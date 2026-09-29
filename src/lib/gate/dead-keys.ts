/**
 * Gate domain · contract keys that are NOT wired to any judgement.
 *
 * `docs/refactor-inventory.md` §5.2 (revised by `docs/refactor-inventory-review.md` F4) lists the
 * contract keys whose runtime judgements do not consume them. This node's DoD requires an explicit
 * disposition for the two compatibility-only ones, so the disposition is a machine-readable registry rather
 * than a comment nobody greps.
 *
 * DISPOSITION — compatibility-only:
 *   `acceptance.require_proposal` and `acceptance.require_claims` are no longer emitted by the
 *   template, but remain declared and type-checked so contracts initialized by 0.4.x still load.
 *   They are not switches: proposal and claims validation remain unconditional.
 *
 *   "No judgement consumes them" below distinguishes the compatibility reads in the config
 *   validator from runtime gate reads. The evidence strings name those hits explicitly instead of
 *   claiming `grep` finds nothing (review F10: the old strings were falsifiable by grep).
 *
 * Contrast (must NOT be confused with the two above):
 *   - `capabilities.external_api` is LIVE despite zero literal occurrences in `src/`: it is read
 *     through the dynamic table in `capability.ts` (`contract.capabilities[capability]`), which
 *     the template sets to `deny`. See `capabilitySetting` / `assessCapabilities`.
 *   - `capabilities.authority_ceiling` is validated (`A0`-`A3`) but never consulted by a decision.
 *   - `capabilities.network` / `dependency_install` / `credentials` are live dynamic capability
 *     gates in the request path; their values are also echoed into the task file.
 *
 * Imports: nothing.
 */

/** How a legacy contract key behaves at runtime. */
export type DeadKeyStatus = 'compatibility_only' | 'validated_only';

export interface ContractKeyDisposition {
  /** Dotted key path as documented in the current or legacy contract surface. */
  path: string;
  status: DeadKeyStatus;
  /** Why it is not an effective gate (grep-verifiable claim). */
  evidence: string;
}

/**
 * The two legacy keys the DoD singles out: accepted for compatibility, but no judgement reads them.
 *
 * Every `evidence` string below is a grep-verifiable claim over `src/`, so it can be re-checked
 * mechanically (review F10): the only hits outside this registry are the config-validation and
 * type layers for the two `acceptance` keys.
 */
export const DEAD_CONTRACT_KEYS: readonly ContractKeyDisposition[] = [
  {
    path: 'acceptance.require_proposal',
    status: 'compatibility_only',
    evidence: 'grep src/ hits config/schema.ts, config/validate.ts, types/config.ts and this registry; no judgement consumes it — proposal validation is unconditional in checkProposal (gate/proposal.ts)',
  },
  {
    path: 'acceptance.require_claims',
    status: 'compatibility_only',
    evidence: 'grep src/ hits config/schema.ts, config/validate.ts, types/config.ts and this registry; no judgement consumes it — claims validation is unconditional in checkClaims (gate/proposal.ts)',
  },
] as const;

/** Adjacent keys that are read, but not as gates — recorded so the three above stay unambiguous. */
export const NON_DECISION_CONTRACT_KEYS: readonly ContractKeyDisposition[] = [
  {
    path: 'capabilities.authority_ceiling',
    status: 'validated_only',
    evidence: 'contract validation accepts A0-A3 / rejects A4, but no decision consults it',
  },
] as const;

/** `true` when the dotted key is one of the documented dead keys. */
export function isDeadContractKey(path: string): boolean {
  return DEAD_CONTRACT_KEYS.some((entry) => entry.path === path);
}
