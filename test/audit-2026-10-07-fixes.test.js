/**
 * Regression pins for the 2026-10-07 read-only audit findings that were fixed in this change.
 *
 * One test per item, each named with its finding id (G04, G06, G07, G13, G18, G19, G21) so a future
 * reader can trace the constraint back to the decision record in
 * `grilling/2026-10-07-audit-findings-grilling.md`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as hostPort from '../dist/runtime/host-port/index.js';
import { PI_SESSION_CAPABILITIES } from '../dist/hosts/pi/index.js';
import { commit, event } from '../dist/runtime/session/journal.js';
import { gitEnvironment } from '../dist/workspace/git.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };

test('G04: pi reports sdkChildSessionIsolation as a bounded partial, never verified', () => {
  const entry = PI_SESSION_CAPABILITIES.sdkChildSessionIsolation;
  assert.notEqual(entry.status, 'verified', 'the session lane has no evidence for verified');
  assert.equal(entry.status, 'unknown');
  const delegation = read('src/hosts/pi/delegation.ts');
  assert.match(delegation, /sdkChildSessionIsolation: \{ status: 'partial' as const/);
  assert.match(delegation, /verifiedSubset:/);
  assert.match(delegation, /unverified:/);
  assert.doesNotMatch(delegation, /sdkChildSessionIsolation: \{ status: 'verified'/,
    'the unbacked verified claim must not come back');
});

test('G18: the local HostGuarantee type only lets verified through with evidence', () => {
  const types = read('src/runtime/host-port/types.ts');
  assert.match(types, /export type HostGuarantee =/);
  assert.match(types, /readonly status: 'verified';/);
  assert.match(types, /readonly \[Decoded<'EvidenceRef'>, \.\.\.Decoded<'EvidenceRef'>\[\]\]/,
    'the verified branch must require a non-empty evidence tuple');
  // The refined type is what HostObservation and the fake-host fixture expose.
  const observation = read('src/runtime/host-port/types.ts');
  assert.match(observation, /readonly cancellation: HostGuarantee;/);
});

test('G07: createFakeHost is not reachable from the host-port barrel or evofence/core', async () => {
  assert.equal(Object.hasOwn(hostPort, 'createFakeHost'), false,
    'the barrel must not re-export the fabricating fake host');
  const deep = await import('../dist/runtime/host-port/host-fake.js');
  assert.equal(typeof deep.createFakeHost, 'function', 'tests still reach it by deep import');
  assert.doesNotMatch(read('src/runtime/host-port/index.ts'), /export \{ createFakeHost \}/);
});

test('G06: journal commit refuses a draft that violates the frozen Event schema', () => {
  const state = { sessionId: 'session-g06', protocol: PROTOCOL, revision: 1, epoch: 1 };
  const appended = [];
  const ports = { store: { append: (request) => { appended.push(request); return { ok: true, value: { sessionId: state.sessionId, revision: 2, eventIds: request.events.map((e) => e.eventId), effectIds: [] } }; } } };
  const command = { commandId: 'command-g06', expectedRevision: 1 };

  const valid = event(state, command.commandId, 'valid', 'node.transition', { changedIds: ['node-a'] });
  const accepted = commit(ports, state, command, { events: [valid], effects: [] });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error));
  assert.equal(appended.length, 1, 'a schema-valid draft still reaches the store');

  const duplicate = event(state, command.commandId, 'duplicate', 'node.transition', { changedIds: ['node-a', 'node-a'] });
  const refused = commit(ports, state, command, { events: [duplicate], effects: [] });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'EFK_SCHEMA_INVALID');
  assert.match(refused.error.message, /violates the Event schema/);
  assert.equal(appended.length, 1, 'the invalid batch never reaches the store');
});

test('G06: the join gap id list is de-duplicated before it becomes changedIds', () => {
  const plans = read('src/runtime/session/plans.ts');
  assert.match(plans, /const changedIds = \[\.\.\.new Set\(\[entry\.nodeId/);
  assert.doesNotMatch(plans, /changedIds: \[entry\.nodeId, \.\.\.\(entry\.readiness\.state === 'waiting'/);
});

test('G13: host plugins never resolve an evofence binary out of the inspected repository', () => {
  for (const file of ['integrations/pi/cli.js', 'integrations/opencode/plugins/cli.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /packageCli\(path\.resolve\(cwd, 'node_modules', 'evofence'\)\)/, file);
    assert.doesNotMatch(source, /packageCli\(path\.resolve\(cwd, '\.\.', 'node_modules', 'evofence'\)\)/, file);
    assert.doesNotMatch(source, /resolveCliInvocation\(cwd\)/, file);
  }
});

test('G19: git children receive an allow-listed environment, not the parent process env', () => {
  const env = gitEnvironment({
    PATH: '/usr/bin', HOME: '/home/fixture', USERPROFILE: 'C:/Users/fixture', SystemRoot: 'C:/Windows',
    AWS_SECRET_ACCESS_KEY: 'secret', NPM_TOKEN: 'token', GITHUB_TOKEN: 'token', GIT_ASKPASS: '/bin/ask',
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/fixture');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  for (const key of ['AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'GITHUB_TOKEN', 'GIT_ASKPASS']) {
    assert.equal(Object.hasOwn(env, key), false, `${key} must not reach the git child`);
  }
  const git = read('src/workspace/git.ts');
  assert.doesNotMatch(git, /\.\.\.process\.env/, 'the parent environment must not be spread into a child');
  assert.match(git, /env: gitEnvironment\(\)/);
});

test('G21: the codec guards dangling refs and bounds recursion', () => {
  const codec = read('src/protocol/codec.ts');
  assert.match(codec, /const MAX_VALIDATION_DEPTH = \d+;/);
  assert.match(codec, /keyword: '\$ref', message: `\$\{at\}: unknown definition/);
  assert.match(codec, /keyword: 'maxDepth'/);
  // A dangling ref must not be reachable by indexing; the resolver returns `undefined` and the
  // caller turns it into an envelope rather than a TypeError.
  assert.match(codec, /function resolveRef\(ref: string\): Def \| undefined/);
});

test('G20: the Super Plumber bridge factory takes no ports parameter', async () => {
  const bridge = await import('../dist/bridges/super-plumber/index.js');
  assert.equal(bridge.createSPBridge.length, 0);
  const types = read('src/bridges/super-plumber/types.ts');
  assert.doesNotMatch(types, /interface BridgePorts/, 'the unused witness type is gone');
});

test('G02: the release-status paragraphs point at the manifest instead of restating a version', () => {
  for (const doc of ['AGENTS.md', 'README.md', 'README.en.md']) {
    const text = read(doc);
    assert.doesNotMatch(text, /尚未\s*tag|not yet tagged|尚未\s*publish|not yet been published|未 tag\/publish|not yet released/i, doc);
  }
  assert.match(read('AGENTS.md'), /Do not restate the current version, tag or publish state/);
  assert.match(read('README.md'), /版本与发布状态不在文档里复述/);
  assert.match(read('README.en.md'), /Version and publish state are not restated here/);
});

test('G10: the gate-parity guard refuses a dropped gate and a missing timeout', async () => {
  const { gateParityProblems, scriptsIn } = await import('../scripts/check-gate-parity.mjs');
  const pkg = JSON.parse(read('package.json'));
  const ci = read('.github/workflows/ci.yml');
  const publish = read('.github/workflows/publish.yml');
  assert.deepEqual(gateParityProblems({ pkg, ci, publish }), []);
  assert.deepEqual(scriptsIn('npm run typecheck && npm run dep:check && npm test'), ['typecheck', 'dep:check', 'test']);
  const withoutDep = ci.replace(/^\s*- name: dep:check\n\s*run: npm run dep:check\n/m, '');
  assert.match(gateParityProblems({ pkg, ci: withoutDep, publish }).join('\n'), /dep:check/);
  const withoutTimeout = ci.replace(/^\s*timeout-minutes: \d+\n/m, '');
  assert.match(gateParityProblems({ pkg, ci: withoutTimeout, publish }).join('\n'), /timeout-minutes/);
});

test('G25/R4: the core-imports baseline is a shrink-only multiset and a crash is not "zero diagnostics"', async () => {
  const { compareToBaseline, parseBaseline, diagnosticKey, guardSummary } = await import('../scripts/check-core-imports-baseline.mjs');
  const known = 'I08|PORT_FALLBACK|src/a.ts|injected capability cannot fall back to a default backend';
  const baseline = parseBaseline({ diagnostics: [known] });
  const observed = parseBaseline({ diagnostics: [known, known] });
  assert.deepEqual(compareToBaseline(baseline, observed).added.length, 1, 'a new duplicate is a new occurrence');
  assert.deepEqual(compareToBaseline(observed, baseline).stale.length, 1, 'a disappeared entry must be reported');
  const parsed = diagnosticKey(`[I08/PORT_FALLBACK] ${fileURLToPath(new URL('../src/protocol/codec.ts', import.meta.url)).replaceAll('/', '\\')}: injected capability cannot fall back to a default backend`);
  assert.equal(parsed, 'I08|PORT_FALLBACK|src/protocol/codec.ts|injected capability cannot fall back to a default backend',
    'paths under the repository root are normalised to repo-relative forward slashes');
  // Review R4: the completion summary is what separates "the guard ran and found N violations" from
  // "the guard crashed", and only the former may ever be compared against or written to the baseline.
  const summary = '{"status":"failed","modules":["kernel"],"violations":39}';
  assert.deepEqual(guardSummary(`[I08/X] a.ts: something\n${summary}\n`), { status: 'failed', modules: ['kernel'], violations: 39 });
  assert.equal(guardSummary('[INPUT/ERROR] Error: Cannot find module typescript\n    at ...'), null);
  assert.equal(guardSummary('{"status":"failed","violations":"many"}'), null);
  assert.equal(guardSummary(''), null);
});

test('G09/R1: the skip gate covers declarations and the titles the runner actually skips', async () => {
  const { compareSkipBaseline, scanSkipSites, tapSkippedTitles, runSkipGate } = await import('../scripts/test-skips.mjs');
  const baseline = JSON.parse(read('scripts/test-skip-baseline.json'));
  assert.deepEqual(scanSkipSites().length, baseline.sites.length, 'the scanned declarations match the recorded baseline');
  assert.deepEqual(compareSkipBaseline(baseline.sites, baseline.sites), { added: [], stale: [] });
  assert.deepEqual(compareSkipBaseline(baseline.sites, [...baseline.sites, 'test/new.test.js|1']).added, ['test/new.test.js|1']);
  assert.deepEqual(compareSkipBaseline(baseline.sites, baseline.sites.slice(1)).stale, [baseline.sites[0]]);
  // Review R1: real skip identities, not just declaration counts.
  const tap = 'ok 1 - DoD1 real Pi memory session # SKIP @earendil-works/pi-coding-agent native package is not installed\n'
    + 'ok 2 - a test that ran\nok 3 - another # SKIP reason\nnot ok 4 - a failure\n';
  assert.deepEqual(tapSkippedTitles(tap), ['DoD1 real Pi memory session', 'another']);
  assert.deepEqual(tapSkippedTitles(''), []);
  assert.equal(baseline.nativeSkips.titles.length > 0, true, 'the recorded native skip set is non-empty');
  assert.deepEqual([...new Set(baseline.nativeSkips.titles)].length, baseline.nativeSkips.titles.length, 'skip titles are unique');
  assert.equal(typeof runSkipGate, 'function');
  const verifyCi = read('scripts/verify-ci-environment.mjs');
  assert.match(verifyCi, /runSkipGate/, 'the previously dead CI-environment script carries the check');
});

test('N1/N2: the skip gate builds first, and the executable bridge example asserts the structural boundary', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['check:skips'], /npm run build &&/, 'the gate must not validate a missing or stale dist');
  assert.match(read('scripts/test-skips.mjs'), /dist\/ is missing or incomplete/);
  const roundtrip = read('docs/evofence-harness-kernel/L5-SP-BRIDGE-ROUNDTRIP.md');
  assert.doesNotMatch(roundtrip, /createSPBridge\(\{/, 'the executable example must not pass a ports object');
  assert.match(roundtrip, /assert\.equal\(createSPBridge\.length, 0/, 'it must assert the arity instead');
  assert.doesNotMatch(roundtrip, /Object\.values\(calls\)/, 'the tautological counter assertion is gone');
  assert.doesNotMatch(roundtrip, /"calls":\{/, 'the recorded JSON sample no longer claims counters');
  assert.match(read('test/l5-sp-bridge-roundtrip.test.js'), /result\.portsParameter/);
});

test('G22: the source-shape guards fail instead of skipping what they cannot read', () => {
  for (const file of ['scripts/check-src-policy.mjs', 'scripts/check-deps.mjs']) {
    const source = read(file);
    assert.doesNotMatch(source, /catch\s*\{\s*\n?\s*return;/, `${file} must not swallow a read failure`);
    assert.match(source, /cannot read/, `${file} must name the unreadable path`);
  }
  assert.match(read('scripts/check-deps.mjs'), /unresolved relative imports: \$\{unresolved\.length\}/);
});
