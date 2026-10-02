import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { config, evidence, hash, record, writeJson } from './io.mjs';
import { summarize } from './meter.mjs';

// Read completed native evidence; never dispatch or replay a provider invocation.
const journal = JSON.parse(fs.readFileSync(path.join(evidence, 'kernel-journal.json')));
const states = Object.fromEntries(journal.events.filter(e => e.type === 'node.transition').map(e => [e.payload.binding.nodeId, e.payload.after]));
assert.equal(states.finish, 'succeeded');
assert.equal(states.verify, 'failed', 'The real negative result must remain red in the journal');
assert.equal(states.repair, 'succeeded');
const trace = fs.readFileSync(path.join(evidence, 'trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const parent = trace.find(e => e.type === 'same-session-recovery').sessionId;
assert.equal(hash(fs.readFileSync(config.contract)), config.contractSha256);
const files = ['src/lib/cli/catalog.ts', 'src/lib/cli/handlers/context.ts', 'src/lib/cli/handlers/ledger.ts',
  'test/ledger-limit-scenario.test.js', 'docs/cli-limit-scenario.md'];
writeJson(path.join(evidence, 'artifact-hashes.json'), Object.fromEntries(files.map(f => [f, hash(fs.readFileSync(path.join(config.scratch, f)))])));
const cost = summarize();
writeJson(path.join(evidence, 'completion.json'), { cp1: 'passed', cp2: 'passed', cp3: 'pending-independent-audit',
  evidenceLevel: 'provider-live', parentSessionId: parent, nodeStates: states, contractSha256: config.contractSha256, cost });
record('finalized-without-model-replay', { nodeStates: states, cost });
process.stdout.write(JSON.stringify({ nodeStates: states, cost }) + '\n');
