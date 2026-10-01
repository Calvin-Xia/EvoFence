/**
 * Total budget: one pool shared by parent, children, planner, workers, reviewer, learning and
 * evaluator requests. A reservation is not a per-agent allowance — it is a claim against the same
 * `settled + outstanding` sum, so a child can never fork a fresh budget (`CONTRACTS.md` §5.3,
 * `METRICS.md` §7).
 *
 * Ordering is fixed: reserve before dispatch, settle from the receipt, and when usage is missing
 * keep the reservation (`missingUsagePolicy: retain-reservation`). Cancellation releases only the
 * part the host proved was unspent; an unconfirmed cancellation keeps the whole reservation and
 * stays `unknown`. Every micro-USD figure is an integer and the per-request worst case rounds
 * *up*, so no epsilon can under-reserve (human review R4).
 *
 * These are pure transitions over an immutable ledger; persistence and the CAS transaction belong
 * to the EventStore (`l2_state_store`), not here.
 */
import { fail } from '../../protocol/index.js';
import type { ErrorEnvelope } from '../../protocol/index.js';
import type { PolicyResult, RequestRole } from './types.js';
import type { BudgetPolicy } from './wire.js';

/** Integer micro-USD per USD. */
export const MICRO_USD_PER_USD = 1_000_000;

/**
 * `METRICS.md` §7.1: `60,000 × p_unc + 4,096 × p_out = 9,546.88 µUSD`, rounded up to 9,547.
 * This is the frozen probe price, not a computed approximation of it.
 */
export const RESERVE_PER_REQUEST_MICROS = 9547;

/** Injected frozen price snapshot, in micro-USD per million tokens. */
export interface PriceTable {
  readonly inputMicrosPerMillionTokens: number;
  readonly outputMicrosPerMillionTokens: number;
}

/** Worst-case request cost, rounded up to whole micro-USD (never truncated). */
export function worstCaseRequestMicros(maxInputTokens: number, maxOutputTokens: number, price: PriceTable): number {
  const numerator =
    maxInputTokens * price.inputMicrosPerMillionTokens + maxOutputTokens * price.outputMicrosPerMillionTokens;
  return Math.ceil(numerator / MICRO_USD_PER_USD);
}

/** One evaluation tier's frozen envelope (`METRICS.md` §7.2). */
export interface EvaluationEnvelope {
  readonly tier: 'S1' | 'S2' | 'S3';
  readonly requestCap: number;
  readonly usdCap: number;
  readonly wallMs: number;
  readonly maxConcurrentRequests: number;
}

/** The freeze: `usdCap` is *exactly* `requestCap × 9547`, per field (R4). */
export const EVALUATION_ENVELOPES: readonly EvaluationEnvelope[] = [
  { tier: 'S1', requestCap: 20, usdCap: 190940, wallMs: 20 * 60_000, maxConcurrentRequests: 20 },
  { tier: 'S2', requestCap: 40, usdCap: 381880, wallMs: 45 * 60_000, maxConcurrentRequests: 40 },
  { tier: 'S3', requestCap: 80, usdCap: 763760, wallMs: 120 * 60_000, maxConcurrentRequests: 80 },
];

/** `null` when the envelope is self-consistent; the old approximate values fail here. */
export function checkEnvelope(envelope: { readonly requestCap: number; readonly usdCap: number }): ErrorEnvelope | null {
  if (envelope.requestCap * RESERVE_PER_REQUEST_MICROS !== envelope.usdCap) {
    return fail(
      'EFK_BUDGET_ENVELOPE_INCONSISTENT',
      `usdCap ${envelope.usdCap} is not exactly requestCap ${envelope.requestCap} x ${RESERVE_PER_REQUEST_MICROS} micro-USD`,
      [],
    );
  }
  return null;
}

export interface Reservation {
  readonly requestId: string;
  readonly role: RequestRole;
  /** Provenance only: parent and child share this one ledger, keyed by requestId. */
  readonly parentRequestId: string | null;
  readonly reservedMicros: number;
}

export interface Settlement {
  readonly requestId: string;
  readonly micros: number;
  readonly complete: boolean;
  readonly digest: string;
}

export interface BudgetLedger {
  readonly poolId: string;
  readonly category: BudgetPolicy['category'];
  readonly capMicros: number | null;
  readonly reservePerRequest: number;
  readonly maxRequests: number;
  readonly maxConcurrentRequests: number;
  readonly reservations: readonly Reservation[];
  readonly settlements: readonly Settlement[];
  readonly requestCount: number;
}

export interface BudgetTransition {
  readonly ledger: BudgetLedger;
  readonly error: ErrorEnvelope | null;
}

