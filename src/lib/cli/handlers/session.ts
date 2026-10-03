/** File boundary for an explicit exported session; no discovery, dispatch or provider access. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { decode, type DefName } from '../../../protocol/index.js';
import { compileGraph } from '../../../kernel/graph/index.js';
import { createSessionService, type SessionSeed } from '../../../runtime/session/index.js';
import { createMemoryEventStore, createMemoryArtifactStore } from '../../../storage/index.js';
import { canonical, type ArtifactRef, type ExportedSession, type StoreResult } from '../../../kernel/store/index.js';
import { validateCompatibility, validateContext } from '../../../learning/assets/compatibility.js';
import type { RegistrySnapshot, QualificationContext } from '../../../learning/assets/types.js';
import { readKernelView, formatKernelView, type ReviewDecisionLink } from '../../report/kernel-view.js';
import type { ReportFormat } from '../../report/formats.js';
import { EvoFenceError } from '../../errors.js';
import { positional, type CommandContext } from './context.js';

const digest = { digest: (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
function invalid(): never { throw new EvoFenceError('EFK_SCHEMA_INVALID', 'Invalid session review export.'); }
function checked<T>(result: StoreResult<T>): T {
  if (!result.ok) throw new EvoFenceError(result.error.code, 'Session review could not read the supplied evidence.');
  return result.value;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value, k))) invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function wire(name: DefName, value: unknown): void { checked(decode(name, value)); }

/** All supplied metadata is validated at this external JSON boundary, then replay owns state. */
export function openReviewExport(input: unknown) {
  const bundle = object(input, ['version', 'seed', 'session', 'artifacts', 'registry', 'assetContext', 'decisionLinks', 'at']);
  if (bundle.version !== 'evofence.review-export/1') invalid();
  wire('Instant', bundle.at);
  const rawSeed = object(bundle.seed, ['sessionId', 'graph', 'graphRef', 'policy', 'reservePerRequest', 'grants', 'operations']);
  wire('Id', rawSeed.sessionId); wire('GraphRef', rawSeed.graphRef); wire('BudgetPolicy', rawSeed.policy);
  array(rawSeed.grants);
  if (rawSeed.operations === null || typeof rawSeed.operations !== 'object' || Array.isArray(rawSeed.operations)) invalid();
  const compiled = compileGraph(rawSeed.graph);
  if (!compiled.ok) throw new EvoFenceError(compiled.error.code, 'Session review graph could not be compiled.');
  if (!Number.isSafeInteger(rawSeed.reservePerRequest) || (rawSeed.reservePerRequest as number) < 1) invalid();
  const seed = { ...rawSeed, graph: compiled.graph } as unknown as SessionSeed;
  if (seed.graphRef.graphId !== seed.graph.graphId || seed.graphRef.revision !== seed.graph.revision
    || seed.graphRef.digest !== digest.digest(canonical(seed.graph.spec))) {
    throw new EvoFenceError('EFK_SOURCE_PIN_DRIFT', 'Session review graph differs from its source pin.');
  }
  const session = object(bundle.session, ['sessionId', 'epoch', 'protocol', 'revision', 'events', 'effects', 'receipts']);
  wire('Id', session.sessionId); wire('ProtocolVersion', session.protocol);
  if (session.sessionId !== seed.sessionId || !Number.isSafeInteger(session.epoch) || (session.epoch as number) < 1
    || !Number.isSafeInteger(session.revision) || (session.revision as number) < 0) invalid();
  for (const row of array(session.events)) wire('Event', row);
  for (const row of array(session.effects)) wire('Effect', row);
  for (const row of array(session.receipts)) wire('Receipt', row);
  const store = createMemoryEventStore({ digest });
  checked(store.restoreSession(session as unknown as ExportedSession));
  const artifacts = createMemoryArtifactStore({ digest });
  for (const item of array(bundle.artifacts)) {
    const entry = object(item, ['ref', 'bytes']);
    if (typeof entry.bytes !== 'string') invalid();
    checked(artifacts.put(entry.ref as ArtifactRef, entry.bytes));
  }
  const rawRegistry = object(bundle.registry, ['revisions', 'history']);
  const revisions = array(rawRegistry.revisions);
  for (const item of revisions) {
    const r = object(item, ['candidate', 'category', 'compatibility', 'createdAt']);
    wire('CapabilityAsset', r.candidate); wire('Instant', r.createdAt);
    if (!['graph-template', 'strategy', 'experience', 'skill', 'tool', 'code-patch'].includes(r.category as string)) invalid();
    checked(validateCompatibility(r.compatibility as Parameters<typeof validateCompatibility>[0]));
  }
  const registry = rawRegistry as unknown as RegistrySnapshot;
  for (const [index, item] of array(rawRegistry.history).entries()) {
    const e = object(item, ['sequence', 'asset', 'at', 'state', 'evidenceRef', 'context', 'expiresAt']);
    wire('AssetRef', e.asset); wire('Instant', e.at);
    if (e.sequence !== index || !['staged', 'validated', 'promoted', 'active', 'revoked'].includes(e.state as string)) invalid();
    if (e.evidenceRef !== null) wire('ArtifactRef', e.evidenceRef);
    if (e.context !== null) checked(validateContext(e.context as QualificationContext));
    if (e.expiresAt !== null) wire('Instant', e.expiresAt);
    if (!registry.revisions.some(r => canonical(r.candidate.asset) === canonical(e.asset))) invalid();
  }
  // qualification() assumes registered, earlier dependencies and an initial staged history row.
  for (const [index, revision] of registry.revisions.entries()) {
    if (!registry.history.some(e => e.state === 'staged' && canonical(e.asset) === canonical(revision.candidate.asset))) invalid();
    if (!revision.candidate.dependencies.every(dep => registry.revisions.slice(0, index)
      .some(r => canonical(r.candidate.asset) === canonical(dep)))) invalid();
  }
  if (bundle.assetContext !== null) {
    checked(validateContext(bundle.assetContext as QualificationContext));
    if ((bundle.assetContext as QualificationContext).at !== bundle.at) invalid();
  }
  for (const item of array(bundle.decisionLinks)) {
    const link = object(item, ['purpose', 'ref']);
    if (!['stop', 'promotion', 'revocation', 'evaluation'].includes(link.purpose as string)) invalid();
    if (link.ref !== null) wire('ArtifactRef', link.ref);
  }
  // These injected ports deliberately provide no execution capability. read/open call none of them.
  const forbidden = (): never => { throw new EvoFenceError('EFK_AUTHORITY_DENIED', 'Session review is read-only.'); };
  const service = createSessionService({ store, artifacts, digest,
    clock: { now: forbidden }, host: { execute: forbidden, observe: forbidden, reconcile: forbidden,
      cancel: forbidden, context: forbidden, usage: forbidden },
    policy: { inspect: forbidden, resume: forbidden },
    evaluator: { issuer: { actorId: 'review', kind: 'evaluator', identityRef: null }, evaluateTask: forbidden },
    leaseTtlMs: 1, effectTtlMs: 1, maxConcurrentAgents: 1, depth: 0, maxDepth: 1 });
  checked(service.open(seed));
  return { service, seed, artifacts, registry, assetContext: bundle.assetContext as QualificationContext | null,
    decisionLinks: bundle.decisionLinks as ReviewDecisionLink[], at: bundle.at as number };
}

export async function commandSessionView(context: CommandContext): Promise<number> {
  const requested = context.options.format;
  const format = requested === undefined ? context.json ? 'json' : 'text' : requested;
  if (!['text', 'json', 'sarif', 'junit'].includes(format as string)
    || (context.json && format !== 'json')) throw new EvoFenceError('USAGE', 'Invalid or conflicting review output format.');
  let input: unknown;
  try { input = JSON.parse(await readFile(path.resolve(context.cwd, positional(context, 0)!), 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) invalid();
    throw new EvoFenceError('EFK_ARTIFACT_UNAVAILABLE', 'Session review export could not be read.');
  }
  const view = checked(readKernelView(openReviewExport(input), { includePrivate: context.options.include_private === true }));
  context.stdout(formatKernelView(view, format as ReportFormat));
  return 0;
}
