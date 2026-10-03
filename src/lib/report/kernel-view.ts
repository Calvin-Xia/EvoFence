/** One read-only ReviewView for CLI and both hosts. All judgements remain in their owners. */
import { decode, asInstant } from '../../protocol/index.js';
import { computeFrontier } from '../../kernel/scheduler/index.js';
import { budgetSnapshot } from '../../kernel/policy/index.js';
import { storeOk, canonical, type ArtifactRef, type ArtifactStore } from '../../kernel/store/index.js';
import { factsFor, currentAttemptOf, type SessionSeed, type SessionService } from '../../runtime/session/index.js';
import { qualification } from '../../learning/assets/qualification.js';
import type { RegistrySnapshot, QualificationContext } from '../../learning/assets/types.js';
import type { ReportFormat } from './formats.js';

export interface ReviewDecisionLink {
  readonly purpose: 'stop' | 'promotion' | 'revocation' | 'evaluation';
  readonly ref: ArtifactRef | null;
}
export interface KernelReviewSource {
  readonly service: Pick<SessionService, 'read'>;
  readonly seed: SessionSeed;
  readonly artifacts: Pick<ArtifactStore, 'get'>;
  /** Supplied by the owning registry service; never a mutable surface cache. */
  readonly registry: RegistrySnapshot;
  readonly assetContext: QualificationContext | null;
  readonly decisionLinks: readonly ReviewDecisionLink[];
  readonly at: number;
}
export interface KernelReviewOptions { readonly includePrivate: boolean }

/** Public text may contain codes and ids, but never credential-shaped material. */
export function redactReviewText(value: string): string {
  return /secret|credential|password|api[_-]?key|token[=: _-]|bearer\s|sk-[a-z0-9]|holdout|held[-_ ]out|private[_-]|final[_-]|:\/\/[^\s/@]*:[^\s/@]*@/i.test(value)
    ? '[redacted]' : value;
}
function safeValue<T>(value: T): T {
  if (typeof value === 'string') return redactReviewText(value) as T;
  if (Array.isArray(value)) return value.map(safeValue) as T;
  if (value !== null && typeof value === 'object') {
    // These fields are closed protocol enums or locally generated gap codes, never free text.
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, typeof item === 'string' && ['gap', 'visibility', 'partition'].includes(key) ? item : safeValue(item)])) as T;
  }
  return value;
}
/** Content, locator, producer identity and private artifact ids are never exported. */
function reference(ref: ArtifactRef, includePrivate: boolean) {
  if (!includePrivate && ref.visibility !== 'public' && ref.visibility !== 'internal') {
    return { visibility: ref.visibility, withheld: true };
  }
  return { digest: ref.digest, schema: ref.schema.name, version: ref.schema.version,
    visibility: ref.visibility, partition: ref.partition };
}
function decision(source: KernelReviewSource, link: ReviewDecisionLink, options: KernelReviewOptions) {
  const base = { purpose: link.purpose, reference: link.ref === null ? null : reference(link.ref, options.includePrivate) };
  if (link.ref === null) return { ...base, outcome: null, reasons: null, gap: 'decision-record-missing' };
  if (link.ref.schema.name !== 'DecisionRecord') return { ...base, outcome: null, reasons: null, gap: 'EFK_ARTIFACT_BINDING_MISMATCH' };
  const bytes = source.artifacts.get(link.ref);
  if (!bytes.ok) return { ...base, outcome: null, reasons: null, gap: bytes.error.code };
  let raw: unknown;
  try { raw = JSON.parse(bytes.value); }
  catch { return { ...base, outcome: null, reasons: null, gap: 'decision-record-invalid-json' }; }
  const parsed = decode('DecisionRecord', raw);
  if (!parsed.ok) return { ...base, outcome: null, reasons: null, gap: parsed.error.code };
  const record = parsed.value;
  if (canonical(record.issuer) !== canonical(link.ref.producer)) return { ...base, outcome: null, reasons: null, gap: 'EFK_ARTIFACT_BINDING_MISMATCH' };
  // Only the declared feedback summary is public. Opt-in exposes references, never evaluator bytes.
  const visible = record.feedbackVisibility === 'public' || record.feedbackVisibility === 'internal';
  return { ...base, kind: record.kind, outcome: record.outcome,
    reasons: visible ? record.reasons : null,
    gap: record.reasons.length === 0 ? 'decision-reasons-missing' : visible ? null : 'private-feedback-withheld',
    ...(record.capabilityJudgement === null ? {} : { capabilityJudgement: {
      verdict: record.capabilityJudgement.verdict, costBasis: record.capabilityJudgement.costBasis,
      guardrailCost: record.capabilityJudgement.guardrailCost, guardrailWall: record.capabilityJudgement.guardrailWall,
      guardrailTruncation: record.capabilityJudgement.guardrailTruncation } }),
    ...(options.includePrivate ? { evidence: (record.evidenceRefs as ArtifactRef[]).map(ref => reference(ref, true)) } : {}) };
}

