import {test} from "node:test";
import assert from "node:assert/strict";
import {pluginMenu,registerPlugins} from "../extension/plugins.mjs";
const name="@magpie-community/opencode-cursor-auth";
function fixture(answers=[],items=[]){
 const calls=[],notes=[];
 const manager={
  search:async q=>{calls.push(["search",q]);return items},
  list:async()=>{calls.push(["list"]);return items},
  stageEntry:p=>p.magpieManaged?{}:undefined,
  mutate:async(a,s,confirm)=>{const ok=await confirm();calls.push([a,s,ok]);return ok?"done":"cancelled"}
 };
 const take=options=>{assert.ok(answers.length,"unexpected prompt");const a=answers.shift();return typeof a==="number"?options[a]:a};
 const ctx={hasUI:true,ui:{select:async(t,o)=>take(o),input:async()=>take([]),confirm:async()=>take([]),notify:(s)=>notes.push(s)}};
 return {manager,ctx,calls,notes,answers};
}
test("menu cancellation at every search prompt and confirmation",async()=>{
 for(const answers of [[undefined],[0,undefined],[0,"  "],[0,"cursor",undefined],[0,"cursor",0,false],[0,"cursor",0,undefined]]){
  const f=fixture(answers,[{name,version:"1.2.3",description:"fixture"}]);
  await pluginMenu(f.manager,f.ctx);
  assert.ok(!f.calls.some(c=>c[0]==="install"&&c[2]));
  if(f.calls.length)assert.equal(f.calls[0][0],"search");
 }
});
test("search pins selection and preserves explicit confirmation",async()=>{
 const f=fixture([0,"cursor",0,true],[{name,version:"1.2.3",description:"fixture"}]);
 await pluginMenu(f.manager,f.ctx);
 assert.deepEqual(f.calls,[["search","cursor"],["install",name+"@1.2.3",true]]);
});
test("empty search/list/uninstall and cancelled direct install",async()=>{
 for(const answers of [[0,"missing"],[1],[2],[3,undefined]]){
  const f=fixture(answers);await pluginMenu(f.manager,f.ctx);
  assert.ok(!f.calls.some(c=>["install","remove"].includes(c[0])));
 }
});
test("manual entries are read-only, owned details allow confirmed removal",async()=>{
 const manual=fixture([1,0],[{spec:name,target:"/manual"}]);
 await pluginMenu(manual.manager,manual.ctx);
 assert.match(manual.notes.join(" "),/read-only/i);
 assert.deepEqual(manual.calls,[["list"]]);
 for(const answers of [[1,0,undefined],[1,0,0,false],[2,0,true]]){
  const expected=answers.at(-1)===true?1:0;
  const f=fixture(answers,[{spec:name+"@1.2.3",target:"/managed",magpieManaged:true}]);
  await pluginMenu(f.manager,f.ctx);
  assert.equal(f.calls.filter(c=>c[0]==="remove"&&c[2]).length,expected);
 }
});
test("noninteractive bare help and mutation refusal never prompt or fetch",async()=>{
 let handler;
 registerPlugins({registerCommand:(n,c)=>handler=c.handler},"/nonexistent",{fetcher:()=>{throw Error("unexpected fetch")}});
 const notes=[];
 const ctx={hasUI:false,ui:{notify:s=>notes.push(s)}};
 await handler("",ctx);await handler("install cursor",ctx);
 assert.match(notes[0],/search/);assert.match(notes[1],/Changes refused/);
});
