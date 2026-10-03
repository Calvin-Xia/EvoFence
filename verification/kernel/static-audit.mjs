// Read-only AST facts. The allowlist is read from the frozen contract, never widened here.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript6');
const root = fileURLToPath(new URL('../../', import.meta.url));
const relative = p => path.relative(root, p).replaceAll('\\', '/');
function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? filesAt(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []).sort();
}
export function audit() {
  const ownership = readFileSync(path.join(root, 'docs/evofence-harness-kernel/spec/contracts/OWNERSHIP.md'), 'utf8');
  const frozen = JSON.parse(ownership.match(/```json\s*([\s\S]*?)```/)[1]);
  const files = ['protocol', 'kernel', 'runtime'].flatMap(n => filesAt(path.join(root, 'src', n)));
  const edges = [], calls = [], violations = [], imports = new Map();
  const forbiddenFunctions = new Set(['stateFromDecision', 'matchingOutgoing', 'evaluatePredicate', 'checkEnvelope', 'grantLease', 'claimNode']);
  for (const file of files) {
    const text = readFileSync(file, 'utf8'), id = relative(file);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const sourceOwner = id.split('/')[1], bindings = new Map();
    const location = n => ({ file: id, line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1 });
    function visit(n) {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
        const specifier = n.moduleSpecifier.text;
        if (!specifier.startsWith('.')) violations.push({ rule: 'I02', ...location(n), specifier });
        else {
          const target = path.resolve(path.dirname(file), specifier).replace(/\.js$/, '.ts');
          assert.ok(existsSync(target), `unresolved import ${id} -> ${specifier}`);
          const resolved = relative(realpathSync(target)), owner = resolved.split('/')[1];
          const edge = { ...location(n), target: resolved, typeOnly: Boolean(n.importClause?.isTypeOnly || n.isTypeOnly) };
          edges.push(edge);
          if (!frozen.allowedEdges[sourceOwner].includes(owner)) violations.push({ rule: 'I01', ...edge,
            reason: `${sourceOwner} may import only ${frozen.allowedEdges[sourceOwner].join('/')}` });
          if (ts.isImportDeclaration(n) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
            for (const item of n.importClause.namedBindings.elements) bindings.set(item.name.text,
              { exported: item.propertyName?.text ?? item.name.text, target: resolved, typeOnly: Boolean(n.importClause.isTypeOnly || item.isTypeOnly) });
          }
        }
      }
      if (ts.isCallExpression(n)) {
        const expression = n.expression;
        if (ts.isIdentifier(expression) && bindings.has(expression.text)) {
          const imported = bindings.get(expression.text);
          calls.push({ ...location(n), local: expression.text, ...imported });
          if (id.startsWith('src/runtime/session/') && forbiddenFunctions.has(imported.exported)) {
            violations.push({ rule: 'single-decision', ...location(n), function: imported.exported });
          }
        }
        if (expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(expression) && ['require', 'eval', 'Function'].includes(expression.text))) {
          violations.push({ rule: 'I03', ...location(n), expression: expression.getText(ast) });
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(ast);
    imports.set(id, [...bindings]);
    if (id.startsWith('src/runtime/session/') && /NOT\s+WIRED/i.test(text)) violations.push({ rule: 'NOT-WIRED', file: id });
  }
  const expected = [
    ['src/runtime/session/plans.ts', 'decide', 'src/kernel/policy/index.ts'],
    ['src/runtime/session/plans.ts', 'computeFrontier', 'src/kernel/scheduler/index.ts'],
    ['src/runtime/session/plans.ts', 'dispatchRound', 'src/kernel/scheduler/index.ts'],
    ['src/runtime/session/evaluation.ts', 'decide', 'src/kernel/graph/index.ts'],
    ['src/runtime/session/dispatch.ts', 'planRound', 'src/runtime/session/plans.ts'],
    ['src/runtime/session/service.ts', 'project', 'src/runtime/session/project.ts'],
    ['src/runtime/session/project.ts', 'reserve', 'src/kernel/policy/index.ts'],
    ['src/runtime/session/project.ts', 'settle', 'src/kernel/policy/index.ts'],
    ['src/kernel/scheduler/frontier.ts', 'evaluateReadiness', 'src/kernel/graph/index.ts'],
    ['src/kernel/graph/readiness.ts', 'decide', 'src/kernel/graph/decide.ts'],
  ];
  const entrypoints = expected.map(([file, exported, target]) => {
    const matches = calls.filter(c => c.file === file && c.exported === exported && c.target === target);
    assert.ok(matches.length > 0, `NOT WIRED: ${file} -> ${target}.${exported}`);
    return { file, exported, target, callLines: matches.map(c => c.line) };
  });
  const sessionText = name => readFileSync(path.join(root, `src/runtime/session/${name}.ts`), 'utf8');
  for (const [name, expression] of [['evaluation', /ports\.evaluator\.evaluateTask\(/], ['plans', /export function factsFor\(/],
    ['evaluation', /judged\.nodeState/], ['dispatch', /ports\.host\.execute\(authorized\.value\)/]]) {
    assert.match(sessionText(name), expression);
  }
  // The transitive evidence is independent of whether a backend is ever constructed.
  const storageBarrel = readFileSync(path.join(root, 'src/storage/index.ts'), 'utf8');
  const concreteBackends = [...storageBarrel.matchAll(/from ['"](.+memory[^'"]+)['"]/g)].map(m => m[1]);
  const constructionSites = calls.filter(c => c.file.startsWith('src/runtime/session/') && /^createMemory/.test(c.exported));
  assert.equal(constructionSites.length, 0);
  return { checkpoint: 'cp3', status: violations.length === 0 ? 'passed' : 'failed', parser: `typescript6 ${ts.version}`,
    ruleSource: 'docs/evofence-harness-kernel/spec/contracts/OWNERSHIP.md I01 + L1-REPLAN-DECISION.md R1',
    frozenAllowedEdges: frozen.allowedEdges, moduleCount: files.length, edgeCount: edges.length, entrypoints,
    factsEntry: 'runtime/session/plans.factsFor consumes journal-derived current attempts, applied receipts, resource holders',
    secondDecisionCalls: calls.filter(c => c.file.startsWith('src/runtime/session/') && forbiddenFunctions.has(c.exported)),
    concreteBackendsViaStorageBarrel: concreteBackends, backendConstructionSitesInApplication: constructionSites,
    violations, edges, calls,
    limitations: ['I04/I05 are not formally proved', 'evofence/core package export is not yet present',
      'dependency-cycle gate does not enforce frozen domain boundaries', 'passive imports still violate I01 even without construction'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = audit();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}
