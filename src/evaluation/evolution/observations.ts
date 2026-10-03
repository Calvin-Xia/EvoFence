import { decode } from '../../protocol/index.js';
import { withheldReason } from '../../kernel/artifacts/index.js';
import { normalizeUsage, usageCompleteness, RESERVE_PER_REQUEST_MICROS } from '../../kernel/policy/index.js';
import { storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import type { Usage } from '../../kernel/policy/index.js';
import { bytes, exact, json, publish, same, sameSet } from './artifacts.js';
import { shuffled } from './statistics.js';
import type { ArtifactRef, EvolutionPorts, Observation, RegisteredPlan, Registration, Run, Sample, Verification } from './types.js';

const runKeys = ['runId', 'startedAt', 'registrationRef', 'trialId', 'seed', 'instanceId', 'hostId', 'arm', 'candidate',
  'baseDigest', 'hostVersion', 'model', 'protocolRef', 'sampling', 'toolsetDigest', 'authorityDigest', 'envelope', 'status',
  'artifactRefs', 'actualDiffRef', 'usage', 'wallMs', 'humanWaitMs', 'authorVisibleRefs', 'pollutionFound'];
function validateRun(value: unknown, registered: RegisteredPlan): StoreResult<{ run: Run; sample: Sample }> {
  if (!exact(value, runKeys) || !Array.isArray(value.artifactRefs) || value.artifactRefs.length === 0 ||
    !Array.isArray(value.usage) || !Array.isArray(value.authorVisibleRefs) || typeof value.pollutionFound !== 'boolean' ||
    !['completed', 'incomplete', 'timeout', 'cancelled', 'usage_incomplete', 'needs-human', 'unknown'].includes(value.status as string)) {
    return storeFail('EFK_SCHEMA_INVALID', 'invalid run observation');
  }
  for (const [name, item] of [['Id', value.runId], ['Instant', value.startedAt], ['ArtifactRef', value.registrationRef],
    ['ModelRequirement', value.model], ['ArtifactRef', value.protocolRef], ['ArtifactRef', value.actualDiffRef],
    ['Count', value.wallMs], ['Count', value.humanWaitMs]] as const) { const decoded = decode(name, item); if (!decoded.ok) return decoded; }
  const run = value as unknown as Run, plan = registered.plan;
  const host = plan.hosts.find(h => h.hostId === run.hostId);
  const sample = registered.splits.find(s => s.partition === plan.partition)!.samples.find(s => s.instanceId === run.instanceId);
  const arms = plan.comparisons.includes('C-B') ? ['A', 'B', 'C'] : ['A', 'B'];
  if (host === undefined || sample === undefined || !arms.includes(run.arm) || !plan.trialIds.includes(run.trialId) ||
    !plan.seeds.includes(run.seed) || run.startedAt <= plan.registeredAt || !same(run.registrationRef, registered.ref) ||
    run.baseDigest !== sample.baseDigest || run.hostVersion !== host.version || !same(run.model, host.model) ||
    !same(run.protocolRef, plan.protocolRef) || !same(run.sampling, plan.sampling) || run.toolsetDigest !== host.toolsetDigest || run.authorityDigest !== host.authorityDigest ||
    !same(run.envelope, plan.envelopes.find(e => e.tier === sample.stratum)) ||
    !same(run.candidate, run.arm === 'A' ? null : plan.candidate.candidate.asset)) {
    return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'run differs from its preregistered candidate/base/host/model/resources/seed/split');
  }
  return storeOk({ run, sample });
}
function completeness(usages: readonly Usage[], requestIds: readonly string[]): StoreResult<ReturnType<typeof usageCompleteness>> {
  for (const usage of usages) {
    const valid = decode('Usage', usage); if (!valid.ok) return valid;
    const normalized = normalizeUsage(usage); if (!normalized.ok) return normalized;
    if (usage.complete && usage.total !== usage.inputUncached! + usage.cacheRead! + usage.output!) {
      return storeFail('EFK_USAGE_CONFLICT', 'normalized token total must include cached input and output exactly once');
    }
  }
  const result = usageCompleteness(usages, requestIds);
  return result.conflictingRequestIds.length > 0 ? storeFail('EFK_USAGE_CONFLICT', 'request telemetry differs from the complete request inventory') : storeOk(result);
}
function verifyShape(v: Verification, sample: Sample): StoreResult<true> {
  if (!exact(v, ['privateTestsPassed', 'outcomesMet', 'branches', 'qualityScore', 'qualityReliable', 'evidenceRefs', 'usage', 'requestIds']) ||
    ![true, false, null].includes(v.privateTestsPassed) || ![true, false, null].includes(v.outcomesMet) ||
    !Array.isArray(v.branches) || !Array.isArray(v.evidenceRefs) || v.evidenceRefs.length === 0 ||
    !Array.isArray(v.usage) || !Array.isArray(v.requestIds) || typeof v.qualityReliable !== 'boolean' ||
    (v.qualityScore !== null && (!Number.isFinite(v.qualityScore) || v.qualityScore < 0 || v.qualityScore > 100)) ||
    v.branches.some(b => !exact(b, ['id', 'passed']) || ![true, false, null].includes(b.passed as boolean | null)) ||
    !sameSet(v.branches.map(b => b.id), sample.requiredBranches)) {
    return storeFail('EFK_EVALUATION_INSUFFICIENT', 'independent verifier must retain every required branch and actual output evidence');
  }
  return storeOk(true);
}
export const cellKey = (run: Run): string => JSON.stringify([run.trialId, run.seed, run.hostId, run.instanceId, run.arm]);

