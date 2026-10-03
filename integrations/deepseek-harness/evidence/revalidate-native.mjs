// Re-execute the existing pinned probe with only its output writer redirected into this lane.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const probe = path.join(root, 'scripts/probes/dsh-native-probe.mjs');
const support = path.join(root, 'scripts/probes/dsh-probe-support.mjs');
const output = path.join(root, '.evofence/out/dsh-evidence/native-revalidation');
const original = fs.readFileSync(probe, 'utf8');
const imported = original.replace(' writeJson,', ' writeJson as historicalWriteJson,')
  .replace('root, outputRoot,', 'root, outputRoot as historicalOutputRoot,')
  .replace("'./dsh-probe-support.mjs'", JSON.stringify(pathToFileURL(support).href));
if (imported === original || imported.includes("'./dsh-probe-support.mjs'")) throw new Error('probe redirection did not match');
fs.mkdirSync(output, { recursive: true });
const writer = `
import fsLane from 'node:fs';
const outputRoot = ${JSON.stringify(output)};
function writeJson(name, value) {
  if (!['VERSION-PIN.json','HOST-MANIFEST.json','offline-trace.json','live-trace.json'].includes(name)) throw new Error('unexpected probe output');
  fsLane.writeFileSync(${JSON.stringify(output)} + '/' + name, JSON.stringify(value, null, 2) + '\\n');
}
`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(output, 'provenance.json'), JSON.stringify({
  probe: 'scripts/probes/dsh-native-probe.mjs', probeSha256: hash(original),
  support: 'scripts/probes/dsh-probe-support.mjs', supportSha256: hash(fs.readFileSync(support)),
  changes: ['import uses absolute file URL', 'only writeJson output path redirected', 'printed outputRoot follows the redirected writer'],
  evidenceLevel: 'native-fixture', providerLive: false,
}, null, 2) + '\n');
await import('data:text/javascript;base64,' + Buffer.from(writer + imported).toString('base64'));
