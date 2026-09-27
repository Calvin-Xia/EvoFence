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
export type { GateJudgementBase } from './fail-closed.js';

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
