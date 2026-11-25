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
 if(!m)throw Error("只接受社区 auth 包名及精确版本");
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
 async config(){const c=JSON.parse(await readFile(this.file,"utf8"));if(!Array.isArray(c.plugins))throw Error("plugins 必须是数组");return c;}
 async search(query){
  const data=await this.json("https://registry.npmjs.org/-/v1/search?size=100&text="+encodeURIComponent("@magpie-community/opencode- "+query));
  return (data.objects||[]).map(x=>x.package).filter(p=>{try{return parse(p.name).name!==withdrawn}catch{return false}}).map(p=>({name:p.name,version:p.version,description:p.description}));
 }
 async list(){return (await this.config()).plugins;}
 async mutate(action,input,confirm){
  if(!["install","remove"].includes(action))throw Error("未知操作");
  const {name,version}=parse(input);
  if(action==="install"&&name===withdrawn)throw Error("Antigravity 插件已撤回，不提供安装；agy-cli 不受影响");
  if(!await confirm(name))return "已取消";
  const lock=path.join(this.state,"plugins.lock");
  try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==="EEXIST")throw Error("另一个插件操作正在运行；如进程已退出，请手动清理 plugins.lock");throw e}
  let stage;
  try{
   const before=await readFile(this.file,"utf8"),c=JSON.parse(before);
   if(!Array.isArray(c.plugins))throw Error("plugins 必须是数组");
   const matches=c.plugins.filter(p=>p.spec===name||p.spec?.startsWith(name+"@"));
   const managedRoot=path.join(path.resolve(this.state),"managed-plugins");
   if(matches.some(p=>!p.magpieManaged||typeof p.target!=="string"||!path.resolve(p.target).startsWith(managedRoot+path.sep)))throw Error("拒绝覆盖手动配置");
   if(action==="remove"){
    c.plugins=c.plugins.filter(p=>!matches.includes(p));
   }else{
    const metadata=await this.json("https://registry.npmjs.org/"+encodeURIComponent(name));
    const resolved=version||metadata["dist-tags"]?.latest;
    parse(name+"@"+resolved);
    if(!metadata.versions?.[resolved])throw Error("版本不存在");
    const root=path.join(this.state,"managed-plugins");
    await mkdir(root,{recursive:true,mode:0o700});
    if((await lstat(root)).isSymbolicLink()||await realpath(root)!==path.join(await realpath(this.state),"managed-plugins"))throw Error("managed-plugins 不允许符号链接");
    stage=await mkdtemp(path.join(root,"pkg-"));
    await writeFile(path.join(stage,"package.json"),'{"private":true}',{mode:0o600});
    await this.runner("npm",["install","--ignore-scripts","--save-exact","--no-audit","--no-fund","--registry=https://registry.npmjs.org",name+"@"+resolved],{cwd:stage,timeout:120000,maxBuffer:1024*1024});
    const target=path.join(stage,"node_modules",name);
    const installed=JSON.parse(await readFile(path.join(target,"package.json"),"utf8"));
    if(installed.name!==name||installed.version!==resolved)throw Error("安装包元数据不匹配");
    c.plugins=c.plugins.filter(p=>!matches.includes(p));
    await writeFile(path.join(stage,".magpie-owned.json"),JSON.stringify({id:path.basename(stage),spec:name+"@"+resolved}),{mode:0o600,flag:"wx"});
    c.plugins.push({spec:name+"@"+resolved,target,magpieManaged:true});
   }
   c.pendingPluginDeletes=[...(Array.isArray(c.pendingPluginDeletes)?c.pendingPluginDeletes:[]),...matches.map(p=>this.stageEntry(p)).filter(Boolean)];
   if(await readFile(this.file,"utf8")!==before)throw Error("配置在操作中改变，请重试");
   const tmp=path.join(lock,"config.json");
   await writeFile(tmp,JSON.stringify(c,null,2)+"\n",{mode:0o600,flag:"wx"});
   await rename(tmp,this.file);stage=undefined;
   return "已更新配置，请重启 Pi。安装成功不代表兼容。凭据保留；旧托管安装将在下次启动、host 启动前清理，当前插件不受影响。";
  }finally{if(stage)await rm(stage,{recursive:true,force:true});await rm(lock,{recursive:true,force:true})}
 }
}
export function registerPlugins(pi,state,dependencies={}){
 const manager=new PluginManager(state,dependencies);
 pi.registerCommand("magpie-plugins",{description:"社区插件 help/search/install/list/remove",handler:async(args,ctx)=>{
  try{
   const [action="help",...rest]=args.trim().split(/\s+/),input=rest.join(" ");
   let result;
   if(action==="search")result=JSON.stringify(await manager.search(input),null,2);
   else if(action==="list")result=JSON.stringify(await manager.list(),null,2);
   else if(["install","remove"].includes(action)){
    if(!ctx.hasUI)throw Error("需要交互界面明确确认，拒绝修改");
    result=await manager.mutate(action,input,name=>ctx.ui.confirm(action+" "+name,"第三方插件运行时拥有当前用户全部权限。npm 禁用安装脚本不能隔离运行代码。移除保留凭据，旧托管目录下次启动删除（更新也会清理旧版本）。继续？"));
   }else result="/magpie-plugins search 查询 | install 包名[@精确版本] | list | remove 包名；别名 cursor/workbuddy。仅搜索社区 auth 包，不保证兼容。";
   ctx.ui.notify(result,"info");
  }catch(e){ctx.ui.notify(String(e),"error")}
 }});
}
