/**
 * Gate domain · contract keys that are NOT wired to any judgement.
 *
 * `docs/refactor-inventory.md` §5.2 (revised by `docs/refactor-inventory-review.md` F4) lists the
 * contract-template keys that no code path reads. This node's DoD requires an explicit
 * disposition for the three dead ones, so the disposition is a machine-readable registry rather
 * than a comment nobody greps.
 *
 * DISPOSITION — kept, and marked non-effective here (no deletion):
 *   `acceptance.require_proposal`, `acceptance.require_claims` and `capabilities.shell.mode` are
 *   declared only in `templates/contract.yaml`. Deleting them would mean editing the template,
 *   which is outside this node's file boundary (L2 R5 forbids `templates/**`), and
 *   `validateContract` deliberately has no `additionalProperties: false`, so an unknown template
 *   key is inert rather than an error. They are therefore documented as unwired — NOT left
 *   looking like live gates — and a test pins that a contract setting them to a permissive value
 *   still changes no judgement (`docs/refactor-inventory.md` §5.2 "dead keys").
 *
 * Contrast (must NOT be confused with the three above):
 *   - `capabilities.external_api` is LIVE despite zero literal occurrences in `src/`: it is read
 *     through the dynamic table in `capability.ts` (`contract.capabilities[capability]`), which
 *     the template sets to `deny`. See `capabilitySetting` / `assessCapabilities`.
 *   - `capabilities.authority_ceiling` is validated (`A0`-`A3`) but never consulted by a decision.
 *   - `capabilities.network` / `dependency_install` / `credentials` are only echoed into the task
 *     file (`runner.js` `taskContents`); they block nothing.
 *
 * Imports: nothing.
 */

/** How a template-only contract key behaves at runtime. */
export type DeadKeyStatus = 'dead' | 'validated_only' | 'task_file_only';

export interface ContractKeyDisposition {
  /** Dotted key path as it appears in `templates/contract.yaml`. */
  path: string;
  status: DeadKeyStatus;
  /** Why it is not a gate (grep-verifiable claim). */
  evidence: string;
}

/** The three keys the DoD singles out: template-only, zero code references, no effect. */
export const DEAD_CONTRACT_KEYS: readonly ContractKeyDisposition[] = [
  {
    path: 'acceptance.require_proposal',
    status: 'dead',
    evidence: 'no reference under src/; proposal validation is unconditional in checkProposal (gate/proposal.ts)',
  },
  {
    path: 'acceptance.require_claims',
    status: 'dead',
    evidence: 'no reference under src/; claims validation is unconditional in checkClaims (gate/proposal.ts)',
  },
  {
    path: 'capabilities.shell.mode',
    status: 'dead',
    evidence: 'no reference under src/; the only shell capability name is the hardcoded builtin shell:evidence_commands_only (BUILTIN_GRANTED_CAPABILITIES)',
  },
] as const;

/** Adjacent keys that are read, but not as gates — recorded so the three above stay unambiguous. */
export const NON_DECISION_CONTRACT_KEYS: readonly ContractKeyDisposition[] = [
  {
    path: 'capabilities.authority_ceiling',
    status: 'validated_only',
    evidence: 'contract validation accepts A0-A3 / rejects A4, but no decision consults it',
  },
  {
    path: 'capabilities.network',
    status: 'task_file_only',
    evidence: 'echoed into .evofence-task.md by taskContents; blocks nothing',
  },
  {
    path: 'capabilities.dependency_install',
    status: 'task_file_only',
    evidence: 'echoed into .evofence-task.md by taskContents; blocks nothing',
  },
  {
    path: 'capabilities.credentials',
    status: 'task_file_only',
    evidence: 'echoed into .evofence-task.md by taskContents; blocks nothing',
  },
] as const;

/** `true` when the dotted key is one of the documented dead keys. */
export function isDeadContractKey(path: string): boolean {
  return DEAD_CONTRACT_KEYS.some((entry) => entry.path === path);
}
