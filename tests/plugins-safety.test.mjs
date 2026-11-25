import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink,readdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PluginManager,registerPlugins,parse} from "../extension/plugins.mjs";
const name="@magpie-community/opencode-cursor-auth";
const fetcher=async()=>({ok:true,json:async()=>({"dist-tags":{latest:"1.2.3"},versions:{"1.2.3":{}}})});
async function fixture(fn){
 const state=await mkdtemp(path.join(os.tmpdir(),"magpie-safety-"));
 await writeFile(path.join(state,"config.json"),JSON.stringify({plugins:[],accounts:{cursor:"secret"},unrelated:42}));
 try{await fn(state)}finally{await rm(state,{recursive:true,force:true})}
}
async function install(_cmd,_args,{cwd}){
 const target=path.join(cwd,"node_modules",name);
 await mkdir(target,{recursive:true});
 await writeFile(path.join(target,"package.json"),JSON.stringify({name,version:"1.2.3"}));
}
test("real overlapping operations reject under the lock",()=>fixture(async state=>{
 let entered,release;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const first=new PluginManager(state,{fetcher,runner:async(...args)=>{entered();await gate;await install(...args)}});
 const pending=first.mutate("install","cursor@1.2.3",async()=>true);
 await started;
 try{
  const second=new PluginManager(state,{fetcher,runner:async()=>assert.fail("second runner")});
  await assert.rejects(()=>second.mutate("remove","cursor",async()=>true),/另一个/);
 }finally{release();await pending}
 assert.equal((await first.list()).length,1);
 assert.deepEqual(parse("workbuddy@1.2.3"),{name:"@magpie-community/opencode-workbuddy-auth",version:"1.2.3"});
}));
test("command refuses noninteractive mutations, handles cancellation and HTTP errors",()=>fixture(async state=>{
 let command,confirmations=0;
 registerPlugins({registerCommand(_name,c){command=c}},state,{
  fetcher:async()=>({ok:false,status:503}),runner:async()=>assert.fail("must not run")
 });
 const notices=[],ctx={hasUI:false,ui:{confirm:async()=>{confirmations++;return false},notify:(text)=>notices.push(text)}};
 const before=await readFile(path.join(state,"config.json"),"utf8");
 for(const verb of ["install","remove"]){
  await command.handler(verb+" cursor",ctx);assert.match(notices.pop(),/拒绝修改/);
 }
 assert.equal(confirmations,0);ctx.hasUI=true;
 for(const verb of ["install","remove"]){
  await command.handler(verb+" cursor",ctx);assert.equal(notices.pop(),"已取消");
 }
 assert.equal(confirmations,2);
 await command.handler("search cursor",ctx);assert.match(notices.pop(),/HTTP 503/);
 assert.equal(await readFile(path.join(state,"config.json"),"utf8"),before);
}));
test("symlink managed root is refused without touching destination",()=>fixture(async state=>{
 const outside=await mkdtemp(path.join(os.tmpdir(),"magpie-outside-"));
 try{
  await symlink(outside,path.join(state,"managed-plugins"),"dir");
  const manager=new PluginManager(state,{fetcher,runner:async()=>assert.fail("must not run")});
  await assert.rejects(()=>manager.mutate("install","cursor",async()=>true),/符号链接/);
  assert.deepEqual(await readdir(outside),[]);
 }finally{await rm(outside,{recursive:true,force:true})}
}));
test("external config change survives aborted activation",()=>fixture(async state=>{
 const file=path.join(state,"config.json");
 const external={plugins:[],accounts:{cursor:"secret"},unrelated:43,newField:"keep"};
 const manager=new PluginManager(state,{fetcher,runner:async(...args)=>{
  await install(...args);await writeFile(file,JSON.stringify(external));
 }});
 await assert.rejects(()=>manager.mutate("install","cursor",async()=>true),/配置在操作中改变/);
 assert.deepEqual(JSON.parse(await readFile(file,"utf8")),external);
 assert.deepEqual(await readdir(path.join(state,"managed-plugins")),[]);
}));
