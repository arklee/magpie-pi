export default async function(){
 return {
 config(c){c.provider.fixture={name:"Fixture",npm:"@ai-sdk/openai-compatible",api:"https://fixture.invalid/v1",models:{chat:{name:"Chat",limit:{context:8192,output:1024}}}}},
 auth:{provider:"fixture",methods:[{type:"oauth",label:"Fixture login",prompts:[{type:"text",key:"workspace",message:"Workspace",validate(v){return v==="fixture-code"?undefined:"Use fixture-code"}}],async authorize(){return {url:"https://fixture.invalid/login",method:"code",async callback(code){return code==="fixture-code"?{type:"success",access:"fixture-access",refresh:"fixture-refresh",expires:Date.now()+3600000}:{type:"failed"}}}}}],
 async loader(getAuth){
  if(!(await getAuth())?.access)return {};
  return {apiKey:"fixture",async fetch(url,init){
   const request=JSON.parse(init.body);
   if(request.messages?.some(m=>m.content==="wait"))return new Promise((resolve,reject)=>init.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}));
   if(request.messages?.some(m=>m.content==="large"))return new Response("x".repeat(512*1024));
   const tool=request.messages?.some(m=>m.content==="tool");
   const chunks=tool?[{choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"call_1",type:"function",function:{name:"weather",arguments:'{"city":"Paris"}'}}]},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:"tool_calls"}]}]:[{choices:[{index:0,delta:{role:"assistant",content:"Hello fixture"},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}}];
   return new Response(chunks.map(x=>"data: "+JSON.stringify(x)+"\n\n").join("")+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}});
  }};
 }}
 };
}
