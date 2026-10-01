import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { canonical } from '../kernel/store/identity.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import { checkScope, checkStage, changesBetween } from '../runtime/workspace/rules.js';
import type { StageRequest, WorkspaceStage, WorkspaceChange, StoreResult } from '../runtime/workspace/types.js';
import type { StageRecord, WorkspaceOptions } from './types.js';
import { acquireLock, releaseLock } from './lock.js';
import { atomicJSON, json, readText, treeFiles, writeText, WorkspaceIOError } from './io.js';
import { putArtifact } from './artifacts.js';

export function stageOperations(options: WorkspaceOptions, instance: string) {
  const { driver, clock, artifacts, digest } = options;
  const recordFile = (id: string) => path.join(driver.controlDir, 'stage-records', `${id}.json`);
  async function withStage<T>(handle: WorkspaceStage, action: (record: StageRecord) => Promise<StoreResult<T>>): Promise<StoreResult<T>> {
    if (!/^[0-9a-f-]{36}$/.test(handle.stageId)) return storeFail('EFK_SCHEMA_INVALID', 'invalid stage identifier');
    const lock = await acquireLock(driver.controlDir, `stage-${handle.stageId}.lock`, instance, handle.stageId);
    if (!lock.ok) return lock;
    try {
      const record = await json<StageRecord>(recordFile(handle.stageId));
      if (canonical(record.stage) !== canonical(handle)) return storeFail('EFK_AUTHORITY_DENIED', 'stage handle differs from granted scope/binding');
      if (handle.grant.revoked || handle.grant.expiresAt <= clock.now()) return storeFail('EFK_AUTHORITY_DENIED', 'stage grant no longer live');
      return await action(record);
    } finally { await releaseLock(lock.value); }
  }
  async function differences(record: StageRecord) {
    const actual = await treeFiles(record.root);
    const changes = changesBetween(await driver.files(record.stage.base), actual);
    for (const change of changes) {
      const permitted = checkScope(record.stage.grant.scope, change.path, 'write', options.resourcePaths);
      if (!permitted.ok) throw new WorkspaceIOError('EFK_AUTHORITY_DENIED', permitted.error.message);
    }
    return changes;
  }
  return {
    async stage(request: StageRequest) {
      const checked = checkStage(request, await driver.current(), clock.now());
      if (!checked.ok) return checked;
      const stage: WorkspaceStage = structuredClone({ ...request, stageId: randomUUID() });
      const root = await driver.stage(stage.base, stage.stageId);
      await mkdir(path.join(driver.controlDir, 'stage-records'), { recursive: true });
      await atomicJSON(recordFile(stage.stageId), { stage, root, sealed: null });
      return storeOk(stage);
    },
    read: (stage: WorkspaceStage, file: string) => withStage(stage, async record => {
      const checked = checkScope(stage.grant.scope, file, 'read', options.resourcePaths);
      return checked.ok ? storeOk(await readText(record.root, file)) : checked;
    }),
    write: (stage: WorkspaceStage, change: WorkspaceChange) => withStage(stage, async record => {
      if (record.sealed !== null) return storeFail('EFK_CLAIM_CONFLICT', 'sealed candidate is immutable; open a new stage');
      const checked = checkScope(stage.grant.scope, change.path, 'write', options.resourcePaths);
      if (!checked.ok) return checked;
      await writeText(record.root, change.path, change.file);
      return storeOk(undefined);
    }),
    diff: (stage: WorkspaceStage) => withStage(stage, async record => storeOk(await differences(record))),
    seal: (stage: WorkspaceStage) => withStage(stage, async record => {
      if (record.sealed !== null) return storeOk(record.sealed);
      const patch = { base: stage.base, binding: stage.binding, scope: stage.grant.scope, changes: await differences(record) };
      const stored = putArtifact(artifacts, digest, { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' }, stage.binding, 'WorkspacePatch', patch);
      if (!stored.ok) return stored;
      await atomicJSON(recordFile(stage.stageId), { ...record, sealed: stored.value });
      return stored;
    }),
  };
}