export interface BudgetSnapshot {
  readonly capMicros: number | null;
  readonly settledMicros: number;
  readonly outstandingMicros: number;
  readonly remainingMicros: number | null;
  readonly requestCount: number;
  readonly outstandingCount: number;
  /** True when no further reservation of the per-request worst case can be admitted. */
  readonly exhausted: boolean;
}

export function budgetSnapshot(ledger: BudgetLedger): BudgetSnapshot {
  const settledMicros = ledger.settlements.reduce((total, settlement) => total + settlement.micros, 0);
  const outstandingMicros = ledger.reservations.reduce((total, reservation) => total + reservation.reservedMicros, 0);
  const remainingMicros = ledger.capMicros === null ? null : ledger.capMicros - settledMicros - outstandingMicros;
  return {
    capMicros: ledger.capMicros,
    settledMicros,
    outstandingMicros,
    remainingMicros,
    requestCount: ledger.requestCount,
    outstandingCount: ledger.reservations.length,
    exhausted:
      (remainingMicros !== null && remainingMicros <= 0) ||
      ledger.requestCount >= ledger.maxRequests ||
      ledger.reservations.length >= ledger.maxConcurrentRequests,
  };
}

/**
 * Open the one pool for a `BudgetPolicy`. Refuses a budget that cannot be dispatched within its
 * own envelope (`budget.changed` would have to be an explicit act, not an implicit widening).
 */
export function openBudgetLedger(policy: BudgetPolicy, reservePerRequest: number): PolicyResult<BudgetLedger> {
  if (policy.category === 'controlled-experiment' && policy.authorizationRef === null) {
    return { ok: false, error: fail('EFK_BUDGET_NOT_AUTHORIZED', 'controlled-experiment budget requires a real authorizationRef', [policy.poolId]) };
  }
  if (policy.maxUsdMicros === null && policy.category !== 'development') {
    return { ok: false, error: fail('EFK_BUDGET_NOT_AUTHORIZED', `category ${policy.category} must declare a finite maxUsdMicros`, [policy.poolId]) };
  }
  if (policy.maxUsdMicros !== null && policy.priceRef === null) {
    return { ok: false, error: fail('EFK_BUDGET_NOT_AUTHORIZED', 'a finite USD cap requires a frozen priceRef', [policy.poolId]) };
  }
  if (policy.maxUsdMicros !== null && policy.maxRequests * reservePerRequest > policy.maxUsdMicros) {
    return {
      ok: false,
      error: fail(
        'EFK_BUDGET_ENVELOPE_INCONSISTENT',
        `maxRequests ${policy.maxRequests} x ${reservePerRequest} exceeds maxUsdMicros ${policy.maxUsdMicros}`,
        [policy.poolId],
      ),
    };
  }
  return {
    ok: true,
    value: {
      poolId: policy.poolId,
      category: policy.category,
      capMicros: policy.maxUsdMicros,
      reservePerRequest,
      maxRequests: policy.maxRequests,
      maxConcurrentRequests: policy.maxConcurrentRequests,
      reservations: [],
      settlements: [],
      requestCount: 0,
    },
  };
}

export interface ReservationRequest {
  readonly requestId: string;
  readonly role: RequestRole;
  readonly parentRequestId?: string | null;
}

/** Reserve the worst-case cost. The same `requestId` is a no-op, so a re-delivery cannot double-charge. */
export function reserve(ledger: BudgetLedger, request: ReservationRequest): BudgetTransition {
  if (ledger.settlements.some((settlement) => settlement.requestId === request.requestId)) return { ledger, error: null };
  if (ledger.reservations.some((reservation) => reservation.requestId === request.requestId)) return { ledger, error: null };

  const snapshot = budgetSnapshot(ledger);
  if (snapshot.requestCount + 1 > ledger.maxRequests) {
    return { ledger, error: fail('EFK_BUDGET_EXHAUSTED', `request cap ${ledger.maxRequests} reached`, [request.requestId]) };
  }
  if (snapshot.outstandingCount + 1 > ledger.maxConcurrentRequests) {
    return { ledger, error: fail('EFK_BUDGET_EXHAUSTED', `concurrency cap ${ledger.maxConcurrentRequests} reached`, [request.requestId]) };
  }
  if (ledger.capMicros !== null && snapshot.settledMicros + snapshot.outstandingMicros + ledger.reservePerRequest > ledger.capMicros) {
    return { ledger, error: fail('EFK_BUDGET_EXHAUSTED', `reservation would exceed cap ${ledger.capMicros}`, [request.requestId]) };
  }
  return {
    ledger: {
      ...ledger,
      reservations: [
        ...ledger.reservations,
        {
          requestId: request.requestId,
          role: request.role,
          parentRequestId: request.parentRequestId ?? null,
          reservedMicros: ledger.reservePerRequest,
        },
      ],
      requestCount: ledger.requestCount + 1,
    },
    error: null,
  };
}

