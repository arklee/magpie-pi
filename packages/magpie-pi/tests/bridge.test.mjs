import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,stat} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Bridge} from "../extension/bridge.mjs";
const root=fileURLToPath(new URL("..",import.meta.url));
test("real Go/Bun host: login, discovery, streaming, tools, abort, persistence",async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),"magpie-pi-"));
 const start=async()=>{
  const b=new Bridge(path.join(root,"bin/magpie-pi"),path.join(root,"vendor/host.js"),state);
  const init=await b.call("init",{authPath:path.join(state,"plugin-auth.json"),directory:state,plugins:[{spec:"fixture",target:path.join(root,"tests/fixture.mjs")}]});
  assert.equal(init.plugins[0].error,undefined);
  return b;
 };
 let b=await start();
 try{
  let rows=await b.call("providers");assert.equal(rows[0].id,"fixture");
  const login=await b.call("authorize",{provider:"fixture",method:0});
  assert.equal((await b.call("callback",{session:login.session,code:"fixture-code"})).ok,true);
  rows=await b.call("providers");assert.equal(rows[0].signedIn,true);assert.equal(rows[0].models[0].id,"chat");
  const f=b.fetch("fixture",undefined,"@ai-sdk/openai-compatible","chat");
  for(const content of ["hello","tool"]){
   const r=await f("https://fixture.invalid/v1/chat/completions",{method:"POST",body:JSON.stringify({messages:[{role:"user",content}]})});
   assert.match(await r.text(),content==="tool"?/weather/:/Hello fixture/);
  }
  const large=await f("https://fixture.invalid/v1/chat/completions",{method:"POST",body:JSON.stringify({messages:[{role:"user",content:"large"}]})});
  assert.equal((await large.text()).length,512*1024);
  const cancelled=await f("https://fixture.invalid/v1/chat/completions",{method:"POST",body:JSON.stringify({messages:[{role:"user",content:"large"}]})});
  await cancelled.body.cancel();
  assert.equal(b.pending.size,0);
  assert.equal((await b.call("providers"))[0].signedIn,true);
  const ctl=new AbortController();
  const waiting=f("https://fixture.invalid/v1/chat/completions",{method:"POST",body:JSON.stringify({messages:[{role:"user",content:"wait"}]}),signal:ctl.signal});
  await new Promise(r=>setTimeout(r,30));
  ctl.abort();await assert.rejects(waiting);
  assert.equal((await b.call("providers"))[0].signedIn,true);
  assert.equal((await stat(path.join(state,"plugin-auth.json"))).mode&0o777,0o600);
  b.close();
  await new Promise(r=>b.child.once("exit",r));
  b=await start();assert.equal((await b.call("providers"))[0].signedIn,true);
 }finally{b.close();await new Promise(r=>b.child.once("exit",r));await rm(state,{recursive:true,force:true});}
});
