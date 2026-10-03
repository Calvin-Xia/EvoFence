// Real pinned Cordis/TeamService/spawn/AgentLoop; only provider and stores are fixtures.
import assert from 'node:assert/strict';
import { fixture, value, deadline } from './l3-dsh-fixtures.test.js';
import { harness, graph, node, PROTOCOL, digestPort, canonical } from './l2-runtime-support.test.js';
import { createDshDelegationBinding } from '../dist/hosts/dsh/delegation.js';
import { createSessionService, planRound, bindingFor } from '../dist/runtime/session/index.js';
import { fail } from '../dist/protocol/index.js';

export { value, deadline, PROTOCOL };
export async function delegationFixture(options = {}) {
  const outputSchema = { name: 'ChildProduct', version: '1.1.0', digest: digestPort.digest(canonical({ name: 'ChildProduct' })) };
  const h = harness({ spec: graph({ nodes: [node('nA', { terminal: true, outputSchemas: [outputSchema] })] }), ...options.harness });
  const subgraph = graph({ graphId: 'g-child', nodes: [node('child-task', { terminal: true })] });
  const packet = h.persist('child-packet', 'NodeContext', { task: 'NODE_PACKET produce fixture-ok', graph: subgraph });
  const graphRef = { graphId: subgraph.graphId, revision: subgraph.revision, digest: digestPort.digest(canonical(subgraph)) };
  const operation = { kind: 'host.delegate', inputRefs: [packet], payload: { toolName: null, argumentsRef: null,
    context: { inputRefs: [packet], isolation: options.isolation ?? 'fresh', preserveHostResources: true, maxTokens: 1024 },
    graphRef, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' } };
  const request = { ...h.seed, epoch: 1, protocol: PROTOCOL, operations: { nA: operation } };
  const f = await fixture({ harness: h, request, team: true });
  const native = value(f.binding.session(h.seed.sessionId));
  const persist = h.persist;
  h.seed = request; h.store = f.composition.ports.store; h.artifacts = f.composition.ports.artifacts;
  h.read = () => value(native.runtime.read(request.sessionId));
  h.persist = (...args) => { const ref = persist(...args); value(h.artifacts.put(ref, value(h.ports.artifacts.get(ref)))); return ref; };
  h.planOnly = () => {
    const state = h.read(), admissions = Object.fromEntries(h.seed.graph.spec.nodes.map(n => [n.nodeId,
      f.composition.ports.policy.inspect(h.seed, n, bindingFor(state, h.seed, n.nodeId), 1000)]));
    const batch = value(planRound(state, h.seed, { ...f.composition.ports, now: 1000 }, admissions, 'plan-1'));
    value(h.store.append({ sessionId: h.seed.sessionId, requestId: 'plan-1', expectedRevision: state.revision, epoch: state.epoch, ...batch }));
    return batch.effects;
  };
  const evaluator = f.composition.ports.evaluator;
  f.composition.ports.evaluator = { ...evaluator, async evaluateTask(...args) {
    const result = await evaluator.evaluateTask(...args);
    if (result.ok) value(h.artifacts.put(result.value.taskEvidenceRef, value(h.ports.artifacts.get(result.value.taskEvidenceRef))));
    return result;
  } };
  const records = options.records ?? new Map(), counts = { spawn: 0, send: 0, interrupt: [], wait: 0, collect: 0, gates: [] };
  let credential = { caller: f.handle.agent, grant: h.seed.grants[0] }, binding, runtime;
  let target = { kind: 'fresh', name: 'worker', description: 'kernel child', provider: 'spawn' };
  const originalTeam = f.ctx.agentTeams;
  const team = {
    tryMembership: agent => originalTeam.tryMembership(agent), listMembers: agent => originalTeam.listMembers(agent),
    async spawnTeammate(caller, request) { counts.spawn++; return originalTeam.spawnTeammate(caller, request); },
    async sendMessage(caller, request) { counts.send++; return originalTeam.sendMessage(caller, request); },
    waitForChange(caller, timeout, signal) { counts.wait++; return originalTeam.waitForChange(caller, timeout, signal); },
    interrupt(caller, name) { counts.interrupt.push(name); return originalTeam.interrupt(caller, name); },
    createTask: (caller, request) => originalTeam.createTask(caller, request),
    updateTask: (caller, request) => originalTeam.updateTask(caller, request),
  };
  const removers = new Map();
  const context = { agents: f.ctx.agents, tools: f.ctx.tools, sessionProjections: f.ctx.sessionProjections,
    agentTeams: team, effect: (execute, label) => f.ctx.effect(execute, label),
    on(name, callback) { const remove = f.ctx.on(name, callback); removers.set(name, remove); return remove; } };
  const store = {
    get: key => ({ ok: true, value: records.get(key) ?? null }),
    list: () => ({ ok: true, value: [...records.values()] }),
    put(record, expectedRevision) {
      if ((records.get(record.key)?.revision ?? null) !== expectedRevision) return { ok: false, error: fail('EFK_HOST_REVISION_CONFLICT', 'fixture CAS conflict') };
      records.set(record.key, structuredClone(record)); return { ok: true, value: undefined };
    },
  };
  const ports = { base: native.host, composition: f.composition, store,
    authority: () => credential, readKernel: () => native.runtime.read(h.seed.sessionId),
    plan: () => ({ ok: true, value: { target, child: { grantId: 'child-grant', scope: credential.grant.scope,
      budget: { ...credential.grant.budget, maxRequests: 1 }, expiresAt: 9000, remainingDepth: 1, maxConcurrency: 1 } } }),
    allowChild: async (grant, exec) => { counts.gates.push({ id: exec.agent.id, grant }); return options.allowChild
      ? options.allowChild(grant, exec) : { ok: true, value: undefined }; },
    snapshot(id) {
      const live = f.ctx.agents.get(id), row = f.rows.get(id);
      if (row === undefined) return { ok: false, error: fail('EFK_ARTIFACT_UNAVAILABLE', 'native transcript missing', [id]) };
      return { ok: true, value: { id, idle: live === undefined || live.status === 'idle', events: live?.session.snapshotEvents() ?? row.events } };
    },
    collect(child, effect, grant) {
      counts.collect++;
      const event = child.events.findLast(e => e.type === 'assistant/message');
      const output = { childId: child.id, grantId: grant.grantId, message: event.data.message };
      return { ok: true, value: [h.persist(`product:${effect.effectId}`, 'ChildProduct', output, effect.binding,
        { actorId: child.id, kind: 'host-adapter', identityRef: null })] };
    },
    projectBoard: link => f.binding.projectBoard(h.seed.sessionId, link),
  };
  function createBinding() {
    binding = createDshDelegationBinding(context, ports);
    runtime = createSessionService({ ...f.composition.ports, host: binding.host });
    value(runtime.open(h.seed)); return binding;
  }
  createBinding();
  async function claimed() {
    h.planOnly();
    const state = h.read(), effect = Object.values(state.effects)[0];
    value(h.store.dispatchEffect(h.seed.sessionId, { expectedRevision: state.revision, epoch: state.epoch,
      effectId: effect.effectId, claimId: 'direct-test-dispatch' }));
    return { effect, grant: credential.grant };
  }
  return { ...f, h, counts, context, records, removers, ports, native, outputSchema, claimed,
    get delegated() { return binding; }, get runtime() { return runtime; },
    setAuthority: value => { credential = value; }, get authority() { return credential; },
    setTarget: value => { target = value; },
    recreate() { binding.dispose(); return createBinding(); },
    async close() { binding.dispose(); await f.close(); },
  };
}
