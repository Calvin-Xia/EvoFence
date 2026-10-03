import { decode } from '../../protocol/index.js';
import { scopeViolations } from '../../kernel/policy/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { qualification, sameRevision } from '../assets/index.js';
import { buildContextPacket } from '../context/index.js';
import type { ContextArtifact, ContextPorts } from '../context/index.js';
import { admitMaterial } from './material.js';
import type { IgnoreReason, RetrievalAttribution, RetrievalInput, RetrievalPorts, RetrievalResult } from './types.js';

const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const identity = (ref: RetrievalInput['candidates'][number]) => ({ assetId: ref.assetId, revision: ref.revision, digest: ref.digest });

/** No clock, host, model, locator discovery, latest lookup or registry mutation. */
export function retrieveContext(input: RetrievalInput, ports: RetrievalPorts): StoreResult<RetrievalResult> {
  const b = input.budget;
  if (!Number.isSafeInteger(b.maxAssets) || b.maxAssets < 0 || b.maxAssets > 5 ||
      !Number.isSafeInteger(b.maxAddedTokens) || b.maxAddedTokens < 0 ||
      !Array.isArray(input.candidates) || !Array.isArray(input.materials)) {
    return storeFail('EFK_SCHEMA_INVALID', 'retrieval needs explicit count (0..5) and token budgets');
  }
  if (new Set(input.materials.map(item => item.ref.id)).size !== input.materials.length) {
    return storeFail('EFK_GRAPH_INPUT_STALE', 'retrieval hydration must have unique artifact identities');
  }
  let qualificationQueries = 0, materialReads = 0, materialCodeUnits = 0, tokenizerCalls = 0, tokensCounted = 0;
  const measured: ContextPorts = { digest: ports.digest, tokenizer: { id: ports.tokenizer.id, countTokens(text) {
    const tokens = ports.tokenizer.countTokens(text);
    tokenizerCalls++; tokensCounted += tokens;
    return tokens;
  } } };
  const materialPorts: RetrievalPorts = { ...measured, artifacts: { put: ports.artifacts.put.bind(ports.artifacts),
    ids: ports.artifacts.ids.bind(ports.artifacts), get(ref) {
    materialReads++;
    const result = ports.artifacts.get(ref);
    if (result.ok) materialCodeUnits += result.value.length;
    return result;
  } } };
  // A proposed injection cannot use the baseline as a side channel around qualification.
  if (input.registry.revisions.some(r => input.candidates.some(ref => sameRevision(r.candidate.asset, ref)) &&
      r.candidate.contentRefs.some(ref => input.baseInputs.plan.inputRefs.some(base => base.id === ref.id)))) {
    return storeFail('EFK_GRAPH_INPUT_STALE', 'base execution must exclude retrieval content');
  }
  const baseline = buildContextPacket(input.taskContract, input.role, input.baseInputs, input.window, measured);
  if (!baseline.ok) return baseline;
  // Join independently supplied retrieval metadata to this exact task/node/host session/base/time.
  const c = input.context, current = input.baseInputs;
  const scope = decode('Scope', c.scope);
  if (!scope.ok) return storeFail(scope.error.code, 'retrieval scope rejected');
  if (c.taskId !== current.contractRef.taskId || c.hostSessionId !== current.binding.hostSessionId ||
      c.baseDigest !== current.binding.baseDigest || c.at !== current.at ||
      scopeViolations(c.scope, (input.taskContract as { scope: typeof c.scope }).scope).length > 0) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'retrieval metadata differs from the current task/node binding');
  }
  const refs = [...input.candidates].sort((a, b) => lexical(canonical(a), canonical(b)));
  const seen = new Set<string>();
  const attribution: RetrievalAttribution[] = [];
  const pool: { record: RetrievalAttribution; materials: readonly ContextArtifact[] }[] = [];
  for (const ref of refs) {
    const key = canonical(identity(ref));
    if (seen.has(key)) return storeFail('EFK_SCHEMA_INVALID', 'retrieval candidate revisions must be unique');
    seen.add(key);
    qualificationQueries++;
    const q = qualification(input.registry, ref, c);
    const record: RetrievalAttribution = { asset: identity(ref), qualification: q.ok ? q.value : null,
      retrieved: false, disposition: 'ignored', reasons: [], contentTokens: null, entryIds: [], feedbackReason: null };
    if (!q.ok || !q.value.eligible) {
      attribution.push({ ...record, reasons: q.ok ? q.value.reasons : [q.error.code] });
      continue;
    }
    const revision = input.registry.revisions.find(r => sameRevision(r.candidate.asset, ref))!;
    const material = admitMaterial(revision, input, materialPorts);
    if (!material.ok) { attribution.push({ ...record, reasons: [material.error.code] }); continue; }
    let contentTokens = 0;
    for (const item of material.value) {
      const count = measured.tokenizer.countTokens(item.bytes);
      if (!Number.isSafeInteger(count) || count < 0) return storeFail('EFK_SCHEMA_INVALID', 'invalid retrieval tokenizer count');
      contentTokens += count;
    }
    pool.push({ record: { ...record, retrieved: true, contentTokens }, materials: material.value });
  }
  // Cheapest complete content first; locale-independent identity tie-breakers. No learned ranker.
  pool.sort((a, b) => a.record.contentTokens! - b.record.contentTokens! ||
    lexical(a.record.asset.assetId, b.record.asset.assetId) || b.record.asset.revision - a.record.asset.revision ||
    lexical(a.record.asset.digest, b.record.asset.digest));
  let context = baseline.value;
  let selected: ContextArtifact[] = [];
  const assets: RetrievalAttribution['asset'][] = [];
  for (const item of pool) {
    let reason: IgnoreReason | null = null;
    if (assets.length >= b.maxAssets) reason = 'asset-count-budget';
    else {
      const trial = [...selected];
      for (const material of item.materials) {
        const prior = trial.find(p => p.ref.id === material.ref.id);
        if (prior === undefined) trial.push(material);
        else if (canonical(prior) !== canonical(material)) {
          return storeFail('EFK_GRAPH_INPUT_STALE', 'shared retrieval content has conflicting hydration');
        }
      }
      const candidate = buildContextPacket(input.taskContract, input.role, { ...current,
        plan: { ...current.plan, inputRefs: [...current.plan.inputRefs, ...trial.map(a => a.ref)] },
        artifacts: [...current.artifacts, ...trial],
      }, input.window, measured);
      if (!candidate.ok) reason = candidate.error.code === 'EFK_BUDGET_EXHAUSTED' ? 'context-window-budget' : candidate.error.code;
      else if (Math.max(0, candidate.value.tokenCount - baseline.value.tokenCount) > b.maxAddedTokens) reason = 'added-token-budget';
      else { context = candidate.value; selected = trial; assets.push(item.record.asset); }
    }
    attribution.push({ ...item.record, disposition: reason === null ? 'pending' : 'ignored',
      reasons: reason === null ? [] : [reason], entryIds: reason === null ? item.materials.map(m => m.ref.id) : [] });
  }
  const delta = context.tokenCount - baseline.value.tokenCount;
  return storeOk({ mode: assets.length === 0 ? 'base' : 'candidate',
    fallbackReason: assets.length === 0 ? pool.length === 0 ? 'no-eligible-assets' : 'no-assets-fit' : null,
    candidate: assets.length === 0 ? null : { assets, context }, context, attribution,
    cost: { basis: 'injected-tokenizer-estimate', tokenizerId: ports.tokenizer.id,
      baselineInputTokens: baseline.value.tokenCount, candidateInputTokens: context.tokenCount,
      inputTokenDelta: delta, chargedAddedTokens: Math.max(0, delta), qualificationQueries,
      materialReads, materialCodeUnits, tokenizerCalls, tokensCounted, modelRequests: 0, wallMs: null, usdMicros: null },
  });
}
