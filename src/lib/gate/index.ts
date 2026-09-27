/**
 * Gate domain barrel — one import surface for every judgement entry point.
 *
 * The gate domain owns exactly five judgement faces plus the verdict mapping. Each face is a
 * pure function of already-collected inputs, each returns `passed` / `reason` / `missing`
 * (fail-closed: absent input is never a pass), and nothing here imports an exec- or
 * ledger-domain module:
 *
 *   contract  → `evaluateContractGate`   (policy drift)  + `validateContract` (document shape)
 *   policy    → `evaluatePolicyGate`     (protected paths / evolution surface)
 *              + `evaluateCapabilityGate` (dynamic capability table)
 *   evidence  → `evaluateEvidenceGate`   (public, private, objective, evidence_ok)
 *   budget    → `evaluateBudgetGate`     (pure decision; accounting stays in the exec domain)
 *   isolation → `evaluateIsolationGate`  (worktree metadata, holdout, CLI opt-ins)
 *   verdict   → `verdictForEvidence` / `verdictForRisk` / `decisionForCandidateCheck`
 *
 * The only non-type, non-sibling imports in this directory are `src/lib/errors.js` (the shared
 * base leaf that carries `EvoFenceError`/`invariant`, needed to preserve the error contract) and
 * `node:` builtins inside `glob.ts` (none). `src/lib/evidence.ts` (the collector) is the single
 * file that still reaches into the exec domain's `process.js`, because R2 forbids changing
 * `collectEvidence`'s signature.
 *
 * WIRING STATUS (fix batch R2 · review F3) — the honest inventory. "Referenced" means reachable
 * from a production entry point (`runEvolution` / `evofence` CLI). `grep -rn '<name>' src/`
 * outside this directory returns only `src/lib/policy.ts` prose for the nine judgement entries
 * below and the noted caller for the four primitives, so each line is independently checkable:
 *
 *   value export                    production caller
 *   ------------------------------  --------------------------------------------------
 *   `USD_MICROS` / `parseNumericBudget` / `usdToMicros` / `usdFromMicros`
 *                                   WIRED — re-exported by `src/lib/exec/budget.ts` and called
 *                                   from `runner-preflight.ts` / `runner-budgeted.ts` /
 *                                   `runner-run.ts`
 *   `evaluateContractGate`          NOT WIRED — production compares the digests inline
 *                                   (`stableStringify(currentPolicyHashes(...)) !== initialHashes`
 *                                   in `runner-iteration.ts` / `runner-evaluate.ts`);
 *                                   `validateContract` (`./contract-document.js`) IS wired
 *                                   (run path + `init`)
 *   `evaluatePolicyGate`            NOT WIRED — production uses `checkChangedPaths` /
 *                                   `isProtectedPath` (`./paths.js`) via `src/lib/policy.ts`
 *   `evaluateCapabilityGate`        NOT WIRED — production uses `assessCapabilities` (`./capability.js`)
 *   `evaluateEvidenceGate`          NOT WIRED — production uses `allCasesPassed` / `casePassed` /
 *                                   `withinTolerance` (`./evidence.js`) via `src/lib/evidence.ts`
 *   `evaluateBudgetGate`            NOT WIRED — production lives in `src/lib/exec/budget.ts`
 *                                   (`recordTokenUsage` / `recordCostUsage`) + the pre-invocation
 *                                   allowance check in `src/lib/exec/runner-budgeted.ts`
 *   `evaluateIsolationGate`         NOT WIRED — production checks the same facts in
 *                                   `runner-preflight.ts` (sandbox + `PRIVATE_ORACLE_READABLE`
 *                                   opt-ins), `runner-candidate.ts` (`git check-ignore` →
 *                                   `HOLDOUT_NOT_IGNORED`) and `runner-iteration.ts` calling
 *                                   `worktreeMetadataMatches` from `src/lib/git.ts`
 *   `verdictForEvidence` / `verdictForRisk` / `decisionForCandidateCheck`
 *                                   NOT WIRED — the 0.3.0 decision table is inlined in
 *                                   `src/lib/exec/runner-evaluate.ts`
 *   `DEAD_CONTRACT_KEYS`            registry only (consumed by `test/contract-policy.test.js`)
 *
 * So the six `evaluate*Gate` entry points and the three verdict mappings are a *reference*
 * implementation today: they are unit-tested and kept honest, but no shipped behaviour runs
 * through them, and a change here alone changes nothing at runtime. `node --test
 * test/fix-gate-wiring.test.js` pins exactly that split instead of implying these functions are
 * live. Wiring them into the exec domain is a separate, cross-file change (it also has to move
 * the host-capability pre-check at `runner-preflight.ts:65-69` and the wall-clock /
 * failed-candidate checks in `runner-run.ts`, `runner-iteration.ts` and `runner-evaluate.ts`,
 * and to pass each gate a complete input — the budget gate refuses to judge a partial one) —
 * deliberately NOT attempted in this batch.
 *
 * `GateJudgementBase` is declared in `src/types/gate.ts` (ADR-0005) and re-exported from
 * `./fail-closed.js` for backwards compatibility.
 */

export { globRegex, matchesGlob } from './glob.js';
export {
  GATE_INPUT_MISSING,
  failingJudgement,
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  passingJudgement,
  refusedJudgement,
} from './fail-closed.js';
export type { GateJudgementBase } from './fail-closed.js'; // declared in src/types/gate.ts

export {
  BUILTIN_PROTECTED,
  checkChangedPaths,
  evaluatePolicyGate,
  isAllowedPath,
  isProtectedPath,
} from './paths.js';
export type { PathPolicyContract, PolicyGateInput, PolicyGateJudgement } from './paths.js';

export { checkClaims, checkProposal } from './proposal.js';

export { assessCapabilities, capabilitySetting, evaluateCapabilityGate, isCapabilityAllowed } from './capability.js';
export type { CapabilityContract, CapabilityGateInput, CapabilityGateJudgement, CapabilityRequestSource } from './capability.js';

export { assessRisk, isRiskAssessment } from './risk.js';
export type { RiskContract, RiskProposalView } from './risk.js';

export {
  POLICY_DOCUMENTS,
  comparePolicyHashes,
  evaluateContractGate,
  requireEvidenceConfigured,
} from './contract.js';
export type { ContractGateJudgement, EvidenceConfigContract } from './contract.js';
export { validateContract } from './contract-document.js';

export {
  allCasesPassed,
  casePassed,
  evaluateEvidenceGate,
  evaluateObjectiveComparison,
  isValidObjectiveScore,
  recomputeAllPrivateWithinTolerance,
  recomputeAllPublicPassed,
  withinTolerance,
} from './evidence.js';
export type { EvidenceGateJudgement } from './evidence.js';

export {
  USD_MICROS,
  evaluateBudgetGate,
  parseNumericBudget,
  remainingTokenBudget,
  remainingUsdBudgetMicros,
  usdFromMicros,
  usdToMicros,
} from './budget.js';
export type { BudgetGateJudgement } from './budget.js';

export { evaluateIsolationGate, worktreeMetadataMatches } from './isolation.js';
export type { IsolationGateJudgement } from './isolation.js';

export { decisionForCandidateCheck, verdictForEvidence, verdictForRisk } from './verdict.js';
export type { EvidenceVerdict } from './verdict.js';

export { DEAD_CONTRACT_KEYS, NON_DECISION_CONTRACT_KEYS, isDeadContractKey } from './dead-keys.js';
export type { ContractKeyDisposition, DeadKeyStatus } from './dead-keys.js';
