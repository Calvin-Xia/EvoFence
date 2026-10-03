import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const documentPath = path.join(root, 'docs/evofence-harness-kernel/execution/L5-SDK-DELIVERY-AND-EXAMPLES.md');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const ts = createRequire(import.meta.url)('typescript6');
const doc = () => readFileSync(documentPath, 'utf8');
export function exampleSource() {
  const matches = [...doc().matchAll(/```js sdk-example\n([\s\S]*?)```/g)];
  assert.equal(matches.length, 1, 'exactly one executable example');
  return matches[0][1];
}
export function checkDocument(text) {
  const rows = [...text.matchAll(/^\| `([^`]+)` \| `([^`]+)` \| (.+) \|$/gm)];
  assert.deepEqual(rows.map(m => m[1]).sort(), Object.keys(pkg.exports).sort());
  for (const [, subpath, statement] of rows) {
    const ast = ts.createSourceFile('sdk-import.js', statement, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0);
    const declaration = ast.statements[0];
    assert.equal(ts.isImportDeclaration(declaration), true);
    const expected = subpath === '.' ? pkg.name : pkg.name + subpath.slice(1);
    assert.equal(declaration.moduleSpecifier.text, expected);
    assert.equal(import.meta.resolve(expected), pathToFileURL(path.join(root, pkg.exports[subpath].default)).href);
    assert.ok(readFileSync(path.join(root, pkg.exports[subpath].types), 'utf8').length > 0);
  }
  const snippet = text.match(/```js sdk-example\n([\s\S]*?)```/)[1];
  const ast = ts.createSourceFile('example.js', snippet, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const n of ast.statements.filter(ts.isImportDeclaration)) {
    const specifier = n.moduleSpecifier.text;
    if (specifier.startsWith(pkg.name)) {
      const subpath = specifier === pkg.name ? '.' : '.' + specifier.slice(pkg.name.length);
      assert.ok(Object.hasOwn(pkg.exports, subpath), `undocumented export: ${specifier}`);
    }
  }
}
export function runExample(host) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'evofence-l5-sdk-'));
  try {
    assert.deepEqual(readdirSync(cwd), []);
    // Resolve documented public imports in the package; execute the unchanged code in empty cwd.
    const shim = `import { register, syncBuiltinESMExports } from 'node:module';
      import childProcess from 'node:child_process';
      globalThis.sdkProcessCalls = 0;
      for (const method of ['exec', 'execFile', 'spawn', 'fork', 'execSync', 'execFileSync', 'spawnSync']) {
        childProcess[method] = () => { globalThis.sdkProcessCalls++; throw new Error('CLI/subprocess called'); };
      }
      syncBuiltinESMExports();
      process.on('exit', () => {
        if (globalThis.sdkProcessCalls !== 0) process.exitCode = 1;
      });
      register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(`
      const entries = ${JSON.stringify(Object.fromEntries(Object.entries(pkg.exports).map(([k, v]) =>
        [k === '.' ? pkg.name : pkg.name + k.slice(1), pathToFileURL(path.join(root, v.default)).href])))};
      export function resolve(s, c, next) {
        return Object.hasOwn(entries, s) ? { url: entries[s], shortCircuit: true } : next(s, c);
      }`))}, import.meta.url);\n`;
    const preload = 'data:text/javascript,' + encodeURIComponent(shim);
    const child = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', exampleSource()], {
      cwd, env: { ...process.env, PATH: cwd, SDK_HOST: host }, encoding: 'utf8', timeout: 20000,
    });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    assert.deepEqual(readdirSync(cwd), [], 'no Git, policy directory or other files created');
    return JSON.parse(child.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('cp1: built core has only relative protocol/kernel/runtime imports', () => {
  const entries = [pkg.exports['./core'].default, pkg.exports['./kernel'].default];
  const seen = new Set();
  function visit(filename) {
    if (seen.has(filename)) return;
    seen.add(filename);
    assert.match(path.relative(root, filename).replaceAll('\\', '/'), /^dist\/(protocol|kernel|runtime)\//);
    const ast = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    function scan(n) {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
        const specifier = n.moduleSpecifier.text;
        assert.match(specifier, /^\.\.?\//, `external dependency: ${specifier}`);
        visit(path.resolve(path.dirname(filename), specifier));
      }
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) assert.fail('dynamic core import');
      ts.forEachChild(n, scan);
    }
    scan(ast);
  }
  entries.forEach(entry => visit(path.join(root, entry)));
  assert.ok(seen.size > 2);
});

test('cp1/cp2: public core import leaves SQLite out of the module graph and cache; construction calls no port', t => {
  const loader = 'data:text/javascript,' + encodeURIComponent(`
    const loaded = [];
    export function initialize({port}) {
      port.on('message', () => port.postMessage(loaded));
    }
    export async function load(url, context, next) {
      const result = await next(url, context);
      loaded.push(url);
      return result;
    }`);
  const source = `import assert from 'node:assert/strict';
    import { createRequire, register } from 'node:module';
    import { MessageChannel } from 'node:worker_threads';
    const require = createRequire(import.meta.url);
    const sqliteCache = () => Object.keys(require.cache).filter(p => p.replaceAll(String.fromCharCode(92), '/').includes('/better-sqlite3/'));
    assert.deepEqual(sqliteCache(), [], 'fresh subprocess must not have SQLite cached');
    const {port1, port2} = new MessageChannel();
    register(${JSON.stringify(loader)}, {parentURL:import.meta.url,data:{port:port2},transferList:[port2]});
    let nativeLoads = 0;
    process.dlopen = () => { nativeLoads++; throw new Error('native addon loaded'); };
    const { createSessionService } = await import('evofence/core');
    assert.deepEqual(sqliteCache(), [], 'SQLite package entered require.cache');
    let calls = 0;
    const spy = () => new Proxy(function () {}, {
      get: (_t, k) => k === 'then' ? undefined : spy(),
      apply: () => { calls++; throw new Error('port called'); },
      construct: () => { calls++; throw new Error('port constructed'); }
    });
    const ports = new Proxy({}, { get: () => spy() });
    const service = createSessionService(ports);
    assert.equal(typeof service.step, 'function');
    assert.equal(calls, 0, 'factory must be inert');
    const loaded = await new Promise(resolve => { port1.once('message', resolve); port1.postMessage('snapshot'); });
    port1.close();
    const sqliteModules = loaded.filter(url => /better-sqlite3|node:sqlite|\\.node$/.test(url));
    assert.deepEqual(sqliteModules, [], 'SQLite entered the runtime module graph');
    assert.ok(loaded.some(url => url.endsWith('/dist/runtime/session/service.js')), 'actual production service was loaded');
    console.log(JSON.stringify({nativeLoads,portCalls:calls,sqliteCachedModules:sqliteCache().length,
      sqliteModuleGraphEntries:sqliteModules.length,productionServiceLoaded:true,tracedModules:loaded.length}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.nativeLoads, 0);
  assert.equal(result.portCalls, 0);
  assert.equal(result.sqliteCachedModules, 0);
  assert.equal(result.sqliteModuleGraphEntries, 0);
  assert.equal(result.productionServiceLoaded, true);
  t.diagnostic(JSON.stringify(result));
});

for (const host of ['pi', 'dsh', 'fake']) test(`cp2: ${host} fixture executes a non-code task through public core without Git or CLI`, t => {
  const result = runExample(host);
  assert.equal(result.evidenceKind, 'native-fixture');
  assert.equal(result.decision.kind, 'task');
  assert.equal(result.decision.outcome, 'completed');
  assert.equal(result.nodeState, 'succeeded');
  assert.equal(result.returnType, 'CommandOutcome');
  assert.equal(result.decisionRefSource, 'journal.decision.recorded');
  assert.equal(result.hostCalls, 1);
  t.diagnostic(JSON.stringify({host,revision:result.commandOutcome.revision,decision:result.decision.outcome,
    nodeState:result.nodeState,hostCalls:result.hostCalls,emptyDirectoryAfter:true,cliCalls:0}));
});

test('cp2: all fixture examples have the same production SessionService contract', () => {
  const results = ['pi', 'dsh', 'fake'].map(runExample);
  for (const r of results.slice(1)) {
    assert.deepEqual(r.methods, results[0].methods);
    assert.deepEqual(r.portFields, results[0].portFields);
  }
});

test('cp2 negative: substituting the legacy runner fails without Git or policy files', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'evofence-l5-sdk-legacy-'));
  try {
    const runner = pathToFileURL(path.join(root, 'dist/lib/runner.js')).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const { runEvolution } = await import(${JSON.stringify(runner)}); await runEvolution({cwd:process.cwd(),adapter:'pi'});`],
    { cwd, encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /NOT_GIT_REPOSITORY|not a git repository|Git repository/i);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('cp3: documentation imports exactly match package exports and built types', () => checkDocument(doc()));
test('cp3: every documented import statement executes, including optional bindings', () => {
  const source = [...doc().matchAll(/^\| `[^`]+` \| `([^`]+)` \| .+ \|$/gm)].map(m => m[1]).join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});
test('cp3: public declarations resolve the actual typed ports and service', () => {
  const filename = path.join(root, 'test/l5-sdk-consumer.ts');
  const source = `import { createSessionService } from 'evofence/core';
    import type { SessionPorts, SessionService } from 'evofence/core';
    import type { Decoded } from 'evofence/protocol';
    import type { PiSession } from 'evofence/hosts/pi';
    import type { DshComposition } from 'evofence/hosts/dsh';
    import { graph } from 'evofence/kernel';
    import { createMemoryEventStore } from 'evofence/storage/memory';
    const factory: (ports: SessionPorts) => SessionService = createSessionService;
    type Contract = [Decoded<'CommandResult'>, graph.GraphSpec, PiSession, DshComposition];
    declare const ports: SessionPorts;
    const store: SessionPorts['store'] = createMemoryEventStore({digest: ports.digest});
    factory({...ports,store}).step('sdk-session');`;
  const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  const fileExists = host.fileExists;
  const readFile = host.readFile;
  host.fileExists = file => path.resolve(file) === filename || fileExists(file);
  host.readFile = file => path.resolve(file) === filename ? source : readFile(file);
  host.getSourceFile = (file, ...args) => path.resolve(file) === filename
    ? ts.createSourceFile(file, source, options.target, true) : getSourceFile(file, ...args);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
test('cp3 negative: a nonexistent documented subpath is rejected', () => {
  assert.throws(() => checkDocument(doc().replace("from 'evofence/core'", "from 'evofence/core/kernel'")), assert.AssertionError);
});
