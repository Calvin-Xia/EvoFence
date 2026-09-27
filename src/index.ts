/**
 * Public package API (R1 conversion of `src/index.js`).
 *
 * The export list is unchanged — 18 symbols, the same modules as 0.3.0 — because
 * `package.json#exports` publishes this module as the library surface. Nothing is added here on
 * purpose: a new public symbol is a contract change, not a refactor.
 */
export { initializeRepository } from './lib/init.js';
export { loadContract, loadPrivateHoldout, validateContract } from './lib/contract.js';
export { runEvolution } from './lib/runner.js';
export { Ledger, ledgerPath } from './lib/ledger.js';
export { checkChangedPaths, checkClaims, checkProposal, isAllowedPath, isProtectedPath, matchesGlob, assessRisk } from './lib/policy.js';
export { collectEvidence } from './lib/evidence.js';
export { buildEvolutionReport, formatEvolutionReport } from './lib/report.js';
export { EvoFenceError } from './lib/errors.js';
