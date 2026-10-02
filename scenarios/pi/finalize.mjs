import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { config, root, evidence, hash, writeJson } from './io.mjs';

const read = file => JSON.parse(fs.readFileSync(path.join(evidence, file)));
const audit = read('audit.json'); assert.equal(audit.cp3, 'passed');
const budgetFile = path.join(root, 'MODEL-BUDGET.json'), budget = JSON.parse(fs.readFileSync(budgetFile));
const rows = budget.requests.filter(r => r.scenario === 'l3-pi-scenario');
const byRole = {};
for (const r of rows) {
  const totals = byRole[r.role] ??= { requests: 0, tokens: 0, referenceUsd: 0 };
  totals.requests++; totals.tokens += r.usage.total_tokens; totals.referenceUsd += r.referenceUsd;
}
const summary = { ...audit.totals, byRole,
  providerSpanMs: Math.max(...rows.map(r => Date.parse(r.finishedAt))) - Math.min(...rows.map(r => Date.parse(r.dispatchedAt))),
  codexSubscriptionUsage: 'unknown: no per-request subscription token/cost telemetry available to this lane',
  providerSpanMeaning: 'first provider dispatch to final settlement, including driver repair/idle; not compute time' };
writeJson(path.join(evidence, 'cost-summary.json'), summary);
budget.scenarioTotals = summary;
const run = budget.scenarioRuns.find(r => r.id === 'l3-pi-scenario');
run.status = 'complete'; run.completedAt = rows.at(-1).finishedAt;
run.referenceUsd = audit.totals.referenceUsd; run.requests = rows.length; run.unknownRequests = audit.totals.unknownRequests;
writeJson(budgetFile, budget);
const original = read('result.json');
if (!fs.existsSync(path.join(evidence, 'result-main.json'))) writeJson(path.join(evidence, 'result-main.json'), original);
writeJson(path.join(evidence, 'result.json'), { ...original, cp3: 'passed', requests: summary.requests,
  tokens: summary.tokens, referenceUsd: summary.referenceUsd, independentAuditRef: 'audit.json',
  qualityRepairRef: 'quality-repair.json', finalArtifactRef: 'artifact-hashes.json', costsRef: 'cost-summary.json' });
const trace = fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const raw = [read('abort.json').file, ...trace.filter(e => e.type === 'child-created').map(e => e.file)];
const collect = (directory, prefix = '') => fs.readdirSync(directory).flatMap(name => {
  const file = path.join(directory, name), relative = prefix + name;
  if (fs.statSync(file).isDirectory()) return collect(file, relative + '/');
  return relative === 'index.json' ? [] : [{ file: relative, sha256: hash(fs.readFileSync(file)) }];
});
writeJson(path.join(evidence, 'index.json'), { lane: 'l3-pi-scenario', generatedAt: new Date().toISOString(),
  artifacts: collect(evidence), rawNativeSessions: raw.map(file => ({ file, sha256: hash(fs.readFileSync(file)) })),
  cumulativeBudget: { file: budgetFile, sha256: hash(fs.readFileSync(budgetFile)) },
  sourceHashes: fs.readdirSync(root).filter(f => /\.(mjs|json|md)$/.test(f) && f !== 'MODEL-BUDGET.json')
    .map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
  frozenContract: { file: config.contract, sha256: hash(fs.readFileSync(config.contract)) } });
process.stdout.write(JSON.stringify({ finalized: true, requests: summary.requests, tokens: summary.tokens, referenceUsd: summary.referenceUsd }) + '\n');
