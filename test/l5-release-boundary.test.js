import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseBoundary } from '../scripts/verify-release-metadata.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const documents = ['docs/evofence-harness-kernel/L5-RELEASE-CANDIDATE.md',
  'docs/evofence-harness-kernel/L5-RELEASE-CHECKLIST.md'];

// The 2026-10-03 user authorization for the v0.5.0 tag + GitHub Release, quoted verbatim from the
// checklist. A tag on HEAD is legal only while this record is present next to it.
const RELEASE_AUTHORIZATION_RECORD = '用户于 2026-10-03 明确授权创建 tag 与 GitHub Release';
const read = name => readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

test('cp3: tracked candidate and checklist preserve authorization and all inherited negative evidence', () => {
  for (const document of documents) assert.doesNotThrow(() => verifyReleaseBoundary(read(document)), document);
});

test('cp3 negative: unauthorized release claims fail in either tracked document', () => {
  for (const document of documents) {
    for (const claim of ['已 tag', '已 publish', '已 merge', '已发布', 'already published', 'has been merged', '收益达成']) {
      assert.throws(() => verifyReleaseBoundary(read(document) + '\n' + claim),
        /unauthorized|unsupported/, `${document}: ${claim}`);
    }
  }
});

test('cp3 negative: changing budget, benefit, failure or pending ADR facts is refused', () => {
  for (const document of documents) {
    for (const [from, to] of [['"inconclusive"', '"achieved"'], ['"failed"', '"passed"'],
      ['938.470100', '943.000000'], ['"adr_0004"', '"accepted_adr_0004"'], ['"unresolved"', '"resolved"']]) {
      assert.throws(() => verifyReleaseBoundary(read(document).replace(from, to)), /negative evidence changed/);
    }
  }
});

test('cp3: a tag on HEAD requires the recorded user authorization; tests and documents remain in non-ignored directories', () => {
  const tags = spawnSync('git', ['tag', '--points-at', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(tags.status, 0, tags.stderr);
  const onHead = tags.stdout.split('\n').map(line => line.trim()).filter(Boolean);
  // Same intent as before, now that one authorized release exists: tagging is a separate act that
  // must be authorized explicitly, never a side effect of merging. Before 2026-10-03 no release was
  // authorized, so "no tag at all" was the entire check; now a tag is legal only while it is
  // exactly the shipped version AND the checklist carries the user authorization that produced it.
  // An unauthorized tag still fails here, and the tag is never deleted to make this green.
  assert.ok(onHead.length <= 1, `HEAD must carry at most one tag, found: ${onHead.join(', ')}`);
  for (const tag of onHead) {
    assert.equal(tag, `v${JSON.parse(read('package.json')).version}`,
      'a tag on HEAD must be the shipped version');
  }
  if (onHead.length === 1) {
    assert.ok(read('docs/evofence-harness-kernel/L5-RELEASE-CHECKLIST.md')
      .includes(RELEASE_AUTHORIZATION_RECORD),
    'a tag on HEAD requires the recorded user release authorization in the checklist');
  }
  for (const document of documents) {
    assert.equal(document.includes('/execution/'), false);
    const ignored = spawnSync('git', ['check-ignore', '--', document], { cwd: root, encoding: 'utf8' });
    assert.equal(ignored.status, 1, `${document} must survive a clean checkout`);
  }
});
