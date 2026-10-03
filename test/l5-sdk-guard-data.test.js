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

test('cp1: diagnostic core guard is excluded from check and CI', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.check, 'npm run typecheck && npm run src:policy && npm run dep:check && npm test');
  const directory = path.join(root, '.github/workflows');
  for (const name of readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
    assert.doesNotMatch(readFileSync(path.join(directory, name), 'utf8'), /check:core-imports|check-core-imports\.mjs/);
  }
});
