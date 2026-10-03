import { isUtf8 } from 'node:buffer';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fail } from '../../protocol/index.js';
import type { ErrorCode, ErrorEnvelope } from '../../protocol/index.js';
import type { EdgeSpec, GraphSpec, NodeSpec } from '../../kernel/graph/index.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = { [key: string]: Json };
export interface DeliverySnapshot {
  readonly format: 'evofence.sp-snapshot/1';
  readonly graph: Row;
  readonly nodes: readonly Row[];
  readonly edges: readonly Row[];
}
/** New execution configuration comes from the caller, never from SP review/history. */
export interface RuntimeBindings {
  readonly graph: Omit<GraphSpec, 'nodes' | 'typedEdges'>;
  readonly nodes: readonly NodeSpec[];
  readonly fallbacks: readonly Pick<EdgeSpec, 'edgeId' | 'when' | 'maxAttempts'>[];
}
export interface LossEntry {
  readonly source: string;
  readonly target: string;
  readonly classification: 'supported' | 'lossy' | 'rejected';
  readonly reason: string;
}
export interface ImportedDelivery {
  readonly classification: 'historical-delivery';
  readonly executable: false;
  readonly delivery: DeliverySnapshot;
  readonly runtimeGraph: GraphSpec;
  readonly bindings: RuntimeBindings;
  readonly initialStates: readonly { nodeId: string; state: 'pending' }[];
  readonly losses: readonly LossEntry[];
}
export type BridgeResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly error: ErrorEnvelope };
/** These ports are witnesses of the forbidden boundary; no bridge method calls them. */
export interface BridgePorts {
  readonly hostPort: { dispatchEffect(value: unknown): unknown };
  readonly journal: { append(value: unknown): unknown };
  readonly decisions: { write(value: unknown): unknown };
  readonly grants: { issue(value: unknown): unknown };
  readonly claims: { claim(value: unknown): unknown };
}
export interface FileScope { readonly root: string }
export class BridgeRejection extends Error {
  constructor(readonly envelope: ErrorEnvelope) { super(envelope.message); }
}
export function reject(code: ErrorCode, message: string): never {
  throw new BridgeRejection(fail(code, message));
}
export function boundary<T>(action: () => T): BridgeResult<T> {
  try { return { ok: true, value: action() }; }
  catch (error) {
    if (error instanceof BridgeRejection) return { ok: false, error: error.envelope };
    throw error;
  }
}
export function external<T>(action: () => T): T {
  try { return action(); }
  catch (error) {
    if (error instanceof BridgeRejection) throw error;
    return reject('EFK_ARTIFACT_UNAVAILABLE', 'explicit bridge file operation failed');
  }
}
function denyGraphPath(file: string): void {
  if (file.replace(/\\/g, '/').split('/').some(part => part.toLowerCase() === '.graph')) {
    reject('EFK_AUTHORITY_DENIED', 'SP truth directories are forbidden, even for reads');
  }
}
function nonLinkChain(file: string): void {
  const parent = path.dirname(file);
  if (parent !== file) nonLinkChain(parent);
  if (lstatSync(file).isSymbolicLink()) reject('EFK_AUTHORITY_DENIED', 'symlink/junction paths are forbidden');
}
function ignored(relative: string, rule: string): boolean {
  // Conservative positive-rule matching: negations never authorize graph-state access.
  const clean = rule.replace(/^\//, '').replace(/\/$/, '');
  if (/[\[\]\\]/.test(clean)) reject('EFK_AUTHORITY_DENIED', 'unsupported ignore pattern requires an explicit clean snapshot scope');
  let expression = '';
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '*' && clean[i + 1] === '*') {
      i++;
      if (clean[i + 1] === '/') { expression += '(?:.*/)?'; i++; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.+^${}()|]/g, '\\$&');
  }
  return new RegExp((rule.startsWith('/') || clean.includes('/') ? '^' : '(^|/)') +
    expression + '($|/)').test(relative);
}
/** Lexical denial precedes filesystem access; resolved containment rejects drive escapes. */
export function checkedPath(file: string, scope: FileScope, output: boolean): string {
  denyGraphPath(file); denyGraphPath(scope.root);
  if (!path.isAbsolute(file) || !path.isAbsolute(scope.root)) reject('EFK_AUTHORITY_DENIED', 'absolute explicit paths required');
  return external(() => {
    nonLinkChain(scope.root);
    const root = realpathSync.native(scope.root), logical = path.resolve(file);
    const relative = path.relative(root, logical);
    if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      reject('EFK_AUTHORITY_DENIED', 'path escapes the explicitly authorized root');
    }
    nonLinkChain(output ? path.dirname(logical) : logical);
    const resolved = output ? path.join(realpathSync.native(path.dirname(logical)), path.basename(logical)) : realpathSync.native(logical);
    denyGraphPath(resolved);
    const rel = path.relative(root, resolved).split(path.sep).join('/');
    if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) reject('EFK_AUTHORITY_DENIED', 'resolved path escapes root');
    // Read only ignore files within the explicit scope, never discover a graph/workspace.
    // Include ancestor policies so choosing an ignored subdirectory as root cannot bypass denial.
    let directory = path.parse(resolved).root;
    const components = path.relative(directory, resolved).split(path.sep);
    for (let i = 0; i < components.length; i++) {
      const ignoreFile = path.join(directory, '.gitignore');
      try {
        const stat = lstatSync(ignoreFile);
        if (!stat.isFile() || stat.isSymbolicLink()) reject('EFK_AUTHORITY_DENIED', 'ignore policy must be a regular file');
        const suffix = components.slice(i).join('/');
        for (const line of readFileSync(ignoreFile, 'utf8').replace(/\r\n?/g, '\n').split('\n')) {
          const rule = line.trim();
          if (rule !== '' && !rule.startsWith('#') && !rule.startsWith('!') && ignored(suffix, rule)) {
            reject('EFK_AUTHORITY_DENIED', 'gitignored paths cannot carry SP bridge data');
          }
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      directory = path.join(directory, components[i]);
    }
    if (!output && !lstatSync(resolved).isFile()) reject('EFK_AUTHORITY_DENIED', 'input must be a regular file');
    return resolved;
  });
}
export function readText(file: string): string {
  return external(() => {
    const bytes = readFileSync(file);
    if (!isUtf8(bytes)) reject('EFK_SCHEMA_INVALID', 'SP snapshot must be UTF-8');
    return bytes.toString('utf8');
  });
}
