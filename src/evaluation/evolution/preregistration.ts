import { decode } from '../../protocol/index.js';
import { verifyForConsumer, withheldReason } from '../../kernel/artifacts/index.js';
import { EVALUATION_ENVELOPES, openBudgetLedger, RESERVE_PER_REQUEST_MICROS } from '../../kernel/policy/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { revisionDigest } from '../../learning/assets/index.js';
import { validateCompatibility } from '../../learning/assets/compatibility.js';
import { bytes, exact, frozen, json, publish, same, sameSet } from './artifacts.js';
import type { ArtifactRef, DataSplit, EvolutionPorts, Preregistration, RegisteredPlan, Registration, Sample } from './types.js';

const keys = ['id', 'registeredAt', 'stage', 'approvalRef', 'candidate', 'baseDigest', 'protocolRef', 'analysisScriptRef',
  'dataSplitRefs', 'partition', 'hosts', 'authors', 'comparisons', 'plannedN', 'trialIds', 'seeds', 'orderSeed',
  'bootstrapSeed', 'bootstrapReplicates', 'selectionRule', 'primaryMetric', 'secondaryMetrics', 'stopping',
  'sampling', 'envelopes', 'budget', 'evidenceKind'];
const unique = (xs: readonly unknown[]): boolean => new Set(xs.map(canonical)).size === xs.length;
const nonempty = (x: unknown): x is readonly unknown[] => Array.isArray(x) && x.length > 0;
const mismatch = () => storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'preregistered evaluation binding/design differs from the frozen protocol');

