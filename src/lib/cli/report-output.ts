/**
 * Report-output path safety: never let `evofence report <file>` overwrite control-plane state.
 *
 * DOMAIN: CLI (node `l2_cli`). Moved verbatim out of `src/cli.js` so the entry module stays under
 * the 350-line gate; the logic is unchanged (`PROTECTED_PATH` in every branch).
 *
 * Two independent attacks are covered: a *path* that resolves inside `.evofence/**` (through
 * symlinks, junctions or 8.3 aliases) and a *hard link* that aliases control-plane content with
 * no path-level signal at all.
 */
import { lstatSync, readlinkSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { EvoFenceError } from '../errors.js';

function isInsideDirectory(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Canonicalize a path even when its tail does not exist yet: resolve the longest
// existing ancestor via realpathSync.native (symlinks, junctions, 8.3 aliases) and
// re-append the remaining components. Dangling links are followed through
// lstat/readlink so a leaf link into state cannot masquerade as a plain file name;
// symlink chains that exceed the depth cap fail closed instead of falling back to
// lexical resolution.
function canonicalizePath(target: string, display: string, depth = 0): string {
  const suffix: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...suffix);
    } catch {
      let link: string | null = null;
      try {
        if (lstatSync(current).isSymbolicLink()) link = readlinkSync(current);
      } catch {
        // Missing component: treated as an ordinary suffix below.
      }
      if (link !== null) {
        if (depth >= 32) {
          throw new EvoFenceError('PROTECTED_PATH', `Refusing to write the report through an unresolvable symlink chain: ${display}`);
        }
        return path.join(canonicalizePath(path.resolve(path.dirname(current), link), display, depth + 1), ...suffix);
      }
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...suffix);
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

// A hard link aliases control-plane content without any path-level signal: compare the
// existing destination's file identity (dev/ino) against state files instead of only
// its canonical pathname. The nlink gate keeps the walk bounded to rare cases.
function sharesIdentityWithState(stateDir: string, output: string): boolean {
  let outputStat;
  try {
    outputStat = statSync(output, { bigint: true });
  } catch {
    return false; // Nothing exists at the destination yet.
  }
  if (!outputStat.isFile() || outputStat.nlink <= 1n) return false;
  const stack = [stateDir];
  while (stack.length) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const candidate = statSync(full, { bigint: true });
        if (candidate.dev === outputStat.dev && candidate.ino === outputStat.ino) return true;
      } catch {
        // Racy removal: treat as non-matching.
      }
    }
  }
  return false;
}

// The report output must never land on EvoFence control-plane state (`.evofence/**`):
// an unconditional overwrite here would destroy the ledger or the contract.
export function assertReportOutputOutsideState(root: string, output: string, display: string): void {
  const normalize = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value);
  const stateDir = path.join(realpathSync.native(root), '.evofence');
  const state = normalize(canonicalizePath(stateDir, display));
  const target = normalize(canonicalizePath(output, display));
  if (isInsideDirectory(state, target)) {
    throw new EvoFenceError('PROTECTED_PATH', `Refusing to write the report over EvoFence state: ${display}`);
  }
  if (sharesIdentityWithState(stateDir, output)) {
    throw new EvoFenceError('PROTECTED_PATH', `Refusing to write the report through a hard link to EvoFence state: ${display}`);
  }
}
