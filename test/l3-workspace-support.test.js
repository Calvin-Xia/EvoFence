/** Evidence harness: real local FS/Git; L2 memory store exported to disk after each CAS for process-kill tests. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createMemoryEventStore, createMemoryArtifactStore } from '../dist/storage/index.js';
import { canonical } from '../dist/kernel/store/identity.js';
import { createWorkspaceProvider, createGitWorkspaceDriver, createFilesystemWorkspaceDriver,
  initializeFilesystemWorkspace } from '../dist/workspace/index.js';
import { git } from '../dist/workspace/git.js';
import { verifyEffect } from '../dist/runtime/host-port/index.js';

export const protocol = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
export const digest = { digest: bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
export const ok = r => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.value; };
export const err = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); return r.error; };
export const text = content => ({ content, executable: false });
export const initial = { 'a.txt': text('base-a\n'), 'b.txt': text('base-b\n'), 'skills/new/SKILL.md': text('project candidate\n') };
export function diskPorts(root) {
  const journalFile = path.join(root, 'journal.json'), artifactFile = path.join(root, 'artifacts.json');
  const store = createMemoryEventStore({ digest }), artifacts = createMemoryArtifactStore({ digest });
  const values = existsSync(artifactFile) ? JSON.parse(readFileSync(artifactFile, 'utf8')) : [];
  for (const entry of values) ok(artifacts.put(entry.ref, entry.bytes));
  if (existsSync(journalFile)) for (const s of JSON.parse(readFileSync(journalFile, 'utf8'))) ok(store.restoreSession(s));
  function save(file, value) { const temp = `${file}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(value)); renameSync(temp, file); }
  const persistentStore = new Proxy(store, { get(target, property) {
    const fn = target[property]; if (typeof fn !== 'function') return fn;
    return (...args) => { const result = fn(...args);
      if (result.ok && ['createSession', 'append', 'dispatchEffect', 'applyReceipt', 'reconcileEffect'].includes(property)) {
        save(journalFile, store.sessionIds().map(id => ok(store.exportSession(id))));
      }
      return result;
    };
  } });
  const persistentArtifacts = { get: ref => artifacts.get(ref), ids: () => artifacts.ids(), put(ref, bytes) {
    const result = artifacts.put(ref, bytes);
    if (result.ok && !values.some(v => v.ref.id === ref.id)) { values.push({ ref, bytes }); save(artifactFile, values); }
    return result;
  } };
  return { store: persistentStore, artifacts: persistentArtifacts };
}
export async function loadFixture(root, checkpoint) {
  const setup = JSON.parse(await readFile(path.join(root, 'setup.json'), 'utf8'));
  const driver = setup.kind === 'git' ? await createGitWorkspaceDriver({ repository: path.join(root, 'repo'),
    integrationRef: 'refs/heads/integration', workspaceId: 'workspace-1', identity: { name: 'Workspace Test', email: 'workspace@example.invalid' } })
    : await createFilesystemWorkspaceDriver(path.join(root, 'assets'), 'workspace-1');
  const ports = diskPorts(root), clock = { now: () => 100 };
  const resourcePaths = { 'file-a': ['a.txt'], 'file-b': ['b.txt'], 'project-skills': ['skills/'], escape: ['escape/'], outside: ['outside.txt'] };
  const options = { driver, ...ports, digest, clock, checkpoint, resourcePaths };
  return { root, kind: setup.kind, ...options, provider: createWorkspaceProvider(options) };
}
export async function fixture(kind, t) {
  const root = await mkdtemp(path.join(tmpdir(), 'evofence-l3-workspace-'));
  await writeFile(path.join(root, 'setup.json'), JSON.stringify({ kind }));
  if (kind === 'git') {
    const repo = path.join(root, 'repo'); await mkdir(repo);
    await git(repo, ['init', '--initial-branch=seed']);
    await git(repo, ['config', 'core.autocrlf', 'false']);
    for (const [name, file] of Object.entries(initial)) { await mkdir(path.dirname(path.join(repo, name)), { recursive: true }); await writeFile(path.join(repo, name), file.content); }
    await git(repo, ['add', '--all']);
    const tree = (await git(repo, ['write-tree'])).trim();
    const commit = (await git(repo, ['-c', 'user.name=Workspace Test', '-c', 'user.email=workspace@example.invalid', 'commit-tree', tree, '-m', 'fixture base'])).trim();
    await git(repo, ['update-ref', 'refs/heads/integration', commit]);
  } else await initializeFilesystemWorkspace(path.join(root, 'assets'), 'workspace-1', initial);
  const f = await loadFixture(root);
  ok(f.store.createSession({ sessionId: 'session-1', epoch: 1, protocol }));
  t?.diagnostic(JSON.stringify({ evidenceLevel: 'real local FS/Git + L2 reference EventStore exports', kind, root }));
  return f;
}
export function binding(base, id) { return { sessionId: 'session-1', hostSessionId: 'host-1',
  graph: { graphId: 'graph-1', revision: 1, digest: digest.digest('graph') }, nodeId: `node-${id}`,
  attemptId: `attempt-${id}`, attemptOrdinal: 1, epoch: 1, baseDigest: base.digest }; }
export function grant(base, token = 1, scopeOver = {}) {
  return { grantId: `grant-${token}`, rootAuthorityRef: 'root-1', scope: {
    workspaceRef: { protocol, id: base.workspaceId, digest: base.digest, producer: { actorId: 'workspace-adapter', kind: 'host-adapter', identityRef: null },
      binding: null, schema: { name: 'WorkspaceSnapshot', version: '1.1.0', digest: digest.digest('workspace-schema') },
      location: `workspace:${base.workspaceId}:${base.revision}`, visibility: 'internal', expiresAt: null, partition: 'not-evaluation' }, readResources: ['file-a', 'file-b', 'project-skills'],
    writeResources: ['file-a', 'file-b', 'project-skills'], artifactScopes: ['project'], trustDomain: 'same-user', ...scopeOver },
    budget: { poolId: 'pool-1', category: 'development', authorizationRef: 'auth-1', maxRequests: 20, maxInputTokens: 1000,
      maxOutputTokens: 1000, maxUsdMicros: null, maxWallMs: 10000, maxConcurrentRequests: 2 },
    issuedEpoch: 1, expiresAt: 10000, remainingDepth: 1, maxConcurrency: 2, revocationEpoch: 0, revoked: false };
}
export async function candidate(f, id, changes, token = 1, scopeOver = {}) {
  const base = ok(await f.provider.base()), b = binding(base, id), g = grant(base, token, scopeOver);
  const stage = ok(await f.provider.stage({ base, binding: b, grant: g }));
  for (const change of changes) ok(await f.provider.write(stage, change));
  const ref = ok(await f.provider.seal(stage));
  return { base, stage, ref, grant: g, binding: b };
}
export function intend(f, id, candidate, over = {}) {
  const e = { protocol, effectId: `effect-${id}`, idempotencyKey: `idem-${id}`, binding: candidate.binding,
    authorityRef: candidate.grant.grantId, reservationRef: 'reserved-1',
    leases: [{ resourceId: f.driver.resourceId, ownerClaimId: `owner-${id}`, epoch: 1,
      fencingToken: Number(candidate.grant.grantId.split('-').at(-1)), expiresAt: 10000 }],
    inputRefs: [candidate.ref], deadline: 10000, kind: 'host.tool', payload: { context: null, toolName: 'workspace.apply', argumentsRef: candidate.ref,
      graphRef: null, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' }, ...over };
  const state = ok(f.store.exportSession('session-1'));
  ok(f.store.append({ sessionId: 'session-1', requestId: `command-${id}`, expectedRevision: state.revision, epoch: 1,
    events: [{ protocol, eventId: `intention-${id}`, sessionId: 'session-1', epoch: 1, causedBy: `command-${id}`, type: 'effect.intended', visibility: 'internal',
      payload: { binding: e.binding, objectRef: null, before: null, after: null, effectId: e.effectId, decisionId: null, changedIds: [], error: null } }],
    effects: [e], receipts: [] }));
  return ok(verifyEffect(e, { grants: [candidate.grant], now: 100 }));
}
export async function currentFiles(f) { return f.driver.files(ok(await f.provider.base())); }
export async function undoRequest(f, result, id, token) {
  const base = ok(await f.provider.base());
  return intend(f, id, { ref: result.evidence, binding: binding(base, id), grant: grant(base, token) });
}
if (process.argv[2] === '--worker') {
  const [root, point] = process.argv.slice(3);
  const f = await loadFixture(root, async hit => { if (hit === point) { process.send({ hit }); await new Promise(() => {}); } });
  const request = JSON.parse(await readFile(path.join(root, 'worker.json'), 'utf8'));
  const result = await f.provider.apply(request.authorized, request.ref);
  process.send({ result });
}
