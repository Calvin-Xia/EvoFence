/**
 * Gate domain · capability approval gate.
 *
 * `assessCapabilities` is ported verbatim from `src/lib/policy.js:141-151` (0.3.0). Its one
 * structural property is that the contract's capability map is indexed **dynamically** by
 * whatever a proposal requests — there is no closed allow-list, so any key a contract declares
 * (for example `external_api`, which the template sets to `deny`) is a live gate the moment a
 * proposal asks for it. `capabilitySetting` names that lookup so it can be tested directly.
 *
 * Allow forms are exactly three: `true`, `'allow'`, `{ mode: 'allow' }`. Everything else —
 * including an absent key — denies.
 *
 * Imports: `src/types/**` + sibling gate modules.
 */

import type { CapabilitiesConfig, EvoFenceContract } from '../../types/config.js';
import type { CapabilityRequest } from '../../types/proposal.js';
import type { CapabilityReview, CapabilityReviewEntry } from '../../types/gate.js';
import type { GateJudgementBase } from './fail-closed.js';
import { failingJudgement, isRecord, passingJudgement, refusedJudgement } from './fail-closed.js';

/** The contract slice this module reads. */
export type CapabilityContract = Pick<EvoFenceContract, 'capabilities'>;

/** The proposal slice this module reads. */
export interface CapabilityRequestSource {
  requested_capabilities?: (string | CapabilityRequest)[] | null;
}

/** The three allow forms, as a pure predicate over one `capabilities.<name>` entry. */
export function isCapabilityAllowed(setting: CapabilitiesConfig[string]): boolean {
  if (setting === true || setting === 'allow') return true;
  return isRecord(setting) && setting.mode === 'allow';
}

/**
 * The dynamic lookup: `contract.capabilities[capability]`.
 *
 * The numeric/`undefined` coercion is intentional and matches 0.3.0's JS property access
 * (a request without a `capability` field indexes the literal `"undefined"` key).
 */
export function capabilitySetting(capability: string, contract: CapabilityContract): CapabilitiesConfig[string] {
  return contract.capabilities[String(capability)];
}

/** Review every capability a proposal requests; `allowed` is the AND of all of them. */
export function assessCapabilities(
  proposal: CapabilityRequestSource | null | undefined,
  contract: CapabilityContract,
): CapabilityReview {
  const requests = proposal?.requested_capabilities ?? [];
  if (!requests.length) return { allowed: true, requests: [] };
  const results: CapabilityReviewEntry[] = requests.map((request) => {
    const capability = typeof request === 'string' ? request : request?.capability;
    const allowed = isCapabilityAllowed(capabilitySetting(String(capability), contract));
    return {
      capability: capability ?? 'unknown',
      allowed,
      scope: typeof request === 'string' ? null : request?.scope ?? request?.exact_scope ?? null,
      reason: allowed ? 'policy_allow' : 'not_allowed_by_contract',
    };
  });
  return { allowed: results.every((item) => item.allowed), requests: results };
}

/** Input of the capability judgement entry point. */
export interface CapabilityGateInput {
  proposal: CapabilityRequestSource | null | undefined;
  contract: CapabilityContract | null | undefined;
}

/** Capability judgement: every requested capability is approved by the contract. */
export interface CapabilityGateJudgement extends GateJudgementBase, CapabilityReview {}

/**
 * Independent capability-gate entry point.
 *
 * Fail-closed: a missing contract denies every request (there is no allow-list to consult), and
 * a missing input object is reported as missing rather than as "nothing requested".
 */
export function evaluateCapabilityGate(input: CapabilityGateInput | null | undefined): CapabilityGateJudgement {
  if (!isRecord(input)) return failingJudgement(['input'], { allowed: false, requests: [] as CapabilityReviewEntry[] });
  const candidate = input as unknown as Record<string, unknown>;
  const requests = (candidate.proposal as CapabilityRequestSource | null | undefined)?.requested_capabilities ?? [];
  if (!isRecord(candidate.contract)) {
    const denied: CapabilityReviewEntry[] = requests.map((request) => ({
      capability: (typeof request === 'string' ? request : request?.capability) ?? 'unknown',
      allowed: false,
      scope: typeof request === 'string' ? null : request?.scope ?? request?.exact_scope ?? null,
      reason: 'not_allowed_by_contract',
    }));
    return failingJudgement(['contract'], { allowed: false, requests: denied });
  }
  const contract = candidate.contract as CapabilityContract;
  const review = assessCapabilities(candidate.proposal as CapabilityRequestSource | null | undefined, contract);
  if (!review.allowed) return refusedJudgement('CAPABILITY_DENIED', review);
  return passingJudgement(review);
}
