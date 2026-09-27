import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyReleaseMetadata, verifyPublishSurface } from '../scripts/verify-release-metadata.js';
import { verifyPublishWorkflow, PUBLISH_WORKFLOW_PATH, REQUIRED_NPM_CLI } from '../scripts/verify-publish-workflow.js';

const readRootJson = (relativePath) => JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
const readRootText = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('release metadata accepts a matching prerelease tag and flag', () => {
  assert.doesNotThrow(() => verifyReleaseMetadata({
    version: '0.1.2-beta.1',
    releaseTag: 'v0.1.2-beta.1',
    releaseIsPrerelease: true,
  }));
});

test('release metadata accepts a matching stable release tag and flag', () => {
  assert.doesNotThrow(() => verifyReleaseMetadata({
    version: '0.1.1',
    releaseTag: 'v0.1.1',
    releaseIsPrerelease: false,
  }));
});

test('release metadata rejects tag mismatch and prerelease flag mismatch', () => {
  assert.throws(() => verifyReleaseMetadata({
    version: '0.1.2-beta.1',
    releaseTag: 'v0.1.2-beta.2',
    releaseIsPrerelease: true,
  }), /does not match package version/);
  assert.throws(() => verifyReleaseMetadata({
    version: '0.1.2-beta.1',
    releaseTag: 'v0.1.2-beta.1',
    releaseIsPrerelease: false,
  }), /prerelease status must match/);
});

test('release metadata requires event values when run as a script', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('../scripts/verify-release-metadata.js', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TAG: '', RELEASE_IS_PRERELEASE: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be provided/);
});

// --- 0.4.0 adaptation (adr_0002: the published artifact is built `dist/` output) ---

test('release metadata accepts the 0.4.0 stable tag this release ships, and still rejects 0.3.0', () => {
  assert.doesNotThrow(() => verifyReleaseMetadata({
    version: '0.4.0',
    releaseTag: 'v0.4.0',
    releaseIsPrerelease: false,
  }));
  assert.doesNotThrow(() => verifyReleaseMetadata({
    version: '0.4.0',
    releaseTag: '0.4.0',
    releaseIsPrerelease: false,
  }));
  assert.throws(() => verifyReleaseMetadata({
    version: '0.4.0',
    releaseTag: 'v0.3.0',
    releaseIsPrerelease: false,
  }), /does not match package version 0\.4\.0/);
  assert.throws(() => verifyReleaseMetadata({
    version: '0.4.0',
    releaseTag: 'v0.4.0',
    releaseIsPrerelease: true,
  }), /prerelease status must match/);
});

test('the shipped package.json is the version the release gate publishes', () => {
  const pkg = readRootJson('package.json');
  assert.equal(pkg.version, '0.4.0');
  assert.doesNotThrow(() => verifyReleaseMetadata({
    version: pkg.version,
    releaseTag: `v${pkg.version}`,
    releaseIsPrerelease: false,
  }));
});

test('publish surface accepts the dist-shaped package.json this repository ships', () => {
  const pkg = readRootJson('package.json');
  assert.doesNotThrow(() => verifyPublishSurface({ pkg, exists: () => true }));
  // The surface this gate protects: bin + exports + types all resolve under dist/.
  assert.deepEqual(Object.values(pkg.bin), ['dist/cli.js']);
  assert.equal(pkg.exports['.'].default, './dist/index.js');
  assert.equal(pkg.exports['.'].types, './dist/index.d.ts');
  assert.equal(pkg.types, './dist/index.d.ts');
  assert.ok(pkg.files.includes('dist/'));
});

