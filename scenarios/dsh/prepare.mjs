import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { config, lane, root, evidence, hash, writeJson } from './io.mjs';

assert(!fs.existsSync(config.scratch), 'Existing scratch must be preserved. Choose an unused path explicitly.');
assert.equal(path.resolve(config.scratch, '..').toLowerCase(), path.resolve(lane, '..').toLowerCase());
assert.equal(hash(fs.readFileSync(config.contract)), config.contractSha256, 'Frozen contract changed');
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
assert.equal(git(['status', '--porcelain'], config.integration), '', 'Integration must be clean');
git(['clone', '--local', '--no-hardlinks', config.integration, config.scratch], root);
git(['checkout', '--detach', config.baseline], config.scratch);
fs.symlinkSync(path.join(config.integration, 'node_modules'), path.join(config.scratch, 'node_modules'), 'junction');
fs.mkdirSync(evidence, { recursive: true });
writeJson(path.join(evidence, 'preflight.json'), {
  checkpoint: 'cp1', status: 'passed', lane: 'l3-dsh-scenario', baseline: config.baseline,
  contractPath: config.contract, contractSha256: config.contractSha256,
  authorization: 'L3-dsh-scenario-brief + FROZEN v1; scratch local clone, bounded ledger show --limit task',
  provider: config.provider, model: config.model, thinking: config.thinking, dollarHardCap: null,
  accounting: 'Append every actual HTTP request including failures; reference cost is not invoice',
  taskNetwork: 'none; configured model API only', nativeVersion: config.dshVersion,
  integrationStatus: 'clean', clone: '--local --no-hardlinks', nodeModules: 'junction',
  laneCommit: false, coreMutation: false, contractMutation: false
});
console.log(JSON.stringify({ cp1: 'passed', scratch: config.scratch, baseline: config.baseline }));
