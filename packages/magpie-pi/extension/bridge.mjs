import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
export class Bridge {
 constructor(binary,host,state,bun="bun") {
  this.next=0; this.pending=new Map();
  this.child=spawn(binary,["--host",host,"--state",state,"--bun",bun],{stdio:["pipe","pipe","inherit"],windowsHide:true});
  this.closed=new Promise(resolve=>this.child.once("close",resolve));
  this.child.on("error",e=>this.fail(e));
  this.child.stdin.on("error",e=>this.fail(e));
  this.child.on("exit",()=>this.fail(new Error("plugin supervisor exited")));
  createInterface({input:this.child.stdout}).on("line",line=>{
   try {const m=JSON.parse(line); this.pending.get(m.id)?.(m);} catch(e){this.fail(e);}
  });
 }
 fail(e){this.terminalError ||= e;for(const f of this.pending.values())f({error:{message:e.message}});this.pending.clear();}
 send(m){if(this.terminalError)return;try{this.child.stdin.write(JSON.stringify(m)+"\n");}catch(e){this.fail(e)}}
 call(method,params={},signal){
  if(this.terminalError)return Promise.reject(this.terminalError);
  return new Promise((resolve,reject)=>{
   const id=++this.next;
   const finish=(e,value)=>{this.pending.delete(id);signal?.removeEventListener("abort",abort);e?reject(e):resolve(value)};
   const abort=()=>{this.send({method:"abort",params:{id}});finish(new Error("aborted"))};
   if(signal?.aborted)return reject(new Error("aborted"));
   this.pending.set(id,m=>m.error?finish(new Error(m.error.message)):finish(null,m.result));
   signal?.addEventListener("abort",abort,{once:true});
   this.send({id,method,params});
  });
 }
 fetch(provider,account,npm,model){
  return async (url,init={})=>{
   if(this.terminalError)throw this.terminalError;
   const request=new Request(url,init);
   const body=Buffer.from(await request.arrayBuffer()).toString("base64");
   for(const key of ["authorization","x-api-key"]) if(request.headers.get(key)?.includes("plugin-owned"))request.headers.delete(key);
   if(this.terminalError)throw this.terminalError;
   return new Promise((resolve,reject)=>{
    const id=++this.next; let controller,ended=false,owed=0;
    const abort=()=>{this.send({method:"abort",params:{id}});finish(new Error("aborted"))};
    const finish=(e,cancelled=false)=>{
     if(ended)return;ended=true;this.pending.delete(id);request.signal.removeEventListener("abort",abort);
     if(!cancelled){if(e)controller?.error(e);else controller?.close();}
     if(e)reject(e);
    };
    if(request.signal.aborted)return reject(new Error("aborted"));
    request.signal.addEventListener("abort",abort,{once:true});
    this.pending.set(id,m=>{
     if(m.error)return finish(new Error(m.error.message));
     if(m.event==="head"){
      const stream=new ReadableStream({start(c){controller=c},pull:()=>{
       if(owed){this.send({method:"credit",params:{id,n:owed}});owed=0}
      },cancel:()=>{this.send({method:"abort",params:{id}});finish(undefined,true)}},{highWaterMark:0});
      resolve(new Response(stream,{status:m.status,headers:m.headers}));
     }else if(m.event==="chunk"){
      const bytes=Buffer.from(m.data,"base64");
      owed+=bytes.length+2048;
      controller.enqueue(bytes);
     }else if("result" in m)finish();
    });
    this.send({id,method:"fetch",params:{provider,account,npm,model,url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body,window:65536}});
   });
  };
 }
 close(){this.fail(new Error("plugin bridge closed"));this.child.stdin.end();return this.closed;}
}
