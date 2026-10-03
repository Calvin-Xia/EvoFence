// Contract fixtures, including simulated T0/provider records; never evidence of real unseen uplift.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { canonical, storeOk, storeFail } from '../dist/kernel/store/index.js';
import { createMemoryArtifactStore } from '../dist/storage/index.js';
import { EVALUATION_ENVELOPES } from '../dist/kernel/policy/index.js';
import { createEvolutionEvaluator } from '../dist/evaluation/evolution/index.js';
import { revisionDigest } from '../dist/learning/assets/index.js';
export const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const actor = (actorId, kind = 'evaluator') => ({ actorId, kind, identityRef: null });
export const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const protocol = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
export function fixture({ n = 160, confirmatory = true, hosts = 1, seeds = [7], trials = ['trial-1'], comparisons = ['B-A'], budget = true } = {}) {
  const digest = { digest: hash }, artifacts = createMemoryArtifactStore({ digest });
  const issuer = actor('evolution-service'), verifierIssuer = actor('blind-pipeline'), author = actor('candidate-author', 'host-adapter');
  const signatures = new Map(), inventory = [], requests = new Map(), blindInputs = [], started = new Set();
  const sign = ref => createHmac('sha256', 'test-only-authority-key').update(canonical(ref)).digest('hex');
  function artifact(bytes, name = 'Material', overrides = {}) {
    const identity = hash(canonical([bytes, name, overrides]));
    const ref = { protocol, id: `artifact:${identity.slice(7, 39)}`, digest: hash(bytes), producer: actor('pin-source', 'kernel'), binding: null,
      schema: { name, version: '1.1.0', digest: hash(name) }, location: `fixture:${identity.slice(7)}`,
      visibility: 'internal', expiresAt: null, partition: 'train', ...overrides };
    unwrap(artifacts.put(ref, bytes)); return ref;
  }
  const analysisScriptRef = artifact('frozen analysis implementation fixture', 'AnalysisScript');
  const protocolRef = artifact('METRICS-v3 protocol fixture; thresholds remain 160/25/1.960', 'EvaluationProtocol');
  const payloadRef = artifact('{"temperature":0,"topP":1,"thinking":{"type":"enabled"},"reasoning_effort":"high"}', 'ModelPayload');
  const model = { providerModel: 'fixture/model', reasoningRequested: 'high', reasoningGuarantee: 'payload-only', payloadRef };
  const evidence = (bytes, claim) => ({ file: 'fixture.json', pointer: '/', sha256: hash(bytes), kind: 'native-fixture', claim });
  const guarantee = { status: 'unknown', coverage: [], evidenceRefs: [] };
  const hostBindings = Array.from({ length: hosts }, (_, i) => ({ hostId: `fixture-host-${i}`, version: '1.0.0',
    manifestRef: artifact(canonical({ protocol, manifestId: `manifest-${i}`, identity: { host: `fixture-host-${i}`, vendor: null,
      version: '1.0.0', pinRef: evidence('fixture pin', 'fixture version pin') }, compatibleProtocols: [protocol], capabilities: {},
      model: { providerModel: model.providerModel, reasoningRequested: 'high', reasoningEffective: 'payload-accepted',
        payloadRef: { ...evidence('payload', 'fixture payload'), sha256: payloadRef.digest }, priceRef: null },
      usageSources: ['native-fixture'], cancel: guarantee, recovery: guarantee, isolation: guarantee,
      hostSpecific: { probeStatus: null, homeObservationRef: null, integrationCompatibility: 'unknown',
        rawManifestRef: evidence('fixture manifest', 'fixture source'), noteRefs: [] } }), 'HostManifest'), model,
    toolsetDigest: hash('same tools'), authorityDigest: hash('same permissions'), cellStatus: 'complete' }));
  const baseDigest = hash('candidate repository base'), scope = { workspaceRef: null, readResources: ['repo'], writeResources: ['staging'], artifactScopes: ['assets'], trustDomain: 'same-user' };
  const revision = { category: 'strategy', createdAt: 1, compatibility: { hosts: hostBindings.map(h => ({ hostId: h.hostId, version: h.version, manifestRef: h.manifestRef })),
    models: [model], repositories: [{ repoId: 'candidate-repo', baseDigest }], taskIds: ['coding-task'], protocolRef },
  candidate: { protocol: { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' },
    asset: { protocol: { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' }, assetId: 'strategy', revision: 1, digest: hash('placeholder'), scope, qualificationRef: null },
    kind: 'memory', contentRefs: [artifact('candidate strategy content')], sourceTraces: [artifact('training-only source')], dependencies: [],
    hypothesis: 'Independent evaluation under the same resource caps prevents unsupported uplift claims.', qualification: 'staged',
    evaluationRef: null, revocationRef: null, expiresAt: null } };
  revision.candidate.asset.digest = revisionDigest(revision, digest);
  const partition = confirmatory ? 'held-out' : 'dev';
  const samples = Array.from({ length: n }, (_, i) => ({ instanceId: `instance-${i}`, repoId: `repo-${i}`, familyId: `family-${i}`,
    stratum: i < Math.floor(n * 0.4) ? 'S1' : i < Math.floor(n * 0.75) ? 'S2' : 'S3', baseDigest: hash(`base-${i}`),
    contractRef: artifact(`behavior contract ${i}`, 'BehaviorContract', { partition, visibility: 'private' }),
    privateTestsRef: artifact(`private check ${i}`, 'PrivateTests', { partition, visibility: 'private' }), requiredBranches: ['write', 'check'], leakRisk: 'low' }));
  const splitRef = artifact(canonical({ partition, samples }), 'DataSplit', { partition, visibility: 'private' });
  const proof = artifact('test-only protocol approval and budget proof', 'Approval');
  const policy = { poolId: 'experiment', category: 'controlled-experiment', authorizationRef: proof, maxRequests: 10000,
    maxInputTokens: 60000, maxOutputTokens: 4096, maxUsdMicros: 100000000, maxWallMs: 10000000, maxConcurrentRequests: 80,
    priceRef: artifact('frozen test price', 'PriceTable'), missingUsagePolicy: 'retain-reservation' };
  const plan = { id: 'test-protocol', registeredAt: 10, stage: confirmatory ? 'T0' : 'draft', approvalRef: confirmatory ? proof : null,
    candidate: revision, baseDigest, protocolRef, analysisScriptRef, dataSplitRefs: [splitRef], partition,
    hosts: hostBindings, authors: [author], comparisons, plannedN: 160, trialIds: trials, seeds,
    orderSeed: 42, bootstrapSeed: 23, bootstrapReplicates: 10000, selectionRule: 'all-required', primaryMetric: 'task_success',
    secondaryMetrics: ['quality_score', 'itt_composite'], stopping: { confirmatoryN: 160, futilityN: 80, futilityThreshold: 0.20 },
    sampling: { temperature: 0, topP: 1 }, envelopes: EVALUATION_ENVELOPES, budget: budget ? policy : null,
    evidenceKind: confirmatory ? 'unseen' : 'offline' };
  const ports = { artifacts, digest, analysisScriptRef,
    authority: { authorize: (action, _ref, evidence) => evidence.digest === proof.digest ? storeOk(true) : storeFail('EFK_AUTHORITY_DENIED', 'approval is not from the trusted fixture root'),
      attest: ref => { signatures.set(canonical(ref), sign(ref)); return storeOk(true); },
      verify: ref => signatures.get(canonical(ref)) === sign(ref) ? storeOk(true) : storeFail('EFK_DECISION_AUTHORITY_DENIED', 'authority proof absent or altered') },
    journal: { hasStarted: id => storeOk(started.has(id)), runs: () => storeOk(inventory), requestIds: ref => storeOk(requests.get(ref.id)),
      evidenceKind: () => storeOk(confirmatory ? 'unseen' : 'offline') },
    verifier: { issuer: verifierIssuer, version: 'fixture-verifier-1', verify: input => {
      blindInputs.push(input);
      const material = JSON.parse(input.artifacts[0]);
      const output = { privateTestsPassed: material.passes, outcomesMet: true,
        branches: input.requiredBranches.map(id => ({ id, passed: true })), qualityScore: 85, qualityReliable: true };
      return storeOk({ ...output, evidenceRefs: [artifact(canonical([input, output]), 'VerifierOutput', { producer: verifierIssuer, visibility: 'private', partition })],
        usage: [], requestIds: [] });
    } } };
  const registration = { issuer, version: 'evolution-v1' };
  const service = createEvolutionEvaluator(registration, ports);
  function register() { return unwrap(service.preregister(plan, 10)); }
  function usage(requestId, overrides = {}) {
    return { requestId, source: 'provider', inputUncached: 10, cacheRead: 5, cacheWrite: null, output: 3, reasoning: 1,
      total: 18, estimatedUsdMicros: 37, invoiceUsdMicros: null, complete: true, evidenceRefs: [], ...overrides };
  }
  function run(registered, sample, arm, host, trialId, seed, overrides = {}) {
    const runId = `${trialId}:${seed}:${host.hostId}:${sample.instanceId}:${arm}`;
    const binding = { sessionId: `session-${runId}`, hostSessionId: `native-${runId}`,
      graph: { graphId: 'evaluation-run', revision: 1, digest: hash('graph') }, nodeId: 'work', attemptId: 'attempt-1', attemptOrdinal: 1, epoch: 1, baseDigest: sample.baseDigest };
    const passes = Number(sample.instanceId.split('-')[1]) < ({ A: 48, B: 96, C: 144 })[arm];
    const r = { runId, startedAt: 11, registrationRef: registered.ref, trialId, seed, instanceId: sample.instanceId, hostId: host.hostId, arm,
      candidate: arm === 'A' ? null : revision.candidate.asset, baseDigest: sample.baseDigest, hostVersion: host.version,
      model: host.model, protocolRef, sampling: plan.sampling, toolsetDigest: host.toolsetDigest, authorityDigest: host.authorityDigest,
      envelope: EVALUATION_ENVELOPES.find(e => e.tier === sample.stratum), status: 'completed',
      artifactRefs: [artifact(canonical({ passes }), 'Program', { binding, producer: author, partition })],
      actualDiffRef: artifact(`actual diff ${sample.instanceId}`, 'ActualDiff', { binding, producer: author, partition }),
      usage: [usage(`request:${runId}`)], wallMs: 1000, humanWaitMs: 0, authorVisibleRefs: [], pollutionFound: false, ...overrides };
    const ref = artifact(canonical(r), 'EvolutionRun', { partition, visibility: 'private' });
    inventory.push(ref); requests.set(ref.id, [`request:${runId}`]); started.add(plan.id);
    return { run: r, ref };
  }
  function populate(registered, change = () => ({}), count = n) {
    for (const trial of trials) for (const seed of seeds) for (const host of hostBindings) for (const s of samples.slice(0, count))
      for (const arm of comparisons.includes('C-B') ? ['A', 'B', 'C'] : ['A', 'B']) run(registered, s, arm, host, trial, seed, change({ sample: s, arm, host, trial, seed }));
  }
  const evaluate = registered => service.evaluateCapability(registered.ref, 20);
  const analysis = result => JSON.parse(unwrap(artifacts.get(result.receipt.requiredJudgements[0].analysisRef)));
  return { plan, ports, service, issuer, verifierIssuer, author, revision, samples, hostBindings, register, run, populate, evaluate, analysis,
    artifact, usage, inventory, requests, blindInputs, started, signatures };
}
