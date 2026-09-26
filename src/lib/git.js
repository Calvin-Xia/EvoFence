import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvoFenceError, invariant } from './errors.js';
import { runProcess } from './process.js';
import { assertInside, sha256 } from './fs.js';

const CANDIDATE_PATHSPEC = ['.', ':!.evofence-out', ':!.evofence-out/**', ':!.evofence-task.md'];

export async function runGit(cwd, args, options = {}) {
  const result = await runProcess('git', args, { cwd, timeoutMs: options.timeoutMs ?? 30000, maxOutputBytes: options.maxOutputBytes ?? 10_000_000, env: options.env ?? {} });
  if (result.code !== 0) {
    throw new EvoFenceError('GIT_COMMAND_FAILED', `git ${args.join(' ')} failed${result.timed_out ? ' (timed out)' : ''}: ${result.stderr.trim() || result.stdout.trim()}`, { args, code: result.code, timed_out: result.timed_out });
  }
  return result.stdout;
}

export async function repositoryRoot(cwd) {
  const root = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim();
  return path.resolve(root);
}

export async function headSha(root) {
  return (await runGit(root, ['rev-parse', 'HEAD'])).trim();
}

export async function createWorktree(root, baseSha, worktreePath) {
  await runGit(root, ['worktree', 'add', '--detach', worktreePath, baseSha], { timeoutMs: 120000 });
  const actualRoot = await repositoryRoot(worktreePath);
  const [canonicalExpected, canonicalActual] = await Promise.all([realpath(worktreePath), realpath(actualRoot)]);
  invariant(path.relative(canonicalExpected, canonicalActual) === '', 'WORKTREE_MISMATCH', 'Git created a worktree at an unexpected path.', { expected: canonicalExpected, actual: canonicalActual });
  return worktreePath;
}

export async function worktreeMetadataSnapshot(worktreePath) {
  const pointer = path.join(worktreePath, '.git');
  const info = await lstat(pointer);
  invariant(info.isFile() && !info.isSymbolicLink(), 'WORKTREE_METADATA_CHANGED', 'Candidate worktree .git pointer is not a regular file.');
  const contents = await readFile(pointer);
  return { path: pointer, contents, sha256: sha256(contents) };
}

export async function restoreWorktreeMetadata(worktreePath, snapshot) {
  assertInside(worktreePath, snapshot.path);
  const current = await lstat(snapshot.path).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (current?.isDirectory() && !current.isSymbolicLink()) await rm(snapshot.path, { recursive: true, force: true });
  else if (current) await rm(snapshot.path, { force: true });
  await writeFile(snapshot.path, snapshot.contents, { flag: 'wx', mode: 0o600 });
}

export async function worktreeMetadataMatches(worktreePath, snapshot) {
  try {
    const current = await worktreeMetadataSnapshot(worktreePath);
    return current.sha256 === snapshot.sha256;
  } catch {
    return false;
  }
}

export async function removeWorktree(root, worktreePath) {
  const result = await runProcess('git', ['worktree', 'remove', '--force', worktreePath], { cwd: root, timeoutMs: 60000, maxOutputBytes: 100000 });
  if (result.code !== 0 && !result.stderr.includes('not a working tree')) {
    throw new EvoFenceError('WORKTREE_REMOVE_FAILED', result.stderr.trim() || `Unable to remove worktree ${worktreePath}.`);
  }
}

export async function changedPaths(root, baseSha) {
  const diff = await runGit(root, ['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', baseSha]);
  const untracked = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return [...new Set(`${diff}\0${untracked}`.split('\0').filter(Boolean).map((name) => name.replaceAll('\\', '/')))];
}

export async function changedPathsBetween(root, baseSha, targetSha) {
  const diff = await runGit(root, ['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', baseSha, targetSha]);
  return [...new Set(diff.split('\0').filter(Boolean).map((name) => name.replaceAll('\\', '/')))];
}

export async function diffHash(root, baseSha, targetSha = null, options = {}) {
  const args = ['diff', '--no-ext-diff', '--no-renames', '--binary', baseSha];
  if (targetSha) {
    args.push(targetSha);
  } else {
    const intent = await runProcess('git', ['add', '--intent-to-add', '--', ...CANDIDATE_PATHSPEC], { cwd: root, timeoutMs: 60000, maxOutputBytes: 100000 });
    if (intent.code !== 0) throw new EvoFenceError('GIT_STAGE_FAILED', intent.stderr.trim() || 'Unable to include new candidate files in the diff hash.');
    args.push('--', ...CANDIDATE_PATHSPEC);
  }
  const diff = await runGit(root, args, { maxOutputBytes: 50_000_000, env: options.env });
  return sha256(diff);
}

export async function commitCandidate(root, baseSha, generationId) {
  const stage = await runProcess('git', ['add', '-A', '--', ...CANDIDATE_PATHSPEC], { cwd: root, timeoutMs: 60000, maxOutputBytes: 100000 });
  if (stage.code !== 0) throw new EvoFenceError('GIT_STAGE_FAILED', stage.stderr.trim());
  const staged = await runProcess('git', ['diff', '--cached', '--quiet'], { cwd: root, timeoutMs: 30000, maxOutputBytes: 100000 });
  if (staged.code === 0) throw new EvoFenceError('NO_CHANGE', 'Candidate contains no accepted project changes.');
  if (staged.code !== 1) throw new EvoFenceError('GIT_DIFF_FAILED', staged.stderr.trim() || 'Could not inspect staged candidate changes.');
  const message = `evofence: accept generation ${generationId}`;
  const commit = await runProcess('git', ['-c', 'user.name=EvoFence', '-c', 'user.email=evofence@users.noreply.github.com', 'commit', '-m', message], { cwd: root, timeoutMs: 120000, maxOutputBytes: 500000 });
  if (commit.code !== 0) throw new EvoFenceError('GIT_COMMIT_FAILED', commit.stderr.trim() || commit.stdout.trim());
  return headSha(root);
}

export async function pinGeneration(root, generationId, sha) {
  await runGit(root, ['update-ref', `refs/evofence/generations/${generationId}`, sha]);
  await runGit(root, ['update-ref', 'refs/evofence/active', sha]);
}

export async function setActiveGenerationRef(root, sha) {
  await runGit(root, ['update-ref', 'refs/evofence/active', sha]);
}

export function createRunId() {
  return `run-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export async function openTreeCount(root) {
  const porcelain = await runGit(root, ['worktree', 'list', '--porcelain']);
  return porcelain.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).length;
}

export async function detachedWorktreeAt(root, commit, worktreePath) {
  return createWorktree(root, commit, worktreePath);
}