export function observe(registered: RegisteredPlan, at: number, registration: Registration, ports: EvolutionPorts): StoreResult<readonly Observation[]> {
  const inventory = ports.journal.runs(registered.ref); if (!inventory.ok) return inventory;
  const entries: { run: Run; sample: Sample; ref: ArtifactRef }[] = [], keys = new Set<string>(), ids = new Set<string>();
  for (const ref of inventory.value) {
    const value = json(ref, at, ports); if (!value.ok) return value;
    const checked = validateRun(value.value, registered); if (!checked.ok) return checked;
    const provenance = ports.journal.evidenceKind(ref); if (!provenance.ok) return provenance;
    if (provenance.value !== registered.plan.evidenceKind) return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'offline/fixture records cannot be relabeled as unseen evaluation');
    const key = cellKey(checked.value.run);
    if (keys.has(key) || ids.has(checked.value.run.runId)) return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'duplicate sample/seed or undeclared repeated trial cannot be selected away');
    keys.add(key); ids.add(checked.value.run.runId); entries.push({ ...checked.value, ref });
  }
  const observations: Observation[] = [], allRequests = new Set<string>();
  for (const entry of shuffled(entries.sort((a, b) => cellKey(a.run).localeCompare(cellKey(b.run))), registered.plan.orderSeed)) {
    const { run, sample, ref } = entry;
    for (const visible of run.authorVisibleRefs) {
      const access = withheldReason(visible, 'author'); if (!access.ok) return access;
      if (access.value !== 'none') return storeFail('EFK_PRIVACY_VIOLATION', 'author transcript contains private/held-out/final material');
    }
    const artifacts: string[] = [];
    for (const product of run.artifactRefs) {
      const read = bytes(product, at, ports); if (!read.ok) return read;
      if (product.binding === null || product.binding.baseDigest !== run.baseDigest || !same(product.binding, run.artifactRefs[0].binding)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'run products must bind the same actual base/attempt');
      if (product.producer.actorId === ports.verifier.issuer.actorId || product.producer.actorId === registration.issuer.actorId) return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'candidate executor cannot also be its evaluation pipeline');
      artifacts.push(read.value);
    }
    if (run.actualDiffRef.binding === null || run.actualDiffRef.binding.baseDigest !== run.baseDigest ||
      !same(run.actualDiffRef.binding, run.artifactRefs[0].binding)) return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'actual diff must bind the same run attempt');
    const diff = bytes(run.actualDiffRef, at, ports); if (!diff.ok) return diff;
    const contract = bytes(sample.contractRef, at, ports); if (!contract.ok) return contract;
    const checks = bytes(sample.privateTestsRef, at, ports); if (!checks.ok) return checks;
    const verified = ports.verifier.verify({ opaqueId: `blind-${observations.length}`, artifacts, actualDiff: diff.value,
      contract: contract.value, privateTests: checks.value, requiredBranches: sample.requiredBranches }); if (!verified.ok) return verified;
    const v = verified.value, shaped = verifyShape(v, sample); if (!shaped.ok) return shaped;
    for (const evidence of v.evidenceRefs) {
      const read = bytes(evidence, at, ports); if (!read.ok) return read;
      if (!same(evidence.producer, ports.verifier.issuer)) return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'verification output must come from the registered independent pipeline');
    }
    const expected = ports.journal.requestIds(ref); if (!expected.ok) return expected;
    for (const id of [...expected.value, ...v.requestIds]) {
      if (allRequests.has(id)) return storeFail('EFK_USAGE_CONFLICT', 'a request cannot be attributed to multiple runs/judges');
      allRequests.add(id);
    }
    const usage = completeness(run.usage, expected.value); if (!usage.ok) return usage;
    if (registered.plan.budget !== null && run.usage.some(u => u.complete &&
      (u.inputUncached! + u.cacheRead! > registered.plan.budget!.maxInputTokens || u.output! > registered.plan.budget!.maxOutputTokens))) {
      return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'measured per-request token usage exceeds the frozen resource envelope');
    }
    const judging = completeness(v.usage, v.requestIds); if (!judging.ok) return judging;
    const known = usage.value.knownMicros;
    const hitCap = run.wallMs >= run.envelope.wallMs || expected.value.length >= run.envelope.requestCap ||
      (known !== null && known >= run.envelope.usdCap);
    const incomplete = run.status !== 'completed' || hitCap || !usage.value.complete;
    const success = !incomplete && diff.value.trim().length > 0 && v.privateTestsPassed === true && v.outcomesMet === true && v.branches.every(b => b.passed === true) ? 1 : 0;
    const verificationRef = publish({ runRef: ref, verifier: ports.verifier.issuer, version: ports.verifier.version,
      result: v, usage: usage.value, judgingUsage: judging.value }, 'EvolutionVerification', registration.issuer, registered.plan.partition, ports);
    if (!verificationRef.ok) return verificationRef;
    observations.push({ run, ref, success, quality: success === 1 ? v.qualityScore : null, qualityReliable: v.qualityReliable,
      costMicros: known, usageComplete: usage.value.complete, incomplete,
      uncertain: v.privateTestsPassed === null || v.outcomesMet === null || v.branches.some(b => b.passed === null),
      polluted: run.pollutionFound, judgingCostMicros: judging.value.knownMicros, judgingUsageComplete: judging.value.complete,
      retainedReservationMicros: (usage.value.missingRequestIds.length + usage.value.incompleteRequestIds.length +
        judging.value.missingRequestIds.length + judging.value.incompleteRequestIds.length) * RESERVE_PER_REQUEST_MICROS,
      requestCount: expected.value.length + v.requestIds.length,
      evidenceRefs: [verificationRef.value, ...v.evidenceRefs] });
  }
  return storeOk(observations.sort((a, b) => cellKey(a.run).localeCompare(cellKey(b.run))));
}
