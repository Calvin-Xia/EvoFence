/** Git is optional infrastructure. The integration ref, not a mutable checkout, is the atomic read surface. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from '../kernel/store/identity.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import { fileAt, validPath } from '../runtime/workspace/rules.js';
import { WorkspaceIOError, writeText } from './io.js';
import type { WorkspaceBase, WorkspaceFiles } from '../runtime/workspace/types.js';
import type { WorkspaceDriver, WorkspaceOptions } from './types.js';

const run = promisify(execFile);
const hash = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export async function git(repository: string, args: readonly string[]): Promise<string> {
  const result = await run('git', ['-C', repository, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return result.stdout;
}
export interface GitWorkspaceOptions {
  readonly repository: string;
  readonly integrationRef: string;
  readonly workspaceId: string;
  readonly identity: { readonly name: string; readonly email: string };
}
export async function createGitWorkspaceDriver(options: GitWorkspaceOptions): Promise<WorkspaceDriver> {
  const { repository, integrationRef, workspaceId, identity } = options;
  await git(repository, ['check-ref-format', integrationRef]);
  if (!integrationRef.startsWith('refs/heads/')) throw new WorkspaceIOError('EFK_SCHEMA_INVALID', 'integration must be an explicit branch ref');
  const worktrees = await git(repository, ['worktree', 'list', '--porcelain']);
  if (worktrees.split('\n').includes(`branch ${integrationRef}`)) {
    throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', 'integration ref must not be checked out; consume snapshots through WorkspacePort');
  }
  const common = (await git(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  // Every provider of the same integration ref shares this lock, even through another worktree.
  const controlDir = path.join(common, 'evofence-workspace', hash(integrationRef).slice(7));
  await mkdir(path.join(controlDir, 'stages'), { recursive: true });
  const emptyHooks = path.join(controlDir, 'empty-hooks');
  await mkdir(emptyHooks, { recursive: true });
  const readTree = async (revision: string): Promise<WorkspaceFiles> => {
    const listing = await git(repository, ['ls-tree', '-r', '-z', revision]);
    const result: Record<string, { content: string; executable: boolean }> = Object.create(null);
    for (const row of listing.split('\0').filter(Boolean)) {
      const tab = row.indexOf('\t');
      const [mode, kind, oid] = row.slice(0, tab).split(' '), name = row.slice(tab + 1);
      if (!validPath(name) || kind !== 'blob' || !['100644', '100755'].includes(mode)) {
        throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', `Git snapshot contains unsupported path/mode ${name}`);
      }
      const blob = await run('git', ['-C', repository, 'cat-file', 'blob', oid], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
      const content = blob.stdout.toString('utf8');
      if (!Buffer.from(content).equals(blob.stdout) || content.includes('\0')) throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', 'Git workspace supports UTF-8 text only');
      result[name] = { content, executable: mode === '100755' };
    }
    const names = Object.keys(result);
    if (new Set(names.map(p => p.toLowerCase())).size !== names.length) throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', 'Git tree contains case aliases');
    return { ...result };
  };
  const files = async (base: WorkspaceBase): Promise<WorkspaceFiles> => {
    if (base.workspaceId !== workspaceId) throw new WorkspaceIOError('EFK_ARTIFACT_BINDING_MISMATCH', 'foreign Git workspace base');
    const result = await readTree(base.revision);
    if (hash(canonical(result)) !== base.digest) throw new WorkspaceIOError('EFK_ARTIFACT_DIGEST_MISMATCH', 'Git base content digest mismatch');
    return result;
  };
  const fromRevision = async (revision: string): Promise<WorkspaceBase> => {
    const result = await readTree(revision);
    return { workspaceId, revision, digest: hash(canonical(result)), isolation: 'git-worktree', osSandbox: false };
  };
  const stage = async (base: WorkspaceBase, id: string): Promise<string> => {
    const root = path.join(controlDir, 'stages', id);
    await git(repository, ['-c', `core.hooksPath=${emptyHooks}`, 'worktree', 'add', '--detach', root, base.revision]);
    return root;
  };
  const current = async () => fromRevision((await git(repository, ['rev-parse', '--verify', integrationRef])).trim());
  return {
    workspaceId, resourceId: workspaceId, controlDir,
    current, files, stage,
    async prepare(before: WorkspaceBase, target: WorkspaceFiles, id: string, checkpoint: WorkspaceOptions['checkpoint']) {
      // Keep Git's per-worktree metadata paths below its Windows path limit; the full key stays in the host record.
      const root = await stage(before, `app-${id.slice(0, 24)}`);
      const old = await files(before);
      for (const name of [...new Set([...Object.keys(old), ...Object.keys(target)])].sort()) {
        await writeText(root, name, fileAt(target, name));
        await checkpoint?.('candidate-file');
      }
      // Build exact blobs without repository clean filters, hooks or line-ending conversions.
      for (const name of Object.keys(old).filter(p => !Object.hasOwn(target, p))) await git(root, ['update-index', '--force-remove', '--', name]);
      for (const [name, file] of Object.entries(target)) {
        const blob = (await git(root, ['hash-object', '-w', '--no-filters', '--', path.join(root, name)])).trim();
        await git(root, ['update-index', '--add', '--cacheinfo', file.executable ? '100755' : '100644', blob, name]);
      }
      const tree = (await git(root, ['write-tree'])).trim();
      const revision = (await git(root, ['-c', 'commit.gpgSign=false', '-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`,
        'commit-tree', tree, '-p', before.revision, '-m', `Workspace transaction ${id}`])).trim();
      const after = await fromRevision(revision);
      if (after.digest !== hash(canonical(target))) throw new WorkspaceIOError('EFK_ARTIFACT_DIGEST_MISMATCH', 'Git filters altered candidate bytes; nothing published');
      return after;
    },
    async publish(before, after) {
      try { await git(repository, ['-c', `core.hooksPath=${emptyHooks}`, 'update-ref', integrationRef, after.revision, before.revision]); return storeOk(undefined); }
      catch (error) {
        // Ref CAS contention is a business conflict; unrelated Git failures stay visible.
        const observed = await current();
        if (observed.revision !== before.revision) return storeFail('EFK_REVISION_CONFLICT', 'integration ref moved; rebase/replan required');
        throw error;
      }
    },
  };
}
