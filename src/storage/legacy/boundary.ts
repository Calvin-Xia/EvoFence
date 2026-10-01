import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fail } from '../../protocol/index.js';
import type { ErrorCode, ErrorEnvelope } from '../../protocol/index.js';
import { storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';

/** Exceptions stay internal; public storage functions return the frozen ErrorEnvelope. */
class Rejection extends Error {
  constructor(readonly envelope: ErrorEnvelope) { super(envelope.message); }
}
export function reject(code: ErrorCode, message: string): never { throw new Rejection(fail(code, message)); }
export function boundary<T>(action: () => T): StoreResult<T> {
  try { return storeOk(action()); }
  catch (error) {
    if (error instanceof Rejection) return { ok: false, error: error.envelope };
    // Unexpected implementation failures are not disguised as input rejection.
    throw error;
  }
}
export function external<T>(code: ErrorCode, message: string, action: () => T): T {
  try { return action(); } catch (error) {
    if (error instanceof Rejection) throw error;
    return reject(code, message);
  }
}
export function digest(bytes: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) reject('EFK_SCHEMA_INVALID', 'expected an object');
  return value as Record<string, unknown>;
}
export function keys(value: unknown, expected: readonly string[]): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).length !== expected.length || expected.some(k => !Object.hasOwn(row, k))) {
    reject('EFK_SCHEMA_INVALID', 'missing or unknown legacy fields');
  }
  return row;
}
export function text(value: unknown): string {
  if (typeof value !== 'string') reject('EFK_SCHEMA_INVALID', 'expected legacy text');
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) reject('EFK_SCHEMA_INVALID', 'expected legacy array');
  return value;
}
export function json(bytes: string): unknown {
  const value: unknown = external('EFK_SCHEMA_INVALID', 'invalid legacy JSON', () => JSON.parse(bytes));
  jsonShape(value);
  return value;
}
export function utf8(bytes: Buffer): string {
  if (!isUtf8(bytes)) reject('EFK_SCHEMA_INVALID', 'legacy text is not valid UTF-8');
  return bytes.toString('utf8');
}
export function jsonShape(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value) || typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    if (ancestors.has(value)) reject('EFK_SCHEMA_INVALID', 'legacy data contains a cyclic alias graph');
    ancestors.add(value);
    Object.values(value).forEach(child => jsonShape(child, ancestors));
    ancestors.delete(value);
    return;
  }
  reject('EFK_SCHEMA_INVALID', 'legacy data contains a non-JSON value');
}
export function readRegular(file: string): { file: string; bytes: Buffer } {
  return external('EFK_ARTIFACT_UNAVAILABLE', 'cannot read a regular source file', () => {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) reject('EFK_AUTHORITY_DENIED', 'source must be a regular non-symlink file');
    return { file: realpathSync(file), bytes: readFileSync(file) };
  });
}
