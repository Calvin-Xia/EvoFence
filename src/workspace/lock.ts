import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import type { StoreResult } from '../kernel/store/contracts.js';
import { atomicJSON, exists, json } from './io.js';

interface Owner { readonly pid: number; readonly instance: string; readonly key: string }
export interface WriterLock { readonly directory: string; readonly owner: Owner }
export async function acquireLock(control: string, name: string, instance: string, key: string): Promise<StoreResult<WriterLock>> {
  const directory = path.join(control, name);
  try { await mkdir(directory); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return storeFail('EFK_CLAIM_CONFLICT', 'single integration/stage writer already held');
    throw e;
  }
  const owner = { pid: process.pid, instance, key };
  await atomicJSON(path.join(directory, 'owner.json'), owner);
  return storeOk({ directory, owner });
}
export async function releaseLock(lock: WriterLock): Promise<void> {
  // The exact lock directory was acquired by this call; never delete the surrounding workspace.
  await rm(lock.directory, { recursive: true });
}
/** A lock never expires itself. Recovery proves the original local owner is dead (or this idle instance). */
export async function recoveryLock(control: string, instance: string, key: string, active: boolean): Promise<StoreResult<WriterLock>> {
  const directory = path.join(control, 'writer.lock');
  if (!await exists(directory)) return acquireLock(control, 'writer.lock', instance, key);
  const arbiter = await acquireLock(control, 'reconcile.lock', instance, key);
  if (!arbiter.ok) return arbiter;
  try {
    const ownerFile = path.join(directory, 'owner.json');
    if (!await exists(ownerFile)) return storeFail('EFK_EFFECT_UNKNOWN', 'writer died before owner evidence; manual inspection required');
    const owner = await json<Owner>(ownerFile);
    if (owner.key !== key) return storeFail('EFK_CLAIM_CONFLICT', 'another application owns the integration writer');
    let alive = true;
    try { process.kill(owner.pid, 0); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw e; }
    if (alive && (owner.instance !== instance || active)) return storeFail('EFK_CLAIM_CONFLICT', 'cannot reconcile a live integration writer');
    await releaseLock({ directory, owner });
    return acquireLock(control, 'writer.lock', instance, key);
  } finally { await releaseLock(arbiter.value); }
}
