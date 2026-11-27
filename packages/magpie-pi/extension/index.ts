import path from "node:path";
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerPlugins,PluginManager} from "./plugins.mjs";
import {createProviders,defaultState,loadConfig,packageRoot,startBridge} from "./providers.mjs";

export default async function(pi:ExtensionAPI){
 // A host in this process already runs magpie through the embedding API (embed.mjs): stay inactive
 // so providers are not registered twice and no second plugin host starts.
 if(process.env.MAGPIE_PI_EMBEDDED==="1")return;
 const state=defaultState();
 registerPlugins(pi,state);
 await new PluginManager(state).cleanup();
 const {config,configPath}=await loadConfig(state);
 if(config.plugins.length===0){
  pi.on("session_start",async(_event,ctx)=>{
   if(ctx.hasUI)ctx.ui.notify(`No magpie-pi providers configured. Use /magpie-plugins to search and install plugins, or edit ${configPath}; restart Pi after configuration. See ${path.join(packageRoot,"README.md")}`,"info");
  });
  return;
 }
 let bridge:Awaited<ReturnType<typeof startBridge>>;
 try {bridge=await startBridge(state);}catch(e){
  pi.on("session_start",async(_event,ctx)=>{if(ctx.hasUI)ctx.ui.notify(String(e),"error")});
  return;
 }
 pi.on("session_shutdown",async()=>{await bridge.close();});
 try {
  for(const provider of await createProviders(bridge,config,state))pi.registerProvider(provider as any);
 }catch(e){await bridge.close();pi.on("session_start",async(_event,ctx)=>{if(ctx.hasUI)ctx.ui.notify(String(e)+"; use /magpie-plugins to fix the configuration","error")});}
}
