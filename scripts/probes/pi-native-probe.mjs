import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadSdk, privateRoot, outputRoot, writeJson, reserveRequest, settleRequest } from './pi-probe-support.mjs';

const live = process.argv.includes('--live');
const mode = live ? 'live' : 'offline';
const trace = [];
const checks = {};
const rawRequests = [];
const payloads = [];
const errors = [];
let executed = 0;
let blockedExecuted = 0;
let contextHits = 0;
let server;
let holdStarted;
let observedDisconnect = false;
const record = (type, data = {}) => trace.push({index:trace.length,type,...data});
const {sdk,agentDir,modelRuntime,model,pin} = await loadSdk(live);
const cwd = path.join(privateRoot, mode+'-workspace');
fs.mkdirSync(cwd,{recursive:true});
// Newly created probe fixtures only; existing project/user/global resources stay unchanged.
fs.writeFileSync(path.join(cwd,'AGENTS.md'),'Probe context marker: EVOFENCE_HOST_CONTEXT. Only use probe tools for this probe.\n');
const skillDir=path.join(agentDir,'skills/host-fixture');fs.mkdirSync(skillDir,{recursive:true});
fs.writeFileSync(path.join(skillDir,'SKILL.md'),'---\nname: host-fixture\ndescription: Native host resource preservation probe.\n---\nHost fixture remains available when the probe extension is attached.\n');
const settings = sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false,provider:{maxRetries:0,timeoutMs:30000}},cacheWarming:'off',packages:[],defaultProjectTrust:'never'});
const extension = pi => {
  pi.on('session_start',(_,ctx)=>{pi.appendEntry('evofence_probe_binding',{version:1,mode});record('extension_session_start',{sessionId:ctx.sessionManager.getSessionId()});});
  pi.on('context',event=>{contextHits++;record('extension_context');return {messages:[...event.messages,{role:'user',content:[{type:'text',text:'EVOFENCE_NODE_CONTEXT: scope=probe'}],timestamp:Date.now()}]};});
  pi.on('tool_call',event=>{record('extension_tool_call',{toolName:event.toolName});if(event.toolName!=='evofence_probe_echo')return {block:true,reason:'Probe authority denies this tool'};});
  pi.on('tool_result',event=>record('extension_tool_result',{toolName:event.toolName,isError:event.isError}));
  pi.on('agent_end',async()=>{record('extension_agent_end_begin');await new Promise(r=>setTimeout(r,15));record('extension_agent_end_done');});
  pi.on('agent_settled',event=>record('extension_agent_settled',{outcome:event.outcome}));
  pi.on('before_provider_request',event=>{
    const payload = event.payload;
    if (payload.model !== model.id) throw new Error('Provider/model drift');
    if (live && payloads.length >= 2) throw new Error('Probe maximum two paid HTTP requests reached');
    const modified={...payload,max_completion_tokens:4096};delete modified.max_tokens;
    assert.equal(modified.thinking?.type,'enabled','Native high must map to thinking.enabled');
    payloads.push({model:modified.model,thinking:modified.thinking,reasoningEffort:modified.reasoning_effort??null,maxOutputTokens:modified.max_completion_tokens,
      hostContextPreserved:JSON.stringify(modified.messages).includes('EVOFENCE_HOST_CONTEXT'),nodeContextInjected:JSON.stringify(modified.messages).includes('EVOFENCE_NODE_CONTEXT'),
      toolNames:(modified.tools??[]).map(t=>t.function?.name),reasoningHistoryPreserved:modified.messages.filter(m=>m.role==='assistant'&&m.tool_calls?.length).every(m=>typeof m.reasoning_content==='string')});
    return modified;
  });
  for (const name of ['evofence_probe_echo','evofence_probe_blocked'])pi.registerTool({name,label:name,description:name==='evofence_probe_echo'?'Echo probe text once.':'Authority-denied probe tool.',parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},
    execute:async(_id,args)=>{if(name==='evofence_probe_blocked')blockedExecuted++;else executed++;return {content:[{type:'text',text:args.text}],details:{probe:true}};}});
};

