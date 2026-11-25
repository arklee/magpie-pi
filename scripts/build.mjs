import {mkdir,copyFile,rename,rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {supervisorPath} from "../extension/platform.mjs";
if(!process.argv.includes("--all"))supervisorPath(".");
await mkdir("bin",{recursive:true});
const targets=process.argv.includes("--all")?[["linux","amd64"],["linux","arm64"],["darwin","amd64"],["darwin","arm64"],["windows","amd64"],["windows","arm64"]]:[[process.platform==="win32"?"windows":process.platform==="darwin"?"darwin":"linux",process.arch==="arm64"?"arm64":"amd64"]];
for(const [os,arch] of targets){
 const suffix=os==="windows"?".exe":"";
 const name="magpie-pi-"+os+"-"+arch;
 execFileSync("go",["build","-trimpath","-ldflags=-s -w","-o","bin/"+name+suffix,"."],{stdio:"inherit",env:{...process.env,CGO_ENABLED:"0",GOOS:os,GOARCH:arch}});
 if(!process.argv.includes("--all")){
  const alias="bin/magpie-pi"+suffix;
  const temporary=alias+".tmp-"+process.pid;
  try {
   await copyFile("bin/"+name+suffix,temporary);
   await rename(temporary,alias);
  }finally{await rm(temporary,{force:true});}
 }
}
