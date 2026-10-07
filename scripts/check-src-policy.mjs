#!/usr/bin/env node
/**
 * EvoFence source policy check — the machine gate behind two hand-maintained rules.
 *
 * Why: two invariants of the 0.4.0 TypeScript refactor were enforced only by review.
 *
 *   1. `src/` is TypeScript only (R1 fix F4). The build used to carry
 *      `allowJs: true` + `checkJs: false` plus a JavaScript include glob from the 0.3.0
 *      migration window. That made `npm run typecheck`, `npm run check` and CI blind to a
 *      stray `.js` file while `tsc` still emitted it into `dist/` and shipped it. Those
 *      settings are gone, so a `.js` file is no longer compiled at all — this check
 *      makes sure one cannot quietly reappear.
 *   2. No `src/**` TypeScript file exceeds 350 lines (graph exit criterion, R1 fix F11).
 *      The largest file sat exactly on the limit, so a single added line regressed the
 *      metric with nothing to catch it.
 *
 * Both failures are reported together and the process exits 1. Pure Node builtins, no
 * dependencies, no writes.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** Extensions that make a file JavaScript the TypeScript program will not see. */
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
/** Extensions counted against the line limit. */
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx']);

const MAX_LINES = 350;

/** Relative path from the repository root, always with forward slashes. */
function repoPath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

/** Every regular file under `directory`, skipping `node_modules` and dot-directories. */
function collectFiles(directory) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      // Audit G22: an unreadable directory used to be skipped silently, so the guard could pass
      // while never having inspected the tree. It is a failure now.
      throw new Error(`cannot read directory ${repoPath(current)}: ${error.message}`);
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (entry.isFile()) {
        found.push(full);
      }
    }
  };
  walk(directory);
  return found.sort();
}

/** Physical line count: the number of newline-terminated lines, ignoring a trailing newline. */
function countLines(text) {
  if (text === '') return 0;
  const breaks = text.split('\n').length;
  return text.endsWith('\n') ? breaks - 1 : breaks;
}

function main() {
  const files = collectFiles(SRC_ROOT);
  const javascriptFiles = files.filter((file) => JAVASCRIPT_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const typescriptFiles = files.filter((file) => TYPESCRIPT_EXTENSIONS.has(path.extname(file).toLowerCase()));

  const problems = [];

  for (const file of javascriptFiles) {
    problems.push(
      `${repoPath(file)} is a JavaScript file under src/. The TypeScript program no longer includes it, ` +
        'so it receives no type checking and would not be emitted at all; keep src/ TypeScript-only.',
    );
  }

  const oversized = [];
  let maxLines = 0;
  let maxFile = null;
  for (const file of typescriptFiles) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      // Audit G22: a file the guard cannot read must fail the check, not shrink the measured set.
      throw new Error(`cannot read ${repoPath(file)}: ${error.message}`);
    }
    const lines = countLines(text);
    if (lines > maxLines) {
      maxLines = lines;
      maxFile = file;
    }
    if (lines > MAX_LINES) oversized.push({ file: repoPath(file), lines });
  }
  for (const { file, lines } of oversized) {
    problems.push(`${file} is ${lines} lines, over the ${MAX_LINES}-line limit.`);
  }

  const summary =
    `src policy: ${typescriptFiles.length} TypeScript file(s), largest ${maxLines} line(s)` +
    (maxFile && maxLines > 0 ? ` (${repoPath(maxFile)})` : '') +
    `, limit ${MAX_LINES}; ${javascriptFiles.length} JavaScript file(s)`;

  if (problems.length) {
    process.stderr.write(`${summary}\n`);
    for (const problem of problems) process.stderr.write(`- ${problem}\n`);
    process.stderr.write('src policy check failed.\n');
    process.exit(1);
  }

  process.stdout.write(`${summary}\nsrc policy check passed.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`src policy check failed: ${error.message}\n`);
  process.exit(1);
}
