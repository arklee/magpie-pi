import {readFile,mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import os from "node:os";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import * as anthropic from "@earendil-works/pi-ai/api/anthropic-messages";
import {Bridge} from "./bridge.mjs";
import {registerPlugins,PluginManager} from "./plugins.mjs";

export default async function(pi:ExtensionAPI){
 const root=fileURLToPath(new URL("..",import.meta.url));
 const state=process.env.MAGPIE_PI_STATE || path.join(os.homedir(),".local","share","magpie-pi");
 registerPlugins(pi,state);
 await new PluginManager(state).cleanup();
 const configPath=path.join(state,"config.json");
 let source:string;
 try {source=await readFile(configPath,"utf8");}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  await mkdir(state,{recursive:true,mode:0o700});
  try {await writeFile(configPath,JSON.stringify({plugins:[],accounts:{},opencode:{}},null,2)+"\n",{flag:"wx",mode:0o600});}
  catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  source=await readFile(configPath,"utf8");
 }
 const config=JSON.parse(source);
 if(!config||!Array.isArray(config.plugins))throw new Error(`magpie-pi: ${configPath} must contain a plugins array`);
 if(config.plugins.length===0){
  pi.on("session_start",async(_event,ctx)=>{
   if(ctx.hasUI)ctx.ui.notify(`No magpie-pi providers configured. Use /magpie-plugins to search and install plugins, or edit ${configPath}; restart Pi after configuration. See ${path.join(root,"README.md")}`,"info");
  });
  return;
 }
 const bridge=new Bridge(path.join(root,"bin",process.platform==="win32"?"magpie-pi.exe":"magpie-pi"),path.join(root,"vendor","host.js"),state,process.env.MAGPIE_PI_BUN);
 pi.on("session_shutdown",async()=>{await bridge.close();});
 try {
 const initialized=await bridge.call("init",{plugins:config.plugins,config:config.opencode || {},authPath:path.join(state,"plugin-auth.json"),directory:state});
 for(const p of initialized.plugins)if(p.error)throw new Error(p.error);
 const rows=await bridge.call("providers");
 for(const initial of rows){
  let row=initial;
  const id="magpie-"+row.id;
  const models=()=>row.models.filter((m:any)=>["@ai-sdk/openai-compatible","@ai-sdk/anthropic"].includes(m.npm)).map((m:any)=>({
   type:"chat",id:m.id,name:m.name||m.id,provider:id,
   api:m.npm==="@ai-sdk/anthropic"?"anthropic-messages":"openai-completions",
   baseUrl:m.url||row.api,reasoning:m.reasoning,input:m.image?["text","image"]:["text"],
   cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:m.context||128000,maxTokens:m.output||8192
  }));
  const stream=(simple:boolean)=>(model:any,context:any,options:any={})=>{
   const m=row.models.find((m:any)=>m.id===model.id);
   const api=model.api==="anthropic-messages"?anthropic:completions;
   return api[simple?"streamSimple":"stream"]({...model,id:m.apiId||model.id},context,{...options,apiKey:"plugin-owned",fetch:bridge.fetch(row.id,config.accounts?.[row.id],m.npm,m.id)});
  };
  pi.registerProvider({
   id,name:row.name||row.id,
   auth:{apiKey:{name:"Plugin-managed account",
    resolve:async({credential})=>credential?.key==="plugin-owned"&&row.signedIn?{auth:{apiKey:"plugin-owned"}}:undefined,
    login:async interaction=>{
     const method=Number(await interaction.prompt({type:"select",message:"Sign-in method",options:row.methods.map((m:any,i:number)=>({id:String(i),label:m.label}))}));
     const m=row.methods[method];let result;
     const inputs:Record<string,string>={};
     while(true){
      const {prompt}=await bridge.call("prompt",{provider:row.id,method,inputs},interaction.signal);
      if(!prompt)break;
      const value=await interaction.prompt(prompt.type==="select"?{
       type:"select",message:prompt.message,options:prompt.options.map((o:any)=>({id:o.value,label:o.label,description:o.hint}))
      }:{type:"secret",message:prompt.message,placeholder:prompt.placeholder});
      const {error}=await bridge.call("validate",{provider:row.id,method,key:prompt.key,value},interaction.signal);
      if(error){interaction.notify({type:"info",message:error});continue;}
      inputs[prompt.key]=value;
     }
     if(m.type==="api"){
      const key=m.keyless||m.keyAsked?"":await interaction.prompt({type:"secret",message:"API key"});
      result=await bridge.call("apiKey",{provider:row.id,method,key,inputs},interaction.signal);
     }else{
      const a=await bridge.call("authorize",{provider:row.id,method,inputs},interaction.signal);
      if(!a.ok)throw new Error(a.error||"Sign-in failed");
      if(a.url)interaction.notify({type:"auth_url",url:a.url,instructions:a.instructions});
      const code=a.method==="code"?await interaction.prompt({type:"manual_code",message:a.instructions||"Authorization code"}):undefined;
      result=await bridge.call("callback",{session:a.session,code},interaction.signal);
     }
     if(!result.ok)throw new Error(result.error||"Sign-in failed");
     row=(await bridge.call("providers")).find((r:any)=>r.id===row.id);
     return {type:"api_key",key:"plugin-owned"};
    }}},
   getModels:models,
   refreshModels:async context=>{
    if(!context.allowNetwork)return;
    const next=(await bridge.call("providers",{},context.signal)).find((r:any)=>r.id===row.id);
    if(!next||next.fellBack)throw new Error(next?.listError||"Model discovery failed");
    await context.publish({update:()=>{row=next}});
   },
   stream:stream(false),streamSimple:stream(true)
  });
 }
 }catch(e){await bridge.close();pi.on("session_start",async(_event,ctx)=>{if(ctx.hasUI)ctx.ui.notify(String(e)+"; use /magpie-plugins to fix the configuration","error")});}
}
