/**
 * Exec domain · temp worktree root layout and parent-directory cleanup.
 *
 * 0.3.0 created `<TMPDIR>/evofence-worktrees/<repoId>/<runId>` and only ever removed
 * `<runId>` in `runEvolution`'s `finally`, so every run leaked one empty `<repoId>` directory
 * (151 observed in the 0.3.0 inventory, §13). The layout is unchanged; the parent is now
 * removed too, but only when it is empty, so a concurrently running sibling (which still holds
 * its own `<runId>` under the same parent) is never disturbed.
 */
import { rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../fs.js';

/** Stable per-repository id used as the shared temp parent name. */
export function repositoryId(root: string): string {
  return sha256(root.toLowerCase()).slice(0, 16);
}

/** `<TMPDIR>/evofence-worktrees/<repoId>` — shared by every run against the same checkout. */
export function worktreeTempParent(root: string): string {
  return path.join(os.tmpdir(), 'evofence-worktrees', repositoryId(root));
}

/** Per-run temp root; must always live inside {@link worktreeTempParent}. */
export function runTempRoot(tempParent: string, runId: string): string {
  return path.join(tempParent, runId);
}

/**
 * Remove the shared temp parent if (and only if) it is empty.
 *
 * Returns `true` when the directory was removed, `false` when it was missing (already cleaned
 * by a concurrent run) or still held another run's directory. This never removes a non-empty
 * directory, which is what makes it safe under concurrent runs against the same checkout.
 *
 * Observable point for regression tests: after `runEvolution` settles, call this with
 * `worktreeTempParent(root)` — or simply `fs.existsSync(worktreeTempParent(root))` — and it
 * must be gone for a run that had no concurrent sibling.
 */
export async function cleanupEmptyWorktreeTempParent(tempParent: string): Promise<boolean> {
  try {
    await rmdir(tempParent);
    return true;
  } catch {
    return false;
  }
}
