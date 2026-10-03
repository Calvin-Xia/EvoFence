import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript6';

test('cp3 bridge module graph contains no process CLI or new bare dependencies', () => {
  // A copy is used only by the mutation harness; normal checks audit the actual build.
  const root = process.env.EFK_SP_AUDIT_COPY || fileURLToPath(new URL('../dist/bridges/super-plumber', import.meta.url));
  const files = readdirSync(root).filter(x => x.endsWith('.js'));
  assert.deepEqual(files.sort(), ['export.js', 'import.js', 'index.js', 'loss.js', 'mapping.js', 'types.js']);
  const violations = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier.text;
        if (!['node:buffer', 'node:fs', 'node:path', 'yaml'].includes(specifier) &&
          !/^\.\/[^/]+\.js$/.test(specifier) && !/^\.\.\/\.\.\/(protocol|kernel)\/(index|graph\/index)\.js$/.test(specifier)) violations.push(file + ':' + specifier);
      }
      if (ts.isIdentifier(node) && /^(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork|require|eval|Function)$/.test(node.text)) violations.push(file + ':' + node.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) violations.push(file + ':dynamic-import');
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, [], 'bridge introduced an execution or dependency path');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(!Object.keys(pkg.exports).some(key => /bridge|plumber/.test(key)));
  for (const entry of ['protocol', 'kernel', 'runtime']) {
    const source = readFileSync(new URL(`../src/${entry}/index.ts`, import.meta.url), 'utf8');
    assert.ok(!/bridge|plumber/.test(source), 'bridge entered core barrel');
  }
});
