/**
 * Gate domain entry — R1 path: `src/lib/policy.js` -> `src/lib/policy.ts`.
 *
 * This file is a re-export facade only (R3). It keeps the exact 0.3.0 export surface (R2) —
 * `matchesGlob`, `isProtectedPath`, `isAllowedPath`, `checkChangedPaths`, `checkProposal`,
 * `checkClaims`, `assessRisk`, `assessCapabilities`, `requireEvidenceConfigured` — while the
 * implementation now lives in `src/lib/gate/`.
 *
 * Independent judgement entry points (each importable on its own, each fail-closed when its
 * input is absent):
 *   - `./gate/paths.js`      `evaluatePolicyGate`        — protected paths + evolution surface
 *   - `./gate/capability.js` `evaluateCapabilityGate`    — capability approval (dynamic table)
 *   - `./gate/contract.js`   `evaluateContractGate`      — policy drift across the 3 documents
 *   - `./gate/evidence.js`   `evaluateEvidenceGate`      — public/private/objective verdict
 *   - `./gate/budget.js`     `evaluateBudgetGate`        — token/USD/wall-clock/failure budgets
 *   - `./gate/isolation.js`  `evaluateIsolationGate`     — worktree metadata, holdout, opt-ins
 *   - `./gate/verdict.js`    `verdictForEvidence` etc.   — the decision table
 *   - `./gate/index.js`      barrel for all of the above
 */

export { matchesGlob } from './gate/glob.js';
export { checkChangedPaths, isAllowedPath, isProtectedPath } from './gate/paths.js';
export { checkClaims, checkProposal } from './gate/proposal.js';
export { assessRisk } from './gate/risk.js';
export { assessCapabilities } from './gate/capability.js';
export { requireEvidenceConfigured } from './gate/contract.js';
