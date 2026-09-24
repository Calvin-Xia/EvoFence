import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { verifyReleaseMetadata } from '../scripts/verify-release-metadata.js';

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