/** One transactional runtime read; pure kernel queries explain it without executing intentions. */
export function readKernelView(source: KernelReviewSource, options: KernelReviewOptions = { includePrivate: false }) {
  const read = source.service.read(source.seed.sessionId);
  if (!read.ok) return read;
  const state = read.value, seed = source.seed;
  const facts = factsFor(state, seed, asInstant(source.at));
  const frontier = computeFrontier(seed.graph, facts, state.scheduler).map(entry => ({
    nodeId: entry.nodeId, kind: entry.kind, state: entry.state,
    disposition: entry.disposition, readiness: entry.readiness,
  }));
  const rows = seed.graph.spec.nodes.map(node => ({ nodeId: node.nodeId, kind: node.kind,
    attemptOrdinal: currentAttemptOf(state, node.nodeId), state: facts.states.get(node.nodeId) ?? null }));
  const links = [...source.decisionLinks];
  for (const event of state.events) {
    const ref = event.payload.objectRef;
    if (ref?.schema.name === 'DecisionRecord' && !links.some(link => link.ref?.digest === ref.digest)) {
      links.push({ purpose: 'evaluation', ref });
    }
    if ((event.type === 'session.paused' || event.type === 'session.cancel-requested')
      && !links.some(link => link.purpose === 'stop')) links.push({ purpose: 'stop', ref: null });
  }
  const decisions = links.map(link => decision(source, link, options));
  const assets = source.registry.revisions.map(revision => {
    const asset = revision.candidate;
    const result = source.assetContext === null ? null : qualification(source.registry, asset.asset, source.assetContext);
    return { assetId: asset.asset.assetId, revision: asset.asset.revision, digest: asset.asset.digest,
      category: revision.category, qualification: result === null ? null : result.ok ? result.value : null,
      gap: result === null ? 'qualification-context-missing' : result.ok ? null : result.error.code,
      sourceTraces: asset.sourceTraces.map(ref => reference(ref, options.includePrivate)), dependencies: asset.dependencies.map(dep => ({
        assetId: dep.assetId, revision: dep.revision, digest: dep.digest })),
      history: source.registry.history.filter(e => e.asset.assetId === asset.asset.assetId && e.asset.digest === asset.asset.digest)
        .map(e => ({ sequence: e.sequence, state: e.state, at: e.at })),
    };
  });
  const view = {
    version: 'evofence.review/1', sessionId: state.sessionId, epoch: state.epoch, at: source.at,
    revision: state.revision, graph: seed.graphRef, dispatchMode: state.dispatchMode, cancellation: state.cancellation,
    nodeStates: state.nodeStates, nodes: rows,
    frontier: {
      ready: frontier.filter(e => e.disposition === 'dispatchable'),
      blocked: frontier.filter(e => e.disposition !== 'dispatchable' && e.disposition !== 'unknown'),
      unknown: frontier.filter(e => e.disposition === 'unknown'),
    },
    usage: { unit: 'micro-USD', ...budgetSnapshot(state.budget),
      reservations: state.budget.reservations, settlements: state.budget.settlements,
      measurements: state.events.filter(e => e.type === 'receipt.applied').flatMap(e => state.receipts[e.payload.objectRef!.id].usage)
        .map(row => ({ requestId: row.requestId, source: row.source, complete: row.complete,
          estimatedUsdMicros: row.estimatedUsdMicros, invoiceUsdMicros: row.invoiceUsdMicros,
          inputUncached: row.inputUncached, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite,
          output: row.output, reasoning: row.reasoning, total: row.total })),
      issues: state.usageIssues.map(e => ({ code: e.code, retry: e.retry })) },
    requiredBranches: seed.graph.spec.nodes.filter(node => node.kind === 'join').map(node => ({
      joinId: node.nodeId, requiredBranches: node.requiredBranches,
      branches: node.requiredBranches.map(id => ({ nodeId: id, state: facts.states.get(id) ?? null,
        attempts: state.nodeStates.filter(e => e.nodeId === id) })),
    })),
    effects: {
      unknown: state.unknownEffectIds.map(id => ({ effectId: id, kind: state.effects[id].kind,
        nodeId: state.effects[id].binding.nodeId, status: 'unknown' })),
      nextEffects: state.intents.map(effect => ({ effectId: effect.effectId, kind: effect.kind,
        nodeId: effect.binding.nodeId, status: 'intended' })),
      staleEffectIds: state.staleEffectIds, archivedReceiptIds: state.archivedReceiptIds,
    },
    assets, decisions,
    waitingHuman: rows.filter(row => row.state === 'waiting' || (row.kind === 'human'
      && row.state !== 'succeeded' && row.state !== 'failed' && row.state !== 'cancelled')),
    gaps: decisions.filter(d => d.gap !== null).map(d => ({ purpose: d.purpose, gap: d.gap })),
    privateEvidence: options.includePrivate ? { referencesOnly: true } : null,
  };
  return storeOk(safeValue(view));
}
export type KernelReviewView = Extract<ReturnType<typeof readKernelView>, { ok: true }>['value'];

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
/** Every format carries the entire sanitized view, including empty and null fields. */
export function formatKernelView(view: KernelReviewView, format: ReportFormat): string {
  const json = JSON.stringify(view, null, 2);
  switch (format) {
    case 'json': return `${json}\n`;
    case 'text': return `EvoFence session review\n${json}\n`;
    case 'sarif': return `${JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'EvoFence' } },
      results: view.decisions.map(d => ({ ruleId: `evofence.${d.purpose}`, message: { text: canonical(d) } })),
      properties: { review: view } }] }, null, 2)}\n`;
    case 'junit': {
      const failures = view.nodes.filter(n => n.state === 'failed');
      const skipped = view.nodes.filter(n => n.state === null || !['succeeded', 'failed'].includes(n.state));
      const cases = view.nodes.map(n => `<testcase name="${xml(n.nodeId)}" classname="EvoFence.session">${
        n.state === 'failed' ? '<failure message="branch failed"/>' : n.state === 'succeeded' ? '' :
          `<skipped message="${xml(n.state === null ? 'unreported' : n.state)}"/>`}</testcase>`);
      return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="EvoFence session" tests="${view.nodes.length}" failures="${failures.length}" skipped="${skipped.length}">\n${cases.join('\n')}\n<system-out>${xml(json)}</system-out>\n</testsuite>\n`;
    }
  }
}
