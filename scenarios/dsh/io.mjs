import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('./', import.meta.url));
export const lane = fileURLToPath(new URL('../../', import.meta.url));
export const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json')));
const replayOption = process.argv.find(arg => arg.startsWith('--evidence-run='));
const replayName = replayOption?.slice('--evidence-run='.length);
if (replayName !== undefined) assert(/^[a-zA-Z0-9_-]+$/.test(replayName), 'Finite replay directory name required');
export const evidence = path.join(root, 'evidence', ...(replayName === undefined ? [] : ['replays', replayName]));
export const runtimeDir = path.join(root, 'runtime', ...(replayName === undefined ? [] : ['replays', replayName]));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = bytes => `sha256:${hash(bytes)}`;
export const value = r => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
export const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
export function record(type, data = {}) {
  const row = { at: new Date().toISOString(), type, ...data };
  fs.appendFileSync(path.join(evidence, 'trace.jsonl'), JSON.stringify(row) + '\n');
  if (['stage', 'provider-dispatch', 'child-created', 'check', 'fatal', 'conflict-resolved'].includes(type)) process.stdout.write(JSON.stringify(row) + '\n');
  return row;
}
