import {readFile,writeFile,mkdir,rename,rm,mkdtemp,lstat,realpath} from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const scope="@magpie-community/opencode-";
const withdrawn=scope+"antigravity-auth";
export function parse(input){
 const alias=/^(cursor|workbuddy)(@.*)?$/.exec(input);
 const value=alias?scope+alias[1]+"-auth"+(alias[2]||""):input;
 const m=/^(@magpie-community\/opencode-[a-z0-9-]+-auth)(?:@([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?))?$/.exec(value);
 if(!m)throw Error("Only community auth package names and exact versions are accepted");
 return {name:m[1],version:m[2]};
}
export class PluginManager{
 constructor(state,{fetcher=fetch,runner=promisify(execFile)}={}){
  this.state=state;this.file=path.join(state,"config.json");this.fetcher=fetcher;this.runner=runner;
 }
 // Queue entries are identifiers, never filesystem paths. Only our marked stages qualify.
 stageEntry(p){
  if(!p.magpieManaged)return;
  const {name,version}=parse(p.spec);
  if(!version)return;
  const root=path.join(path.resolve(this.state),"managed-plugins");
  const relative=path.relative(root,p.target||"");
  const id=relative.split(path.sep)[0];
  if(!/^pkg-[a-zA-Z0-9]+$/.test(id)||p.target!==path.join(root,id,"node_modules",name))return;
  return {id,spec:p.spec};
 }
 async cleanup(){
  const lock=path.join(this.state,"plugins.lock");
  try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==="ENOENT"||e.code==="EEXIST")return;throw e}
  try{
   const before=await readFile(this.file,"utf8"),c=JSON.parse(before);
   if(!Array.isArray(c.pendingPluginDeletes)||!Array.isArray(c.plugins))return;
   const root=path.join(path.resolve(this.state),"managed-plugins");
   const remaining=[];
   for(const entry of c.pendingPluginDeletes){
    try{
     if(!entry||!/^pkg-[a-zA-Z0-9]+$/.test(entry.id))throw Error("invalid stage");
     const {name,version}=parse(entry.spec);
     if(!version)throw Error("missing version");
     const dir=path.join(root,entry.id);
     if(c.plugins.some(p=>typeof p.target==="string"&&(path.resolve(p.target)===dir||path.resolve(p.target).startsWith(dir+path.sep))))throw Error("still referenced");
     if((await lstat(root)).isSymbolicLink()||await realpath(root)!==path.join(await realpath(this.state),"managed-plugins"))throw Error("unsafe root");
     let stat;
     try{stat=await lstat(dir)}catch(e){if(e.code==="ENOENT")continue;throw e}
     if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(dir)!==dir)throw Error("unsafe stage");
     const marker=path.join(dir,".magpie-owned.json");
     if(!(await lstat(marker)).isFile()||(await lstat(marker)).isSymbolicLink())throw Error("unsafe marker");
     if(await readFile(marker,"utf8")!==JSON.stringify({id:entry.id,spec:name+"@"+version}))throw Error("not owned");
     // rm does not follow nested symlinks.
     await rm(dir,{recursive:true,force:true});
    }catch{remaining.push(entry)}
   }
   if(await readFile(this.file,"utf8")!==before)return;
   c.pendingPluginDeletes=remaining;
   const tmp=path.join(lock,"config.json");
   await writeFile(tmp,JSON.stringify(c,null,2)+"\n",{mode:0o600,flag:"wx"});
   await rename(tmp,this.file);
  }finally{await rm(lock,{recursive:true,force:true})}
 }
 async json(url){
  const r=await this.fetcher(url,{signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error("Registry HTTP "+r.status);
  return r.json();
 }
 async config(){const c=JSON.parse(await readFile(this.file,"utf8"));if(!Array.isArray(c.plugins))throw Error("plugins must be an array");return c;}
 async search(query){
  const data=await this.json("https://registry.npmjs.org/-/v1/search?size=100&text="+encodeURIComponent("@magpie-community/opencode- "+query));
  return (data.objects||[]).map(x=>x.package).filter(p=>{try{return parse(p.name).name!==withdrawn}catch{return false}}).map(p=>({name:p.name,version:p.version,description:p.description}));
 }
 async list(){return (await this.config()).plugins;}
 async mutate(action,input,confirm){
  if(!["install","remove"].includes(action))throw Error("Unknown operation");
  const {name,version}=parse(input);
  if(action==="install"&&name===withdrawn)throw Error("The Antigravity plugin has been withdrawn and cannot be installed; agy-cli is unaffected");
  if(!await confirm(name))return "Cancelled";
  const lock=path.join(this.state,"plugins.lock");
  try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==="EEXIST")throw Error("Another plugin operation is running. If that process has exited, manually remove plugins.lock");throw e}
  let stage;
  try{
   const before=await readFile(this.file,"utf8"),c=JSON.parse(before);
   if(!Array.isArray(c.plugins))throw Error("plugins must be an array");
   const matches=c.plugins.filter(p=>p.spec===name||p.spec?.startsWith(name+"@"));
   const managedRoot=path.join(path.resolve(this.state),"managed-plugins");
   if(matches.some(p=>!p.magpieManaged||typeof p.target!=="string"||!path.resolve(p.target).startsWith(managedRoot+path.sep)))throw Error("Refusing to overwrite manual configuration");
   if(action==="remove"){
    c.plugins=c.plugins.filter(p=>!matches.includes(p));
   }else{
    const metadata=await this.json("https://registry.npmjs.org/"+encodeURIComponent(name));
    const resolved=version||metadata["dist-tags"]?.latest;
    parse(name+"@"+resolved);
    if(!metadata.versions?.[resolved])throw Error("Version not found");
    const root=path.join(this.state,"managed-plugins");
    await mkdir(root,{recursive:true,mode:0o700});
    if((await lstat(root)).isSymbolicLink()||await realpath(root)!==path.join(await realpath(this.state),"managed-plugins"))throw Error("managed-plugins must not be a symlink");
    stage=await mkdtemp(path.join(root,"pkg-"));
    await writeFile(path.join(stage,"package.json"),'{"private":true}',{mode:0o600});
    await this.runner("npm",["install","--ignore-scripts","--save-exact","--no-audit","--no-fund","--registry=https://registry.npmjs.org",name+"@"+resolved],{cwd:stage,timeout:120000,maxBuffer:1024*1024});
    const target=path.join(stage,"node_modules",name);
    const installed=JSON.parse(await readFile(path.join(target,"package.json"),"utf8"));
    if(installed.name!==name||installed.version!==resolved)throw Error("Installed package metadata does not match");
    c.plugins=c.plugins.filter(p=>!matches.includes(p));
    await writeFile(path.join(stage,".magpie-owned.json"),JSON.stringify({id:path.basename(stage),spec:name+"@"+resolved}),{mode:0o600,flag:"wx"});
    c.plugins.push({spec:name+"@"+resolved,target,magpieManaged:true});
   }
   c.pendingPluginDeletes=[...(Array.isArray(c.pendingPluginDeletes)?c.pendingPluginDeletes:[]),...matches.map(p=>this.stageEntry(p)).filter(Boolean)];
   if(await readFile(this.file,"utf8")!==before)throw Error("Configuration changed during the operation; please retry");
   const tmp=path.join(lock,"config.json");
   await writeFile(tmp,JSON.stringify(c,null,2)+"\n",{mode:0o600,flag:"wx"});
   await rename(tmp,this.file);stage=undefined;
   return "Configuration updated. Restart Pi to apply changes. Installation does not guarantee compatibility. Credentials are preserved; old managed installations will be cleaned up before the host starts next time. Currently running plugins are unaffected.";
  }finally{if(stage)await rm(stage,{recursive:true,force:true});await rm(lock,{recursive:true,force:true})}
 }
}
const help="/magpie-plugins search QUERY | install PACKAGE[@EXACT_VERSION] | list | remove PACKAGE. Aliases: cursor/workbuddy. Searches community auth packages only; compatibility is not guaranteed.";
async function change(manager,ctx,action,input){
 return manager.mutate(action,input,async()=>{
  const ok=await ctx.ui.confirm(action+" "+input,"Third-party plugins run with your user permissions. Disabling npm install scripts does not sandbox runtime code. Removal preserves credentials; old managed directories are deleted on next startup (including versions replaced by updates). Continue?");
  if(ok)ctx.ui.notify((action==="install"?"Installing":"Removing")+"…","info");
  return ok;
 });
}
// One selection path per invocation: Escape always exits, never reopens a prompt.
export async function pluginMenu(manager,ctx){
 const choice=await ctx.ui.select("Magpie Community Plugins",["Search and install","Installed plugins / details","Uninstall","Install by package name","Help"]);
 if(!choice)return;
 if(choice==="Help"){ctx.ui.notify(help,"info");return}
 if(choice==="Install by package name"){
  const input=await ctx.ui.input("Package name[@EXACT_VERSION]","cursor / workbuddy");
  if(input?.trim())ctx.ui.notify(await change(manager,ctx,"install",input.trim()),"info");
  return;
 }
 if(choice==="Search and install"){
  const query=await ctx.ui.input("Search community plugins","cursor / workbuddy");
  if(!query?.trim())return;
  ctx.ui.notify("Searching npm…","info");
  const results=await manager.search(query.trim());
  if(!results.length){ctx.ui.notify("No results found","info");return}
  const labels=results.map((p,i)=>`${i+1}. ${p.name}@${p.version} — ${p.description||"No description"}`);
  const selected=await ctx.ui.select("Select a plugin to install (compatibility not guaranteed)",labels);
  const p=results[labels.indexOf(selected)];
  if(!p)return;
  const spec=p.name+"@"+p.version;
  if(!parse(spec).version)throw Error("Search result is missing an exact version");
  ctx.ui.notify(await change(manager,ctx,"install",spec),"info");
  return;
 }
 const all=await manager.list();
 const owned=p=>!!manager.stageEntry(p);
 const entries=choice==="Uninstall"?all.filter(owned):all;
 if(!entries.length){ctx.ui.notify((choice==="Uninstall"?"No managed plugins to uninstall":"No installed plugins"),"info");return}
 const labels=entries.map((p,i)=>`${i+1}. ${p.spec||p.target} [${owned(p)?"Managed":"Manual / read-only"}]`);
 const selected=await ctx.ui.select(choice,labels);
 const p=entries[labels.indexOf(selected)];
 if(!p)return;
 ctx.ui.notify(`${p.spec||"Manual plugin"}\nPath: ${p.target}\n${owned(p)?"Managed; removal preserves credentials and cleans up files on next startup":"Read-only: cannot be modified through this menu"}`,"info");
 if(!owned(p))return;
 if(choice!=="Uninstall"&&await ctx.ui.select("Plugin actions",["Uninstall","Close"])!=="Uninstall")return;
 ctx.ui.notify(await change(manager,ctx,"remove",p.spec),"info");
}
export function registerPlugins(pi,state,dependencies={}){
 const manager=new PluginManager(state,dependencies);
 pi.registerCommand("magpie-plugins",{description:"Community plugin menu and help/search/install/list/remove",handler:async(args,ctx)=>{
  try{
   if(!args.trim()&&ctx.hasUI)return await pluginMenu(manager,ctx);
   const [action="help",...rest]=args.trim().split(/\s+/),input=rest.join(" ");
   let result;
   if(action==="search")result=JSON.stringify(await manager.search(input),null,2);
   else if(action==="list")result=JSON.stringify(await manager.list(),null,2);
   else if(["install","remove"].includes(action)){
    if(!ctx.hasUI)throw Error("Changes refused: explicit confirmation in an interactive UI is required");
    result=await manager.mutate(action,input,name=>ctx.ui.confirm(action+" "+name,"Third-party plugins run with your user permissions. Disabling npm install scripts does not sandbox runtime code. Removal preserves credentials; old managed directories are deleted on next startup (including versions replaced by updates). Continue?"));
   }else result="/magpie-plugins search QUERY | install PACKAGE[@EXACT_VERSION] | list | remove PACKAGE. Aliases: cursor/workbuddy. Searches community auth packages only; compatibility is not guaranteed.";
   ctx.ui.notify(result,"info");
  }catch(e){ctx.ui.notify(String(e),"error")}
 }});
}