if (!live) {
  server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const p=JSON.parse(body);rawRequests.push({model:p.model,thinking:p.thinking,maxOutputTokens:p.max_completion_tokens});
    if(JSON.stringify(p.messages).includes('HOLD_FOR_ABORT')){holdStarted?.();res.on('close',()=>{observedDisconnect=true;});return;}
    const toolSeen=p.messages.some(m=>m.role==='tool');
    const delta=toolSeen?{role:'assistant',content:'probe-ok'}:{role:'assistant',reasoning_content:'Probe fixture reasoning.',tool_calls:[
      {index:0,id:'echo-1',type:'function',function:{name:'evofence_probe_echo',arguments:'{"text":"probe-ok"}'}},
      {index:1,id:'blocked-1',type:'function',function:{name:'evofence_probe_blocked',arguments:'{"text":"must-not-execute"}'}}]};
    res.writeHead(200,{'content-type':'text/event-stream'});
    const chunk=(choices,usage)=>({id:'offline-probe',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:p.model,choices,...(usage?{usage}:{})});
    for(const data of [chunk([{index:0,delta,finish_reason:null}]),chunk([{index:0,delta:{},finish_reason:toolSeen?'stop':'tool_calls'}]),chunk([],{prompt_tokens:200,completion_tokens:20,total_tokens:220,prompt_tokens_details:{cached_tokens:0},completion_tokens_details:{reasoning_tokens:4}})])res.write('data: '+JSON.stringify(data)+'\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  modelRuntime.registerProvider('xiaomi',{baseUrl:'http://127.0.0.1:'+server.address().port+'/v1'});
}
const effectiveModel=modelRuntime.getModel('xiaomi',model.id);
const loader=()=>new sdk.DefaultResourceLoader({cwd,agentDir,settingsManager:settings,noExtensions:true,noThemes:true,extensionFactories:[extension]});
const receipts=[];
let requestNumber=0;
const responses=[];
async function makeSession(sessionManager, sessionStartEvent) {
  const resources=loader();await resources.reload();
  const result=await sdk.createAgentSession({cwd,agentDir,modelRuntime,model:effectiveModel,thinkingLevel:'high',settingsManager:settings,resourceLoader:resources,sessionManager,
    tools:['read','evofence_probe_echo','evofence_probe_blocked'],sessionStartEvent});
  const session=result.session;
  await session.bindExtensions({mode:'non_interactive',onError:error=>errors.push({event:error.event,message:error.error?.message??String(error.error)})});
  session.subscribe(event=>{
    if(event.type==='message_update')return;
    record('session_'+event.type,event.type==='message_end'?{role:event.message.role,stopReason:event.message.stopReason}:{});
    if(event.type==='message_end'&&event.message.role==='assistant')receipts.push({provider:event.message.provider,model:event.message.model,stopReason:event.message.stopReason,usage:event.message.usage});
  });
  const nativeStream=session.agent.streamFunction;
  session.agent.streamFunction=(m,context,options)=>nativeStream(m,context,{...options,maxTokens:4096,maxRetries:0,timeoutMs:30000,...(live?{fetch:async(url,init)=>{
    const payload=JSON.parse(init.body);
    if(new URL(String(url)).origin!=='https://api.xiaomimimo.com')throw new Error('Unauthorized provider origin');
    const id='S01-pi-'+Date.now()+'-'+(++requestNumber);
    reserveRequest(payload,id);record('request_reserved',{id});
    try {
      const response=await fetch(url,init);
      const observer=response.clone().text().then(text=>{
        let rawUsage;
        for(const line of text.split('\n'))if(line.startsWith('data: ')&&line.slice(6)!=='[DONE]'){try{const data=JSON.parse(line.slice(6));if(data.usage)rawUsage=data.usage;}catch{/* SSE fragments without usage are irrelevant */}}
        settleRequest(id,rawUsage,response.status);rawRequests.push({id,httpStatus:response.status,usage:rawUsage??null});
      }).catch(()=>{settleRequest(id,undefined,response.status);rawRequests.push({id,httpStatus:response.status,usage:null});});
      responses.push(observer);return response;
    }catch(error){settleRequest(id,undefined,null);throw error;}
  }}:{})});
  assert.equal(session.thinkingLevel,'high');
  assert(session.getActiveToolNames().includes('read'));
  assert(resources.getSkills().skills.some(s=>s.name==='host-fixture'));
  return {session,resources};
}

const manager=sdk.SessionManager.create(cwd,path.join(privateRoot,mode+'-sessions'));
let session;
let restored;
let child;
try {
  ({session}=await makeSession(manager));
  checks.nativeSessionCreated=true;
  const sessionId=manager.getSessionId();
  await session.prompt('Call evofence_probe_echo exactly once with text "probe-ok", then reply probe-ok. Do not use other tools.');
  await session.waitForIdle();await Promise.all(responses);
  checks.sameSessionPreserved=manager.getSessionId()===sessionId;
  checks.contextInjection= contextHits>0 && payloads.every(p=>p.hostContextPreserved&&p.nodeContextInjected);
  checks.hostToolsAndSkillPreserved=true;
  checks.toolExecutionAndHooks=executed===1&&trace.some(e=>e.type==='extension_tool_call')&&trace.some(e=>e.type==='extension_tool_result');
  checks.blockedToolNeverExecutes=live?null:blockedExecuted===0&&trace.some(e=>e.type==='extension_tool_call'&&e.toolName==='evofence_probe_blocked');
  checks.appendEntry=manager.getEntries().some(e=>e.type==='custom'&&e.customType==='evofence_probe_binding');
  checks.highPayload=payloads.length>0&&payloads.every(p=>p.thinking.type==='enabled'&&p.maxOutputTokens===4096);
  checks.reasoningPassThrough=payloads.length>=2&&payloads.at(-1).reasoningHistoryPreserved;
  checks.usage=receipts.length>0&&receipts.every(r=>r.usage.totalTokens>0&&r.usage.input>=0&&r.usage.output>=0);
  checks.settledAfterAsyncEnd=trace.findIndex(e=>e.type==='extension_agent_settled')>trace.findIndex(e=>e.type==='extension_agent_end_done');
  const savedPath=manager.getSessionFile();assert(fs.existsSync(savedPath));
  const messageCount=session.messages.length;
  session.dispose();
  const reopened=sdk.SessionManager.open(savedPath);
  ({session:restored}=await makeSession(reopened,{type:'session_start',reason:'resume'}));
  checks.diskRestore=reopened.getSessionId()===sessionId&&restored.messages.length===messageCount&&reopened.getEntries().some(e=>e.customType==='evofence_probe_binding');
  ({session:child}=await makeSession(sdk.SessionManager.inMemory(cwd)));
  checks.independentChildSession=child.sessionManager.getSessionId()!==sessionId&&child.messages.length===0&&restored.messages.length===messageCount;
  if(!live){
    const started=new Promise(resolve=>{holdStarted=resolve;});
    const pending=child.prompt('HOLD_FOR_ABORT');await started;await child.abort();await pending;await child.waitForIdle();
    await new Promise(r=>setTimeout(r,20));
    checks.abortAndIdle=!child.isStreaming&&child.messages.some(m=>m.role==='assistant'&&m.stopReason==='aborted');
    checks.httpAbortDisconnect=observedDisconnect;
  }
  checks.extensionErrorsEmpty=errors.length===0;
  for(const [name,value]of Object.entries(checks))if(value!==null)assert.equal(value,true,name);
} finally {
  session?.dispose();restored?.dispose();child?.dispose();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await Promise.allSettled(responses);
  writeJson(path.join(outputRoot,mode+'-trace.json'),{mode,recordedAt:new Date().toISOString(),checks,trace,payloads,rawRequests,receipts,errors,
    evidence:live?'Real Pi SDK session calling the authorized Xiaomi API; USD-reference estimate from complete provider usage':'Real Pi SDK lifecycle, tool, context, persistence and abort against deterministic local HTTP fixture; no paid API calls',
    limitations:['SDK child isolation is not an EvoFence delegated subgraph implementation','Restored transcript is not recovery/reconciliation of unknown external effects','MiMo high maps to enabled thinking; no API high tier','No capability uplift or long-running dual-host scenario proved'],
    piVersion:pin.version});
}
console.log(JSON.stringify({mode,checks,payloadCount:payloads.length,rawHttpRequests:rawRequests.length,assistantReceipts:receipts.length,output:path.join(outputRoot,mode+'-trace.json')}));
