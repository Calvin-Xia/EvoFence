/**
 * Skip visibility (audit G09 + G23, review R1).
 *
 * Every CI leg skips the real Pi/DSH suites, because the native host packages are not installed
 * there — yet nothing reported that, so a green CI run read as coverage it never had. Node exits 0
 * on skips, and the only skip-sensitive check in the repository (`verify-ci-environment.mjs`) was
 * referenced by nothing.
 *
 * Two layers, because counting declarations alone is not enough (review R1):
 *
 *   1. **Declarations** — every `{ skip: ... }` / `t.skip(...)` site is baselined per file
 *      (`file|count`), so a skip added or moved anywhere in the test tree is visible.
 *   2. **Actual skips** — the native-host files are executed with the native package roots pointed at
 *      a path that does not exist, and the *titles the runner actually skipped* must equal the
 *      recorded set. That is the assertion the declaration count cannot make: if
 *      `nativePackageSkipReason` ever stopped skipping, or a different test started skipping, the
 *      title set changes and this fails.
 *
 * Layer 2 is deliberately limited to the native-host files: their skip behaviour is deterministic on
 * every platform once the packages are absent, while skips elsewhere are platform-conditional (a
 * Windows-only path fixture, an external scenario directory) and would make the check differ between
 * the ubuntu and windows CI legs. Those stay covered by layer 1.
 *
 * It is wired into CI as `npm run check:skips` through the documented
 * `scripts/verify-ci-environment.mjs` entry point (audit G23).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'test-skip-baseline.json');
const NOT_INSTALLED = path.join(os.tmpdir(), 'evofence-native-absent');

/** Files whose skip behaviour is deterministic when the native packages are absent. */
const NATIVE_FILES = [
  'test/l3-pi-native.test.js',
  'test/l3-pi-delegation-native.test.js',
  'test/l3-dsh-session.test.js',
  'test/l3-dsh-delegation.test.js',
];

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

/** Titles the runner reported as skipped, from TAP lines like `ok 3 - name # SKIP reason`. */
export function tapSkippedTitles(tapText) {
  const titles = [];
  for (const line of tapText.split(/\r?\n/)) {
    const match = /^ok \d+ - (.+?) # SKIP\b/.exec(line.trim());
    if (match !== null) titles.push(match[1].trim());
  }
  return titles.sort();
}

/** Run the deterministic native-host files with the native packages absent, and collect skips. */
function runNativeSkipRun(root) {
  // Review N1: the probe executes test files that import `dist/**`. `npm run check:skips` builds
  // first (like `npm test`), and this guard makes a direct invocation fail with a clear message
  // instead of reporting a confusing skip-set mismatch against a missing or stale build.
  const distEntry = path.join(root, 'dist', 'runtime', 'host-port', 'index.js');
  if (!existsSync(distEntry)) {
    return { failure: 'dist/ is missing or incomplete — the native skip probe imports dist/**; run `npm run build` first (npm run check:skips does it for you)', titles: [] };
  }
  const env = { ...process.env, EVOFENCE_PI_PACKAGE_ROOT: NOT_INSTALLED, EVOFENCE_DSH_PACKAGE_ROOT: NOT_INSTALLED };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...NATIVE_FILES],
    { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  if (result.error) return { failure: `could not run the native skip probe: ${result.error.message}`, titles: [] };
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const titles = tapSkippedTitles(output);
  if (!/^# skipped \d+$/m.test(output)) return { failure: `native skip probe produced no TAP summary (exit ${result.status})`, titles };
  if (titles.length === 0) return { failure: 'no native test was skipped even though the native packages are absent — host coverage may have silently started running', titles };
  return { failure: null, titles };
}

/**
 * The whole gate: declaration baseline plus the actual-skip titles.
 * `--update` regenerates both halves together, so they cannot drift apart.
 */
export function runSkipGate({ root = ROOT, update = false, write = (text) => process.stdout.write(text), fail = (text) => process.stderr.write(text) } = {}) {
  const sites = scanSkipSites(root);
  const native = runNativeSkipRun(root);
  if (native.failure !== null) {
    fail(`${native.failure}\n`);
    return 1;
  }
  const baselinePath = path.join(root, 'scripts', 'test-skip-baseline.json');
  if (update) {
    writeFileSync(baselinePath, `${JSON.stringify({
      note: 'Known skip declarations and the deterministic native-skip titles; shrink-only. Regenerate with --update.',
      sites, nativeSkips: { files: NATIVE_FILES, titles: native.titles },
    }, null, 2)}\n`);
    write(`test-skip baseline updated: ${sites.length} declaration file(s), ${native.titles.length} actual native skip(s)\n`);
    return 0;
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    fail(`cannot read scripts/test-skip-baseline.json: ${error.message}\n`);
    return 1;
  }
  const declarations = compareSkipBaseline(baseline.sites ?? [], sites);
  const actual = compareSkipBaseline(baseline.nativeSkips?.titles ?? [], native.titles);
  write(`test-skip gate: ${sites.length} declaration file(s), ${native.titles.length} actual native skip(s); `
    + `${declarations.added.length} new / ${declarations.stale.length} stale declaration(s), `
    + `${actual.added.length} new / ${actual.stale.length} stale skip title(s)\n`);
  for (const entry of declarations.added) fail(`- new skip declaration without a baseline entry: ${entry}\n`);
  for (const entry of declarations.stale) fail(`- baseline declaration no longer occurs (regenerate with --update): ${entry}\n`);
  for (const entry of actual.added) fail(`- test started skipping without a baseline entry: ${entry}\n`);
  for (const entry of actual.stale) fail(`- baselined skip no longer happens (it may now be running, or renamed): ${entry}\n`);
  const problems = declarations.added.length + declarations.stale.length + actual.added.length + actual.stale.length;
  return problems === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runSkipGate({ update: process.argv.includes('--update') });
}
