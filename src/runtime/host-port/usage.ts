/**
 * Usage is applied once.
 *
 * Invariant 5 of `CONTRACTS.md` §5 is a host-port obligation: "host请求与receipt可重复送达，
 * 业务归约/usage只应用一次". `SCHEMAS.md` S03 says the same thing for `Usage.requestId`: a
 * repeated identity with the same bytes is a duplicate, a repeated identity with different bytes
 * is a conflict, and both must be decided rather than averaged away.
 *
 * A missing meter is **not** a zero. `missingUsagePolicy: retain-reservation` and S14 forbid
 * writing `0` where the host recorded nothing, so `usageIsComplete` says `false` and the caller
 * keeps the reservation.
 */
import { fail } from '../../protocol/index.js';
import { err, ok, type HostResult, type Usage } from './types.js';

/**
 * Deterministic JSON for equality only — key order is sorted, so two objects that differ only in
 * insertion order compare equal. This is not the S22 wire-encoding recipe (that one lives in the
 * kernel); it exists so `dedupeUsage` has one comparison, not two.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/**
 * Reduce a re-delivered `Usage` list to the rows that may be settled.
 *
 * First occurrence wins; an identical repeat is dropped; a different payload under the same
 * `requestId` is `EFK_USAGE_CONFLICT` (never "last write wins", never an average).
 */
export function dedupeUsage(usages: readonly Usage[]): HostResult<readonly Usage[]> {
  const byRequest = new Map<string, string>();
  const settled: Usage[] = [];
  for (const usage of usages) {
    const encoded = stableStringify(usage);
    const prior = byRequest.get(usage.requestId);
    if (prior === undefined) {
      byRequest.set(usage.requestId, encoded);
      settled.push(usage);
      continue;
    }
    if (prior !== encoded) {
      return err(fail('EFK_USAGE_CONFLICT', `requestId ${usage.requestId} was settled with different usage`, [usage.requestId]));
    }
  }
  return ok(settled);
}

/**
 * `true` only when there is at least one row, every row is `complete`, and the reasoning subset
 * is not larger than the output it is part of (S15). Unknown values staying `null` is fine; an
 * empty list is not evidence of a free request.
 */
export function usageIsComplete(usages: readonly Usage[]): boolean {
  if (usages.length === 0) return false;
  return usages.every((usage) => {
    if (!usage.complete) return false;
    if (usage.reasoning !== null && usage.output !== null && usage.reasoning > usage.output) return false;
    return true;
  });
}
