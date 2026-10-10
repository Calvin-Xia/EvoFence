#!/usr/bin/env node
/**
 * EvoFence dependency check — static import-graph cycle detector for `src/`.
 *
 * Why: the 0.4.0 refactor splits `src/` into five domains (base / ledger / gate /
 * exec / io). Cycles between files are the one structural regression that is easy
 * to introduce while moving code and expensive to discover later, so the build
 * gate asserts the module graph stays acyclic.
 *
 * What it does (pure Node builtins, no dependencies):
 *   1. Walks `src/**` for `.ts` / `.js` / `.mjs` / `.cjs` (and the JSX variants).
 *   2. Strips comments, then extracts every relative import / export-from /
 *      side-effect import / literal dynamic-import specifier.
 *   3. Resolves each specifier to a file on disk. NodeNext rewrites the extension in
 *      TypeScript sources (`./x.js` in a `.ts` file means the *emitted* `./x.js`, whose
 *      source is `./x.ts`), so `.js` -> `.ts` (and `.mjs` -> `.mts`, `.cjs` -> `.cts`)
 *      is tried first; otherwise the literal path is used. That keeps the graph
 *      stable across the JS -> TS migration instead of reporting phantom edges.
 *   4. Depth-first back-edge search, cycles deduplicated by canonical rotation.
 *
 * Output: module count, edge count, every cycle path, and a final
 * `acyclic: true|false` line. Exit code 1 when any cycle exists, 0 otherwise.
 *
 * Unresolved relative specifiers are reported as `warning:` lines but do not fail
 * the gate — resolution can legitimately miss generated or conditionally-absent
 * files, and a hard failure there would block unrelated work. Cycles always fail.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);

/** `.js` -> `.ts` etc: the extension a TypeScript source rewrites to. */
const EXTENSION_SWAPS = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx', '.ts']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

const TRY_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];
const INDEX_BASENAMES = TRY_EXTENSIONS.map((extension) => `index${extension}`);

/** Relative path from the repository root, always with forward slashes. */
function moduleId(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}

function collectSourceFiles(directory) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      // Audit G22: skipping an unreadable directory could hide an entire subtree from the cycle
      // check, so the guard now refuses instead of reporting "acyclic" over an unseen tree.
      throw new Error(`cannot read directory ${moduleId(current)}: ${error.message}`);
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        found.push(full);
      }
    }
  };
  walk(directory);
  return found.sort();
}

/**
 * Remove `//` and block comments while leaving string / template literals intact,
 * so a comment that mentions `from './x.js'` cannot become a phantom edge.
 */
function stripComments(source) {
  let output = '';
  let index = 0;
  let state = 'code';
  const length = source.length;

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block';
        index += 2;
        continue;
      }
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'template';
      output += char;
      index += 1;
      continue;
    }

    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        output += char;
      }
      index += 1;
      continue;
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      if (char === '\n') output += char;
      index += 1;
      continue;
    }

    // Inside a string or template literal: keep it verbatim, honour escapes.
    if (char === '\\') {
      output += char + (next ?? '');
      index += 2;
      continue;
    }
    output += char;
    index += 1;
    if (state === 'single' && char === "'") state = 'code';
    else if (state === 'double' && char === '"') state = 'code';
    else if (state === 'template' && char === '`') state = 'code';
  }

  return output;
}

