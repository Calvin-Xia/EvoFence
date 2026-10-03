import { open, rename, mkdir, readFile, lstat, realpath, readdir, writeFile, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from '../protocol/index.js';
import type { ErrorCode, ErrorEnvelope } from '../protocol/index.js';
import { validPath } from '../runtime/workspace/rules.js';
import type { WorkspaceFiles, WorkspaceFile } from '../runtime/workspace/types.js';

export class WorkspaceIOError extends Error {
  readonly envelope: ErrorEnvelope;
  constructor(code: ErrorCode, message: string) { super(message); this.envelope = fail(code, message); }
}
export function ioError(error: unknown): ErrorEnvelope {
  return error instanceof WorkspaceIOError ? error.envelope : fail('EFK_HOST_EXECUTION_FAILED', String(error));
}
export async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
/** A same-volume pointer/record replace. File contents are synced before the rename. */
export async function atomicJSON(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx');
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, file);
}
export async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
/** Real FS boundary: reject links, aliases, directories-as-files and Windows ADS/traversal. */
export async function scopedPath(root: string, relative: string): Promise<string> {
  if (!validPath(relative)) throw new WorkspaceIOError('EFK_AUTHORITY_DENIED', `invalid workspace path ${relative}`);
  const canonicalRoot = await realpath(root);
  let cursor = canonicalRoot;
  const parts = relative.split('/');
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    if (!await exists(cursor)) continue;
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) {
      throw new WorkspaceIOError('EFK_AUTHORITY_DENIED', `non-regular or linked workspace path ${relative}`);
    }
    const resolved = await realpath(cursor);
    const within = path.relative(canonicalRoot, resolved);
    if (within.startsWith('..') || path.isAbsolute(within)) throw new WorkspaceIOError('EFK_AUTHORITY_DENIED', `workspace path escapes ${relative}`);
  }
  return cursor;
}
export async function readText(root: string, relative: string): Promise<WorkspaceFile | null> {
  const file = await scopedPath(root, relative);
  if (!await exists(file)) return null;
  const bytes = await readFile(file);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content).equals(bytes) || content.includes('\0')) throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', 'workspace adapter supports UTF-8 text files only');
  return { content, executable: ((await lstat(file)).mode & 0o111) !== 0 };
}
export async function writeText(root: string, relative: string, file: WorkspaceFile | null): Promise<void> {
  const target = await scopedPath(root, relative);
  if (file === null) { if (await exists(target)) await unlink(target); return; }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.content);
  if (process.platform !== 'win32') await chmod(target, file.executable ? 0o755 : 0o644);
}
export async function treeFiles(root: string): Promise<WorkspaceFiles> {
  const files: Record<string, WorkspaceFile> = Object.create(null);
  async function walk(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.toLowerCase() === '.git') continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new WorkspaceIOError('EFK_AUTHORITY_DENIED', `linked workspace entry ${name}`);
      if (entry.isDirectory()) await walk(name);
      else files[name] = (await readText(root, name))!;
    }
  }
  await walk('');
  const names = Object.keys(files);
  if (new Set(names.map(p => p.toLowerCase())).size !== names.length) throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', 'case aliases are unsupported workspace paths');
  return { ...files };
}
