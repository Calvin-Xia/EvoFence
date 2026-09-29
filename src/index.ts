/**
 * Public package API (R1 conversion of `src/index.js`).
 *
 * The original 18 symbols and their module paths remain unchanged. `verifyBundle` is the
 * additive public entry point for offline ledger-bundle verification; it does not open SQLite.
 * `package.json#exports` publishes this module as the library surface.
 */
export { initializeRepository } from './lib/init.js';
export { loadContract, loadPrivateHoldout, validateContract } from './lib/contract.js';
export { runEvolution } from './lib/runner.js';
export { Ledger, ledgerPath, verifyBundle } from './lib/ledger.js';
export { checkChangedPaths, checkClaims, checkProposal, isAllowedPath, isProtectedPath, matchesGlob, assessRisk } from './lib/policy.js';
export { collectEvidence } from './lib/evidence.js';
export { buildEvolutionReport, formatEvolutionReport } from './lib/report.js';
export { EvoFenceError } from './lib/errors.js';
