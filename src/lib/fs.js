import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { EvoFenceError, invariant } from './errors.js';

export function stableStringify(value) {
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]));
    }
    return item;
  };
  return JSON.stringify(sort(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertInside(root, target) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  invariant(relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)), 'PATH_ESCAPE', `Path escapes its controlled root: ${target}`);
  return absoluteTarget;
}

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
}

export async function writeJsonAtomic(filename, value) {
  await ensureDirectory(path.dirname(filename));
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, filename);
}

export async function writeNewFile(filename, contents) {
  await ensureDirectory(path.dirname(filename));
  await writeFile(filename, contents, { flag: 'wx', mode: 0o600 });
}

export async function readJsonInside(root, filename, maxBytes = 1_048_576) {
  assertInside(root, filename);
  const parentInfo = await lstat(path.dirname(filename));
  const fileInfo = await lstat(filename);
  invariant(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), 'UNSAFE_ARTIFACT', `Artifact directory is not a normal directory: ${path.dirname(filename)}`);
  invariant(fileInfo.isFile() && !fileInfo.isSymbolicLink(), 'UNSAFE_ARTIFACT', `Artifact must be a regular file: ${filename}`);
  invariant(fileInfo.size <= maxBytes, 'ARTIFACT_TOO_LARGE', `Artifact exceeds the ${maxBytes}-byte size limit: ${filename}`);
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new EvoFenceError('INVALID_JSON', `${filename} is not valid JSON: ${error.message}`);
    throw error;
  }
}

export async function removeInside(root, target) {
  assertInside(root, target);
  const parentInfo = await lstat(path.dirname(target));
  invariant(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to remove through a symbolic-link parent: ${path.dirname(target)}`);
  const info = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!info) return;
  invariant(!info.isSymbolicLink(), 'UNSAFE_PATH', `Refusing to remove a symbolic link: ${target}`);
  await rm(target, { recursive: info.isDirectory(), force: false });
}
