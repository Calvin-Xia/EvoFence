import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { compileGraph } from '../../dist/kernel/graph/index.js';
import { config, evidence, value, record, writeJson } from './io.mjs';
import { setup, ctx, agentOptions, handles, cleanup } from './native.mjs';
import { budget } from './meter.mjs';
import { createKernel } from './graph.mjs';

// Native projection maintenance after completed kernel claims, no model turn.
await setup({ started() { throw new Error('No checkpoint tool belongs to board settlement'); } });
try {
  const count = budget.requests.length;
  const completion = JSON.parse(fs.readFileSync(path.join(evidence, 'completion.json')));
  const parent = await ctx.agents.resume({ resumeSessionId: completion.parentSessionId, agentOptions: agentOptions() }); handles.push(parent);
  const graph = compileGraph(JSON.parse(fs.readFileSync(path.join(evidence, 'dynamic-graph.json'))).after); assert(graph.ok);
  const g = JSON.parse(fs.readFileSync(path.join(evidence, 'recovered-grant.json'))).grant;
  const kernel = createKernel(graph.graph, {}, g, () => { throw new Error('Already evaluated; never regenerate task verdict'); });
  const state = value(kernel.service.read(kernel.seed.sessionId)); assert.equal(state.scheduler.claims.length, 0);
  const invocations = ['logic', 'tests', 'verify', 'finish'].map(stage => JSON.parse(fs.readFileSync(path.join(evidence, `invocation-${stage}.json`))));
  const before = ctx.agentTeams.listTasks(parent.agent);
  for (const task of before.filter(t => t.ownerId !== undefined)) {
    const owner = invocations.find(i => i.sessionId === task.ownerId && task.description === `projection-only:${i.claim.claimId}`);
    assert(owner, 'Only recorded projection ownership can be released');
    await ctx.agentTeams.updateTask(parent.agent, { taskId: task.id, expectedRevision: task.revision, action: 'release' });
  }
  await ctx.sessionPersistence.flush();
  const after = ctx.agentTeams.listTasks(parent.agent);
  assert(after.every(t => t.ownerId === undefined)); assert.equal(budget.requests.length, count, 'Projection cleanup must not call a model');
  writeJson(path.join(evidence, 'final-board.json'), { kernelClaims: state.scheduler.claims, before, after,
    modelRequests: 0, parentSessionId: parent.agent.id, events: parent.agent.session.snapshotEvents() });
  record('final-board-settled', { nativeTasks: after.length, nativeOwners: 0, kernelClaims: 0, modelRequests: 0 });
  process.stdout.write('Native board projections settled; zero model requests.\n');
} finally { await cleanup(); }
