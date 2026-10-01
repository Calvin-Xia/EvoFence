#!/usr/bin/env node
// I01-I08 guard; AST and in-memory emit use the lockfile-resolved typescript6 parser.
async function guardMain(argv) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const { execFileSync } = await import('node:child_process');
  const require = createRequire(import.meta.url);
  const allowed = { protocol: ['protocol'], kernel: ['protocol', 'kernel'], runtime: ['protocol', 'kernel', 'runtime'] };
  const portNames = ['HostPort', 'EventStore', 'ArtifactStore', 'WorkspacePort', 'EvaluatorPort', 'Clock', 'PolicyPort', 'BudgetPort', 'AssetRegistry', 'DigestPort', 'Ports'];
  const options = { roots: {}, built: {}, probes: null, project: null };
  function assignment(value, target) {
    const at = value.indexOf('='), name = value.slice(0, at), location = value.slice(at + 1);
    if (at < 1 || !Object.hasOwn(allowed, name) || location === '' || Object.hasOwn(target, name)) throw new Error('INPUT: expected a unique protocol|kernel|runtime=path');
    target[name] = path.resolve(location);
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help') {
      console.log('Usage: node scripts/check-core-imports.mjs [--root module=dir]... [--built module=dir]... [--project tsconfig.json] [--probes file.json]');
      return;
    }
    if (!['--root', '--built', '--project', '--probes'].includes(flag) || i + 1 === argv.length) throw new Error('INPUT: unknown option or missing value: ' + flag);
    const value = argv[++i];
    if (flag === '--root') assignment(value, options.roots);
    else if (flag === '--built') assignment(value, options.built);
    else {
      const name = flag.slice(2);
      if (options[name] !== null) throw new Error('INPUT: duplicate option: ' + flag);
      options[name] = path.resolve(value);
    }
  }
  if (Object.keys(options.roots).length === 0) {
    for (const name of Object.keys(allowed)) options.roots[name] = path.resolve('src', name);
  }
  for (const name of Object.keys(options.built)) if (!Object.hasOwn(options.roots, name)) throw new Error('INPUT: --built requires the corresponding --root');
  const errors = [];
  const fail = (rule, code, file, message) => errors.push({ rule, code, file, message });
  const canonical = p => {
    const real = fs.realpathSync(p);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  const inside = (file, root) => {
    const relative = path.relative(root, file);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  };
  const suffix = /\.(?:d\.)?(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;
  const sourceRoots = {};
  for (const [name, root] of Object.entries(options.roots)) {
    sourceRoots[name] = canonical(root);
    if (!fs.statSync(sourceRoots[name]).isDirectory()) throw new Error('INPUT: root must be a directory: ' + root);
  }
  for (const [a, ra] of Object.entries(sourceRoots)) for (const [b, rb] of Object.entries(sourceRoots)) {
    if (a < b && (inside(ra, rb) || inside(rb, ra))) throw new Error('INPUT: module roots overlap: ' + a + ', ' + b);
  }
  const owner = file => Object.keys(sourceRoots).find(name => inside(file, sourceRoots[name]));
  const files = new Map();
  const visitedDirectories = new Set();
  function walk(logical, moduleName) {
    const real = canonical(logical);
    const realOwner = owner(real);
    if (realOwner === undefined || !allowed[moduleName].includes(realOwner)) {
      fail('I01', 'REALPATH_ESCAPE', logical, 'symlink/junction has a forbidden real module target');
      return;
    }
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      if (visitedDirectories.has(real)) return;
      visitedDirectories.add(real);
      for (const name of fs.readdirSync(real).sort()) walk(path.join(real, name), realOwner);
    } else if (stat.isFile() && (suffix.test(real) || real.endsWith('.json'))) {
      files.set(real, { file: real, owner: realOwner, text: fs.readFileSync(real, 'utf8') });
    }
  }
  for (const [name, root] of Object.entries(sourceRoots)) walk(root, name);
  const entries = {};
  for (const [name, root] of Object.entries(sourceRoots)) {
    const matches = [...files.values()].filter(f => f.owner === name && path.dirname(f.file) === root && /^index\.(ts|mts|js|mjs)$/.test(path.basename(f.file)));
    if (matches.length !== 1) fail('I01', 'ENTRY_REQUIRED', root, 'exactly one index.ts|mts|js|mjs is required; missing/ambiguous roots cannot pass');
    else entries[name] = matches[0].file;
  }
  function finish(extra) {
    for (const e of errors) console.error('[' + e.rule + '/' + e.code + '] ' + e.file + ': ' + e.message);
    console.log(JSON.stringify({ status: errors.length === 0 ? 'passed' : 'failed', modules: Object.keys(sourceRoots), rules: ['I01','I02','I03','I04','I05','I06','I07','I08'], coverage:{I04:'static-best-effort',I05:'static-best-effort',I06:Object.keys(options.built).length?'source-and-supplied-build':'source-and-in-memory-ESM-emit',I07:'import/factory/explicit-input-cases',I08:'lexical-port-flow-and-defaults'}, files: files.size, ...extra, violations: errors.length }));
    process.exitCode = errors.length === 0 ? 0 : 1;
  }
  if (errors.length) { finish({ stage: 'roots' }); return; }
  const ts = require('typescript6');
  console.log('parser: typescript6 ' + ts.version + ' (project dependency)');
  let compilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, allowJs: true, resolveJsonModule: true, verbatimModuleSyntax: true };
  if (options.project !== null) {
    const config = ts.readConfigFile(options.project, ts.sys.readFile);
    if (config.error) throw new Error('INPUT: ' + ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(options.project));
    if (parsed.errors.length) throw new Error('INPUT: ' + parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    compilerOptions = { ...parsed.options, allowJs: true, resolveJsonModule: true };
  }
  let program = ts.createProgram([...files.keys()].filter(f => !f.endsWith('.json')), compilerOptions);
  let checker = program.getTypeChecker();
  let checkedFiles = new Set(files.keys());
  const sourceEdges = new Map([...files.keys()].map(f => [f, []]));
  function relativeSpecifier(specifier) { return specifier.startsWith('./') || specifier.startsWith('../'); }
  function dependency(from, specifier, typeOnly, rule = 'I01') {
    if (!relativeSpecifier(specifier)) {
      fail('I02', 'NON_RELATIVE_IMPORT', from, 'bare/builtin/alias/absolute specifier forbidden: ' + specifier);
      return;
    }
    const resolution = ts.resolveModuleName(specifier, from, compilerOptions, ts.sys).resolvedModule;
    if (resolution === undefined) {
      fail(rule, 'UNRESOLVED_IMPORT', from, 'cannot resolve ' + specifier);
      return;
    }
    const target = canonical(resolution.resolvedFileName), toOwner = owner(target);
    if (toOwner === undefined || !allowed[owner(from)].includes(toOwner)) {
      fail(rule, 'FORBIDDEN_EDGE', from, 'disallowed real import target: ' + target);
      return;
    }
    if (!files.has(target)) {
      fail(rule, 'UNCOLLECTED_TARGET', from, 'target is outside the enumerated source closure: ' + target);
      return;
    }
    sourceEdges.get(from).push({ specifier, target, typeOnly });
  }
  function bindingSymbol(identifier) {
    return ts.isShorthandPropertyAssignment(identifier.parent)
      ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
      : checker.getSymbolAtLocation(identifier);
  }
  function isLocal(identifier) {
    const symbol = bindingSymbol(identifier);
    return symbol !== undefined && symbol.declarations !== undefined && symbol.declarations.some(d => checkedFiles.has(canonical(d.getSourceFile().fileName)) && (ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Ambient) === 0);
  }
  function unwrap(n) {
    while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
    return n;
  }
  function expressionPath(node, aliases = 1) {
    const n = unwrap(node);
    if (ts.isIdentifier(n)) {
      if (!isLocal(n)) return n.text;
      if (aliases === 0) return null;
      const symbol = bindingSymbol(n);
      const declaration = symbol.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return expressionPath(declaration.initializer, aliases - 1);
      if (declaration && ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
        const parent = declaration.parent.parent;
        if (ts.isVariableDeclaration(parent) && parent.initializer) {
          const base = expressionPath(parent.initializer, aliases - 1);
          const key = declaration.propertyName ? declaration.propertyName.getText() : declaration.name.getText();
          return base === null ? null : base + '.' + key;
        }
      }
      return null;
    }
    if (ts.isPropertyAccessExpression(n)) {
      const base = expressionPath(n.expression, aliases);
      return base === null ? null : base + '.' + n.name.text;
    }
    if (ts.isElementAccessExpression(n) && n.argumentExpression && (ts.isStringLiteralLike(n.argumentExpression) || ts.isNumericLiteral(n.argumentExpression))) {
      const base = expressionPath(n.expression, aliases);
      return base === null ? null : base + '.' + n.argumentExpression.text;
    }
    return null;
  }
  const forbiddenRoots = new Set(['process', 'globalThis', 'global', 'window', 'self', 'fetch', 'XMLHttpRequest', 'WebSocket', 'crypto', 'performance', 'console', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']);
  function ambient(p) { return p !== null && (forbiddenRoots.has(p.split('.')[0]) || ['Date.now','performance.now','Math.random'].some(s => p === s || p.startsWith(s + '.'))); }
  const loaders = new Set(['require', 'eval', 'Function', 'createRequire']);
  const codeLoader = p => p !== null && loaders.has(p.split('.').at(-1));
  const pureGlobals = new Set(['undefined', 'Infinity', 'NaN', 'Object', 'Math', 'JSON', 'Array', 'String', 'Number', 'Boolean', 'BigInt', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Promise', 'Proxy', 'Reflect', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError', 'Date', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'structuredClone']);
  function identifierRead(n) {
    const p = n.parent;
    if ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === n)) return false;
    if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isEnumDeclaration(p) || ts.isEnumMember(p) || ts.isModuleDeclaration(p) || ts.isBindingElement(p)) && p.name === n) return false;
    if (ts.isBindingElement(p) && p.propertyName === n || ts.isLabeledStatement(p) && p.label === n || (ts.isBreakStatement(p) || ts.isContinueStatement(p)) && p.label === n) return false;
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
    if (ts.isImportAttribute(p) && p.name === n) return false;
    return true;
  }
  function references(sf, file, emitted = false) {
    const list = [];
    const add = (specifier, typeOnly) => emitted ? list.push({ specifier, typeOnly }) : dependency(file, specifier, typeOnly);
    function scan(n) {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
        if (n.moduleSpecifier) {
          const clause = n.importClause;
          // With verbatimModuleSyntax, `export {type T}` retains an empty
          // runtime re-export. Only statement-level `export/import type` erases it.
          add(n.moduleSpecifier.text, Boolean(n.isTypeOnly || (clause && clause.isTypeOnly)));
        }
      } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) add(n.argument.literal.text, true);
      else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
        add(n.moduleReference.expression.text, n.isTypeOnly);
        if (!emitted) fail('I03','IMPORT_EQUALS',file,'CommonJS import-equals forbidden');
      }
      ts.forEachChild(n, scan);
    }
    scan(sf);
    if (!emitted) {
      for (const ref of sf.referencedFiles) dependency(file, ref.fileName, true);
      for (const ref of sf.typeReferenceDirectives) add(ref.fileName, true);
    }
    return list;
  }
  const pureCalls = new Set(['Object.freeze','Object.keys','Object.values','Object.entries','Object.fromEntries','Object.create','JSON.parse','JSON.stringify','Array.from','Array.isArray','Number.isFinite','Number.isInteger','Number.isSafeInteger','String','Number','Boolean']);
  const pureMethods = new Set(['map','filter','reduce','forEach','flatMap','flat','slice','concat','join','includes','indexOf','split','replace','replaceAll','toLowerCase','toUpperCase','trim','sort','every','some','has','get']);
  function isPureTopCall(n) {
    const p = expressionPath(n.expression);
    if (p !== null && (pureCalls.has(p) || p.startsWith('Math.') && p !== 'Math.random')) return true;
    const e = unwrap(n.expression);
    if (ts.isPropertyAccessExpression(e) && pureMethods.has(e.name.text)) {
      const base = unwrap(e.expression);
      if (ts.isArrayLiteralExpression(base) || ts.isStringLiteralLike(base)) return true;
      if (ts.isIdentifier(base) && isLocal(base)) {
        const d = checker.getSymbolAtLocation(base).valueDeclaration;
        return d && ts.isVariableDeclaration(d) && d.initializer && !portNames.some(s => d.type && d.type.getText().includes(s));
      }
    }
    return false;
  }
  function isPortType(n) { return n.type && portNames.some(p => new RegExp('\\b' + p + '\\b').test(n.type.getText())); }
  let portParameters = new Set();
  function portDerived(n, seen = new Set()) {
    n = unwrap(n);
    if (ts.isIdentifier(n)) {
      const symbol = bindingSymbol(n), d = symbol && symbol.valueDeclaration;
      if (!d || seen.has(d)) return false;
      seen.add(d);
      if (ts.isParameter(d)) return portParameters.has(d) || d.name.getText() === 'ports' || Boolean(isPortType(d));
      if (ts.isVariableDeclaration(d)) return Boolean(isPortType(d) || d.initializer && portDerived(d.initializer, seen));
      if (ts.isBindingElement(d)) {
        const declaration=d.parent.parent;
        if (ts.isParameter(declaration)) return portParameters.has(declaration) || Boolean(isPortType(declaration));
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) return portDerived(declaration.initializer, seen);
      }
      return false;
    }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) return portDerived(n.expression, seen);
    // Track capability handles stored in objects/arrays/closures as well as direct aliases.
    if (ts.isObjectLiteralExpression(n)) return n.properties.some(p => {
      if (ts.isPropertyAssignment(p)) return portDerived(p.initializer, new Set(seen));
      if (ts.isShorthandPropertyAssignment(p)) return portDerived(p.name, new Set(seen));
      if (ts.isSpreadAssignment(p)) return portDerived(p.expression, new Set(seen));
      if (ts.isMethodDeclaration(p)) return portDerived(p, new Set(seen));
      return false;
    });
    if (ts.isArrayLiteralExpression(n)) return n.elements.some(e => portDerived(e, new Set(seen)));
    if (ts.isFunctionLike(n) && n.body) {
      let capturesPort = false;
      const scan = child => {
        if (ts.isIdentifier(child) && identifierRead(child) && portDerived(child, new Set(seen))) capturesPort = true;
        ts.forEachChild(child, scan);
      };
      scan(n.body);
      return capturesPort;
    }
    if (ts.isConditionalExpression(n)) return portDerived(n.whenTrue, new Set(seen)) || portDerived(n.whenFalse, new Set(seen));
    if (ts.isCallExpression(n)) {
      const signature = checker.getResolvedSignature(n), d = signature && signature.declaration;
      if (!d || !d.body || seen.has(d) || !checkedFiles.has(canonical(d.getSourceFile().fileName))) return false;
      seen.add(d);
      if (!ts.isBlock(d.body)) return portDerived(d.body, seen);
      let returnsPort = false;
      function scan(child) {
        if (ts.isReturnStatement(child) && child.expression && portDerived(child.expression, new Set(seen))) returnsPort = true;
        if (!ts.isFunctionLike(child)) ts.forEachChild(child, scan);
      }
      scan(d.body);
      return returnsPort;
    }
    return false;
  }
  function tracePortArguments() {
    portParameters = new Set();
    let changed;
    do {
      changed = false;
      function scan(n) {
        if (ts.isCallExpression(n)) {
          const signature = checker.getResolvedSignature(n), d = signature && signature.declaration;
          if (d && d.body && checkedFiles.has(canonical(d.getSourceFile().fileName))) {
            for (let i = 0; i < Math.min(n.arguments.length, d.parameters.length); i++) {
              const parameter = d.parameters[i];
              if (!portParameters.has(parameter) && portDerived(n.arguments[i])) {
                portParameters.add(parameter);
                changed = true;
              }
            }
          }
        }
        ts.forEachChild(n, scan);
      }
      for (const file of checkedFiles) if (!file.endsWith('.json')) scan(program.getSourceFile(file));
    } while (changed);
  }
  function scanRecord(record, built = false) {
    if (record.file.endsWith('.json')) { JSON.parse(record.text); return; }
    const reject = (rule, code, file, message) => fail(built ? 'I06' : rule, built ? 'BUILD_' + rule + '_' + code : code, file, message);
    const sf = program.getSourceFile(record.file);
    if (!built) {
      for (const d of sf.parseDiagnostics) fail('I01','PARSE_ERROR',record.file,ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      references(sf, record.file);
      if (Object.values(entries).includes(record.file) && !ts.isExternalModule(sf)) fail('I01','ENTRY_NOT_MODULE',record.file,'core entry must be an ESM export/import module, not an empty/script placeholder');
    }
    function scan(n, top) {
      if (ts.isTypeNode(n) && !ts.isTypeQueryNode(n)) {
        // import() type references are collected separately; no runtime read.
        return;
      }
      if (ts.isCallExpression(n)) {
        const e = unwrap(n.expression), p = expressionPath(e);
        if (e.kind === ts.SyntaxKind.ImportKeyword) reject('I03','DYNAMIC_IMPORT',record.file,'dynamic import forbidden, including literal targets');
        if (p === 'Date') reject('I04','AMBIENT_DATE_CALL',record.file,'Date() reads ambient time');
        if (top && e.kind !== ts.SyntaxKind.ImportKeyword && !isPureTopCall(n)) reject('I05','TOP_CALL_UNPROVEN',record.file,'top-level/static call is not a recognized pure initializer: '+e.getText(sf));
      }
      if (ts.isNewExpression(n)) {
        const p = expressionPath(n.expression);
        if (p === 'Date') reject('I04','AMBIENT_DATE',record.file,'new Date reads ambient time');
        if (top && !['Map','Set','WeakMap','WeakSet','RegExp'].includes(p)) reject('I05','TOP_NEW_UNPROVEN',record.file,'top-level/static construction is not a pure initializer');
      }
      if (ts.isIdentifier(n) && identifierRead(n)) {
        const p = expressionPath(n);
        if (codeLoader(p)) reject('I03','CODE_ALIAS',record.file,'code-loading alias/reference forbidden: '+p);
        if (ambient(p)) reject('I04','AMBIENT_READ',record.file,'ambient reference forbidden: '+p);
        if (!isLocal(n) && !pureGlobals.has(n.text) && !ambient(p) && !codeLoader(p)) reject('I08','UNINJECTED_GLOBAL',record.file,'external capability must come from a lexical port parameter: '+n.text);
      }
      if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
        const p = expressionPath(n.name);
        if (ambient(p)) reject('I04','AMBIENT_BINDING',record.file,'destructuring captures ambient capability: '+p);
        if (codeLoader(p)) reject('I03','CODE_BINDING',record.file,'destructuring captures code loader: '+p);
      }
      if (ts.isExportAssignment(n) && n.isExportEquals) reject('I03','COMMONJS_EXPORT',record.file,'core requires ESM, not export-equals');
      if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        const p = expressionPath(n);
        if (codeLoader(p)) reject('I03','CODE_MEMBER',record.file,'code-loading member/alias forbidden: '+p);
        const key = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : null;
        if (key === 'constructor') {
          const base = checker.getTypeAtLocation(n.expression);
          if (base.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || base.getCallSignatures().length || base.getConstructSignatures().length) reject('I03','REFLECTED_CONSTRUCTOR',record.file,'function-constructor reflection cannot load code in core');
        }
        if (ambient(p)) reject('I04','AMBIENT_MEMBER',record.file,'ambient member/one-layer alias forbidden: '+p);
      }
      if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) reject('I04','IMPORT_META',record.file,'core cannot discover its environment through import.meta');
      if (ts.isParameter(n) && (portParameters.has(n) || n.name.getText() === 'ports' || isPortType(n)) && n.initializer) reject('I08','PORT_PARAMETER_DEFAULT',record.file,'injected ports have no default backend');
      if (ts.isBindingElement(n) && n.initializer && ts.isObjectBindingPattern(n.parent)) {
        const parent=n.parent.parent;
        if (ts.isParameter(parent) && (portParameters.has(parent) || parent.name.getText().includes('ports') || isPortType(parent)) || ts.isVariableDeclaration(parent) && parent.initializer && portDerived(parent.initializer)) reject('I08','PORT_DESTRUCTURING_DEFAULT',record.file,'injected destructured capability has a default backend');
      }
      if (ts.isVariableDeclaration(n) && isPortType(n)) {
        let scope = n.parent;
        while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
        if (scope && ts.isSourceFile(scope)) reject('I08','PORT_SINGLETON',record.file,'module-scoped port/backend storage forbidden');
      }
      if (ts.isBinaryExpression(n) && [ts.SyntaxKind.QuestionQuestionToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionEqualsToken,ts.SyntaxKind.BarBarEqualsToken].includes(n.operatorToken.kind) && portDerived(n.left)) reject('I08','PORT_FALLBACK',record.file,'injected capability cannot fall back to a default backend');
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && portDerived(n.left)) reject('I08','PORT_REPLACEMENT',record.file,'core cannot replace an injected capability or its alias');
      if (ts.isBinaryExpression(n) && n.operatorToken.kind===ts.SyntaxKind.EqualsToken && portDerived(n.right)) {
        let target=unwrap(n.left);
        while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target=unwrap(target.expression);
        if (ts.isIdentifier(target)) {
          const s=checker.getSymbolAtLocation(target), d=s && s.valueDeclaration;
          if (d) {
            let scope=d.parent;
            while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope=scope.parent;
            if (scope && ts.isSourceFile(scope)) reject('I08','PORT_CAPTURE',record.file,'injected port escapes into module-scoped storage');
          }
        }
      }
      if (ts.isConditionalExpression(n) && portDerived(n.condition)) reject('I08','PORT_CONDITIONAL_DEFAULT',record.file,'capability-dependent fallback requires explicit host policy, not a core default');
      if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
        const namedPort = n.name && portNames.some(p => n.name.text.endsWith(p) && p !== 'Ports');
        const implementsPort = n.heritageClauses && n.heritageClauses.some(h => h.token === ts.SyntaxKind.ImplementsKeyword && h.types.some(t => portNames.some(p => p !== 'Ports' && new RegExp('\\b' + p + '\\b').test(t.getText()))));
        if (namedPort || implementsPort) reject('I08','CORE_BACKEND_CLASS',record.file,'concrete port implementation belongs outside core');
      }
      if (ts.isFunctionLike(n)) {
        // Default parameters execute at invocation, not import time.
        ts.forEachChild(n, child => scan(child, false));
      } else if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
        for (const member of n.members) {
          const isStatic = Boolean(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) || ts.isClassStaticBlockDeclaration(member);
          scan(member, top && isStatic);
        }
        if (n.heritageClauses) for (const h of n.heritageClauses) scan(h, top);
      } else ts.forEachChild(n, child => scan(child, top));
    }
    scan(sf, true);
  }
  tracePortArguments();
  for (const record of files.values()) scanRecord(record);
  if (entries.runtime) {
    const sf=program.getSourceFile(entries.runtime), moduleSymbol=checker.getSymbolAtLocation(sf);
    if (moduleSymbol) for (let s of checker.getExportsOfModule(moduleSymbol)) if (s.name==='createKernel') {
      if (s.flags & ts.SymbolFlags.Alias) s=checker.getAliasedSymbol(s);
      const d=s.valueDeclaration;
      const fn=d && ts.isVariableDeclaration(d) ? d.initializer : d;
      if (!fn || !ts.isFunctionLike(fn) || fn.parameters.length===0 || !(fn.parameters[0].name.getText()==='ports' || isPortType(fn.parameters[0]))) fail('I08','INJECTION_BOUNDARY_UNKNOWN',entries.runtime,'createKernel must expose a lexical Ports parameter; unknown injection boundary cannot pass');
    }
  }
  if (errors.length) { finish({ stage: 'source', compiler: ts.version }); return; }
  const emitted = new Map(), emittedPaths = new Map();
  function emittedPath(file) {
    if (file.endsWith('.json')) return file;
    if (file.endsWith('.mts')) return file.slice(0,-4)+'.mjs';
    if (file.endsWith('.cts')) return file.slice(0,-4)+'.cjs';
    return file.replace(/\.(ts|tsx|jsx)$/,'.js');
  }
  for (const f of files.values()) {
    if (/\.d\.(ts|mts|cts)$/.test(f.file)) continue;
    const output = f.file.endsWith('.json') ? f.text : ts.transpileModule(f.text, { fileName:f.file, compilerOptions:{...compilerOptions,module:ts.ModuleKind.ESNext,declaration:false,declarationMap:false,sourceMap:false,verbatimModuleSyntax:true} }).outputText;
    emitted.set(f.file, { id:f.file, path:emittedPath(f.file), code:output, json:f.file.endsWith('.json'), dependencies:{} });
    emittedPaths.set(emittedPath(f.file),f.file);
  }
  function inspectEmitted(records, paths, actual) {
    for (const record of records.values()) {
      if (record.json) { JSON.parse(record.code); continue; }
      const sf = ts.createSourceFile(record.path,record.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
      for (const d of sf.parseDiagnostics) fail('I06','EMIT_PARSE',record.path,ts.flattenDiagnosticMessageText(d.messageText,'\n'));
      const actualTargets = [];
      for (const edge of references(sf,record.path,true)) {
        if (!relativeSpecifier(edge.specifier)) { fail('I06','EMIT_EXTERNAL',record.path,'emitted/built closure contains '+edge.specifier); continue; }
        const logicalTarget = path.resolve(path.dirname(record.path),edge.specifier);
        // In-memory .js files do not exist yet; their directory can still be a real symlink.
        const directory = path.dirname(logicalTarget);
        const targetPath = fs.existsSync(directory) ? path.join(canonical(directory), path.basename(logicalTarget)) : logicalTarget;
        if (!paths.has(targetPath)) { fail('I06','EMIT_UNRESOLVED',record.path,'unresolved emitted import: '+edge.specifier); continue; }
        const target = paths.get(targetPath);
        actualTargets.push(target); record.dependencies[edge.specifier]=target;
      }
      const expected = [...new Set(sourceEdges.get(record.id).filter(e=>!e.typeOnly).map(e=>e.target))].sort();
      const found = [...new Set(actualTargets)].sort();
      if (JSON.stringify(expected)!==JSON.stringify(found)) fail('I06','CLOSURE_DRIFT',record.path,(actual?'supplied build':'in-memory ESM emit')+' differs from source runtime-edge projection');
    }
  }
  inspectEmitted(emitted,emittedPaths,false);
  function exportSignature(record) {
    if (record.json) return ['default'];
    const sf=ts.createSourceFile(record.path,record.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS), exports=[];
    function bindings(n) {
      if (ts.isIdentifier(n)) exports.push(n.text);
      else for (const e of n.elements) if (ts.isBindingElement(e)) bindings(e.name);
    }
    for (const n of sf.statements) {
      if (ts.isExportDeclaration(n)) {
        if (!n.exportClause) exports.push('*:'+record.dependencies[n.moduleSpecifier.text]);
        else if (ts.isNamespaceExport(n.exportClause)) exports.push(n.exportClause.name.text);
        else for (const e of n.exportClause.elements) exports.push(e.name.text);
      } else if (ts.isExportAssignment(n)) exports.push('default');
      else if (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) {
        if (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Default) exports.push('default');
        else if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) bindings(d.name);
        else if (n.name) exports.push(n.name.text);
      }
    }
    return [...new Set(exports)].sort();
  }
  let probeModules = emitted;
  if (Object.keys(options.built).length) {
    const built = new Map(), builtPaths = new Map();
    if (Object.keys(options.built).length !== Object.keys(sourceRoots).length) throw new Error('INPUT: supplied build must cover every declared module root');
    for (const [name, dir] of Object.entries(options.built)) {
      const realRoot = canonical(dir);
      for (const source of emitted.values()) if (owner(source.id)===name) {
        const target = path.resolve(realRoot,path.relative(sourceRoots[name],source.path));
        const real = canonical(target);
        if (!inside(real,realRoot)) { fail('I06','BUILD_REALPATH_ESCAPE',target,'built symlink escapes module root'); continue; }
        built.set(source.id,{...source,path:real,code:fs.readFileSync(real,'utf8'),dependencies:{}});
        builtPaths.set(real,source.id);
      }
    }
    inspectEmitted(built,builtPaths,true);
    for (const record of built.values()) if (JSON.stringify(exportSignature(record))!==JSON.stringify(exportSignature(emitted.get(record.id)))) fail('I06','EXPORT_DRIFT',record.path,'supplied build changes the emitted public export surface');
    // A matching export graph alone says nothing about a dormant loader in a function body.
    // Bind actual JS scopes, then apply the same effect checks to the supplied artifacts.
    checkedFiles = new Set([...built.values()].filter(r => !r.json).map(r => r.path));
    program = ts.createProgram([...checkedFiles], compilerOptions);
    checker = program.getTypeChecker();
    tracePortArguments();
    for (const record of built.values()) scanRecord({ file: record.path, text: record.code }, true);
    probeModules = built;
  }
  if (errors.length) { finish({stage:'static/emit',compiler:ts.version}); return; }
  const probes = options.probes === null ? {version:1,cases:[]} : JSON.parse(fs.readFileSync(options.probes,'utf8'));
  if (Object.keys(probes).sort().join(',') !== 'cases,version' || probes.version!==1 || !Array.isArray(probes.cases)) throw new Error('INPUT: probes require only version=1 and cases array');
  for (const p of probes.cases) {
    if (Object.keys(p).sort().join(',')!=='args,export,module' || !Object.hasOwn(entries,p.module) || typeof p.export!=='string' || !Array.isArray(p.args)) throw new Error('INPUT: each probe requires module/export/args and no extra fields');
  }
  async function probeWorker(job) {
    const vm = await import('node:vm');
    const calls = [], violations = [], context = vm.createContext({}, {codeGeneration:{strings:false,wasm:false}});
    context.__record = name => { calls.push(name); throw new Error('ambient call '+name); };
    vm.runInContext(`{
      const trap=n=>(...args)=>__record(n);
      for(const n of ['process','fetch','XMLHttpRequest','WebSocket','crypto','setTimeout','setInterval','setImmediate','queueMicrotask']){
        Object.defineProperty(globalThis,n,{get(){return __record(n);},configurable:false});
      }
      Math.random=trap('Math.random'); Date.now=trap('Date.now');
      const NativeDate=Date;
      globalThis.Date=new Proxy(NativeDate,{construct(){return __record('new Date');},apply(){return __record('Date()');}});
      globalThis.performance={now:trap('performance.now')};
    }`,context);
    const modules = new Map();
    for (const record of job.modules) {
      const m=record.json ? new vm.SyntheticModule(['default'],function(){this.setExport('default',JSON.parse(record.code));},{context,identifier:record.id})
        : new vm.SourceTextModule(record.code,{context,identifier:record.id});
      modules.set(record.id,m);
    }
    const byId=new Map(job.modules.map(m=>[m.id,m]));
    const link=(specifier,referencing)=>modules.get(byId.get(referencing.identifier).dependencies[specifier]);
    function port(path) {
      return new Proxy(function(){},{
        get(_target,key){if(key==='then')return undefined; if(typeof key==='symbol')return undefined;return port(path+'.'+key);},
        apply(){calls.push(path);return 0;},
        construct(){calls.push(path+'.new');return {};}
      });
    }
    const injected = new Proxy({}, {get(_t,key){return port('ports.'+String(key));}});
    const dataPrototype = vm.runInContext('Object.prototype', context);
    function dataText(value) {
      const seen = new Set();
      function check(v) {
        if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
        if (typeof v !== 'object' || seen.has(v)) throw new Error('probe result must be finite, acyclic JSON data');
        if (!Array.isArray(v) && Object.getPrototypeOf(v) !== dataPrototype && Object.getPrototypeOf(v) !== null) throw new Error('probe result must be a plain JSON object, not Map/Set/class');
        if (Array.isArray(v) && Reflect.ownKeys(v).length !== v.length + 1) throw new Error('probe data cannot contain sparse arrays or extra array properties');
        seen.add(v);
        for (const key of Reflect.ownKeys(v)) {
          if (Array.isArray(v) && key === 'length') continue;
          if (Array.isArray(v) && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) throw new Error('probe array keys must be indices');
          const d = Object.getOwnPropertyDescriptor(v, key);
          if (typeof key !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value')) throw new Error('probe data cannot contain symbols, accessors or hidden properties');
          check(d.value);
        }
        seen.delete(v);
      }
      check(value);
      return JSON.stringify(value);
    }
    async function invoke(fn,args){
      context.__probeFn=fn;context.__probeArgs=args;
      const value=vm.runInContext('__probeFn(...__probeArgs)',context,{timeout:1000});
      return await value;
    }
    let factoryCount=0, deterministicCount=0;
    try {
      for(const id of Object.values(job.entries)){
        const m=modules.get(id);
        if(m.status==='unlinked')await m.link(link);
        if(m.status==='linked')await m.evaluate({timeout:1000});
      }
      for(const [name,id] of Object.entries(job.entries)){
        const ns=modules.get(id).namespace;
        if(name==='runtime' && typeof ns.createKernel!=='function')violations.push({rule:'I07',code:'FACTORY_REQUIRED',message:'runtime entry must export createKernel; incomplete runtime cannot pass'});
        if(typeof ns.createKernel==='function'){
          factoryCount++;
          await invoke(ns.createKernel,[injected]);
        }
        for(const key of Object.keys(ns)) if(typeof ns[key]==='function' && /(^reduce|reducer|negotiate)/i.test(key) && !job.probes.some(p=>p.module===name&&p.export===key)){
          violations.push({rule:'I07',code:'PROBE_REQUIRED',message:'explicit deterministic input required for '+name+'.'+key});
        }
      }
      for(const p of job.probes){
        const fn=modules.get(job.entries[p.module]).namespace[p.export];
        if(typeof fn!=='function'){violations.push({rule:'I07',code:'PROBE_EXPORT',message:'not a function: '+p.module+'.'+p.export});continue;}
        const outputs=[];
        for(let i=0;i<2;i++){
          context.__inputJson = JSON.stringify(p.args);
          const args = vm.runInContext('JSON.parse(__inputJson)', context), before = dataText(args);
          const result=await invoke(fn,args);
          if(dataText(args)!==before)violations.push({rule:'I07',code:'INPUT_MUTATION',message:p.export+' mutates supplied data'});
          outputs.push(dataText(result));
        }
        deterministicCount++;
        if(outputs[0]!==outputs[1])violations.push({rule:'I07',code:'NON_DETERMINISTIC',message:p.export+' differs for repeated identical data'});
      }
    } catch(error) {
      violations.push({rule:'I07',code:'PROBE_EXECUTION',message:error.message});
    }
    if(calls.length)violations.push({rule:'I07',code:'OBSERVABLE_CALL',message:calls.join(', ')});
    return {violations,importEntries:Object.keys(job.entries).length,factories:factoryCount,deterministicCases:deterministicCount,calls};
  }
  const job={modules:[...probeModules.values()],entries,probes:probes.cases};
  let result;
  try {
    const source='const run='+probeWorker.toString()+'; const fs=await import("node:fs"); const job=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(JSON.stringify(await run(job)));';
    result=JSON.parse(execFileSync(process.execPath,['--experimental-vm-modules','--no-warnings','--input-type=module','-e',source],{input:JSON.stringify(job),encoding:'utf8',timeout:5000,maxBuffer:1024*1024}));
  } catch(error) {
    fail('I07','PROBE_PROCESS_FAILED','<probe>','isolated probe could not finish: '+error.message);
    finish({stage:'probe',compiler:ts.version});return;
  }
  for(const e of result.violations)fail(e.rule,e.code,'<probe>',e.message);
  console.log('I07 evidence: '+JSON.stringify({imports:result.importEntries,factories:result.factories,deterministicCases:result.deterministicCases,portOrAmbientCalls:result.calls.length}));
  finish({stage:'complete',compiler:ts.version,probe:result});
}
try { await guardMain(process.argv.slice(2)); } catch (error) { console.error('[INPUT/ERROR] '+error.stack); process.exitCode=1; }
