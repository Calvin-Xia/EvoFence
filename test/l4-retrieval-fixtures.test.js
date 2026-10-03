import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { task } from './l2-policy-fixtures.js';
import { createMemoryArtifactStore } from '../dist/storage/index.js';
import { canonical, storeOk } from '../dist/kernel/store/index.js';
import { emptyRegistry, stageRevision, revisionDigest, recordDecision, revokeRevision } from '../dist/learning/assets/index.js';
import { buildContextPacket } from '../dist/learning/context/index.js';
import { retrieveContext } from '../dist/learning/retrieval/index.js';

export const hash = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
export const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const runtime = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
const assetProtocol = { namespace: 'evofence.assets/1', schemaVersion: '1.0.0' };
const actor = (actorId, kind = 'kernel') => ({ actorId, kind, identityRef: null });

/** Receipts are synthetic, but qualification is obtained through the real registry write path. */
export function fixture() {
  const digest = { digest: hash };
  const tokenizer = { id: 'fixture:utf8-byte/v1', countTokens: text => new TextEncoder().encode(text).length };
  const artifacts = createMemoryArtifactStore({ digest });
  const ports = { digest, tokenizer, artifacts };
  const issuers = { candidate: actor('candidate-service', 'evaluator'), promotion: actor('promotion-service'),
    activation: actor('activation-service'), revocation: actor('permission-root') };
  const registryPorts = { digest, artifacts, issuers, authorize: () => storeOk(true) };
  let ordinal = 0;
  function material(bytes, overrides = {}) {
    const ref = { protocol: runtime, id: `material-${++ordinal}`, digest: hash(bytes),
      producer: actor('training-source'), binding: null,
      schema: { name: 'Material', version: '1.1.0', digest: hash('Material schema') },
      location: `fixture:${ordinal}`, visibility: 'internal', partition: 'train', expiresAt: null, ...overrides };
    unwrap(artifacts.put(ref, bytes));
    return { ref, bytes, purpose: 'evidence', expectation: { productKind: 'pre-source', schema: ref.schema, binding: null } };
  }
  const source = material('read-only train trace').ref;
  const manifest = material('pinned host manifest').ref, payload = material('pinned model payload').ref;
  const protocolRef = material('pinned evaluation protocol').ref;
  const scope = { workspaceRef: null, readResources: ['repo'], writeResources: ['project-staging'],
    artifactScopes: ['assets'], trustDomain: 'same-user' };
  const model = { providerModel: 'fixture/model', reasoningRequested: 'high', reasoningGuarantee: 'payload-only', payloadRef: payload };
  const context = { hostId: 'fixture-host', hostVersion: '1.0.0', hostManifestRef: manifest, hostSessionId: 'host-session',
    model, repoId: 'fixture-repo', baseDigest: hash('base'), taskId: 'task-1', scope, at: 20 };
  const contract = task({ scope, authorityGrant: { ...task().authorityGrant, scope } });
  const baseInputs = { contractRef: { taskId: contract.taskId, version: contract.version, digest: hash(canonical(contract)) },
    binding: { sessionId: 'session-1', hostSessionId: context.hostSessionId,
      graph: { graphId: 'graph-1', revision: 2, digest: hash('graph') }, nodeId: 'retrieval-node',
      attemptId: 'retrieval-attempt', attemptOrdinal: 1, epoch: 1, baseDigest: context.baseDigest },
    nodeInputRefs: [], plan: { inputRefs: [], maxTokens: 60000, preserveHostResources: true, isolation: 'fresh' },
    artifacts: [], at: context.at };
  const input = { registry: emptyRegistry(), candidates: [], context, taskContract: contract, role: 'executor', baseInputs,
    materials: [], window: { windowTokens: 100000, reservedOutputTokens: 4096, hostInputTokens: 100,
      strategy: 'reject', excerptChars: 64 }, budget: { maxAssets: 5, maxAddedTokens: 50000 } };
  function revision(assetId, bytes = `use ${assetId}`, dependencies = [], edits = {}) {
    const item = material(bytes);
    const rev = { category: 'experience', createdAt: 10,
      compatibility: { hosts: [{ hostId: context.hostId, version: context.hostVersion, manifestRef: manifest }],
        models: [model], repositories: [{ repoId: context.repoId, baseDigest: context.baseDigest }], taskIds: [context.taskId], protocolRef },
      candidate: { protocol: assetProtocol, asset: { protocol: assetProtocol, assetId, revision: 1,
        digest: hash('placeholder'), scope, qualificationRef: null }, kind: 'memory', contentRefs: [item.ref],
        sourceTraces: [source], dependencies, hypothesis: 'A train-derived experience improves unseen coding tasks.',
        qualification: 'staged', evaluationRef: null, expiresAt: null, revocationRef: null } };
    Object.assign(rev.candidate, edits);
    rev.candidate.asset.digest = revisionDigest(rev, digest);
    input.materials.push(item); input.baseInputs.nodeInputRefs.push(item.ref);
    return rev;
  }
  function stage(rev) {
    input.registry = unwrap(stageRevision(input.registry, rev, registryPorts));
    input.candidates.push(rev.candidate.asset);
    return rev;
  }
  function evaluation(rev) {
    const judgement = { cellStatus: 'complete', look: 'CONFIRMATORY_LOOK', verdict: 'positive', protocolRef,
      analysisRef: material('synthetic positive analysis').ref, costBasis: 'measured-usage-estimate',
      guardrailCost: 'passed', guardrailWall: 'passed', guardrailTruncation: 'passed' };
    const receipt = { evaluationId: `evaluation-${ordinal}`, candidate: rev.candidate.asset, baseDigest: context.baseDigest,
      dependencyRefs: rev.candidate.dependencies, protocolRef, dataSplitRefs: [source], hostManifestRefs: [manifest],
      modelBindings: [model], requiredJudgements: [judgement], usageComplete: true, evidenceRefs: [source] };
    const ref = material(canonical(receipt), { schema: { name: 'EvaluationReceipt', version: '1.1.0', digest: hash('EvaluationReceipt') },
      producer: actor('independent-evaluator', 'evaluator'), visibility: 'private' }).ref;
    return { judgement, ref };
  }
  function decide(kind, rev, evaluation) {
    const d = { protocol: runtime, decisionId: `decision-${ordinal}`, kind,
      outcome: kind === 'candidate' ? 'validated' : 'promoted', inputs: rev.candidate.contentRefs,
      contractRef: null, taskEvidenceRef: null, evaluationReceiptRef: evaluation.ref, activationReceiptRef: null,
      evaluatorVersion: 'fixture-v1', evaluationProtocolRef: protocolRef, reasons: [], evidenceRefs: [],
      feedbackVisibility: 'internal', issuer: issuers[kind], capabilityJudgement: kind === 'candidate' ? evaluation.judgement : null };
    const decisionRef = material(canonical(d), { schema: { name: 'DecisionRecord', version: '1.1.0', digest: hash('DecisionRecord') },
      producer: issuers[kind], visibility: 'private' }).ref;
    input.registry = unwrap(recordDecision(input.registry, { asset: rev.candidate.asset, decisionRef, context, at: context.at }, registryPorts));
  }
  function promote(rev) {
    const e = evaluation(rev); decide('candidate', rev, e); decide('promotion', rev, e); return rev;
  }
  function revoke(rev) {
    const evidenceRef = material('regression evidence', { producer: issuers.revocation }).ref;
    input.registry = unwrap(revokeRevision(input.registry, { asset: rev.candidate.asset, evidenceRef,
      authorizationRef: 'revoke-grant', at: context.at }, registryPorts));
  }
  const add = (id, bytes, deps, edits) => promote(stage(revision(id, bytes, deps, edits)));
  const baseline = () => unwrap(buildContextPacket(input.taskContract, input.role, input.baseInputs, input.window, ports));
  const retrieve = () => unwrap(retrieveContext(input, ports));
  return { input, ports, registryPorts, material, revision, stage, promote, decide, evaluation, revoke, add, baseline, retrieve };
}
