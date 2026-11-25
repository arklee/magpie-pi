import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import path from "node:path";
const files={"internal/plugin/host.js":"vendor/host.js","LICENSE":"vendor/LICENSE"};
const hash=b=>createHash("sha256").update(b).digest("hex");
if(process.argv[2]==="extract"){
 const source=path.resolve(process.argv[3]);
 const commit=execFileSync("git",["-C",source,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const manifest={repository:"https://github.com/yetone/magpie",commit,patches:[],files:[]};
 for(const [from,to] of Object.entries(files)){
  const bytes=execFileSync("git",["-C",source,"show",commit+":"+from],{maxBuffer:8*1024*1024});
  await writeFile(to,bytes);manifest.files.push({source:from,path:to,sha256:hash(bytes)});
 }
 await writeFile("extraction.json",JSON.stringify(manifest,null,2)+"\n");
}else{
 const m=JSON.parse(await readFile("extraction.json"));
 for(const f of m.files)if(hash(await readFile(f.path))!==f.sha256)throw new Error("Extraction hash mismatch: "+f.path);
 console.log("Pinned extraction verified");
}
