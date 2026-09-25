export { initializeRepository } from './lib/init.js';
export { loadContract, loadPrivateHoldout, validateContract } from './lib/contract.js';
export { runEvolution } from './lib/runner.js';
export { Ledger, ledgerPath } from './lib/ledger.js';
export { checkChangedPaths, checkClaims, checkProposal, isAllowedPath, isProtectedPath, matchesGlob, assessRisk } from './lib/policy.js';
export { collectEvidence } from './lib/evidence.js';
export { buildEvolutionReport, formatEvolutionReport } from './lib/report.js';
export { EvoFenceError } from './lib/errors.js';
