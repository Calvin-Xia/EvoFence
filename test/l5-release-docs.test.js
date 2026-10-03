import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeCommand } from '../dist/lib/cli/commands.js';
import { parseCommandArgs } from '../dist/lib/cli/options.js';
import { verifyDocumentedEntrypoints } from '../scripts/verify-release-metadata.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const candidate = 'docs/evofence-harness-kernel/L5-RELEASE-CANDIDATE.md';
const documents = ['README.md', 'README.en.md', candidate];
function parseCli(argv) {
  if (argv.length === 1 && ['--help', '--version'].includes(argv[0])) return;
  const { spec, rest } = routeCommand(argv);
  parseCommandArgs(spec, rest);
}

test('cp2: both READMEs and tracked candidate match all exports and real CLI routing', () => {
  for (const document of documents) {
    const result = verifyDocumentedEntrypoints({ pkg, text: read(document), parseCli });
    assert.equal(result.exports, Object.keys(pkg.exports).length, document);
  }
});

test('cp2: built bin uses the documented source router and reports manifest help/version', () => {
  const source = read('src/cli.ts');
  assert.match(source, /renderHelp, routeCommand.*lib\/cli\/commands\.js/);
  assert.match(source, /parseCommandArgs.*lib\/cli\/options\.js/);
  for (const flag of ['--help', '--version']) {
    const result = spawnSync(process.execPath, [path.join(root, pkg.bin.evofence), flag], { encoding: 'utf8', cwd: root });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    if (flag === '--version') assert.equal(result.stdout.trim(), pkg.version);
    else assert.match(result.stdout, /evofence session view <export>/);
  }
});

test('cp2 negative: undocumented import, invented CLI command and metadata drift are refused', () => {
  for (const document of documents) {
    const text = read(document);
    assert.throws(() => verifyDocumentedEntrypoints({ pkg, text: text + "\nimport 'evofence/not-exported';\n", parseCli }),
      /undocumented package export/);
    assert.throws(() => verifyDocumentedEntrypoints({ pkg, text: text + '\nevofence invented-entry\n', parseCli }),
      /Unknown command/);
    assert.throws(() => verifyDocumentedEntrypoints({ pkg, text: text.replace('"dist/cli.js"', '"dist/missing.js"'), parseCli }),
      /disagree/);
  }
});

test('cp2: candidate links to real tracked sources, built targets, examples and validation entries', () => {
  const text = read(candidate);
  for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    // Local process-record citations are disclosed in prose; tests never read them.
    if (match[1].startsWith('execution/')) continue;
    assert.ok(existsSync(path.resolve(path.dirname(path.join(root, candidate)), match[1])), match[1]);
  }
  for (const command of ['npm run check', 'npm run test:e2e',
    'node verification/kernel/static-audit.mjs', 'node scripts/check-core-imports.mjs']) {
    assert.ok(text.includes(command), command);
  }
});

test('cp2: Unreleased breaking explanation retains legacy formats and independent new namespaces', () => {
  const changelog = read('CHANGELOG.md').split('## 0.4.2')[0];
  const legacy = read('src/storage/legacy/README.md');
  assert.match(changelog, /## Unreleased/);
  assert.match(changelog, /0\.5\.0/);
  assert.match(changelog, /Old ledger\/config\/old graph remain unchanged/);
  assert.match(changelog, /no in-place migration/);
  for (const namespace of ['evofence.runtime/1', 'evofence.assets/1',
    'evofence.legacy-export/1', 'evofence.legacy-source/1']) {
    assert.ok(changelog.includes(namespace));
    assert.ok(legacy.includes(namespace));
  }
  assert.ok(changelog.includes('src/storage/legacy/README.md'));
});
