import { fail } from '../../protocol/index.js';
import { normalizeUsage, reserve, settle, usageIdentity } from '../../kernel/policy/index.js';
import { err, ok, stableStringify } from '../../runtime/host-port/index.js';
import type { PiRequestState, PiSharedRequests } from './delegation-types.js';

/** A transport adapter over the parent's existing pool, including ordinary parent calls. */
export function bindPiSharedRequests(read: () => PiRequestState, write: (state: PiRequestState) => void): PiSharedRequests {
  const poolId = read().ledger.poolId;
  return {
    poolId,
    beforeRequest(requestId, invocationId, policy, bounds) {
      const state = read();
      // Actual request bounds are supplied by the bounded host transport, before HTTP dispatch.
      if (![bounds.inputTokens, bounds.outputTokens, bounds.usdMicros].every(n => Number.isSafeInteger(n) && n >= 0)) {
        return err(fail('EFK_SCHEMA_INVALID', 'transport request bounds must be non-negative integers', [requestId]));
      }
      if (policy.poolId !== poolId || state.ledger.poolId !== poolId || policy.category !== state.ledger.category
        || bounds.inputTokens > policy.maxInputTokens || bounds.outputTokens > policy.maxOutputTokens
        || bounds.usdMicros > state.ledger.reservePerRequest) {
        return err(fail('EFK_BUDGET_NOT_AUTHORIZED', 'request is outside the inherited pool/transport bounds', [requestId]));
      }
      const owned = state.owners.filter(o => o.invocationId === invocationId);
      if (state.owners.some(o => o.requestId === requestId)) {
        return err(fail('EFK_IDEMPOTENCY_COLLISION', 'request was already dispatched; reconciliation cannot replay HTTP', [requestId]));
      }
      if (owned.length >= policy.maxRequests || (policy.maxUsdMicros !== null
        && (owned.length + 1) * state.ledger.reservePerRequest > policy.maxUsdMicros)) {
        return err(fail('EFK_BUDGET_EXHAUSTED', 'child request ceiling reached in the parent pool', [invocationId]));
      }
      if (owned.filter(o => state.ledger.reservations.some(r => r.requestId === o.requestId)).length >= policy.maxConcurrentRequests) {
        return err(fail('EFK_BUDGET_EXHAUSTED', 'child concurrent requests exceed its narrowed ceiling', [invocationId]));
      }
      const next = reserve(state.ledger, { requestId, role: 'worker', parentRequestId: invocationId });
      if (next.error !== null) return err(next.error);
      write({ ...state, ledger: next.ledger, owners: [...state.owners, { requestId, invocationId }] });
      return ok(undefined);
    },
    record(usage) {
      const state = read();
      if (!state.owners.some(o => o.requestId === usage.requestId)) {
        return err(fail('EFK_BUDGET_NOT_AUTHORIZED', 'usage has no parent-pool reservation', [usage.requestId]));
      }
      const prior = state.usage.find(u => u.requestId === usage.requestId);
      if (prior?.complete && stableStringify(prior) !== stableStringify(usage)) {
        return err(fail('EFK_USAGE_CONFLICT', 'completed request usage changed', [usage.requestId]));
      }
      const rows = [...state.usage.filter(u => u.requestId !== usage.requestId), usage];
      const normalized = normalizeUsage(usage);
      if (!normalized.ok) { write({ ...state, usage: rows }); return normalized; }
      const next = settle(state.ledger, { ...normalized.value, digest: usageIdentity(usage) });
      write({ ...state, ledger: next.ledger, usage: rows });
      return next.error === null ? ok(undefined) : err(next.error);
    },
    report(invocationId) {
      const state = read();
      const requestIds = state.owners.filter(o => o.invocationId === invocationId).map(o => o.requestId);
      return { requestIds, usage: state.usage.filter(u => requestIds.includes(u.requestId)) };
    },
  };
}
