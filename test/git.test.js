import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { commitCandidate, diffHash, headSha } from '../src/lib/git.js';
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
