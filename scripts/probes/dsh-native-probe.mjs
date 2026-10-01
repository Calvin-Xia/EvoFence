import assert from 'node:assert/strict';
import { expectedVersion, root, outputRoot, inspectInstallation, inspectDeclarations, inspectCliVersion, inspectHome, versionFailure, writeJson, refusePaidPath, loadNative, provenance, compareFrozenPi } from './dsh-probe-support.mjs';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') { console.log('Usage: node scripts/probes/dsh-native-probe.mjs [--live]\nNative offline conformance with memory LLM/storage fixtures. --live is a compatibility alias for offline mode; it records a not-run refusal and never selects a provider/live mode.'); process.exit(0); }
if (args.some(arg => arg !== '--live') || args.length > 1) { console.error('{"error":{"code":"PROBE_USAGE"}}'); process.exit(1); }
const trace = [], checks = {}, errors = [], requests = [], receipts = [], toolResults = [], handles = [];
const record = (type, data = {}) => trace.push({index: trace.length, type, ...data});
async function deadline(promise, label, ms = 5000) { let timer; try { return await Promise.race([promise, new Promise((_,reject) => {timer=setTimeout(()=>reject(Object.assign(new Error(label),{code:'PROBE_TIMEOUT'})),ms);})]); } finally {clearTimeout(timer);} }
const check = (name, value) => { checks[name] = Boolean(value); assert.equal(checks[name], true, name); };
let installation={available:false}, cli={}, home={}, source={}, declarations=[], admissionError, ctx, stage='installation', nativeStarted=false, teardownCompleted=false;
let executed=0, deniedExecuted=0, failureExecuted=0, holdSignalAborted=false, holdStarted, releaseHold;
async function runNative(sdk) {
  const {Context}=sdk.cordis, llm=sdk['dsh-llm'], sessions=sdk['dsh-session'], {defineTool}=sdk['dsh-tools'];
  const {SessionPersistence,SessionPersistenceRevision}=sdk['dsh-session-persistence'], z=sdk.zod.z;
  ctx=new Context();
  const mount=async(name,plugin,config)=>{stage='mount:'+name; const fiber=ctx.plugin(plugin,config); await deadline(fiber.await(),stage);};
  const rows=new Map();
  class MemoryFixturePersistence extends SessionPersistence {
    constructor(ownerCtx){
      super(ownerCtx);
      // Persistence backends, not AgentLoop, own the post-commit append feed.
      // This fixture implements that seam synchronously in memory; no durability claim.
      ownerCtx.on('session/event',(session,event)=>{
        const row=rows.get(session.id);if(!row?.owned)return;
        assert.equal(event.seq,row.events.length);row.events.push(structuredClone(event));
      });
      ownerCtx.on('session/flush',()=>{});
    }
    async create(header,options={}) { options.signal?.throwIfAborted(); if(rows.has(header.id))throw new Error('Fixture session exists'); rows.set(header.id,{header:structuredClone(header),events:[],inheritedEventCount:options.inheritedEventCount??0,owned:false}); return this.open(header.id,'write',options); }
    async open(id,access,options={}) {
      options.signal?.throwIfAborted(); const row=rows.get(id); if(!row)throw new Error('Fixture session missing'); if(access==='write'&&row.owned)throw new Error('Fixture writer owned'); if(access==='write')row.owned=true; let closed=false;
      const live=()=>{if(closed)throw new Error('Fixture handle closed');};
      const handle={id,access,header:structuredClone(row.header),inheritedEventCount:row.inheritedEventCount,
        read:async(offset=0,length,opts={})=>{live();opts.signal?.throwIfAborted();return{eventState:'detached',events:structuredClone(row.events.slice(offset,length===undefined?undefined:offset+length))};},
        append:async(events,opts={})=>{live();opts.signal?.throwIfAborted();assert.equal(access,'write');for(const event of events){assert.equal(event.seq,row.events.length);row.events.push(structuredClone(event));}},
        flush:async()=>{live();},close:async()=>{if(!closed&&access==='write')row.owned=false;closed=true;}};
      handle[Symbol.asyncDispose]=handle.close;return handle;
    }
    async flush(){}
    async stat(id){const row=rows.get(id);return row?{header:structuredClone(row.header),eventCount:row.events.length,revision:SessionPersistenceRevision('fixture-'+id+'-'+row.events.length)}:undefined;}
    async list(){return Promise.all([...rows.keys()].map(id=>this.stat(id)));}
  }
  const fixtureUsage={inputTokens:100,outputTokens:22,cacheReadTokens:20,cacheWriteTokens:5,reasoningTokens:4,totalTokens:147};
  const user=text=>llm.createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
  class FixtureAdapter extends llm.LlmAdapter {
    providerRetryPolicy(){return llm.resolveRetryPolicy({mode:'normal',maxRetries:0});}
    async resolveModel(provider,model){return{provider,id:model,name:'Offline fixture',context:{contextWindow:8192},inputModalities:['text'],reasoning:{efforts:[{id:llm.ReasoningEffortId('high'),name:'Fixture high'}]}};}
    async *stream(options){
      if(requests.length>=20)throw new llm.LlmError('Fixture call limit','PROBE_CALL_LIMIT');
      const text=JSON.stringify(options.messages), row={index:requests.length,sessionId:options.sessionId,provider:options.provider,model:options.model,reasoningEffort:options.reasoningEffort,hostContextPreserved:text.includes('EVOFENCE_HOST_CONTEXT'),nodeContextInjected:text.includes('EVOFENCE_NODE_CONTEXT'),toolNames:(options.tools??[]).map(t=>t.name),maxTokens:options.maxTokens,outcome:'pending',usageSource:'synthetic-fixture'};
      requests.push(row);record('fixture_request',{requestIndex:row.index,sessionId:options.sessionId});
      if(text.includes('HOLD_FOR_ABORT')&&!options.messages.some(m=>m.role==='assistant')){
        holdStarted?.();await new Promise(resolve=>{releaseHold=resolve;if(options.signal.aborted){holdSignalAborted=true;resolve();}else options.signal.addEventListener('abort',()=>{holdSignalAborted=true;resolve();},{once:true});});row.outcome='aborted';throw new llm.LlmError('Fixture cancelled','ABORTED');
      }
      if(text.includes('PROVIDER_FAILURE')){row.outcome='failed-without-usage';throw new llm.LlmError('Controlled failure','PROBE_PROVIDER_FAILURE');}
      const toolRun=text.includes('TOOLS_FIRST_TURN')&&!options.messages.some(m=>m.role==='tool');
      if(toolRun){for(const [index,name]of['evofence_probe_echo','evofence_probe_blocked','evofence_probe_failure'].entries()){const id=llm.ToolCallId('fixture-call-'+index);yield{type:'block-start',index,blockType:'tool-call'};yield{type:'tool-call-delta',index,id,name,argumentsDelta:'{"text":"probe-ok"}'};yield{type:'block-end',index,block:{type:'tool-call',id,name,arguments:'{"text":"probe-ok"}'}};}}
      else{yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:'probe-ok'};yield{type:'block-end',index:0,block:{type:'text',text:'probe-ok'}};}
      row.outcome='completed';row.usage={...fixtureUsage};yield{type:'usage',usage:{...fixtureUsage}};yield{type:'finish',reason:{kind:toolRun?'tool-calls':'stop'}};
    }
  }
  for(const name of ['dsh-agent','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-llm','dsh-tools'])await mount(name,sdk[name].default,{});
  await mount('memory-fixture',MemoryFixturePersistence);
  await mount('dsh-agent-loop',sdk['dsh-agent-loop'].default,{agents:[],maxParallelToolCalls:1});
  await mount('dsh-subagent',sdk['dsh-subagent'].default,{maxDepth:2,maxActiveSubagents:2});
  await mount('spawn',sdk['dsh-subagent-spawn-in-process'],{providerName:'spawn'});
  await mount('fork',sdk['dsh-subagent-fork-in-process'],{providerName:'fork'});
  await mount('team',sdk['dsh-experimental-agent-team'].default,{maxMembers:2,maxTasks:4});
  nativeStarted=true;stage='registrations';ctx.llm.registerAdapter(['offline-probe'],new FixtureAdapter());
  ctx.systemPrompt.section({name:'host-fixture',order:10,text:'EVOFENCE_HOST_CONTEXT: controlled existing host instruction'});
  for(const name of ['host_read_fixture','evofence_probe_echo','evofence_probe_blocked','evofence_probe_failure'])ctx.tools.register(defineTool({name,description:name,parameters:{text:{type:'string',required:true}},output:{schema:{type:'string'},render:(_,value)=>[{type:'text',text:value}]},execute:async args=>{if(name==='evofence_probe_blocked')deniedExecuted++;if(name==='evofence_probe_echo')executed++;if(name==='evofence_probe_failure'){failureExecuted++;throw new Error('Controlled tool failure');}return args.text;}}));
  ctx.on('agent/created',async({agent,source})=>{record('agent_created_begin',{sessionId:agent.id,source});await new Promise(r=>setTimeout(r,5));record('agent_created_done',{sessionId:agent.id});});
  ctx.on('agent/status',({agent,status})=>record('agent_status',{sessionId:agent.id,status}));
  ctx.on('agent/disposed',({agent})=>record('agent_disposed',{sessionId:agent.id}));
  ctx.on('agent/pre-step',async(payload,next)=>{record('agent_pre_step',{sessionId:payload.agent.id,step:payload.step});if(JSON.stringify(payload.messages).includes('REJECT_STEP'))return{kind:'reject'};const d=await next();return d.kind==='enter'?{...d,messages:[...d.messages,user('EVOFENCE_NODE_CONTEXT: bounded probe packet')]}:d;});
  ctx.on('tools/pre-execute',async(exec,next)=>{record('tools_pre_execute',{name:exec.name,callId:exec.callId,sessionId:exec.agent?.id});return exec.name==='evofence_probe_blocked'?{kind:'deny',reason:'Fixture authority denies tool'}:next();});
  ctx.on('tools/result',(exec,result)=>{const row={name:exec.name,callId:exec.callId,sessionId:exec.agent?.id,isError:result.isError,errorCode:result.error?.code??null,identityFrozen:Object.isFrozen(exec)};toolResults.push(row);record('tools_result',row);});
  ctx.on('session/event',(session,event)=>{record('session_event',{sessionId:session.id,seq:event.seq,eventType:event.type});if(['assistant/message','assistant/attempt'].includes(event.type))receipts.push({sessionId:session.id,seq:event.seq,eventType:event.type,usage:event.data.usage??null,evidenceLevel:'native-runtime-with-synthetic-adapter'});});
  ctx.sessionProjections.register({key:'evofenceProbe',stateVersion:1,stateSchema:z.object({seqs:z.array(z.number())}),init:()=>({seqs:[]}),apply:(state,event)=>({seqs:[...state.seqs,event.seq]}),wire:{viewSchema:z.object({seqs:z.array(z.number())}),view:state=>state}});
  const options={provider:'offline-probe',model:'deterministic-fixture',reasoningEffort:llm.ReasoningEffortId('high'),maxTokens:128};
  stage='lifecycle-and-hooks';const handle=await deadline(ctx.agents.create({sessionId:sessions.SessionId('evofence-dsh-probe-lead'),meta:{cwd:root},agentOptions:options}),'create');handles.push(handle);const agent=handle.agent;
  check('nativeSessionCreated',agent.id===agent.session.id&&ctx.agents.get(agent.id)===agent);
  check('asyncCreatedBeforeReturn',trace.some(e=>e.type==='agent_created_done'&&e.sessionId===agent.id));
  agent.followup(user('TOOLS_FIRST_TURN'));await deadline(agent.whenIdle(),'tool loop idle');
  check('sameSessionPreserved',requests.length===2&&requests.every(r=>r.sessionId===agent.id));
  check('additiveNodeContext',requests.every(r=>r.hostContextPreserved&&r.nodeContextInjected));
  check('hostToolPreserved',requests.every(r=>r.toolNames.includes('host_read_fixture')));
  check('toolGateAndResults',executed===1&&deniedExecuted===0&&failureExecuted===1&&toolResults.length===3);
  check('deniedAndFailedResultsObserved',toolResults.filter(r=>r.isError).length===2);
  check('toolCallerIdentity',toolResults.every(r=>r.sessionId===agent.id&&r.identityFrozen));
  check('usagePreserved',receipts.length===2&&receipts.every(r=>JSON.stringify(r.usage)===JSON.stringify(fixtureUsage)));
  check('reasoningParameterFixture',requests.every(r=>r.reasoningEffort==='high'));
  let count=requests.length;agent.followup(user('REJECT_STEP'));await deadline(agent.whenIdle(),'reject idle');check('rejectedStepNoModelCall',requests.length===count);
  const events=agent.session.snapshotEvents();check('contiguousSessionOrder',events.every((e,i)=>e.seq===i));
  const projection=ctx.sessionProjections.snapshot(agent.session);check('projectionOrderMatchesLog',JSON.stringify(projection.values.evofenceProbe.seqs)===JSON.stringify(events.map(e=>e.seq)));
  const checkpoint=ctx.sessionProjections.checkpoint(agent.session), restored=ctx.sessionProjections.restore(checkpoint,events,sessions.SessionLogOffset(0),agent.session.header,sessions.SessionLogOffset(0));
  check('projectionCheckpointRestore',JSON.stringify(restored.snapshot.values.evofenceProbe)===JSON.stringify(projection.values.evofenceProbe));
  assert.throws(()=>ctx.sessionProjections.restore({},events.filter((_,i)=>i!==1),sessions.SessionLogOffset(0),agent.session.header,sessions.SessionLogOffset(0)),/missing seq/);check('projectionGapRejected',true);
  const bad=structuredClone(checkpoint);bad.evofenceProbe.ver=999;assert.throws(()=>ctx.sessionProjections.restore(bad,events.slice(1),sessions.SessionLogOffset(1),agent.session.header,sessions.SessionLogOffset(0)),/cannot restore from seq 1/);check('projectionVersionTailRejected',true);
  stage='team-and-authority';check('leadMembership',ctx.agentTeams.membership(agent).role==='lead');
  const impostor={...agent,id:agent.id};assert.throws(()=>ctx.agentTeams.membership(impostor),e=>e.code==='TEAM_NOT_MEMBER');check('sameIdImpostorRejected',ctx.agentTeams.tryMembership(impostor)===undefined);
  const task=await ctx.agentTeams.createTask(agent,{subject:'probe task',description:'bounded fixture',writeScopes:['fixture-only']}),claimed=await ctx.agentTeams.updateTask(agent,{taskId:task.id,expectedRevision:task.revision,action:'claim'});
  check('teamTaskClaim',claimed.revision===2&&claimed.status==='in_progress');await assert.rejects(()=>ctx.agentTeams.updateTask(agent,{taskId:task.id,expectedRevision:1,action:'complete'}),e=>e.code==='TEAM_TASK_STALE_REVISION');check('teamStaleRevisionRejected',true);
  const spawned=await deadline(ctx.agentTeams.spawnTeammate(agent,{name:'worker',description:'offline worker',prompt:[{type:'text',text:'FRESH_CHILD'}],context:'fresh',provider:'spawn',signal:new AbortController().signal}),'team spawn');
  const child=ctx.agents.get(spawned.member.id);assert(child);await deadline(child.whenIdle(),'child idle');
  check('nativeTeamDelegation',child.id!==agent.id&&child.session.header.parentSession===agent.id&&ctx.agentTeams.membership(child).role==='teammate');
  check('freshChildContextIsolation',requests.filter(r=>r.sessionId===child.id).length===1&&!child.session.snapshotEvents().some(e=>e.type==='tool/call'));
  await assert.rejects(()=>ctx.agentTeams.spawnTeammate(child,{name:'forbidden',description:'no lead authority',prompt:[{type:'text',text:'VALID_FORBIDDEN_CHILD'}],context:'fresh',provider:'spawn',signal:new AbortController().signal}),e=>e.code==='TEAM_LEAD_REQUIRED');check('nonLeadSpawnRejected',true);
  const delivered=await ctx.agentTeams.sendMessage(agent,{target:'worker',content:[{type:'text',text:'PEER_MESSAGE'}],signal:new AbortController().signal});await deadline(child.whenIdle(),'message idle');
  await deadline(agent.whenIdle(),'completion feedback idle');
  await new Promise(resolve=>setTimeout(resolve,20));
  const targetEvents=rows.get(child.id).events;
  checks.teamMessageDurable=Boolean(delivered.messageId)&&agent.session.snapshotEvents().some(e=>e.type==='team/message/queued')&&agent.session.snapshotEvents().some(e=>e.type==='team/message/delivered')&&targetEvents.some(e=>e.type==='user/message'&&e.data.source.kind==='team-message');
  check('teamMessageQueued',Boolean(delivered.messageId)&&agent.session.snapshotEvents().some(e=>e.type==='team/message/queued'));
  record('team_message_observation',{returnedStatus:delivered.status,durableEnqueue:true,targetRecorded:targetEvents.some(e=>e.type==='user/message'&&e.data.source.kind==='team-message'),leadAcknowledged:agent.session.snapshotEvents().some(e=>e.type==='team/message/delivered')});
  // Only a fixture composition is loaded; no credentials/configuration are present.
  record('controlled_fixture_diagnostics',{warningCount:ctx.logger.buffer.filter(m=>m.type==='warn').length,rawLogsPersisted:false});
  const done=await ctx.agentTeams.updateTask(agent,{taskId:task.id,expectedRevision:2,action:'complete'});check('teamTaskComplete',done.revision===3&&done.status==='completed');
  const waitAbort=new AbortController(),waiting=ctx.agentTeams.waitForChange(agent,10000,waitAbort.signal);waitAbort.abort();await assert.rejects(()=>waiting);check('teamWaitCancellation',true);
  stage='failure-cancel-and-resume';const failure=await ctx.agents.create({sessionId:sessions.SessionId('evofence-dsh-failure'),agentOptions:options});handles.push(failure);failure.agent.followup(user('PROVIDER_FAILURE'));await deadline(failure.agent.whenIdle(),'failure idle');
  check('providerFailureIdle',failure.agent.session.snapshotEvents().some(e=>e.type==='turn/end'&&e.data.reason.kind==='error'));check('failureUsageNotZeroInvented',requests.some(r=>r.outcome==='failed-without-usage'&&r.usage===undefined));
  const abort=await ctx.agents.create({sessionId:sessions.SessionId('evofence-dsh-abort'),agentOptions:options});handles.push(abort);const started=new Promise(r=>{holdStarted=r;});abort.agent.followup(user('HOLD_FOR_ABORT'));await deadline(started,'stream start');abort.agent.cancel({kind:'user'});await deadline(abort.agent.whenIdle(),'cancel idle');
  check('cancelSignalsAndIdle',holdSignalAborted&&abort.agent.status==='idle'&&abort.agent.session.snapshotEvents().some(e=>e.type==='turn/end'&&e.data.reason.kind==='aborted'));
  const interrupted=ctx.agentTeams.interrupt(agent,'worker');record('team_interrupt_observation',interrupted);check('teamIdleStatusVocabulary',interrupted.previousStatus==='inactive');
  await deadline(agent.whenIdle(),'lead before restore idle');await ctx.sessions.flush(agent.session);const before=structuredClone(agent.session.snapshotEvents());
  record('memory_persistence_comparison',{liveCount:before.length,storedCount:rows.get(agent.id).events.length,liveTypes:before.map(e=>e.type),storedTypes:rows.get(agent.id).events.map(e=>e.type)});
  assert.deepEqual(rows.get(agent.id).events,before);check('memoryPersistenceLogMatches',true);
  await deadline(handle.dispose(),'lead dispose');check('staleAuthorityRejected',ctx.agentTeams.tryMembership(agent)===undefined);count=requests.length;
  const resumed=await deadline(ctx.agents.resume({resumeSessionId:agent.id,agentOptions:options}),'resume');handles.push(resumed);
  check('nativeResumeWithMemoryPersistence',resumed.agent.id===agent.id&&resumed.agent!==agent&&JSON.stringify(resumed.agent.session.snapshotEvents().slice(0,before.length))===JSON.stringify(before));check('restoreWithoutModelReplay',requests.length===count);
  check('teamBoardRestored',ctx.agentTeams.getTask(resumed.agent,task.id).status==='completed');check('resumedLeadAuthority',ctx.agentTeams.membership(resumed.agent).role==='lead');
  check('parentChildUsageCoverage',requests.filter(r=>r.outcome==='completed').length===receipts.filter(r=>r.usage!==null).length&&receipts.some(r=>r.sessionId===child.id&&r.usage!==null));
  check('failedCancelledUsageUnknown',receipts.filter(r=>r.eventType==='assistant/attempt').length===2&&receipts.filter(r=>r.eventType==='assistant/attempt').every(r=>r.usage===null));
  stage='teardown';
}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Offline probe forbids network');};
try{installation=inspectInstallation();cli=inspectCliVersion();home=await inspectHome(installation);source=provenance();declarations=inspectDeclarations(installation);record('version_admission',{expectedVersion,observedVersion:installation.version,cliVersion:cli.version});admissionError=versionFailure(installation,cli);if(admissionError)throw Object.assign(new Error('Version admission failed'),{code:admissionError});await runNative(await loadNative());}
catch(error){const code=/^[A-Z][A-Z0-9_]+$/.test(error.code??'')?error.code:'PROBE_FAILURE';errors.push({code,stage,failedCheck:['ERR_ASSERTION','PROBE_TIMEOUT'].includes(code)?error.message.split('\n')[0]:null});record('probe_failure',errors.at(-1));}
finally{releaseHold?.();for(const handle of [...handles].reverse()){try{await deadline(handle.dispose(),'dispose');}catch{errors.push({code:'PROBE_TEARDOWN_FAILED',stage:'teardown'});}}if(ctx){try{await deadline(ctx.fiber.dispose(),'context dispose');teardownCompleted=true;}catch{errors.push({code:'PROBE_CONTEXT_TEARDOWN_FAILED',stage:'teardown'});}}globalThis.fetch=originalFetch;}
const capability=(names,limitation)=>({status:names.every(n=>checks[n])?'verified':'unknown',verificationStatus:names.every(n=>checks[n])?'verified-scoped-checks':'unverified',evidenceLevel:'native-runtime-with-memory-fixtures',checks:names,evidence:'offline-trace.json',limitation});
const unknown=(limitation,names=[])=>({status:'unknown',verificationStatus:'unverified',checks:names,evidence:names.length?'offline-trace.json':null,evidenceLevel:names.length?'native-runtime-with-memory-fixtures':'not-run',limitation});
const matrix={
  nativeSessionBinding:capability(['nativeSessionCreated','sameSessionPreserved','asyncCreatedBeforeReturn'],'Controlled plugins, not current user GUI'),
  contextAndResources:capability(['additiveNodeContext','hostToolPreserved'],'Controlled instructions/tool retained; skill discovery unverified'),
  agentPreStep:capability(['additiveNodeContext','rejectedStepNoModelCall'],'Native admission/rejection/additive message fixture'),
  toolRequestGate:capability(['toolGateAndResults'],'ToolRuntime path only; no OS isolation'),
  toolResultObservation:capability(['deniedAndFailedResultsObserved','toolCallerIdentity'],'Normal/denied/thrown-tool fixture results'),
  settledAndIdle:capability(['asyncCreatedBeforeReturn','cancelSignalsAndIdle','providerFailureIdle'],'whenIdle/status tested; arbitrary detached plugins unverified'),
  usageTokens:capability(['usagePreserved','failureUsageNotZeroInvented','parentChildUsageCoverage','failedCancelledUsageUnknown'],'Synthetic usage only; no vendor/billing comparison'),
  teamDelegation:capability(['nativeTeamDelegation','freshChildContextIsolation','teamMessageQueued'],'Native fresh teammate and enqueue over memory storage; fork/cold delivery unverified'),
  teamMessageDelivery:capability(['teamMessageDurable'],'Durable target receipt/Lead acknowledgement must be observed; queued alone is not delivered'),
  nativeTeamGraphBoard:capability(['teamTaskClaim','teamTaskComplete','teamBoardRestored'],'Write scopes advisory; not kernel lease/fencing'),
  teamTaskCas:capability(['teamStaleRevisionRejected'],'Stale revision checked; multi-process race not tested'),
  teamAuthorityIdentity:capability(['leadMembership','sameIdImpostorRejected','nonLeadSpawnRejected','staleAuthorityRejected','resumedLeadAuthority'],'Exact-live same-process identity; no cross-process grant proof'),
  sdkAbort:capability(['cancelSignalsAndIdle'],'Memory stream abort; no vendor disconnect/refund proof'),
  transcriptRecovery:capability(['nativeResumeWithMemoryPersistence','restoreWithoutModelReplay','teamBoardRestored','memoryPersistenceLogMatches'],'Native resume with fixture storage; no disk/crash proof'),
  projectionOrdering:capability(['contiguousSessionOrder','projectionOrderMatchesLog','projectionCheckpointRestore','projectionGapRejected','projectionVersionTailRejected'],'Native pure projections; no durable kernel journal'),
  parentChildCancellation:unknown('Not exercised; no automatic team cascade assumed'),
  toolCancellation:unknown('No long-running tool dispatch'),
  diskCrashRecovery:unknown('No native JSONL artifacts; writes limited to lane files'),
  osSandbox:unknown('No OS sandbox tested; hooks do not imply one; lack of testing does not establish absence'),
  externalEffectReconciliation:unknown('No external effects/journal/outbox'),
  reasoningHighGuarantee:unknown('Fixture high parameter only; Xiaomi/provider guarantee not exercised',['reasoningParameterFixture']),
  costInvoice:unknown('No paid requests/invoice query'),providerCancelBilling:unknown('No vendor request/cancel'),
  existingIntegrationCompatibility:{...unknown('Declared exact engines/peer versions mismatch; integration not loaded or modified'),evidence:source.integrationGap??{},evidenceLevel:'static-package-manifest'},
  grantWriteScopeEnforcement:unknown('Advisory task writeScopes stored; file-write enforcement, kernel grants/leases and grant inheritance unverified',['teamTaskClaim']),
  teamWaitAndInterrupt:{...capability(['teamWaitCancellation','teamIdleStatusVocabulary'],'Only wait signal cancellation and inactive-member interrupt result verified; running interrupt and propagation unverified'),status:checks.teamWaitCancellation&&checks.teamIdleStatusVocabulary?'partial':'unknown',verificationStatus:'unverified',verifiedSubset:['waitForChange signal cancellation','inactive-member interrupt status'],unverifiedGuarantees:['running-member interrupt','parent-child cancellation propagation']},
  skillsPluginCoexistence:unknown('No real user skill discovery, GUI/profile or arbitrary third-party plugin coexistence exercised'),
  sdkChildSessionIsolation:capability(['nativeTeamDelegation','freshChildContextIsolation'],'Fresh native child session id/transcript separation only; no OS or cross-process isolation'),
  sessionCustomEntries:unknown('Pi appendEntry/custom-entry disk reopen semantics not exercised on DSH; no absence inferred')
};
const checkpoints={cp1:!admissionError&&installation.available&&declarations.length&&declarations.every(item=>item.fileFound&&!item.symbolNotFound&&item.lines.length)?'passed':'failed',cp2:['nativeSessionCreated','cancelSignalsAndIdle','nativeResumeWithMemoryPersistence','projectionGapRejected'].every(n=>checks[n])?'passed':'failed',cp3:['usagePreserved','toolGateAndResults','sameIdImpostorRejected','staleAuthorityRejected'].every(n=>checks[n])?'passed':'failed'};
const pinFailure=versionFailure(installation,cli);
const capabilityStatusCounts=Object.values(matrix).reduce((counts,item)=>(counts[item.status]++,counts),{absent:0,partial:0,unknown:0,verified:0});
const limitations=Object.entries(matrix).filter(([,item])=>item.status!=='verified').map(([capability,item])=>({capability,status:item.status,limitation:item.limitation}));
const status=errors.length||Object.values(checkpoints).includes('failed')?'failed':'completed-with-limitations',recordedAt=new Date().toISOString();
const statusContract={vocabulary:['failed','completed-with-limitations'],meaning:{failed:'Probe error or failed checkpoint',
  'completed-with-limitations':'Scoped offline probe completed; fixed unverified provider/disk/host guarantees remain'},
  note:'Overall probe status only; checkpoint and capability status vocabularies are separate. This probe has no overall passed state'};
