/**
 * Shared filesystem / hashing leaf module.
 *
 * Converted 1:1 from `src/lib/fs.js` (L2 io domain, node `l2_config`). All eight exports keep
 * their names and semantics (R2). It is the shared bottom layer for every domain, so the only
 * changes here are type annotations plus ESM-compatible `catch (error)` narrowing.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { EvoFenceError, invariant } from './errors.js';

/** Error code carried by a non-`Error` throw, or `undefined`. */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Recursively sort object keys so two equal values always stringify identically. */
function sortedForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedForHash);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortedForHash(record[key])]));
  }
  return value;
}

/** Canonical JSON with sorted keys; the hashing input for every digest in the ledger. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortedForHash(value));
}

/** Lowercase hex SHA-256 of a string (or byte view). */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Resolve `target` and fail closed when it escapes `root`. Returns the absolute target. */
export function assertInside(root: string, target: string): string {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  invariant(relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)), 'PATH_ESCAPE', `Path escapes its controlled root: ${target}`);
  return absoluteTarget;
}

/** `mkdir -p`. */
export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

/** Write JSON through a same-directory temp file + rename, mode 0600, never clobbering. */
export async function writeJsonAtomic(filename: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filename));
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, filename);
}

/** Create a new file (fails if it exists), mode 0600. */
export async function writeNewFile(filename: string, contents: string): Promise<void> {
  await ensureDirectory(path.dirname(filename));
  await writeFile(filename, contents, { flag: 'wx', mode: 0o600 });
}

/**
 * Read and parse a JSON artifact under `root`, refusing symlinked parents/leaves, oversized
 * files, and malformed JSON (`UNSAFE_ARTIFACT` / `ARTIFACT_TOO_LARGE` / `INVALID_JSON`).
 */
export async function readJsonInside(root: string, filename: string, maxBytes = 1_048_576): Promise<unknown> {
  assertInside(root, filename);
  const parentInfo = await lstat(path.dirname(filename));
  const fileInfo = await lstat(filename);
  invariant(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), 'UNSAFE_ARTIFACT', `Artifact directory is not a normal directory: ${path.dirname(filename)}`);
  invariant(fileInfo.isFile() && !fileInfo.isSymbolicLink(), 'UNSAFE_ARTIFACT', `Artifact must be a regular file: ${filename}`);
  invariant(fileInfo.size <= maxBytes, 'ARTIFACT_TOO_LARGE', `Artifact exceeds the ${maxBytes}-byte size limit: ${filename}`);
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new EvoFenceError('INVALID_JSON', `${filename} is not valid JSON: ${error.message}`);
    throw error;
  }
}

/** Remove a path under `root`, refusing symbolic links and symlinked parents. */
export async function removeInside(root: string, target: string): Promise<void> {
  assertInside(root, target);
  const parentInfo = await lstat(path.dirname(target));
  invariant(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to remove through a symbolic-link parent: ${path.dirname(target)}`);
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    return;
  }
  invariant(!info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to remove a symbolic link: ${target}`);
  await rm(target, { recursive: info.isDirectory(), force: false });
}
