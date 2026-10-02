# Writes native protocol verification evidence to the ignored .work directory, including on failure.
# Product src/dist/config and tracked evidence stay read-only.
$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '../..'))
try {
@'
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const here = path.join(repo, 'test/protocol-guard');
const workspace = path.join(here, '.work');
mkdirSync(workspace, { recursive: true });
const area = mkdtempSync(path.join(workspace, 'native-'));
const require = createRequire(import.meta.url);
const packageFile = require.resolve('typescript/package.json');
const native = JSON.parse(readFileSync(packageFile, 'utf8'));
const compiler = path.resolve(path.dirname(packageFile), native.bin.tsc);
const records = [new Date().toISOString(), 'Node ' + process.version, 'native compiler ' + native.version];

try {
  // Build a copy inside the authorized test directory; product src/dist stay read-only.
  cpSync(path.join(repo, 'src/protocol'), path.join(area, 'source/protocol'), { recursive: true });
  const config = {
    extends: path.join(repo, 'tsconfig.json'),
    compilerOptions: { rootDir: './source', outDir: './built' },
    include: ['./source/**/*.ts'],
  };
  const project = path.join(area, 'tsconfig.json');
  writeFileSync(project, JSON.stringify(config));
  const compile = spawnSync(process.execPath, [compiler, '--project', project], {
    cwd: repo, encoding: 'utf8', timeout: 30000,
  });
  if (compile.error) throw compile.error;
  records.push('isolated native protocol build exit=' + compile.status, compile.stdout, compile.stderr);
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);

  const args = [
    'scripts/check-core-imports.mjs', '--root', 'protocol=src/protocol', '--project', 'tsconfig.json',
    '--built', 'protocol=' + path.join(area, 'built/protocol'),
  ];
  const result = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', timeout: 20000 });
  if (result.error) throw result.error;
  records.push('command: node ' + args.join(' '), 'guard exit=' + result.status, result.stdout, result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  // Negative fixtures are owned here; live kernel/runtime may be added by other lanes.
  const empty = path.join(area, 'empty');
  mkdirSync(empty);
  for (const [name, root, diagnostic] of [
    ['missing-root', path.join(area, 'missing'), /ENOENT/],
    ['empty-root', empty, /\[I01\/ENTRY_REQUIRED\]/],
  ]) {
    const negativeArgs = ['scripts/check-core-imports.mjs', '--root', 'protocol=' + root];
    const negative = spawnSync(process.execPath, negativeArgs, { cwd: repo, encoding: 'utf8' });
    if (negative.error) throw negative.error;
    records.push('command: node ' + negativeArgs.join(' '), name + ' exit=' + negative.status, negative.stdout, negative.stderr);
    assert.equal(negative.status, 1);
    assert.match(negative.stderr, diagnostic);
  }
} finally {
  writeFileSync(path.join(workspace, 'EVIDENCE-PROTOCOL.txt'), records.join('\n'));
  // Remove only this invocation's directory, after checking its resolved parent.
  const realArea = realpathSync(area);
  assert.equal(path.dirname(realArea), realpathSync(workspace));
  rmSync(realArea, { recursive: true });
}
console.log(records.join('\n'));
'@ | node --input-type=module
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