test('publish surface rejects the 0.3.0 source-tree package shape', () => {
  const sourceTreePkg = {
    bin: { evofence: 'cli.js' },
    exports: { '.': { types: './src/index.d.ts', default: './src/index.js' } },
    types: './src/index.d.ts',
    files: ['src/', 'templates/', 'README.md'],
  };
  assert.throws(() => verifyPublishSurface({ pkg: sourceTreePkg, exists: () => true }), /bin evofence must point into dist\//);

  const distBinPkg = { ...sourceTreePkg, bin: { evofence: 'dist/cli.js' } };
  assert.throws(() => verifyPublishSurface({ pkg: distBinPkg, exists: () => true }), /exports\["\."\]\.types must point into dist\//);

  const distExportsPkg = { ...distBinPkg, exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } } };
  assert.throws(() => verifyPublishSurface({ pkg: distExportsPkg, exists: () => true }), /types must point into dist\//);

  const distTypesPkg = { ...distExportsPkg, types: './dist/index.d.ts' };
  assert.throws(() => verifyPublishSurface({ pkg: distTypesPkg, exists: () => true }), /files must include "dist\/"/);
});

test('publish surface fails closed when a promised dist artifact is missing', () => {
  const pkg = readRootJson('package.json');
  assert.throws(
    () => verifyPublishSurface({ pkg, exists: (target) => target !== 'dist/index.d.ts' }),
    /incomplete, missing: dist\/index\.d\.ts.*npm run build/s,
  );
  assert.throws(
    () => verifyPublishSurface({ pkg, exists: () => false }),
    /incomplete, missing: dist\/cli\.js, dist\/index\.d\.ts, dist\/index\.js/,
  );
  assert.throws(() => verifyPublishSurface({ pkg: { ...pkg, bin: {} }, exists: () => true }), /at least one command/);
});

// --- OIDC Trusted Publishing static gate (DoD 4) ---

const workflowFixture = ({ idToken = 'write', order = ['typecheck', 'build', 'test', 'publish'], publishTag = '--tag latest' } = {}) => {
  const runs = {
    typecheck: 'npm run typecheck',
    build: 'npm run build',
    test: 'npm test',
    publish: `npm publish ${publishTag}`.trim(),
  };
  return [
    'name: Publish to npm',
    'on:',
    '  release:',
    '    types: [published]',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  publish:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: read',
    `      id-token: ${idToken}`,
    '    steps:',
    '      - uses: actions/checkout@v6',
    '        with:',
    '          persist-credentials: false',
    '      - name: Install npm CLI with Trusted Publishing support',
    `        run: npm install --global npm@${REQUIRED_NPM_CLI}`,
    '      - name: Verify npm CLI version',
    `        run: test "$(npm --version)" = "${REQUIRED_NPM_CLI}"`,
    ...order.map((kind) => `      - name: ${kind}\n        run: ${runs[kind]}`),
  ].join('\n') + '\n';
};

test('the shipped publish workflow passes the OIDC Trusted Publishing gate', () => {
  const result = verifyPublishWorkflow(readRootText(PUBLISH_WORKFLOW_PATH));
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.steps >= 10);
});

test('the publish workflow gate rejects a workflow without id-token: write', () => {
  const result = verifyPublishWorkflow(workflowFixture({ idToken: 'none' }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /id-token: write/);
});

test('the publish workflow gate rejects a build that runs after the publish step', () => {
  const result = verifyPublishWorkflow(workflowFixture({ order: ['publish', 'typecheck', 'build', 'test'] }));
  assert.equal(result.ok, false);
  const errors = result.errors.join('\n');
  assert.match(errors, /`type-check` step must run before the first `npm publish` step/);
  assert.match(errors, /`build` step must run before the first `npm publish` step/);
  assert.match(errors, /`test` step must run before the first `npm publish` step/);
});

test('the publish workflow gate rejects an untagged publish and a missing npm CLI pin', () => {
  const untagged = verifyPublishWorkflow(workflowFixture({ publishTag: '' }));
  assert.equal(untagged.ok, false);
  assert.match(untagged.errors.join('\n'), /must pass an explicit `--tag`/);

  const noPin = workflowFixture().replace(/npm install --global npm@[\w.\-]+/, 'npm install --global npm');
  const result = verifyPublishWorkflow(noPin);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /must install the pinned npm CLI/);
});

test('the publish workflow gate reports invalid YAML instead of throwing a parse stack', () => {
  assert.throws(() => verifyPublishWorkflow('jobs: [\n'), /is not valid YAML/);
});
