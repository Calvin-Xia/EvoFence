/** Project-local assets use immutable directory snapshots; a single pointer selects the active snapshot. */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { canonical } from '../kernel/store/identity.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import { sameBase } from '../runtime/workspace/rules.js';
import { atomicJSON, exists, json, treeFiles, writeText, WorkspaceIOError } from './io.js';
import type { WorkspaceBase, WorkspaceFiles } from '../runtime/workspace/types.js';
import type { WorkspaceDriver } from './types.js';

const hash = (bytes: string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
/** Initialization requires a new directory: never imports/overwrites existing global Skills. */
export async function initializeFilesystemWorkspace(root: string, workspaceId: string, initial: WorkspaceFiles): Promise<void> {
  await mkdir(root);
  await mkdir(path.join(root, 'snapshots'));
  await mkdir(path.join(root, 'stages'));
  await mkdir(path.join(root, 'control'));
  const revision = randomUUID(), directory = path.join(root, 'snapshots', revision);
  await mkdir(directory);
  for (const [name, file] of Object.entries(initial)) await writeText(directory, name, file);
  const actual = await treeFiles(directory);
  // Windows has no portable executable mode; do not silently certify a requested executable.
  if (canonical(actual) !== canonical(initial)) throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', 'filesystem cannot preserve requested file modes');
  await atomicJSON(path.join(root, 'HEAD.json'), { workspaceId, revision, digest: hash(canonical(actual)), isolation: 'versioned-directory', osSandbox: false });
}
export async function createFilesystemWorkspaceDriver(root: string, workspaceId: string): Promise<WorkspaceDriver> {
  const pointer = path.join(root, 'HEAD.json'), controlDir = path.join(root, 'control');
  if (!await exists(pointer)) throw new WorkspaceIOError('EFK_ARTIFACT_UNAVAILABLE', 'filesystem workspace must be explicitly initialized');
  const files = async (base: WorkspaceBase): Promise<WorkspaceFiles> => {
    if (base.workspaceId !== workspaceId || !/^[0-9a-f-]{36}$/.test(base.revision)) throw new WorkspaceIOError('EFK_ARTIFACT_BINDING_MISMATCH', 'invalid filesystem snapshot locator');
    const result = await treeFiles(path.join(root, 'snapshots', base.revision));
    if (hash(canonical(result)) !== base.digest) throw new WorkspaceIOError('EFK_ARTIFACT_DIGEST_MISMATCH', 'actual snapshot bytes differ from base digest');
    return result;
  };
  const current = async () => { const base = await json<WorkspaceBase>(pointer); await files(base); return base; };
  return {
    workspaceId, resourceId: workspaceId, controlDir,
    current, files,
    async stage(base, id) {
      const target = path.join(root, 'stages', id); await mkdir(target);
      for (const [name, file] of Object.entries(await files(base))) await writeText(target, name, file);
      return target;
    },
    async prepare(before, target, _id, checkpoint) {
      const revision = randomUUID(), directory = path.join(root, 'snapshots', revision); await mkdir(directory);
      for (const [name, file] of Object.entries(target)) { await writeText(directory, name, file); await checkpoint?.('candidate-file'); }
      const actual = await treeFiles(directory);
      if (canonical(actual) !== canonical(target)) throw new WorkspaceIOError('EFK_CAPABILITY_UNSUPPORTED', 'filesystem failed to preserve file modes');
      return { ...before, revision, digest: hash(canonical(actual)) };
    },
    async publish(before, after) {
      if (!sameBase(before, await current())) return storeFail('EFK_REVISION_CONFLICT', 'snapshot pointer moved; rebase/replan required');
      await files(after);
      await atomicJSON(pointer, after);
      return storeOk(undefined);
    },
  };
}
