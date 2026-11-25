import {mkdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
await mkdir("bin",{recursive:true});
const targets=process.argv.includes("--all")?[["linux","amd64"],["linux","arm64"],["darwin","amd64"],["darwin","arm64"],["windows","amd64"],["windows","arm64"]]:[[process.platform==="win32"?"windows":process.platform==="darwin"?"darwin":"linux",process.arch==="arm64"?"arm64":"amd64"]];
for(const [os,arch] of targets){
 const suffix=os==="windows"?".exe":"";
 const name=process.argv.includes("--all")?"magpie-pi-"+os+"-"+arch:"magpie-pi";
 execFileSync("go",["build","-trimpath","-ldflags=-s -w","-o","bin/"+name+suffix,"."],{stdio:"inherit",env:{...process.env,CGO_ENABLED:"0",GOOS:os,GOARCH:arch}});
}
