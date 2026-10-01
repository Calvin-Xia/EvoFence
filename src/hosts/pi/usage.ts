import { fail } from '../../protocol/index.js';
import { dedupeUsage, err, ok, type HostResult, type Usage } from '../../runtime/host-port/index.js';
import type { PiMessage, PiUsageEvidence } from './types.js';

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' ? v as Record<string, unknown> : {};
const count = (v: unknown): number | null => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : null;
/** Validate external meters once. Zero-filled SDK aborted/error receipts are not complete usage. */
export function mapPiUsage(requestId: string, message: PiMessage, evidence?: PiUsageEvidence): HostResult<Usage> {
  const sdk = object(message.usage);
  const zeroFailure = evidence === undefined && (message.stopReason === 'aborted' || message.stopReason === 'error') && sdk.totalTokens === 0;
  const u = zeroFailure ? {} : object(evidence === undefined ? message.usage : evidence.raw);
  const provider = evidence?.source === 'provider' || evidence?.source === 'synthetic';
  const prompt = count(u.prompt_tokens);
  const cached = count(object(u.prompt_tokens_details).cached_tokens);
  const input = provider ? (prompt !== null && cached !== null ? prompt - cached : null) : count(u.input);
  const cacheRead = provider ? cached : count(u.cacheRead);
  const cacheWrite = provider ? null : count(u.cacheWrite);
  const output = count(provider ? u.completion_tokens : u.output);
  const reasoning = count(provider ? object(u.completion_tokens_details).reasoning_tokens : u.reasoning);
  const total = count(provider ? u.total_tokens : u.totalTokens);
  const expected = input !== null && cacheRead !== null && output !== null
    ? provider ? input + cacheRead + output : cacheWrite !== null ? input + cacheRead + cacheWrite + output : null : null;
  const cost = object(object(message.usage).cost).total;
  const estimated = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? Math.ceil(cost * 1e6) : null;
  if ((input !== null && input < 0) || (reasoning !== null && output !== null && reasoning > output)
    || (expected !== null && total !== null && total !== expected)) {
    return err(fail('EFK_USAGE_INCOMPLETE', 'Pi usage components disagree; do not settle', [requestId]));
  }
  const complete = input !== null && cacheRead !== null && output !== null && total !== null && total > 0
    && (provider || (message.stopReason !== 'error' && message.stopReason !== 'aborted'));
  return ok({ requestId, source: evidence?.source ?? (message.usage === undefined || zeroFailure ? 'unknown' : 'host-normalized'),
    inputUncached: input, cacheRead, cacheWrite, output, reasoning, total,
    estimatedUsdMicros: complete ? estimated : null, invoiceUsdMicros: null, complete,
    evidenceRefs: evidence?.evidenceRefs ?? [] });
}
export function addPiUsage(rows: readonly Usage[], next: Usage): HostResult<readonly Usage[]> {
  return dedupeUsage([...rows, next]);
}
/** Frozen SessionPorts settles one reservation per invocation. Keep transport rows separately. */
export function invocationUsage(requestId: string, rows: readonly Usage[], expected: readonly string[]): Usage {
  const complete = expected.length > 0 && expected.length === rows.length
    && expected.every(id => rows.some(r => r.requestId === id && r.complete));
  const sum = (key: 'inputUncached' | 'cacheRead' | 'cacheWrite' | 'output' | 'reasoning' | 'total' | 'estimatedUsdMicros') =>
    rows.length > 0 && rows.every(r => r[key] !== null) ? rows.reduce((n, r) => n + r[key]!, 0) : null;
  return { requestId, source: rows.length === 0 ? 'unknown' : rows.every(r => r.source === 'synthetic') ? 'synthetic' : 'host-normalized',
    inputUncached: sum('inputUncached'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'),
    output: sum('output'), reasoning: sum('reasoning'), total: sum('total'),
    estimatedUsdMicros: complete ? sum('estimatedUsdMicros') : null, invoiceUsdMicros: null, complete,
    evidenceRefs: [...new Set(rows.flatMap(r => r.evidenceRefs))] };
}
