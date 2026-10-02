import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { config, lane, root } from './io.mjs';

assert(!fs.existsSync(config.scratch), 'existing scratch preserved; choose an unused scratch path in config.json');
const parent = path.resolve(config.scratch, '..');
assert.equal(parent.toLowerCase(), path.resolve(lane, '..').toLowerCase(), 'scratch must be a sibling outside lane worktrees');
const run = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
};
run(['clone', '--local', '--no-hardlinks', config.integration, config.scratch], root);
run(['checkout', '--detach', config.baseline], config.scratch);
fs.symlinkSync(path.join(config.integration, 'node_modules'), path.join(config.scratch, 'node_modules'), 'junction');
process.stdout.write(`Prepared local scratch at ${config.scratch}; baseline ${config.baseline}; no network or install.\n`);
