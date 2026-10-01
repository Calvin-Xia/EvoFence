/**
 * Usage completeness (`SCHEMAS.md` S14/S15, `METRICS.md` §7): telemetry is evidence, not a default.
 *
 * The one rule this module exists to enforce is that a missing or incomplete measurement is
 * `unknown`, never `0`. A local abort that reports `estimatedUsdMicros: 0` with `complete: false`
 * does not prove the provider was free; the reservation is retained (`missingUsagePolicy:
 * retain-reservation`) and only a later complete usage settles it.
 *
 * Identity comparison is a stable, field-ordered serialization rather than a hash — the kernel
 * closure may not import a digest implementation (`OWNERSHIP.md` I01/I02); a caller that needs a
 * cryptographic digest gets it from an injected DigestPort.
 */
import { fail } from '../../protocol/index.js';
import type { PolicyResult } from './types.js';
import type { Usage } from './wire.js';

export interface NormalizedUsage {
  readonly requestId: string;
  readonly complete: boolean;
  readonly source: Usage['source'];
  /** Estimated micro-USD, or `null` when unknown. Never `0` for a missing measurement. */
  readonly micros: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

function sum(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const present = values.filter((value): value is number => value !== null);
  return present.reduce((total, value) => total + value, 0);
}

/**
 * Normalize one usage record. `complete: true` with a null required count is a contradiction, not
 * "zero" — the `Usage` contract says an unavailable value is explicit `null`.
 */
export function normalizeUsage(usage: Usage): PolicyResult<NormalizedUsage> {
  if (usage.reasoning !== null && usage.output !== null && usage.reasoning > usage.output) {
    return {
      ok: false,
      error: fail(
        'EFK_USAGE_CONFLICT',
        `reasoning (${usage.reasoning}) exceeds output (${usage.output}); reasoning is a subset of output`,
        [usage.requestId],
      ),
    };
  }
  if (usage.complete && usage.source === 'unknown') {
    return {
      ok: false,
      error: fail('EFK_USAGE_CONFLICT', `usage for ${usage.requestId} is marked complete but its source is unknown`, [usage.requestId]),
    };
  }
  if (usage.complete) {
    const missing = (['inputUncached', 'cacheRead', 'output', 'total'] as const).filter((field) => usage[field] === null);
    if (missing.length > 0) {
      return {
        ok: false,
        error: fail('EFK_USAGE_INCOMPLETE', `usage marked complete but ${missing.join(', ')} is null`, [usage.requestId]),
      };
    }
  }
  return {
    ok: true,
    value: {
      requestId: usage.requestId,
      complete: usage.complete,
      source: usage.source,
      micros: usage.complete ? usage.estimatedUsdMicros : null,
      inputTokens: usage.complete ? sum([usage.inputUncached, usage.cacheRead]) : null,
      outputTokens: usage.complete ? usage.output : null,
    },
  };
}

/** Stable identity for duplicate-request reconciliation; key order is fixed, not insertion order. */
export function usageIdentity(usage: Usage): string {
  return JSON.stringify([
    usage.requestId,
    usage.source,
    usage.inputUncached,
    usage.cacheRead,
    usage.cacheWrite,
    usage.output,
    usage.reasoning,
    usage.total,
    usage.estimatedUsdMicros,
    usage.invoiceUsdMicros,
    usage.complete,
  ]);
}

export interface UsageCompleteness {
  readonly complete: boolean;
  /** Total estimated micro-USD, or `null` when anything is unknown. Never a partial-sum guess. */
  readonly knownMicros: number | null;
  readonly missingRequestIds: readonly string[];
  readonly incompleteRequestIds: readonly string[];
  readonly conflictingRequestIds: readonly string[];
}

/**
 * Completeness over the requests the run actually made. `expectedRequestIds` is the reservation
 * set: a request that was reserved but has no usage is *missing*, and missing is not zero.
 * A usage report for a request that was never reserved is itself a conflict (A07: every request is
 * charged to the same pool, and an unaccounted one breaks that).
 */
export function usageCompleteness(usages: readonly Usage[], expectedRequestIds: readonly string[]): UsageCompleteness {
  const identities = new Map<string, string>();
  const byRequest = new Map<string, Usage>();
  const conflicting = new Set<string>();

  for (const usage of usages) {
    const identity = usageIdentity(usage);
    const previous = identities.get(usage.requestId);
    if (previous !== undefined && previous !== identity) {
      conflicting.add(usage.requestId);
      continue;
    }
    identities.set(usage.requestId, identity);
    byRequest.set(usage.requestId, usage);
  }

  const expected = [...new Set(expectedRequestIds)].sort();
  const expectedSet = new Set(expected);
  const missingRequestIds = expected.filter((requestId) => !byRequest.has(requestId));
  const incompleteRequestIds = expected.filter((requestId) => {
    const usage = byRequest.get(requestId);
    return usage !== undefined && (!usage.complete || usage.estimatedUsdMicros === null || usage.source === 'unknown');
  });
  for (const requestId of byRequest.keys()) if (!expectedSet.has(requestId)) conflicting.add(requestId);
  const conflictingRequestIds = [...conflicting].sort();

  const complete = missingRequestIds.length === 0 && incompleteRequestIds.length === 0 && conflictingRequestIds.length === 0;
  // `complete` proves every expected request is present, complete, known-source and non-null.
  const knownMicros = complete
    ? expected.reduce((total, requestId) => total + byRequest.get(requestId)!.estimatedUsdMicros!, 0)
    : null;

  return { complete, knownMicros, missingRequestIds, incompleteRequestIds, conflictingRequestIds };
}