function validate(plan: Preregistration): StoreResult<true> {
  if (!exact(plan, keys) || !nonempty(plan.hosts) || !nonempty(plan.authors) || !nonempty(plan.dataSplitRefs) ||
    !nonempty(plan.trialIds) || !nonempty(plan.seeds) || !exact(plan.stopping, ['confirmatoryN', 'futilityN', 'futilityThreshold']) ||
    !exact(plan.sampling, ['temperature', 'topP']) || !Array.isArray(plan.envelopes) ||
    !exact(plan.candidate, ['candidate', 'category', 'compatibility', 'createdAt'])) return storeFail('EFK_SCHEMA_INVALID', 'invalid preregistration shape');
  for (const [name, value] of [['Id', plan.id], ['Instant', plan.registeredAt], ['Digest', plan.baseDigest],
    ['CapabilityAsset', plan.candidate.candidate], ['ArtifactRef', plan.protocolRef], ['ArtifactRef', plan.analysisScriptRef]] as const) {
    const decoded = decode(name, value); if (!decoded.ok) return decoded;
  }
  const compat = validateCompatibility(plan.candidate.compatibility); if (!compat.ok) return compat;
  if (!['draft', 'T0'].includes(plan.stage) || !['train', 'dev', 'held-out', 'final'].includes(plan.partition) ||
    !['fixture', 'offline', 'unseen'].includes(plan.evidenceKind) || ![160, 165].includes(plan.plannedN) ||
    !same(plan.secondaryMetrics, ['quality_score', 'itt_composite']) || plan.primaryMetric !== 'task_success' ||
    plan.selectionRule !== 'all-required' || ![canonical(['B-A']), canonical(['B-A', 'C-B'])].includes(canonical(plan.comparisons)) ||
    plan.bootstrapReplicates !== 10000 || plan.stopping.confirmatoryN !== plan.plannedN ||
    (plan.stopping.futilityN !== null && plan.stopping.futilityN !== Math.floor(plan.plannedN / 2)) ||
    plan.stopping.futilityThreshold !== 0.20 || !same(plan.envelopes, EVALUATION_ENVELOPES) ||
    !Number.isFinite(plan.sampling.temperature) || plan.sampling.temperature < 0 ||
    !Number.isFinite(plan.sampling.topP) || plan.sampling.topP <= 0 || plan.sampling.topP > 1 ||
    !unique(plan.trialIds) || !unique(plan.seeds) || !unique(plan.dataSplitRefs) ||
    !plan.seeds.every(s => Number.isSafeInteger(s) && s >= 0 && s <= 0xffffffff) ||
    ![plan.orderSeed, plan.bootstrapSeed].every(s => Number.isSafeInteger(s) && s >= 0 && s <= 0xffffffff)) return mismatch();
  for (const id of plan.trialIds) { const d = decode('Id', id); if (!d.ok) return d; }
  for (const author of plan.authors) { const d = decode('ActorRef', author); if (!d.ok) return d; }
  if (plan.budget !== null) { const d = decode('BudgetPolicy', plan.budget); if (!d.ok) return d; }
  if (plan.approvalRef !== null) { const d = decode('ArtifactRef', plan.approvalRef); if (!d.ok) return d; }
  for (const host of plan.hosts) {
    if (!exact(host, ['hostId', 'version', 'manifestRef', 'model', 'toolsetDigest', 'authorityDigest', 'cellStatus']) ||
      !['complete', 'capability_absent', 'not-yet-comparable'].includes(host.cellStatus) || typeof host.version !== 'string' || host.version.length === 0) return mismatch();
    for (const [name, value] of [['Id', host.hostId], ['ArtifactRef', host.manifestRef], ['ModelRequirement', host.model],
      ['Digest', host.toolsetDigest], ['Digest', host.authorityDigest]] as const) { const d = decode(name, value); if (!d.ok) return d; }
  }
  const c = plan.candidate.compatibility;
  if (!same(c.protocolRef, plan.protocolRef) || !sameSet(c.hosts, plan.hosts.map(h => ({ hostId: h.hostId, version: h.version, manifestRef: h.manifestRef }))) ||
    !sameSet(c.models, [...new Map(plan.hosts.map(h => [canonical(h.model), h.model])).values()]) ||
    c.repositories.some(r => r.baseDigest !== plan.baseDigest) || !unique(plan.hosts.map(h => h.hostId))) return mismatch();
  return storeOk(true);
}
function sample(value: unknown): StoreResult<Sample> {
  if (!exact(value, ['instanceId', 'repoId', 'familyId', 'stratum', 'baseDigest', 'contractRef', 'privateTestsRef', 'requiredBranches', 'leakRisk']) ||
    !['S1', 'S2', 'S3'].includes(value.stratum as string) || !['low', 'reviewed', 'high', 'unreviewed'].includes(value.leakRisk as string) ||
    !Array.isArray(value.requiredBranches) || !unique(value.requiredBranches)) return storeFail('EFK_SCHEMA_INVALID', 'invalid sample manifest');
  for (const [name, item] of [['Id', value.instanceId], ['Id', value.repoId], ['Id', value.familyId], ['Digest', value.baseDigest],
    ['ArtifactRef', value.contractRef], ['ArtifactRef', value.privateTestsRef]] as const) { const d = decode(name, item); if (!d.ok) return d; }
  for (const id of value.requiredBranches) { const d = decode('Id', id); if (!d.ok) return d; }
  return storeOk(value as unknown as Sample);
}
function loadSplits(plan: Preregistration, at: number, ports: EvolutionPorts): StoreResult<readonly DataSplit[]> {
  const splits: DataSplit[] = [], ids = new Set<string>(), repos = new Map<string, string>(), families = new Map<string, string>();
  for (const ref of plan.dataSplitRefs) {
    const loaded = json(ref, at, ports); if (!loaded.ok) return loaded;
    const value = loaded.value;
    if (!exact(value, ['partition', 'samples']) || !['train', 'dev', 'held-out', 'final'].includes(value.partition as string) ||
      !Array.isArray(value.samples) || ref.partition !== value.partition || splits.some(s => s.partition === value.partition)) return mismatch();
    const samples: Sample[] = [], withinRepo = new Set<string>();
    for (const item of value.samples) {
      const checked = sample(item); if (!checked.ok) return checked;
      const s = checked.value;
      if (ids.has(s.instanceId) || (repos.has(s.repoId) && repos.get(s.repoId) !== value.partition) ||
        (families.has(s.familyId) && families.get(s.familyId) !== value.partition) ||
        (['held-out', 'final'].includes(value.partition as string) && (withinRepo.has(s.repoId) || !['low', 'reviewed'].includes(s.leakRisk)))) return mismatch();
      ids.add(s.instanceId); withinRepo.add(s.repoId); repos.set(s.repoId, value.partition as string); families.set(s.familyId, value.partition as string);
      if (s.privateTestsRef.partition !== value.partition) return mismatch();
      const privateAccess = withheldReason(s.privateTestsRef, 'author'); if (!privateAccess.ok) return privateAccess;
      if (privateAccess.value === 'none') return storeFail('EFK_PRIVACY_VIOLATION', 'private acceptance tests must be evaluator-only');
      for (const evidence of [s.contractRef, s.privateTestsRef]) { const read = bytes(evidence, at, ports); if (!read.ok) return read; }
      samples.push(s);
    }
    splits.push({ partition: value.partition as DataSplit['partition'], samples });
  }
  if (!splits.some(s => s.partition === plan.partition)) return mismatch();
  if (plan.stage === 'T0' && plan.partition === 'held-out') {
    const s = splits.find(s => s.partition === 'held-out')!.samples;
    const raw = [0.4, 0.35, 0.25].map(w => w * plan.plannedN), quota = raw.map(Math.floor);
    const order = [0, 1, 2].sort((a, b) => (raw[b] - quota[b]) - (raw[a] - quota[a]) || a - b);
    const remaining = plan.plannedN - quota.reduce((a, b) => a + b, 0);
    for (let i = 0; i < remaining; i++) quota[order[i]]++;
    if (s.length !== plan.plannedN || ['S1', 'S2', 'S3'].some((stratum, i) => s.filter(x => x.stratum === stratum).length !== quota[i])) return mismatch();
  }
  return storeOk(splits);
}
function prepare(plan: Preregistration, ref: ArtifactRef, at: number, registration: Registration, ports: EvolutionPorts): StoreResult<RegisteredPlan> {
  if (registration.issuer.kind !== 'evaluator' || ports.verifier.issuer.kind !== 'evaluator' ||
    registration.version.length === 0 || ports.verifier.version.length === 0 ||
    plan.authors.some(a => a.actorId === registration.issuer.actorId || a.actorId === ports.verifier.issuer.actorId)) {
    return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'evaluation and blind verifier must be independent of candidate authors');
  }
  if (!same(plan.analysisScriptRef, ports.analysisScriptRef) || revisionDigest(plan.candidate, ports.digest) !== plan.candidate.candidate.asset.digest) return mismatch();
  const material = verifyForConsumer({ role: 'asset', contentRefs: plan.candidate.candidate.contentRefs,
    sourceTraces: plan.candidate.candidate.sourceTraces, revokedDependencies: [], at }, ports.artifacts); if (!material.ok) return material;
  for (const evidence of [plan.protocolRef, plan.analysisScriptRef, ...plan.hosts.flatMap(h => [h.manifestRef, h.model.payloadRef!])]) {
    const loaded = bytes(evidence, at, ports); if (!loaded.ok) return loaded;
  }
  for (const host of plan.hosts) {
    const manifest = json(host.manifestRef, at, ports); if (!manifest.ok) return manifest;
    const decoded = decode('HostManifest', manifest.value); if (!decoded.ok) return decoded;
    const identity = decoded.value.identity;
    if (identity.host !== host.hostId || identity.version !== host.version ||
      !decoded.value.compatibleProtocols.some(p => same(p, host.manifestRef.protocol))) return mismatch();
    const model = decoded.value.model;
    if (host.cellStatus === 'complete' && (model === null || model.providerModel !== host.model.providerModel ||
      model.reasoningRequested !== host.model.reasoningRequested || model.payloadRef === null ||
      (model.payloadRef as Record<string, unknown>).sha256 !== host.model.payloadRef!.digest)) return mismatch();
  }
  const splits = loadSplits(plan, at, ports); if (!splits.ok) return splits;
  let t0Approved = false, budgetAuthorized = false;
  if (plan.stage === 'T0' && plan.approvalRef !== null) {
    const read = bytes(plan.approvalRef, at, ports); if (!read.ok) return read;
    const approved = ports.authority.authorize('T0', ref, plan.approvalRef, at); if (!approved.ok) return approved;
    t0Approved = true;
  }
  if (plan.budget !== null && plan.budget.category === 'controlled-experiment' && plan.budget.authorizationRef !== null) {
    const policy = openBudgetLedger(plan.budget, RESERVE_PER_REQUEST_MICROS); if (!policy.ok) return policy;
    const proof = plan.budget.authorizationRef as ArtifactRef;
    const read = bytes(proof, at, ports); if (!read.ok) return read;
    const price = bytes(plan.budget.priceRef as ArtifactRef, at, ports); if (!price.ok) return price;
    const authorized = ports.authority.authorize('budget', ref, proof, at); if (!authorized.ok) return authorized;
    budgetAuthorized = true;
  }
  return storeOk({ ref, plan, splits: splits.value, t0Approved, budgetAuthorized });
}
export function preregister(input: Preregistration, at: number, registration: Registration, ports: EvolutionPorts): StoreResult<RegisteredPlan> {
  const valid = validate(input); if (!valid.ok) return valid;
  const time = decode('Instant', at); if (!time.ok) return time;
  if (input.registeredAt > at) return mismatch();
  const started = ports.journal.hasStarted(input.id); if (!started.ok) return started;
  if (started.value) return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'preregistration must precede every result');
  // Freeze a copy: later author mutation never changes the stored protocol/selection rule.
  const plan = frozen(JSON.parse(canonical(input)) as Preregistration);
  const published = publish(plan, 'EvolutionPreregistration', registration.issuer, plan.partition, ports, `preregistration:${plan.id}`);
  if (!published.ok) return published;
  return prepare(plan, published.value, at, registration, ports);
}
export function loadRegistration(ref: ArtifactRef, at: number, registration: Registration, ports: EvolutionPorts): StoreResult<RegisteredPlan> {
  if (ref.schema.name !== 'EvolutionPreregistration' || !same(ref.producer, registration.issuer)) return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'preregistration issuer is not the registered evolution service');
  const proof = ports.authority.verify(ref); if (!proof.ok) return proof;
  const loaded = json(ref, at, ports); if (!loaded.ok) return loaded;
  const plan = loaded.value as Preregistration;
  const valid = validate(plan); if (!valid.ok) return valid;
  return prepare(plan, ref, at, registration, ports);
}
