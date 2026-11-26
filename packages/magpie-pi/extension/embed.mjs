// Embedding API for hosts that run Pi through its SDK with one shared model runtime across
// sessions (for example a GUI backend). The Pi extension starts one plugin host per Pi process
// and registers providers per session; an embedder instead starts the host once, registers the
// returned providers in its own runtime, and restarts the host to apply plugin changes.
//
//   import {startMagpie, PluginManager} from "magpie-pi/embed";
//   const magpie = await startMagpie();
//   for (const provider of magpie.providers) modelRuntime.registerProvider(provider.id, provider);
//   ...
//   await magpie.close();
import {PluginManager} from "./plugins.mjs";
import {createProviders,defaultState,loadConfig,startBridge} from "./providers.mjs";

export {PluginManager,parse} from "./plugins.mjs";
export {defaultState} from "./providers.mjs";

/**
 * Start magpie: mark the process as embedding (MAGPIE_PI_EMBEDDED=1, which keeps the Pi extension
 * inactive in it), clean up deferred plugin deletions, read the config, start the plugin host and build
 * Pi provider definitions. Never throws for configuration or plugin problems: they are returned in
 * `errors` (with no providers) so the embedder keeps working; `close()` is always safe to call.
 *
 * @param {{state?: string, bun?: string}} [options]
 * @returns {Promise<{state: string, configPath: string, providers: any[], errors: string[], close: () => Promise<void>}>}
 */
export async function startMagpie(options={}){
 // The Pi extension, if also installed (any source), stays inactive in this process.
 process.env.MAGPIE_PI_EMBEDDED="1";
 const state=options.state||defaultState();
 const none=async()=>{};
 await new PluginManager(state).cleanup();
 let loaded;
 try {loaded=await loadConfig(state);}
 catch(e){return {state,configPath:"",providers:[],errors:[String(e)],close:none};}
 const {config,configPath}=loaded;
 if(config.plugins.length===0)return {state,configPath,providers:[],errors:[],close:none};
 let bridge;
 try {bridge=startBridge(state,options.bun);}
 catch(e){return {state,configPath,providers:[],errors:[String(e)],close:none};}
 const close=()=>bridge.close().then(()=>undefined);
 try {
  return {state,configPath,providers:await createProviders(bridge,config,state),errors:[],close};
 }catch(e){
  await close();
  return {state,configPath,providers:[],errors:[String(e)],close:none};
 }
}
