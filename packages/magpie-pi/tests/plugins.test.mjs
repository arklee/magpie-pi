import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink,realpath} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PluginManager,parse} from "../extension/plugins.mjs";
const name="@magpie-community/opencode-cursor-auth";
test("cleanup refuses outside paths, symlink stages and unmarked directories",async()=>{
 const state=await mkdtemp(path.join(os.tmpdir(),"magpie-clean-"));
 const outside=await mkdtemp(path.join(os.tmpdir(),"magpie-outside-"));
 try{
  const root=path.join(state,"managed-plugins");
  await mkdir(root);
  await writeFile(path.join(outside,"keep"),"safe");
  await symlink(outside,path.join(root,"pkg-linked"));
  await mkdir(path.join(root,"pkg-manual"));
  await writeFile(path.join(root,"pkg-manual","keep"),"manual");
  const queue=["../"+path.basename(outside),"pkg-linked","pkg-manual"].map(id=>({id,spec:name+"@1.2.3"}));
  await writeFile(path.join(state,"config.json"),JSON.stringify({plugins:[],pendingPluginDeletes:queue}));
  await new PluginManager(state).cleanup();
  assert.equal(await readFile(path.join(outside,"keep"),"utf8"),"safe");
  assert.equal(await readFile(path.join(root,"pkg-manual","keep"),"utf8"),"manual");
  assert.deepEqual(JSON.parse(await readFile(path.join(state,"config.json"),"utf8")).pendingPluginDeletes,queue);
 }finally{await rm(state,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
});
test("package validation and aliases",()=>{
 assert.equal(parse("cursor").name,name);
 for(const x of ["../bad","cursor;id",name+"@latest","https://evil",name+"@1.2.3 --x"])assert.throws(()=>parse(x));
 assert.equal(parse("@magpie-community/opencode-agy-cli-auth").version,undefined);
});
test("registry, transactional install/remove, failure, cancellation, lock",async()=>{
 // macOS temporary directories can have symlinked ancestors; owned cleanup
 // deliberately requires canonical stage paths.
 const state=await realpath(await mkdtemp(path.join(os.tmpdir(),"magpie-manager-")));
 const file=path.join(state,"config.json");
 const original={plugins:[],accounts:{cursor:"keep"},custom:{preserve:true}};
 await writeFile(file,JSON.stringify(original));
 let runs=0,fail=false;
 const manager=new PluginManager(state,{
  fetcher:async url=>({ok:true,json:async()=>url.includes("/-/v1/search")?{objects:[{package:{name,version:"1.2.3"}},{package:{name:"@magpie-community/opencode-antigravity-auth"}},{package:{name:"unrelated"}}]}:{"dist-tags":{latest:"1.2.3"},versions:{"1.2.3":{}}}}),
  runner:async(command,args,options)=>{
   runs++;assert.equal(command,"npm");assert.ok(args.includes("--ignore-scripts"));assert.ok(args.includes("--save-exact"));
   if(fail)throw Error("download failed");
   const target=path.join(options.cwd,"node_modules",name);
   await mkdir(target,{recursive:true});await writeFile(path.join(target,"package.json"),JSON.stringify({name,version:"1.2.3"}));
  }
 });
 try{
  assert.equal((await manager.search("cursor")).length,1);
  assert.equal(await manager.mutate("install","cursor",async()=>false),"Cancelled");assert.equal(runs,0);
  await assert.rejects(()=>manager.mutate("install","@magpie-community/opencode-antigravity-auth",async()=>true));
  await manager.mutate("install","cursor",async()=>true);
  const saved=await readFile(file,"utf8");
  assert.equal(JSON.parse(saved).plugins[0].spec,name+"@1.2.3");
  fail=true;await assert.rejects(()=>manager.mutate("install","cursor",async()=>true));assert.equal(await readFile(file,"utf8"),saved);
  await mkdir(path.join(state,"plugins.lock"));
  await assert.rejects(()=>manager.mutate("remove","cursor",async()=>true),/Another plugin operation/);
  await rm(path.join(state,"plugins.lock"),{recursive:true});
  await manager.mutate("remove","cursor",async()=>true);
  const oldTarget=JSON.parse(saved).plugins[0].target;
  await readFile(path.join(oldTarget,"package.json"));
  await manager.cleanup();
  await assert.rejects(()=>readFile(path.join(oldTarget,"package.json")),/ENOENT/);
  assert.deepEqual(JSON.parse(await readFile(file,"utf8")),{...original,pendingPluginDeletes:[]});
  await writeFile(file,JSON.stringify({...original,plugins:[{spec:name,target:"/manual"}]}));
  await assert.rejects(()=>manager.mutate("remove","cursor",async()=>true),/manual/);
 }finally{await rm(state,{recursive:true,force:true})}
});