export interface SettlementInput {
  readonly requestId: string;
  /** Normalized estimated micro-USD, or `null` when unknown. */
  readonly micros: number | null;
  readonly complete: boolean;
  /** Stable content identity of the usage, for same-request reconciliation. */
  readonly digest: string;
}

/**
 * Settle a reservation from its receipt. Incomplete or unknown usage retains the reservation and
 * returns `EFK_USAGE_INCOMPLETE`; the same requestId with different usage returns
 * `EFK_USAGE_CONFLICT`. Actual spend above the reservation is recorded, not hidden, and reported as
 * an exhausted cap.
 */
export function settle(ledger: BudgetLedger, input: SettlementInput): BudgetTransition {
  const existing = ledger.settlements.find((settlement) => settlement.requestId === input.requestId);
  if (existing !== undefined) {
    if (existing.digest === input.digest) return { ledger, error: null };
    return { ledger, error: fail('EFK_USAGE_CONFLICT', `request ${input.requestId} was already settled with different usage`, [input.requestId]) };
  }
  if (!ledger.reservations.some((reservation) => reservation.requestId === input.requestId)) {
    return {
      ledger,
      error: fail('EFK_INVARIANT_VIOLATION', `request ${input.requestId} was never reserved; every request is charged to the pool before dispatch`, [input.requestId]),
    };
  }
  if (!input.complete || input.micros === null) {
    return { ledger, error: fail('EFK_USAGE_INCOMPLETE', `usage for ${input.requestId} is incomplete; reservation retained`, [input.requestId]) };
  }
  const next: BudgetLedger = {
    ...ledger,
    reservations: ledger.reservations.filter((reservation) => reservation.requestId !== input.requestId),
    settlements: [...ledger.settlements, { requestId: input.requestId, micros: input.micros, complete: true, digest: input.digest }],
  };
  const snapshot = budgetSnapshot(next);
  if (snapshot.capMicros !== null && snapshot.settledMicros + snapshot.outstandingMicros > snapshot.capMicros) {
    return {
      ledger: next,
      error: fail(
        'EFK_BUDGET_EXHAUSTED',
        `settled ${snapshot.settledMicros} + outstanding ${snapshot.outstandingMicros} exceeds cap ${snapshot.capMicros}`,
        [input.requestId],
      ),
    };
  }
  return { ledger: next, error: null };
}

export interface ReleaseInput {
  readonly requestId: string;
  /** Micro-USD the host proved was unspent; `null` means the cancellation is unconfirmed. */
  readonly confirmedUnspentMicros: number | null;
}

function releaseDigest(input: ReleaseInput): string {
  return `release:${input.requestId}:${input.confirmedUnspentMicros}`;
}

/**
 * Cancellation: release only the proven-unspent part and settle the remainder as spent. A `null`
 * confirmation keeps the whole reservation and returns `EFK_CANCEL_UNCONFIRMED` — cancel is not a
 * way to make spend disappear.
 */
export function releaseUnspent(ledger: BudgetLedger, input: ReleaseInput): BudgetTransition {
  const digest = releaseDigest(input);
  const existing = ledger.settlements.find((settlement) => settlement.requestId === input.requestId);
  if (existing !== undefined) {
    if (existing.digest === digest) return { ledger, error: null };
    return { ledger, error: fail('EFK_USAGE_CONFLICT', `request ${input.requestId} was already settled with different usage`, [input.requestId]) };
  }
  const reservation = ledger.reservations.find((entry) => entry.requestId === input.requestId);
  if (reservation === undefined) {
    return { ledger, error: fail('EFK_INVARIANT_VIOLATION', `request ${input.requestId} was never reserved`, [input.requestId]) };
  }
  if (input.confirmedUnspentMicros === null) {
    return { ledger, error: fail('EFK_CANCEL_UNCONFIRMED', `cancellation of ${input.requestId} is unconfirmed; reservation retained`, [input.requestId]) };
  }
  const released = Math.min(reservation.reservedMicros, input.confirmedUnspentMicros);
  const spent = reservation.reservedMicros - released;
  return {
    ledger: {
      ...ledger,
      reservations: ledger.reservations.filter((entry) => entry.requestId !== input.requestId),
      settlements: [...ledger.settlements, { requestId: input.requestId, micros: spent, complete: true, digest }],
    },
    error: null,
  };
}
