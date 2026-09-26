import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertGitVersionAtLeast, commitCandidate, diffHash, gitVersionAtLeast, headSha, requireGitVersion } from '../src/lib/git.js';
import { EvoFenceError } from '../src/lib/errors.js';
import { runProcess } from '../src/lib/process.js';

test('diff hash includes an addition-only candidate and matches its committed generation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'evofence-diff-'));
  try {
    let result = await runProcess('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root, timeoutMs: 10000 });
    assert.equal(result.code, 0, result.stderr);
    for (const [key, value] of [['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid']]) {
      result = await runProcess('git', ['config', key, value], { cwd: root, timeoutMs: 10000 });
      assert.equal(result.code, 0, result.stderr);
    }
    await writeFile(path.join(root, 'baseline.txt'), 'baseline\n');
    result = await runProcess('git', ['add', '-A'], { cwd: root });
    assert.equal(result.code, 0, result.stderr);
    result = await runProcess('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: root });
    assert.equal(result.code, 0, result.stderr);
    const baseSha = await headSha(root);

    await writeFile(path.join(root, 'new-file.txt'), 'new file contents\n');
    const workingHash = await diffHash(root, baseSha);
    assert.notEqual(workingHash, createHash('sha256').update('').digest('hex'));
    const acceptedSha = await commitCandidate(root, baseSha, 'g-test');
    assert.equal(acceptedSha, await headSha(root));
    assert.equal(await diffHash(root, baseSha, acceptedSha), workingHash);
  } finally {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())));
    await rm(resolved, { recursive: true, force: true });
  }
});

test('git version parsing accepts 2.42+ and rejects older or unparseable versions', () => {
  assert.equal(gitVersionAtLeast('git version 2.42.0', 2, 42), true);
  assert.equal(gitVersionAtLeast('git version 2.53.0.windows.2', 2, 42), true);
  assert.equal(gitVersionAtLeast('git version 3.0.0', 2, 42), true);
  assert.equal(gitVersionAtLeast('git version 2.41.0.windows.1', 2, 42), false);
  assert.equal(gitVersionAtLeast('git version 2.42.0', 2, 43), false);
  assert.equal(gitVersionAtLeast('not a version string', 2, 42), false);
  assert.equal(gitVersionAtLeast('', 2, 42), false);
});

test('requireGitVersion rejects unsupported versions with GIT_VERSION_UNSUPPORTED', () => {
  assert.doesNotThrow(() => requireGitVersion('git version 2.42.0', 2, 42, 'attribute-pinned audit diffs'));
  assert.throws(() => requireGitVersion('git version 2.41.0.windows.1', 2, 42, 'attribute-pinned audit diffs'), (error) => {
    assert.ok(error instanceof EvoFenceError, 'error must be an EvoFenceError');
    assert.equal(error.code, 'GIT_VERSION_UNSUPPORTED');
    assert.match(error.message, /Git 2\.42 or newer is required for attribute-pinned audit diffs/);
    assert.match(error.message, /2\.41\.0/);
    return true;
  });
});

test('assertGitVersionAtLeast probes the installed git', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'evofence-gitver-'));
  try {
    await assert.doesNotReject(() => assertGitVersionAtLeast(root, 2, 42, 'attribute-pinned audit diffs'));
    await assert.rejects(() => assertGitVersionAtLeast(root, 99, 0, 'a hypothetical future feature'), (error) => {
      assert.equal(error.code, 'GIT_VERSION_UNSUPPORTED');
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
