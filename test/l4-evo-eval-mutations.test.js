// Real production-module mutations in a subprocess loader. On-disk source/dist remain intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const controls = [
  { id: 'budget-bypass', module: 'judgement.js', from: 'if (!registered.budgetAuthorized)', to: 'if (false)', pattern: 'DoD1 budget-missing' },
  { id: 'sample-bypass', module: 'judgement.js', from: "if (look !== 'CONFIRMATORY_LOOK' || stats.n < p.plannedN)", to: 'if (false)', pattern: 'DoD1 insufficient-samples' },
  { id: 'selection-bias', module: 'service.js', from: "judgements.every(j => j.verdict === 'positive'", to: "judgements.some(j => j.verdict === 'positive'", pattern: 'cp3 selection-bias negative control' },
  { id: 'leakage-bypass', module: 'observations.js', from: "if (access.value !== 'none')", to: 'if (false)', pattern: 'cp3 leakage negative control' },
  { id: 'usage-as-zero', module: 'observations.js', from: 'const known = usage.value.knownMicros;', to: 'const known = 0;', pattern: 'cp3 usage negative control' },
  { id: 'forged-authority', module: 'service.js', from: 'const proof = ports.authority.verify(ref);', to: 'const proof = storeOk(true);', pattern: 'DoD2 authority negative control' },
  { id: 'task-as-evolution', module: 'service.js', from: "evaluation.decision.kind !== 'candidate'", to: 'false', pattern: 'DoD2 task-verdict negative control' },
];
const results = [];
const directory = new URL('../src/evaluation/evolution/evidence/', import.meta.url);
test('mutation evidence: production guards turn red under mutation and green after restoration', async t => {
  mkdirSync(directory, { recursive: true });
  for (const control of controls) await t.test(control.id, () => {
    const url = new URL(`../dist/evaluation/evolution/${control.module}`, import.meta.url).href;
    const original = readFileSync(new URL(url), 'utf8');
    assert.equal(original.split(control.from).length - 1, 1, 'mutation must hit exactly one real production guard');
    const hook = `let rule; export function initialize(data){rule=data;} export async function load(url,ctx,next){const r=await next(url,ctx); if(url===rule.url){const s=String(r.source); if(!s.includes(rule.from))throw Error('mutation missed'); return {...r,source:s.replace(rule.from,rule.to)};} return r;}`;
    const hookUrl = `data:text/javascript,${encodeURIComponent(hook)}`;
    const bootstrap = `import {register} from 'node:module'; register(${JSON.stringify(hookUrl)},{data:${JSON.stringify({ url, from: control.from, to: control.to })}});`;
    function execute(mutated) {
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      return spawnSync(process.execPath, [...(mutated ? [`--import=data:text/javascript,${encodeURIComponent(bootstrap)}`] : []),
        '--test', `--test-name-pattern=${control.pattern}`, 'test/l4-evo-eval-guards.test.js'], { encoding: 'utf8', timeout: 30000, env });
    }
    const green = execute(false), red = execute(true), restored = execute(false);
    for (const [phase, output] of [['green', green], ['red', red], ['restored', restored]]) {
      assert.equal(output.error, undefined);
      writeFileSync(new URL(`${control.id}.${phase}.txt`, directory), `${output.stdout}\n${output.stderr}`);
    }
    assert.equal(green.status, 0, green.stdout + green.stderr); assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout + red.stderr, /AssertionError|ERR_ASSERTION/); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    const after = readFileSync(new URL(url), 'utf8'); assert.equal(after, original);
    results.push({ ...control, green: green.status, red: red.status, restored: restored.status,
      productionModuleSha256: createHash('sha256').update(after).digest('hex'), diskUnchanged: true });
  });
  writeFileSync(new URL('mutations.json', directory), `${JSON.stringify({ evidenceKind: 'production-module-mutation', controls: results }, null, 2)}\n`);
});
