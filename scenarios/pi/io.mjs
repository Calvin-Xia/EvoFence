import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const lane = fileURLToPath(new URL('../../', import.meta.url));
export const root = fileURLToPath(new URL('./', import.meta.url));
export const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json')));
export const attempt = process.argv.find(a => a.startsWith('--new-attempt='))?.split('=')[1] ?? '1';
assert(/^[1-9][0-9]*$/.test(attempt), 'decimal attempt identity required');
export const evidence = path.join(root, 'evidence', ...(attempt === '1' ? [] : [`attempt-${attempt}`]));
export const runtimeDir = path.join(root, 'runtime', ...(attempt === '1' ? [] : [`attempt-${attempt}`]));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = bytes => `sha256:${hash(bytes)}`;
export const value = r => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
export const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
export function init(resume = false) {
  for (const dir of [evidence, runtimeDir]) fs.mkdirSync(dir, { recursive: true });
  assert.equal(fs.existsSync(path.join(evidence, 'trace.jsonl')), resume, 'use --resume-after-recovery to continue the existing run; never overwrite evidence');
}
export function record(type, data = {}) {
  const event = { at: new Date().toISOString(), type, ...data };
  fs.appendFileSync(path.join(evidence, 'trace.jsonl'), JSON.stringify(event) + '\n');
  if (['stage', 'provider-dispatch', 'child-created', 'check', 'fatal'].includes(type)) {
    process.stdout.write(JSON.stringify(event) + '\n');
  }
  return event;
}
