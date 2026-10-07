/**
 * Skip visibility (audit G09 + G23).
 *
 * Every CI leg skips the real Pi/DSH suites, because the native host packages are not installed
 * there — yet nothing reported that, so a green CI run read as coverage it never had. Node exits 0
 * on skips, and the only skip-sensitive check in the repository (`verify-ci-environment.mjs`) was
 * referenced by nothing.
 *
 * This module makes skips visible and *counted*: it scans the test sources for skip declarations and
 * compares the per-file counts against a shrink-only baseline. A new skip site fails the gate, and a
 * baseline entry that disappeared fails too, so an allowance cannot be parked.
 *
 * It is wired into CI as `npm run check:skips` through the documented
 * `scripts/verify-ci-environment.mjs` entry point (audit G23).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'test-skip-baseline.json');

/** A `{ skip: reason }` option, `t.skip(...)`, `test.skip(...)` or `it.skip(...)`. */
const SKIP_PATTERNS = [/\bskip\s*:/g, /\bt\.skip\s*\(/g, /\btest\.skip\s*\(/g, /\bit\.skip\s*\(/g];

function testFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(full));
    else if (/\.(?:js|mjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** `file|count` for every file that declares at least one skip. */
export function scanSkipSites(root = ROOT) {
  const sites = [];
  for (const file of testFiles(path.join(root, 'test'))) {
    const text = readFileSync(file, 'utf8');
    let count = 0;
    for (const pattern of SKIP_PATTERNS) count += [...text.matchAll(pattern)].length;
    if (count > 0) sites.push(`${path.relative(root, file).replaceAll('\\', '/')}|${count}`);
  }
  return sites.sort();
}

/** Multiset difference in both directions, as human-readable lines. */
export function compareSkipBaseline(baseline, observed) {
  const counts = (list) => list.reduce((map, entry) => map.set(entry, (map.get(entry) ?? 0) + 1), new Map());
  const allowed = counts(baseline);
  const seen = counts(observed);
  const added = [];
  const stale = [];
  for (const [entry, count] of seen) if (count > (allowed.get(entry) ?? 0)) added.push(entry);
  for (const [entry, count] of allowed) if (count > (seen.get(entry) ?? 0)) stale.push(entry);
  return { added: added.sort(), stale: stale.sort() };
}

export function runSkipReport({ root = ROOT, update = false, write = (text) => process.stdout.write(text), fail = (text) => process.stderr.write(text) } = {}) {
  const observed = scanSkipSites(root);
  if (update) {
    writeFileSync(path.join(root, 'scripts', 'test-skip-baseline.json'),
      `${JSON.stringify({ note: 'Known skip declarations; shrink-only. Regenerate with --update.', sites: observed }, null, 2)}\n`);
    write(`test-skip baseline updated: ${observed.length} file(s)\n`);
    return 0;
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(path.join(root, 'scripts', 'test-skip-baseline.json'), 'utf8')).sites ?? [];
  } catch (error) {
    fail(`cannot read scripts/test-skip-baseline.json: ${error.message}\n`);
    return 1;
  }
  const { added, stale } = compareSkipBaseline(baseline, observed);
  write(`test-skip baseline: ${observed.length} file(s) with skip declarations, ${added.length} new, ${stale.length} stale\n`);
  for (const entry of added) fail(`- new skip declaration without a baseline entry: ${entry}\n`);
  for (const entry of stale) fail(`- baseline entry no longer occurs (regenerate with --update): ${entry}\n`);
  return added.length === 0 && stale.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runSkipReport({ update: process.argv.includes('--update') });
}
