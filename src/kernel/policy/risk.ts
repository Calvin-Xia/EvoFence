/**
 * The single policy decision: allow, wait for authorization, deny, or degrade.
 *
 * Ordering matters and is fail-closed. Authority and protocol come first (no capability, usage or
 * budget answer can rescue an unauthorized run). A missing OS sandbox is never upgraded to
 * "probably fine": `same-user` is accepted only when the policy asks for `same-user`
 * (human review R7 — hooks and worktrees are not an OS sandbox). Only guarantees that are *needed
 * and not provided* cause a refusal, and a gap that only the evolution loop needs disables the
 * evolution loop rather than the task (`adr_0003`, `adr_0008`).
 *
 * Missing telemetry is never read as zero: an incomplete usage set denies when the policy requires
 * complete usage, while the budget ledger keeps the reservation.
 */
import { fail } from '../../protocol/index.js';
import type { ErrorEnvelope } from '../../protocol/index.js';
import type { EffectiveAuthority } from './authority.js';
import type { BudgetSnapshot } from './budget.js';
import type { UsageCompleteness } from './usage.js';
import type { PolicyResult, TrustDomain } from './types.js';
import type { GuaranteeGap, NegotiationResult } from './wire.js';

type Gap = GuaranteeGap;
type Confidence = 'verified' | 'partial' | 'unknown' | 'absent';

export interface RiskPolicy {
  readonly policyId: string;
  /** `hard` means the evolution loop itself needs the guarantee; `optional` lets a task continue without it. */
  readonly evolutionMode: 'hard' | 'optional';
  /** Capability keys only the evolution loop (learning / promotion) consumes. */
  readonly evolutionCapabilities: readonly string[];
  readonly requireTrustDomain: TrustDomain;
  /** Judging and learning must be fully metered; a `0` from an aborted SDK call is not free. */
  readonly requireCompleteUsage: boolean;
}

export interface PolicyDecision {
  readonly disposition: 'allow' | 'needs-authorization' | 'deny' | 'degrade';
  readonly evolution: 'enabled' | 'disabled';
  readonly confidence: Confidence;
  readonly reasons: readonly string[];
  readonly error: ErrorEnvelope | null;
  readonly gaps: readonly Gap[];
}

export interface RiskInput {
  readonly policy: RiskPolicy;
  readonly authority: PolicyResult<EffectiveAuthority>;
  readonly negotiation: PolicyResult<NegotiationResult>;
  readonly budget: { readonly snapshot: BudgetSnapshot; readonly error: ErrorEnvelope | null };
  readonly usage: UsageCompleteness;
}

/** Evidence confidence recorded for later judging; a gap is evidence of a weaker guarantee, not a break. */
function confidenceOf(gaps: readonly Gap[]): Confidence {
  if (gaps.length === 0) return 'verified';
  if (gaps.some((gap) => gap.reason === 'partial')) return 'partial';
  if (gaps.some((gap) => gap.reason === 'absent' || gap.reason === 'missing')) return 'absent';
  return 'unknown';
}

function decision(
  disposition: PolicyDecision['disposition'],
  evolution: PolicyDecision['evolution'],
  confidence: Confidence,
  reasons: readonly string[],
  error: ErrorEnvelope | null,
  gaps: readonly Gap[] = [],
): PolicyDecision {
  return { disposition, evolution, confidence, reasons, error, gaps };
}

export function decide(input: RiskInput): PolicyDecision {
  const { policy } = input;

  if (!input.authority.ok) return decision('deny', 'disabled', 'unknown', ['authority'], input.authority.error);
  if (!input.negotiation.ok) return decision('deny', 'disabled', 'unknown', ['protocol'], input.negotiation.error);

  const authority = input.authority.value;
  if (policy.requireTrustDomain === 'os-sandbox' && authority.trustDomain !== 'os-sandbox') {
    return decision(
      'deny',
      'disabled',
      'unknown',
      ['trust-domain'],
      fail('EFK_AUTHORITY_DENIED', 'policy requires an OS sandbox but the effective trust domain is same-user; hooks and worktrees are not an OS sandbox', authority.nodeIds),
    );
  }

  const negotiation = input.negotiation.value;
  const gaps = negotiation.gaps;
  const confidence = confidenceOf(gaps);

  if (negotiation.status === 'unsupported') {
    const evolutionOnly = gaps.length > 0 && gaps.every((gap) => policy.evolutionCapabilities.includes(gap.capability));
    if (evolutionOnly && policy.evolutionMode === 'optional') {
      return decision('degrade', 'disabled', confidence, ['evolution-guarantee-absent'], null, gaps);
    }
    return decision(
      'deny',
      'disabled',
      confidence,
      ['capability-unsupported'],
      fail('EFK_CAPABILITY_UNSUPPORTED', `required guarantees are not provided by this host: ${gaps.map((gap) => gap.capability).join(', ')}`, []),
      gaps,
    );
  }

  if (negotiation.status === 'needs-degradation') {
    return decision(
      'needs-authorization',
      'enabled',
      confidence,
      ['degradation-approval-required'],
      fail('EFK_DEGRADATION_APPROVAL_REQUIRED', 'a technically viable alternative exists but has no approval binding; it is not dispatchable', []),
      gaps,
    );
  }

  if (input.budget.error !== null) return decision('deny', 'enabled', confidence, ['budget'], input.budget.error, gaps);
  if (input.budget.snapshot.exhausted) {
    return decision('deny', 'enabled', confidence, ['budget-exhausted'], fail('EFK_BUDGET_EXHAUSTED', 'the shared budget pool has no room for another request', []), gaps);
  }

  if (policy.requireCompleteUsage && !input.usage.complete) {
    return decision(
      'deny',
      'enabled',
      confidence,
      ['usage-incomplete'],
      fail('EFK_USAGE_INCOMPLETE', 'required usage telemetry is missing or incomplete; the reservation is retained, not settled to zero', input.usage.missingRequestIds),
      gaps,
    );
  }

  return decision('allow', 'enabled', confidence, [], null, gaps);
}
