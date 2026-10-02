import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractExperience, proposeDeterministically, verifyCandidates, stageCandidate } from '../dist/learning/proposals/index.js';
import { fixture, limits, value } from './l4-experience-fixtures.test.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = [
  { lane: 'l3-pi-scenario', relative: 'scenarios/pi/evidence/trace.jsonl', hostId: 'pi', modelId: 'deepseek/deepseek-flash', name: 'Pi initial' },
  { lane: 'l3-pi-scenario', relative: 'scenarios/pi/evidence/attempt-2/trace.jsonl', hostId: 'pi', modelId: 'deepseek/deepseek-flash', name: 'Pi attempt-2' },
  { lane: 'l3-dsh-scenario', relative: 'scenarios/dsh/evidence/trace.jsonl', hostId: 'dsh', modelId: 'deepseek/deepseek-flash', name: 'DSH' },
];

for (const source of sources) test(`provider-live source cp1/cp3: ${source.name} visible operational trace yields staged conditional candidates`, async t => {
  const filename = path.resolve(root, '..', source.lane, source.relative);
  try { await stat(filename); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('local gitignored scenario trace unavailable'); throw error; }
  const bytes = await readFile(filename, 'utf8'), f = fixture();
  const ref = f.artifact(bytes, { id: `real-${source.hostId}-${source.name.replaceAll(' ', '-')}`,
    location: filename, producer: { actorId: `${source.hostId}-scenario-driver`, kind: 'host-adapter', identityRef: null } });
  const selection = f.selection(ref, { grade: 'provider-live', scope: { projectId: 'EvoFence-scenario', hostId: source.hostId,
    modelId: source.modelId, taskId: 'ledger-limit' }, whyVisible: 'Brief §2 explicitly selects the visible L3 scenario operational trace as train; excludes raw sessions, private tests and final evaluator artifacts.' });
  const experience = value(extractExperience([selection], limits, 1000, f.ports));
  const candidates = value(proposeDeterministically(experience, f.ports));
  value(verifyCandidates(candidates, experience, 1000, f.ports));
  assert.ok(candidates.length > 0); assert.ok(experience.traces[0].events.length > 0);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'l4-experience-real-'));
  try {
    const stagingRoot = path.join(temp, 'staged'); await mkdir(stagingRoot);
    for (const candidate of candidates) value(await stageCandidate(candidate, experience,
      { projectRoot: temp, stagingRoot, userSkillRoots: [] }, 1000, f.ports));
    t.diagnostic(JSON.stringify({ grade: 'provider-live-source', generation: 'deterministic-zero-provider',
      trace: filename, digest: ref.digest, lines: experience.traces[0].totalLines, visibleObservations: experience.traces[0].events.length,
      candidates: candidates.map(c => ({ candidateId: c.candidateId, facet: experience.patterns.find(p => p.patternId === c.patternId).facet,
        supportLine: c.support[0].line, counterexampleLine: c.counterexamples[0].event.line })), paidGenerationRequests: 0 }));
  } finally {
    const resolved = await realpath(temp), base = await realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('l4-experience-real-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
