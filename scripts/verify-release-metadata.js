import { existsSync, readFileSync } from 'node:fs';
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
  for (const condition of ['types', 'default']) {
    const target = rootExport[condition];
    if (typeof target !== 'string' || !toRepoRelative(target).startsWith('dist/')) {
      throw new Error(`package.json exports["."].${condition} must point into dist/, got ${String(target)}`);
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
    rootExport.default,
    rootExport.types,
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
  process.stdout.write(`Release ${releaseTag} matches package ${pkg.version}.\n`);
  process.stdout.write(`Publish surface verified: ${Object.values(pkg.bin).join(', ')}, ${pkg.exports['.'].default}, ${pkg.types}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