const SPECIFIER_PATTERNS = [
  // `import ... from 'x'`, `export ... from 'x'`, `import type { T } from 'x'`
  /(?:^|[^\w$.])(?:import|export)(?:\s+type)?[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g,
  // `import('x')`
  /(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // `import 'x'`
  /(?:^|[^\w$.])import\s+['"]([^'"]+)['"]/g,
];

function extractSpecifiers(source) {
  const code = stripComments(source);
  const specifiers = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a relative specifier to an existing source file, or null when the
 * specifier is external (bare / `node:`) or points at nothing on disk.
 */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;

  const base = path.resolve(path.dirname(fromFile), specifier);
  const extension = path.extname(base);
  const candidates = [];

  if (extension && EXTENSION_SWAPS.has(extension)) {
    // NodeNext: the `.js` in a TS source denotes the emitted file, so the TS
    // source sitting next to it wins. Fall back to the literal path afterwards.
    const stem = base.slice(0, base.length - extension.length);
    for (const swapped of EXTENSION_SWAPS.get(extension)) candidates.push(stem + swapped);
  }

  candidates.push(base);
  if (!extension) {
    for (const tried of TRY_EXTENSIONS) candidates.push(base + tried);
  }
  for (const indexName of INDEX_BASENAMES) candidates.push(path.join(base, indexName));

  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function buildGraph() {
  const files = collectSourceFiles(SRC_ROOT);
  const known = new Set(files.map((file) => path.resolve(file)));
  const ids = new Map(files.map((file) => [path.resolve(file), moduleId(file)]));
  const edges = new Set();
  const unresolved = [];
  const adjacency = new Map();

  for (const file of files) {
    const resolvedFile = path.resolve(file);
    const from = ids.get(resolvedFile);
    if (!adjacency.has(from)) adjacency.set(from, new Set());

    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch (error) {
      // Audit G22: a module that cannot be read contributes no edges, which would understate the
      // graph; fail instead of silently shrinking it.
      throw new Error(`cannot read ${moduleId(file)}: ${error.message}`);
    }

    for (const specifier of extractSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue; // node:/bare -> external
      const target = resolveSpecifier(resolvedFile, specifier);
      if (!target || !known.has(path.resolve(target))) {
        unresolved.push(`${from} -> ${specifier}`);
        continue;
      }
      const to = ids.get(path.resolve(target));
      if (to === from) continue; // self-import: not a cross-module cycle
      edges.add(`${from}\u0000${to}`);
      adjacency.get(from).add(to);
    }
  }

  return {
    modules: files.map((file) => moduleId(file)),
    adjacency,
    edgeList: [...edges].map((key) => key.split('\u0000')),
    unresolved,
  };
}

/** Depth-first back-edge search; cycles deduplicated by canonical rotation. */
function findCycles(modules, adjacency) {
  const state = new Map(); // module -> 'visiting' | 'done'
  const stack = [];
  const stackIndex = new Map();
  const cycles = new Map();

  const canonicalize = (cycle) => {
    let pivot = 0;
    for (let i = 1; i < cycle.length; i += 1) {
      if (cycle[i] < cycle[pivot]) pivot = i;
    }
    return [...cycle.slice(pivot), ...cycle.slice(0, pivot)].join(' -> ');
  };

  const visit = (module) => {
    state.set(module, 'visiting');
    stackIndex.set(module, stack.length);
    stack.push(module);

    for (const next of adjacency.get(module) ?? []) {
      const nextState = state.get(next);
      if (nextState === 'visiting') {
        const cycle = stack.slice(stackIndex.get(next));
        cycles.set(canonicalize(cycle), cycle);
      } else if (nextState === undefined) {
        visit(next);
      }
    }

    stack.pop();
    stackIndex.delete(module);
    state.set(module, 'done');
  };

  for (const module of modules) {
    if (state.get(module) === undefined) visit(module);
  }

  return [...cycles.values()];
}

function main() {
  const { modules, adjacency, edgeList, unresolved } = buildGraph();
  const cycles = findCycles(modules, adjacency);

  const lines = [];
  lines.push(`modules: ${modules.length}`);
  lines.push(`edges: ${edgeList.length}`);
  lines.push(`cycles: ${cycles.length}`);
  cycles.forEach((cycle, index) => {
    lines.push(`cycle ${index + 1}: ${[...cycle, cycle[0]].join(' -> ')}`);
  });
  lines.push(`acyclic: ${cycles.length === 0 ? 'true' : 'false'}`);
  // Audit G22: unresolved relative imports stay warnings (a legitimately dynamic specifier must not
  // fail the build), but the count is part of the summary so a silent increase is visible.
  lines.push(`unresolved relative imports: ${unresolved.length}`);
  process.stdout.write(`${lines.join('\n')}\n`);

  for (const unresolvedEdge of unresolved) {
    process.stderr.write(`warning: unresolved relative import ${unresolvedEdge}\n`);
  }

  if (cycles.length > 0) {
    process.stderr.write(
      `[dependency-cycle] ${cycles.length} import cycle(s) detected under src/; dependency graph must stay acyclic\n`,
    );
    return 1;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`dependency check failed: ${error.message}\n`);
  process.exit(1);
}
