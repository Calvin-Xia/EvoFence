import assert from 'node:assert/strict';
import { DEFS, ERROR_CODES } from '../../dist/protocol/index.js';
import { canonical, createMemoryEventStore, createMemorySnapshotStore, createMemoryArtifactStore } from '../../dist/storage/index.js';
import { compileGraph } from '../../dist/kernel/graph/index.js';
import { deriveAuthority } from '../../dist/kernel/policy/index.js';
import { PI_CAPABILITIES } from '../../dist/runtime/host-port/index.js';
// Deep import on purpose (audit G07): the barrel no longer exposes the fabricating fake host.
import { createFakeHost } from '../../dist/runtime/host-port/host-fake.js';
import { createSessionService } from '../../dist/runtime/session/index.js';
import { actor, digest, graph, policy, PROTOCOL, usage } from './fixtures.mjs';
export { canonical, usage };
export function value(result) { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; }
export function error(result, expected) {
  const actual = result.error;
  assert.equal(actual?.code, expected);
  assert.ok(ERROR_CODES.includes(actual.code), `unfrozen error: ${actual.code}`);
  return actual;
}
export function harness(name, options = {}) {
  const spec = options.spec ?? graph();
  const compiled = compileGraph(spec);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.error));
  const budget = policy(options.budget);
  const scope = { workspaceRef: null, readResources: spec.resourcePolicy.map(p => p.resourceId),
    writeResources: spec.resourcePolicy.map(p => p.resourceId), artifactScopes: [], trustDomain: 'same-user' };
  const root = { grantId: 'root-verify', rootAuthorityRef: 'root-verify', parentGrantRef: null,
    actor: actor('user', 'kernel'), sessionId: `s-${name}`, nodeIds: spec.nodes.map(n => n.nodeId),
    scope, capabilities: ['host.agent', 'host.delegate'], maxDelegationDepth: 3, expiresAt: 10000,
    revocationEpoch: 0, approvalRef: null };
  const parentGrant = { grantId: 'grant-verify', rootAuthorityRef: root.grantId, scope, budget,
    issuedEpoch: 1, expiresAt: 10000, remainingDepth: 2, maxConcurrency: 4, revocationEpoch: 0, revoked: false };
  const seed = { sessionId: root.sessionId, graph: compiled.graph,
    graphRef: { graphId: spec.graphId, revision: spec.revision, digest: digest.digest(canonical(spec)) },
    policy: budget, reservePerRequest: 100, grants: [parentGrant], operations: Object.fromEntries(spec.nodes.map(n =>
      [n.nodeId, { kind: 'host.agent', inputRefs: [], payload: { context: n.contextPlan, toolName: null,
        argumentsRef: null, graphRef: null, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' } }])) };
  let now = 1000, service, ports;
  const log = [], errors = [], checkpoints = [], artifactEntries = new Map();
  const calls = { observe: 0, execute: 0, reconcile: 0, evaluate: 0, clock: 0, inspect: 0, resume: 0 };
  const control = { revokedEpoch: 0, automaticUsage: options.automaticUsage ?? true,
    metering: {}, evaluation: {}, forgedIssuer: false, boardOwners: [] };
  const script = { outcomes: {}, reconcile: {}, usage: {}, cancelConfirmed: {}, artifacts: {} };
  const clock = { now: () => { calls.clock++; return now; } };
  function stores() {
    const store = createMemoryEventStore({ digest });
    const append = store.append, dispatch = store.dispatchEffect;
    store.append = request => {
      const result = append(request);
      log.push({ port: 'EventStore.append', request: structuredClone(request), result: structuredClone(result) });
      return result;
    };
    store.dispatchEffect = (id, request) => {
      const result = dispatch(id, request);
      log.push({ port: 'EventStore.dispatchEffect', request: structuredClone(request), result: structuredClone(result) });
      return result;
    };
    const artifacts = createMemoryArtifactStore({ digest });
    const put = artifacts.put;
    artifacts.put = (ref, bytes) => {
      const result = put(ref, bytes);
      if (result.ok) artifactEntries.set(ref.id, { ref, bytes });
      return result;
    };
    return { store, artifacts, snapshots: createMemorySnapshotStore({ digest }) };
  }
  const fake = createFakeHost({ host: 'verification-fake', clock, capabilities: PI_CAPABILITIES,
    cancellation: { status: 'partial', coverage: [], evidenceRefs: [] },
    recovery: { status: 'verified', coverage: [], evidenceRefs: [] },
    isolation: { status: 'partial', coverage: [], evidenceRefs: [] }, script });
  function persisted(id, name, data, binding = null, producer = actor('kernel', 'kernel')) {
    const bytes = canonical(data);
    const ref = { protocol: PROTOCOL, id, digest: digest.digest(bytes), binding, producer,
      schema: { name, version: '1.1.0', digest: digest.digest(canonical(DEFS[name] ?? { name })) },
      location: `verification:${id}`, visibility: 'internal', expiresAt: null, partition: 'not-evaluation' };
    value(ports.artifacts.put(ref, bytes));
    return ref;
  }
  const host = { ...fake,
    observe: async id => { calls.observe++; return { ok: true,
      value: { ...value(await fake.observe(id)), boardOwners: control.boardOwners } }; },
    execute: async authorized => {
      calls.execute++;
      const e = authorized.effect, state = read();
      const committed = value(ports.store.exportSession(seed.sessionId));
      const intended = committed.events.find(x => x.type === 'effect.intended' && x.payload.effectId === e.effectId);
      assert.ok(intended, 'host call requires committed intention');
      assert.ok(committed.effects.some(x => canonical(x) === canonical(e)), 'outbox bytes must be committed');
      assert.ok(committed.events.some(x => x.type === 'effect.dispatched' && x.payload.effectId === e.effectId));
      if (e.reservationRef !== null) {
        assert.ok(state.budget.reservations.some(r => r.requestId === e.reservationRef));
        assert.ok(state.scheduler.claims.some(c => c.binding.attemptId === e.binding.attemptId));
        for (const lease of e.leases) assert.ok(state.scheduler.leases.grants.some(l => canonical(l) === canonical({ ...lease,
          mode: state.resourceModes[lease.resourceId] })));
        if (control.automaticUsage) script.usage[e.effectId] = [usage(e.reservationRef, control.metering[e.binding.nodeId])];
      }
      log.push({ port: 'HostPort.execute', effect: structuredClone(e), journalRevision: committed.revision });
      return fake.execute(authorized);
    },
    reconcile: async request => { calls.reconcile++; const result = await fake.reconcile(request);
      log.push({ port: 'HostPort.reconcile', request, result: structuredClone(result) }); return result; },
  };
  const issuer = actor('verification-evaluator', 'evaluator');
  const evaluator = { issuer, evaluateTask: async (_seed, state, receipt) => {
    calls.evaluate++;
    const outcome = control.evaluation[receipt.binding.nodeId] ?? 'completed';
    const receiptRef = state.events.find(e => e.type === 'receipt.applied' && e.payload.objectRef.id === receipt.receiptId).payload.objectRef;
    const report = { contractRef: spec.taskContractRef, binding: receipt.binding,
      privateTestsPassed: outcome === 'completed', requiredOutcomesMet: outcome === 'completed', branchReport: [],
      artifactRefs: receipt.artifactRefs, actualDiffRef: null, runStatus: 'completed', usageComplete: true, privacyChecked: true };
    const evidenceRef = persisted(`evidence:${receipt.binding.attemptId}`, 'TaskEvidenceReport', report, receipt.binding, issuer);
    return { ok: true, value: { protocol: PROTOCOL, decisionId: `decision:${receipt.binding.attemptId}`, kind: 'task',
      inputs: [receiptRef], contractRef: spec.taskContractRef, taskEvidenceRef: evidenceRef, evaluationReceiptRef: null,
      activationReceiptRef: null, evaluatorVersion: 'verification/1', evaluationProtocolRef: null, outcome,
      reasons: [`private-tests:${report.privateTestsPassed}`], evidenceRefs: [evidenceRef], feedbackVisibility: 'internal',
      issuer: control.forgedIssuer ? actor('forged-host', 'host-adapter') : issuer, capabilityJudgement: null } };
  } };
  ports = { ...stores(), host, clock, digest, evaluator,
    policy: { inspect: (_seed, n, _binding, at) => { calls.inspect++;
      return { policy: { policyId: 'risk-verify', evolutionMode: 'optional', evolutionCapabilities: [],
        requireTrustDomain: 'same-user', requireCompleteUsage: false },
      authority: deriveAuthority({ now: at, revokedEpoch: control.revokedEpoch, root, parent: root,
        task: scope, node: { nodeId: n.nodeId, scope, capabilities: [seed.operations[n.nodeId].kind] } }),
      negotiation: { ok: true, value: { status: 'executable', taskDigest: seed.graphRef.digest,
        manifestDigest: seed.graphRef.digest, satisfied: [], gaps: [], selectedAlternatives: [], approvalRefs: [] } } }; },
      resume: (_seed, _state, request) => { calls.resume++;
        assert.equal(request.manifestRef.digest, seed.graphRef.digest);
        return { ok: true, value: undefined }; } },
    leaseTtlMs: 5000, effectTtlMs: 5000, maxConcurrentAgents: 2, depth: 0, maxDepth: 3 };
  budget.priceRef = persisted('price-frozen', 'PriceTable', { model: 'simulated-host', unit: 'micro-USD', reservePerRequest: 100 });
  function read() { return value(service.read(seed.sessionId)); }
  function start() { service = createSessionService(ports); return value(service.create({ ...seed, epoch: 1, protocol: PROTOCOL })); }
  function checkpoint(label) {
    const s = read(), projection = value(ports.store.replay(seed.sessionId));
    const { sessionId, revision, epoch, lastSequence, dispatchMode, nodeStates } = projection;
    const saved = value(ports.snapshots.save({ sessionId, revision, epoch, sequence: lastSequence,
      schemaVersion: PROTOCOL.schemaVersion, projection: { sessionId, revision, epoch, lastSequence, dispatchMode, nodeStates } }));
    const recovered = value(ports.snapshots.recover(sessionId, s.events));
    assert.equal(canonical(recovered.projection), canonical(saved.projection));
    const record = { label, revision, epoch, dispatchMode, nodeStates: s.nodeStates, attempts: s.attempts,
      outbox: s.outbox, budget: s.budget, unknown: s.unknownEffectIds, calls: { ...calls }, snapshotDigest: saved.digest };
    checkpoints.push(structuredClone(record));
    return s;
  }
  function restart() {
    const exported = JSON.parse(canonical(value(service.close(seed.sessionId))));
    const oldState = canonical(read()), before = canonical(calls);
    const saved = JSON.parse(canonical(value(ports.snapshots.load(seed.sessionId))));
    const bytes = [...artifactEntries.values()].map(x => JSON.parse(canonical(x)));
    ports = { ...ports, ...stores() };
    value(ports.store.restoreSession(exported));
    for (const x of bytes) value(ports.artifacts.put(x.ref, x.bytes));
    if (saved !== null) ports.snapshots.seed(saved);
    service = createSessionService(ports);
    assert.equal(canonical(value(service.open(seed))), oldState);
    assert.equal(canonical(calls), before, 'restore/open/replay must call no host, clock or evaluator');
    log.push({ port: 'restart', hostCallsDuringReplay: 0, clockCallsDuringReplay: 0, journalDigest: digest.digest(canonical(exported)) });
  }
  function recordError(label, result, code, input) {
    const actual = error(result, code);
    errors.push({ path: label, code: actual.code, input: structuredClone(input),
      reproduce: `node verification/kernel/run.mjs --scenario ${name}` });
    return actual;
  }
  function finish() {
    const exported = value(service.close(seed.sessionId));
    assert.equal(canonical(exported.events), canonical(read().events));
    return { name, boundary: 'production memory stores + fake host; serialized kernel restart; no OS crash durability',
      checkpoints, log, errors, journal: exported, artifacts: [...artifactEntries.values()].sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
      snapshot: value(ports.snapshots.load(seed.sessionId)), calls, hostStats: fake.stats() };
  }
  return { seed, parentGrant, root, control, script, fake, host, start, read, checkpoint, restart, recordError, finish, persisted,
    get ports() { return ports; }, get service() { return service; }, calls, log, setNow: at => { now = at; },
    step: () => service.step(seed.sessionId), effects: () => Object.values(read().effects),
    effect: nodeId => Object.values(read().effects).filter(e => e.binding.nodeId === nodeId).at(-1),
    evaluate: nodeId => service.evaluate(seed.sessionId, Object.values(read().effects).filter(e => e.binding.nodeId === nodeId).at(-1).effectId),
    receipt: (effect, overrides = {}) => ({ protocol: PROTOCOL, receiptId: `external:${effect.effectId}`,
      effectId: effect.effectId, binding: effect.binding, hostInvocationId: `native:${effect.effectId}`, status: 'completed',
      artifactRefs: [], usage: [], observability: ['simulated-native-evidence'], error: null, ...overrides }) };
}