const versionPin={version:expectedVersion,providerModel:null,selectedModel:null,catalogSource:null,pricingSource:null,price:null,thinkingSource:null,modelSelectionNote:'No live provider/model/catalog/pricing/thinking source selected or verified; synthetic fixture metadata is in HOST-MANIFEST.hostSpecific',observedVersion:installation.version??null,pinSatisfied:!pinFailure&&installation.available,packageRoot:installation.packageRoot,nodeVersion:process.version,platform:process.platform,arch:process.arch,cli,packages:installation.packages??[],files:installation.files??[],...source,recordedAt};
const hostManifest={manifestKind:'L1 evidence-backed host capability draft; not frozen production schema',host:'dsh',version:expectedVersion,status,model:null,reasoningRequested:'high',evidenceFiles:['VERSION-PIN.json','offline-trace.json','live-trace.json'],capabilities:matrix,homeObservation:home,hostSpecific:{fixtureModel:'offline-probe/deterministic-fixture',modelKind:'synthetic-fixture',modelNote:'Common model field means selected real provider/model; null here. Reasoning high was requested from the fixture only',evidenceLevels:{'VERSION-PIN.json':'local-version-and-static-manifests; drift separately unverified','offline-trace.json':'native-runtime-with-synthetic-adapter-and-memory-storage','live-trace.json':'not-run'},liveProviderRun:false},capabilityStatusCounts,limitations,comparisonContract:null,requiredAdapterResponsibilities:['Bind current host session and preserve real instructions/skills/tools','Choose one authority for team board and kernel scheduler','Enforce scoped grants, shared budget and lease fencing across children','Complete required fan-in and reject stale receipts','Reconcile unknown effects and missing usage without replaying effects','Verify disk recovery/model mapping/child cancellation/isolation separately'],capabilityUpliftProved:false,dualHostLongTaskProved:false};
hostManifest.statusContract=statusContract;
hostManifest.comparisonContract=compareFrozenPi(hostManifest,versionPin);
const referencedChecks=new Set(Object.values(matrix).flatMap(item=>item.checks??[]));
const checkCoverage={unreferenced:Object.keys(checks).filter(name=>!referencedChecks.has(name)),referencedButNotExecuted:[...referencedChecks].filter(name=>!(name in checks))};
writeJson('VERSION-PIN.json',versionPin);
writeJson('offline-trace.json',{mode:'offline',requestedMode:args.includes('--live')?'live-compatibility-alias':'offline',status,recordedAt,dshVersion:expectedVersion,checkpoints,capabilityStatusCounts,limitations,checkCoverage,checks,trace,declarations,requests,receipts,toolResults,errors,modelCalls:requests.length,paidRequests:0,storage:'Probe-owned memory fixture of native SessionPersistence seam',reproducibility:{contract:'Same scoped checks and evidence semantics, not byte-identical artifacts',volatileFields:['recordedAt','native child sessionId and its dependent trace references']},usage:{source:'synthetic-fixture-only',providerUsageVerified:false,estimatedUsd:null,invoiceUsd:null},evidence:'Real installed DSH loop/hooks/tools/team/projections/resume with deterministic in-memory LLM/storage fixtures, not paid-provider evidence',isolation:{credentialsRead:false,credentialReadClaimScope:'Explicit probe file reads only; dependency internals are not instrumented',userConfigRead:false,npmLogPathsChecked:source.drift?.collection.npmLogPathsChecked??0,npmLogsRead:source.drift?.collection.npmLogsRead??false,npmLogsReadCount:source.drift?.collection.npmLogsReadCount??0,homeDirStatOnly:home.homeDirStatOnly??false,dshHomeFileContentsRead:false,profilesStarted:false,agentRuntimeImported:nativeStarted,sessionLogsWritten:false,sharedBudgetMutated:false,scratchFilesWritten:false,teardownCompleted}});
writeJson('HOST-MANIFEST.json',hostManifest);
writeJson('live-trace.json',{...refusePaidPath(),evidenceLevel:'not-run',reason:'Offline mechanism probe only; vendor usage/cancel/billing and Xiaomi high remain unverified',recordedAt});
console.log(JSON.stringify({status,dshVersion:expectedVersion,checkpoints,capabilityStatusCounts,checkCoverage,checks,errors,fixtureModelCalls:requests.length,paidRequests:0,output:outputRoot}));process.exitCode=status==='failed'?1:0;
