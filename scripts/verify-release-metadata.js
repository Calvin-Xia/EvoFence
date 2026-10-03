import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Leading `./` is legal inside `bin` / `exports` but not in a filesystem path, so
 * every publish-surface target is normalized to a repo-relative path first.
 */
function toRepoRelative(target) {
  return target.replace(/^\.\//, '');
}

export function verifyReleaseMetadata({ version, releaseTag, releaseIsPrerelease }) {
  const releaseVersion = releaseTag.replace(/^v/, '');
  const packageIsPrerelease = version.split('+', 1)[0].includes('-');

  if (releaseVersion !== version) {
    throw new Error(`Release tag ${releaseTag} does not match package version ${version}`);
  }

  if (releaseIsPrerelease !== packageIsPrerelease) {
    throw new Error('GitHub Release prerelease status must match the package SemVer version');
  }
}

/**
 * 0.4.0 adaptation (adr_0002): the published artifact is the *built* `dist/` tree, not
 * the repository tree. A tag/version match alone can therefore still ship a broken
 * package — `bin`/`exports`/`types` could point at a stale path, or `files` could stop
 * shipping `dist/` and the tarball would silently lose the CLI. This gate keeps the
 * release gate honest about the thing that is actually uploaded: every published entry
 * point must live under `dist/`, `files` must ship `dist/`, and the built files the
 * metadata promises must exist on disk.
 *
 * `exists` is injected so the check is a pure function of (metadata, filesystem).
 */
export function verifyPublishSurface({ pkg, exists = existsSync }) {
  const bin = pkg.bin;
  if (bin === undefined || bin === null || typeof bin !== 'object' || Array.isArray(bin)) {
    throw new Error('package.json bin must be an object mapping commands to entry points');
  }
  const binEntries = Object.entries(bin);
  if (binEntries.length === 0) {
    throw new Error('package.json bin must declare at least one command entry point');
  }
  for (const [command, target] of binEntries) {
    if (typeof target !== 'string' || !toRepoRelative(target).startsWith('dist/')) {
      throw new Error(`package.json bin ${command} must point into dist/, got ${String(target)}`);
    }
  }

  const rootExport = pkg.exports?.['.'];
  if (rootExport === undefined || rootExport === null || typeof rootExport !== 'object') {
    throw new Error('package.json exports["."] must declare the published entry points');
  }
  const exportTargets = [];
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    for (const condition of ['types', 'default']) {
      const target = entry?.[condition];
      if (typeof target !== 'string' || !toRepoRelative(target).startsWith('dist/')) {
        throw new Error(`package.json exports["${subpath}"].${condition} must point into dist/, got ${String(target)}`);
      }
      const relative = toRepoRelative(target);
      if (relative.includes('\\') || relative.split('/').includes('..')) {
        throw new Error(`package.json export ${subpath} escapes dist/: ${target}`);
      }
      exportTargets.push(target);
    }
  }
  if (typeof pkg.types !== 'string' || !toRepoRelative(pkg.types).startsWith('dist/')) {
    throw new Error(`package.json types must point into dist/, got ${String(pkg.types)}`);
  }

  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const shipsDist = files.some(
    (entry) => typeof entry === 'string' && toRepoRelative(entry).replace(/\/+$/, '') === 'dist',
  );
  if (!shipsDist) {
    throw new Error('package.json files must include "dist/" so the built artifact is published');
  }

  const promised = new Set([
    ...binEntries.map(([, target]) => target),
    ...exportTargets,
    pkg.types,
  ]);
  const missing = [...promised]
    .map(toRepoRelative)
    .filter((target) => !exists(target))
    .sort();
  if (missing.length > 0) {
    throw new Error(`the built dist/ artifact is incomplete, missing: ${missing.join(', ')} (run \`npm run build\` before releasing)`);
  }
}

export const EXPECTED_PACKAGE_FILES = [
  'dist/', 'templates/', 'docs/pi-tool-strategy.md',
  'README.md', 'README.en.md', 'LICENSE', 'CHANGELOG.md',
];

/** Check actual npm pack output, including npm's implicit package.json entry. */
export function verifyPackedFiles({ pkg, files }) {
  const expected = [...EXPECTED_PACKAGE_FILES].sort();
  if (JSON.stringify([...pkg.files].sort()) !== JSON.stringify(expected)) {
    throw new Error('package.json files expands or changes the frozen publish allowlist');
  }
  if (JSON.stringify(Object.keys(pkg.dependencies).sort()) !== JSON.stringify(['better-sqlite3', 'yaml'])) {
    throw new Error('runtime dependencies must be exactly better-sqlite3 and yaml');
  }
  if (pkg.bin.evofence !== 'dist/cli.js' || Object.keys(pkg.bin).length !== 1) {
    throw new Error('the only CLI bin must be evofence -> dist/cli.js');
  }
  const paths = files.map(entry => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error('duplicate packed path');
  for (const name of paths) {
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some(p => ['..', '.', ''].includes(p))) {
      throw new Error(`non-canonical packed path: ${name}`);
    }
    if (/(^|\/)(?:\.evofence|\.graph|execution|scenarios|experiments|evidence|private|node_modules)(\/|$)/.test(name)) {
      throw new Error(`private/generated packed path: ${name}`);
    }
    const allowed = name === 'package.json' || EXPECTED_PACKAGE_FILES.some(entry =>
      entry.endsWith('/') ? name.startsWith(entry) : name === entry);
    if (!allowed) throw new Error(`unexpected packed path: ${name}`);
    if (name.startsWith('dist/') && !/\.(?:js(?:\.map)?|d\.ts(?:\.map)?)$/.test(name)) {
      throw new Error(`dist must contain built artifacts only: ${name}`);
    }
  }
  const packed = new Set(paths);
  verifyPublishSurface({ pkg, exists: target => packed.has(target) });
  for (const name of ['package.json', ...EXPECTED_PACKAGE_FILES.filter(p => !p.endsWith('/'))]) {
    if (!packed.has(name)) throw new Error(`required packed document missing: ${name}`);
  }
  if (!paths.some(p => p.startsWith('templates/'))) throw new Error('packed templates missing');
  return { entries: paths.length, exports: Object.keys(pkg.exports).length, privateEntries: 0 };
}

