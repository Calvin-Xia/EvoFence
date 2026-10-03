import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Explicitly invoked audit, never mutates sources during ordinary node --test discovery. */
export function runNegativeControls() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const controls = [
    { dod: 'DoD1', file: 'conditions.ts', from: "reasons.push('host-changed')", to: 'void 0',
      test: 'l4-revocation-conditions.test.js', pattern: 'DoD1 host version' },
    { dod: 'DoD1', file: 'conditions.ts', from: "reasons.push(`quality-below:${metric}`)", to: 'void 0',
      test: 'l4-revocation-conditions.test.js', pattern: 'cp1 quality threshold stops use' },
    { dod: 'DoD2', file: 'conditions.ts', from: 'return affected;', to: 'return [root];',
      test: 'l4-revocation-propagation.test.js', pattern: 'DoD2 propagates through staged derivatives' },
    { dod: 'DoD2', file: 'plan.ts', from: 'if (q.value.eligible) target = candidate;', to: 'target = candidate;',
      test: 'l4-revocation-propagation.test.js', pattern: 'DoD2 propagates through staged derivatives' },
    { dod: 'feedback', file: 'signals.ts', from: "!['dev', 'not-evaluation'].includes(ref.partition)",
      to: "!['dev', 'not-evaluation', 'final'].includes(ref.partition)",
      test: 'l4-revocation-privacy.test.js', pattern: 'feedback boundary rejects final before signal reads' },
  ];
  const evidence = [];
  const run = args => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  for (const control of controls) {
    const source = new URL(`../src/evaluation/revocation/${control.file}`, import.meta.url);
    const before = readFileSync(source), text = before.toString('utf8');
    assert.equal(text.split(control.from).length, 2, `mutation target must occur exactly once: ${control.from}`);
    const testArgs = ['--test', `--test-name-pattern=${control.pattern}`, `test/${control.test}`];
    const baseline = run(testArgs); assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    let mutationBuild, red;
    try {
      writeFileSync(source, text.replace(control.from, control.to));
      mutationBuild = run(['node_modules/typescript/bin/tsc']);
      assert.equal(mutationBuild.status, 0, mutationBuild.stdout + mutationBuild.stderr);
      red = run(testArgs); assert.equal(red.status, 1, red.stdout + red.stderr);
      assert.match(red.stdout + red.stderr, /AssertionError|TypeError/);
    } finally {
      writeFileSync(source, before);
      assert.equal(readFileSync(source).equals(before), true, 'source must be restored byte for byte');
      assert.equal(digest(readFileSync(source)), digest(before), 'source must be restored byte for byte');
      const rebuilt = run(['node_modules/typescript/bin/tsc']);
      assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    }
    const green = run(testArgs); assert.equal(green.status, 0, green.stdout + green.stderr);
    evidence.push({ dod: control.dod, file: control.file, pattern: control.pattern,
      baselineExit: baseline.status, mutationBuildExit: mutationBuild.status, redExit: red.status, restoredExit: green.status,
      sha256Before: digest(before), sha256After: digest(readFileSync(source)) });
  }
  return evidence;
}
