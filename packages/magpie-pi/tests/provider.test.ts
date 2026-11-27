import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm,readFile,stat} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import extension from "../extension/index";
import {normalizeContext} from "@earendil-works/pi-ai/utils/transcript";
// This suite runs under Bun. Use that executable for all fixture hosts.
const previousBun=process.env.MAGPIE_PI_BUN;
before(()=>{process.env.MAGPIE_PI_BUN=process.execPath});
after(()=>{if(previousBun===undefined)delete process.env.MAGPIE_PI_BUN;else process.env.MAGPIE_PI_BUN=previousBun});
test("first launch creates private config without starting a host",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"magpie-first-"));
 const state=path.join(root,"new-state");
 const previous=process.env.MAGPIE_PI_STATE;
 process.env.MAGPIE_PI_STATE=state;
 try{
  let start:any,command:any;
  const api={registerCommand(name:string,definition:any){assert.equal(name,"magpie-plugins");command=definition;},registerProvider(){assert.fail("no providers configured")},on(event:string,fn:any){assert.equal(event,"session_start");start=fn}};
  await extension(api as any);
  assert.equal(typeof command.handler,"function");
  const file=path.join(state,"config.json");
  assert.deepEqual(JSON.parse(await readFile(file,"utf8")),{plugins:[],accounts:{},opencode:{}});
  if(process.platform!=="win32")assert.equal((await stat(file)).mode&0o777,0o600);
  let message="";
  await start({}, {hasUI:true,ui:{notify(text:string){message=text}}});
  assert.ok(message.includes(file));
  await start({}, {hasUI:false});
  const original=await readFile(file,"utf8");
  await extension(api as any);
  assert.equal(await readFile(file,"utf8"),original);
  await writeFile(file,"invalid json");
  await assert.rejects(()=>extension(api as any),SyntaxError);
  assert.equal(await readFile(file,"utf8"),"invalid json");
 }finally{
  if(previous===undefined)delete process.env.MAGPIE_PI_STATE;else process.env.MAGPIE_PI_STATE=previous;
  await rm(root,{recursive:true,force:true});
 }
});
test("Pi provider delivers text and tools through its native SDK",async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),"magpie-provider-"));
 process.env.MAGPIE_PI_STATE=state;
 await writeFile(path.join(state,"config.json"),JSON.stringify({plugins:[{spec:"fixture",target:path.resolve("tests/fixture.mjs")}]}));
 let provider:any,shutdown:any;
 try{
 await extension({registerCommand(){},registerProvider(p:any){provider=p},on(_e:any,f:any){shutdown=f}} as any);
 assert.equal(provider.id,"magpie-fixture");
 await provider.auth.apiKey.login({signal:new AbortController().signal,prompt:async(p:any)=>p.type==="select"?"0":"fixture-code",notify(){}});
 assert.equal(await provider.auth.apiKey.resolve({}),undefined);
 assert.deepEqual(await provider.auth.apiKey.resolve({credential:{type:"api_key",key:"plugin-owned"}}),{auth:{apiKey:"plugin-owned"}});
 assert.equal(await provider.auth.apiKey.resolve({credential:undefined}),undefined);
 const model=provider.getModels()[0];
 for(const content of ["hello","tool"]){
  const stream=provider.streamSimple(model,normalizeContext({messages:[{role:"user",content,timestamp:Date.now()}]}),{});
  const result=await stream.result();
  assert.notEqual(result.stopReason,"error",result.errorMessage);
  assert.equal(result.content[0].type,content==="tool"?"toolCall":"text");
 }
 }finally{await shutdown?.();delete process.env.MAGPIE_PI_STATE;await new Promise(r=>setTimeout(r,100));await rm(state,{recursive:true,force:true})}
});

test("failed plugin initialization leaves manager accessible and notifies on session start",async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),"magpie-broken-"));
 const previous=process.env.MAGPIE_PI_STATE;
 process.env.MAGPIE_PI_STATE=state;
 try{
  await writeFile(path.join(state,"config.json"),JSON.stringify({plugins:[{spec:"broken",target:path.join(state,"missing.mjs")}]}));
  let command:any;const events:Record<string,any>={};
  await extension({registerCommand(_name:any,c:any){command=c},registerProvider(){assert.fail("broken provider")},on(event:any,fn:any){events[event]=fn}} as any);
  assert.equal(typeof command.handler,"function");
  let notice="";
  const ctx={hasUI:true,ui:{notify(text:string){notice=text}}};
  await events.session_start({},ctx);
  assert.ok(notice.includes("/magpie-plugins"));
  await command.handler("list",ctx);
  assert.ok(notice.includes("broken"));
  await events.session_shutdown();
 }finally{
  if(previous===undefined)delete process.env.MAGPIE_PI_STATE;else process.env.MAGPIE_PI_STATE=previous;
  await rm(state,{recursive:true,force:true});
 }
});

test("embedding API starts the host once and returns working providers",async()=>{
 const {startMagpie}=await import("../extension/embed.mjs");
 const root=await mkdtemp(path.join(os.tmpdir(),"magpie-embed-"));
 try{
  const empty=await startMagpie({state:path.join(root,"empty")});
  assert.deepEqual([empty.providers,empty.errors],[[],[]]);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,"empty","config.json"),"utf8")).plugins,[]);
  await empty.close();

  const badState=path.join(root,"bad");
  await import("node:fs/promises").then(fs=>fs.mkdir(badState));
  await writeFile(path.join(badState,"config.json"),JSON.stringify({plugins:[{spec:"broken",target:path.join(badState,"missing.mjs")}]}));
  const bad=await startMagpie({state:badState});
  assert.equal(bad.providers.length,0);
  assert.equal(bad.errors.length,1);
  await bad.close();
  await bad.close();

  const state=path.join(root,"fixture");
  await import("node:fs/promises").then(fs=>fs.mkdir(state));
  await writeFile(path.join(state,"config.json"),JSON.stringify({plugins:[{spec:"fixture",target:path.resolve("tests/fixture.mjs")}]}));
  const host=await startMagpie({state});
  try{
   assert.deepEqual(host.errors,[]);
   const provider:any=host.providers[0];
   assert.equal(provider.id,"magpie-fixture");
   await provider.auth.apiKey.login({signal:new AbortController().signal,prompt:async(p:any)=>p.type==="select"?"0":"fixture-code",notify(){}});
   const stream=provider.streamSimple(provider.getModels()[0],normalizeContext({messages:[{role:"user",content:"hello",timestamp:Date.now()}]}),{});
   const result=await stream.result();
   assert.notEqual(result.stopReason,"error",result.errorMessage);
  }finally{await host.close();}
  assert.equal(process.env.MAGPIE_PI_EMBEDDED,"1");
 }finally{delete process.env.MAGPIE_PI_EMBEDDED;await new Promise(r=>setTimeout(r,100));await rm(root,{recursive:true,force:true})}
});

test("the Pi extension stays inactive in a process that embeds magpie",async()=>{
 const previous=process.env.MAGPIE_PI_EMBEDDED;
 process.env.MAGPIE_PI_EMBEDDED="1";
 try{
  await extension({registerCommand(){assert.fail("no command")},registerProvider(){assert.fail("no provider")},on(){assert.fail("no handlers")}} as any);
 }finally{if(previous===undefined)delete process.env.MAGPIE_PI_EMBEDDED;else process.env.MAGPIE_PI_EMBEDDED=previous;}
});
