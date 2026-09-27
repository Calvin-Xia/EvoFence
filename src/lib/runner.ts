/**
 * Exec domain entry (0.3.0 path preserved: `src/lib/runner.js` -> `src/lib/runner.ts`).
 *
 * The 858-line 0.3.0 monolith now lives in `src/lib/exec/runner-*.ts`; this file is the stable
 * domain boundary. Every previously exported symbol keeps its name and semantics.
 *
 * Added exports (allowed, nothing removed):
 *   - `worktreeTempParent` / `repositoryId` / `cleanupEmptyWorktreeTempParent` — the temp-root
 *     layout plus its new empty-only parent cleanup, exposed so a regression test can assert
 *     that `runEvolution` no longer leaks `<TMPDIR>/evofence-worktrees/<repoId>`.
 */
export { checkFinalCandidate } from './exec/runner-candidate.js';
export { runEvolution } from './exec/runner-run.js';
export { cleanupEmptyWorktreeTempParent, repositoryId, worktreeTempParent } from './exec/worktree-temp.js';