export function readPackInventory(root = REPO_ROOT) {
  // All Windows shell tokens are fixed; paths are passed through cwd, never shell text.
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd pack --dry-run --json --ignore-scripts --cache .npm-cache']
    : ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', '.npm-cache'];
  const result = spawnSync(command, args,
    { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`npm pack --dry-run failed: ${result.error?.message ?? result.stderr}`);
  }
  const inventory = JSON.parse(result.stdout);
  if (inventory.length !== 1 || !Array.isArray(inventory[0].files)) throw new Error('expected exactly one pack inventory');
  return inventory[0];
}

/** Parse every documented package import and concrete CLI example against real routing. */
export function verifyDocumentedEntrypoints({ pkg, text, parseCli }) {
  const imports = new Set([...text.matchAll(/['"](evofence(?:\/[\w./-]+)?)['"]/g)].map(m => m[1]));
  for (const specifier of imports) {
    if (!Object.hasOwn(pkg.exports, specifier === pkg.name ? '.' : '.' + specifier.slice(pkg.name.length))) {
      throw new Error(`undocumented package export: ${specifier}`);
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('evofence ')) continue;
    // README marks optional syntax with [--flag] and supplies placeholder positional values.
    const argv = line.slice('evofence '.length).replace(/\[([^\]]+)\]/g, '$1').trim().split(/\s+/);
    parseCli(argv);
  }
  const block = text.match(/```json release-entries\s*([\s\S]*?)```/);
  if (!block) throw new Error('release-entries block required');
  const entries = JSON.parse(block[1]);
  if (JSON.stringify(entries.bin) !== JSON.stringify(pkg.bin) ||
      JSON.stringify(entries.exports) !== JSON.stringify(pkg.exports)) {
    throw new Error('documented bin/exports disagree with package.json');
  }
  return { imports: imports.size, exports: Object.keys(entries.exports).length };
}

export function verifyReleaseBoundary(text) {
  if (!text.includes('本节点不授权 tag/publish')) throw new Error('explicit release authorization boundary required');
  if (/(?:已\s*(?:tag|publish|merge|发布|合并)|\b(?:already|was|has been)\s+(?:tagged|published|merged)\b)/i.test(text)) {
    throw new Error('unauthorized release action claim');
  }
  if (/收益\s*(?:已)?(?:达成|显著提升)|\bbenefit achieved\b/i.test(text)) throw new Error('unsupported capability benefit claim');
  const block = text.match(/```json release-boundary\s*([\s\S]*?)```/);
  if (!block) throw new Error('release-boundary block required');
  const boundary = JSON.parse(block[1]);
  const expected = {
    nodeAuthorizesPublish: false, benefit: 'inconclusive', attempt1: 'failed',
    findings: { blocker: 1, major: 2 }, historicalBudgetUsd: [747, 943],
    budgetAdjudication: 'unresolved', preregisteredEnvelopeUsd: '938.470100',
    proposedAdrs: ['adr_0001', 'adr_0004'], fog: { 'dual-host-runtime-and-uplift': 'not-graduated' },
  };
  if (JSON.stringify(boundary) !== JSON.stringify(expected) ||
      !/收益\s*\*{0,2}inconclusive/.test(text) || !/attempt 1\s*\*{0,2}failed/.test(text) ||
      !text.includes('747 / 943 USD') || !text.includes('938.470100 USD')) {
    throw new Error('inherited release boundary/negative evidence changed');
  }
}

function run() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const releaseTag = process.env.RELEASE_TAG;
  const releaseFlag = process.env.RELEASE_IS_PRERELEASE;
  if (!releaseTag || !['true', 'false'].includes(releaseFlag)) {
    throw new Error('RELEASE_TAG and RELEASE_IS_PRERELEASE must be provided by the GitHub Release event');
  }
  verifyReleaseMetadata({ version: pkg.version, releaseTag, releaseIsPrerelease: releaseFlag === 'true' });
  verifyPublishSurface({
    pkg,
    exists: (target) => existsSync(path.join(REPO_ROOT, toRepoRelative(target))),
  });
  const inventory = readPackInventory();
  const packed = verifyPackedFiles({ pkg, files: inventory.files });
  process.stdout.write(`Release ${releaseTag} matches package ${pkg.version}.\n`);
  process.stdout.write(`Publish surface verified: ${Object.values(pkg.bin).join(', ')}, ${Object.keys(pkg.exports).length} typed exports.\n`);
  process.stdout.write(`Pack boundary verified: ${packed.entries} entries, ${packed.exports} exports, zero private entries.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
