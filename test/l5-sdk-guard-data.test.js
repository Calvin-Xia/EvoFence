import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(import.meta.url)('typescript6');

// The diagnostic guard's existing scalar-flow finding belongs in the delivery record (r2).
// These checks cover only the SDK lane's barrels and gate wiring; they never execute that guard.
test('cp1: SDK barrels contain only relative re-exports in the permitted domains', () => {
  for (const filename of ['src/kernel/index.ts', 'src/runtime/index.ts']) {
    const ast = ts.createSourceFile(filename, readFileSync(path.join(root, filename), 'utf8'), ts.ScriptTarget.Latest, true);
    assert.equal(ast.parseDiagnostics.length, 0);
    assert.ok(ast.statements.length > 0);
    for (const n of ast.statements) {
      assert.equal(ts.isExportDeclaration(n), true, 'barrel must not implement business logic');
      assert.match(n.moduleSpecifier.text, /^\.\.?\//);
      const target = path.resolve(root, path.dirname(filename), n.moduleSpecifier.text).replace(/\.js$/, '.ts');
      assert.match(path.relative(root, target).replaceAll('\\', '/'), /^src\/(protocol|kernel|runtime)\//);
    }
  }
});

test('cp1: the diagnostic core guard runs inside check and CI behind a shrink-only baseline', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  // Audit G25 replaced the old "deliberately excluded" contract: the 39 pre-existing I08
  // diagnostics are pinned in scripts/core-imports-baseline.json, a *new* diagnostic fails, and a
  // baseline entry that stopped occurring fails too. That is why the guard can be part of `check`
  // without pretending the backlog is clean.
  assert.match(pkg.scripts.check, /npm run check:core-imports/);
  assert.match(pkg.scripts['check:core-imports'], /check-core-imports-baseline\.mjs/);
  const baseline = JSON.parse(readFileSync(path.join(root, 'scripts/core-imports-baseline.json'), 'utf8'));
  assert.equal(baseline.diagnostics.length, 39, 'the recorded backlog is 39 diagnostics');
  assert.equal(new Set(baseline.diagnostics).size > 1, true);
  const directory = path.join(root, '.github/workflows');
  const ci = readFileSync(path.join(directory, 'ci.yml'), 'utf8');
  assert.match(ci, /npm run check:core-imports/, 'CI must execute the guard the gate now depends on');
});
