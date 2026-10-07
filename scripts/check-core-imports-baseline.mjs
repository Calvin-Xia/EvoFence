/**
 * Baseline wrapper for the I01–I08 core-imports guard (audit G25).
 *
 * `scripts/check-core-imports.mjs` is a 45 KB lexical guard with 39 pre-existing I08 diagnostics
 * (documented in `CHANGELOG.md`). Because it was red, it was kept out of `check` and every workflow,
 * which meant the kernel/runtime injection invariants were unenforced anywhere.
 *
 * This wrapper makes the gate usable without hiding the backlog:
 *
 *   - a diagnostic listed in the baseline is *known* and does not fail the run;
 *   - a diagnostic that is **not** in the baseline fails — new violations cannot slip in;
 *   - a baseline entry that no longer occurs also fails, so the baseline can only shrink and a
 *     stale allowance cannot be parked there forever.
 *
 * Run `node scripts/check-core-imports-baseline.mjs --update` to regenerate after intentionally
 * fixing (or, with justification, adding) diagnostics.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'check-core-imports.mjs');
const BASELINE = path.join(ROOT, 'scripts', 'core-imports-baseline.json');

/** One `[I08/PORT_FALLBACK] path: message` line -> a stable `rule|code|file|message` key. */
export function diagnosticKey(line) {
  const match = /^\[(I\d\d)\/([A-Z_]+)\]\s+(.+?):\s+(.*)$/.exec(line.trim());
  if (match === null) return null;
  const file = match[3].replaceAll('\\', '/');
  const repoRelative = file.toLowerCase().startsWith(ROOT.replaceAll('\\', '/').toLowerCase() + '/')
    ? file.slice(ROOT.length + 1)
    : file;
  return `${match[1]}|${match[2]}|${repoRelative}|${match[4]}`;
}

/** Multiset of observed diagnostics, from the guard's combined output. */
export function observedDiagnostics(output) {
  const counts = new Map();
  for (const line of output.split(/\r?\n/)) {
    const key = diagnosticKey(line);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Known/stale split for a baseline multiset against the observed one. */
export function compareToBaseline(baseline, observed) {
  const added = [];
  const stale = [];
  for (const [key, count] of observed) {
    const allowed = baseline.get(key) ?? 0;
    if (count > allowed) added.push(`${key} (observed ${count}, baseline ${allowed})`);
  }
  for (const [key, count] of baseline) {
    const seen = observed.get(key) ?? 0;
    if (seen < count) stale.push(`${key} (baseline ${count}, observed ${seen})`);
  }
  return { added: added.sort(), stale: stale.sort() };
}

export function parseBaseline(json) {
  const counts = new Map();
  for (const key of json.diagnostics ?? []) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function runGuard() {
  const result = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function main() {
  const observed = observedDiagnostics(runGuard());
  if (process.argv.includes('--update')) {
    // The baseline is a multiset: `parseBaseline` counts duplicates, so a diagnostic that occurs
    // five times is listed five times.
    const list = [];
    for (const [key, count] of observed) for (let index = 0; index < count; index += 1) list.push(key);
    writeFileSync(BASELINE, `${JSON.stringify({ note: 'Known I01-I08 diagnostics; shrink-only. Regenerate with --update.', diagnostics: list.sort() }, null, 2)}\n`);
    process.stdout.write(`core-imports baseline updated: ${list.length} diagnostic(s)\n`);
    process.exitCode = 0;
    return;
  }
  let baseline;
  try {
    baseline = parseBaseline(JSON.parse(readFileSync(BASELINE, 'utf8')));
  } catch (error) {
    process.stderr.write(`cannot read ${path.relative(ROOT, BASELINE)}: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const { added, stale } = compareToBaseline(baseline, observed);
  process.stdout.write(`core-imports baseline: ${observed.size} known diagnostic(s), ${added.length} new, ${stale.length} stale\n`);
  if (added.length > 0) {
    process.stderr.write('new core-imports diagnostics (not in the baseline):\n');
    for (const entry of added) process.stderr.write(`- ${entry}\n`);
  }
  if (stale.length > 0) {
    process.stderr.write('baseline entries that no longer occur (regenerate with --update):\n');
    for (const entry of stale) process.stderr.write(`- ${entry}\n`);
  }
  if (added.length > 0 || stale.length > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
