/**
 * Capability negotiation: `verified` evidence with matching version / coverage / evidence kinds is
 * the only thing that satisfies a requirement. Host and vendor labels are never read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { decode } from '../dist/protocol/index.js';
import { negotiate } from '../dist/kernel/policy/index.js';
import * as fixtures from './l2-policy-fixtures.js';

const manifestFor = (capabilities, overrides = {}) => fixtures.manifest({ capabilities, ...overrides });
const input = (overrides = {}) => ({
  task: fixtures.task(),
  manifest: manifestFor({ cap: fixtures.observation() }),
  taskDigest: fixtures.DIGEST('1'),
  manifestDigest: fixtures.DIGEST('2'),
  approvals: [],
  ...overrides,
});

test('a verified capability with matching scope is executable, and the result is a valid NegotiationResult', () => {
  const result = negotiate(input());
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.value.status, 'executable');
  assert.deepEqual(result.value.satisfied, ['cap']);
  assert.deepEqual(result.value.gaps, []);
  assert.equal(decode('NegotiationResult', result.value).ok, true);
});

test('a missing capability key is unknown, not borrowed from the other host', () => {
  const result = negotiate(input({ manifest: manifestFor({}) }));
  assert.equal(result.value.status, 'unsupported');
  assert.equal(result.value.gaps[0].reason, 'missing');
});

test('partial, mismatched-version, coverage and evidence-kind gaps keep their distinct reason', () => {
  const partial = negotiate(input({ manifest: manifestFor({ cap: fixtures.observation({ status: 'partial', verifiedSubset: ['cap-partial'] }) }) }));
  assert.equal(partial.value.gaps[0].reason, 'partial');

  const version = negotiate(input({ manifest: manifestFor({ cap: fixtures.observation({ scope: fixtures.capabilityScope({ hostVersion: '9.9.9' }) }) }) }));
  assert.equal(version.value.gaps[0].reason, 'version');

  const coverage = negotiate(input({ manifest: manifestFor({ cap: fixtures.observation({ scope: fixtures.capabilityScope({ coverage: ['other'] }) }) }) }));
  assert.equal(coverage.value.gaps[0].reason, 'coverage');

  const evidence = negotiate(input({ manifest: manifestFor({ cap: fixtures.observation({ evidenceRefs: [fixtures.evidenceRef('static')] }) }) }));
  assert.equal(evidence.value.gaps[0].reason, 'evidence-kind');
});

test('a provider-live requirement needs a real provider binding', () => {
  const task = fixtures.task({ requiredGuarantees: [fixtures.requirement({ evidenceKinds: ['provider-live'] })] });
  const withoutProvider = negotiate(input({ task, manifest: manifestFor({ cap: fixtures.observation() }) }));
  assert.equal(withoutProvider.value.status, 'unsupported');
  assert.equal(withoutProvider.value.gaps[0].reason, 'evidence-kind');

  const withProvider = negotiate(
    input({
      task,
      manifest: manifestFor({
        cap: fixtures.observation({
          scope: fixtures.capabilityScope({ providerModel: 'vendor/model' }),
          evidenceRefs: [fixtures.evidenceRef('provider-live')],
        }),
      }),
    }),
  );
  assert.equal(withProvider.value.status, 'executable');
});

// DoD negative control: the same alternative is refused without its approval binding.
test('a degradable gap is closed by an approved alternative and needs-degradation otherwise', () => {
  const task = fixtures.task({
    requiredGuarantees: [fixtures.requirement({ mode: 'degradable', alternativeIds: ['alt-1'] })],
    degradations: [fixtures.degradation()],
  });
  const manifest = manifestFor({ 'alt-cap': fixtures.observation() });

  const unapproved = negotiate(input({ task, manifest }));
  assert.equal(unapproved.value.status, 'needs-degradation');
  assert.deepEqual(unapproved.value.selectedAlternatives, []);

  const approved = negotiate(input({ task, manifest, approvals: [{ alternativeId: 'alt-1', approvalRef: fixtures.artifact('approval-1', 'Approval') }] }));
  assert.equal(approved.value.status, 'executable');
  assert.deepEqual(approved.value.selectedAlternatives, ['alt-1']);
  assert.deepEqual(approved.value.gaps.map((gap) => gap.capability), ['cap']);
  assert.equal(approved.value.approvalRefs.length, 1);
});

test('an alternative that replaces the wrong capability or is itself unsatisfied does not substitute', () => {
  const wrongTarget = negotiate(
    input({
      task: fixtures.task({
        requiredGuarantees: [fixtures.requirement({ mode: 'degradable', alternativeIds: ['alt-1'] })],
        degradations: [fixtures.degradation({ replacesCapability: 'something-else' })],
      }),
      manifest: manifestFor({ 'alt-cap': fixtures.observation() }),
    }),
  );
  assert.equal(wrongTarget.value.status, 'unsupported');

  const unsatisfied = negotiate(
    input({
      task: fixtures.task({
        requiredGuarantees: [fixtures.requirement({ mode: 'degradable', alternativeIds: ['alt-1'] })],
        degradations: [fixtures.degradation()],
      }),
      manifest: manifestFor({}),
    }),
  );
  assert.equal(unsatisfied.value.status, 'unsupported');
});

test('a recursive alternative is not a valid substitute', () => {
  const result = negotiate(
    input({
      task: fixtures.task({
        requiredGuarantees: [fixtures.requirement({ mode: 'degradable', alternativeIds: ['alt-1'] })],
        degradations: [
          fixtures.degradation({
            requirements: [fixtures.requirement({ capability: 'alt-cap', alternativeIds: ['alt-1'] })],
          }),
        ],
      }),
      manifest: manifestFor({ 'alt-cap': fixtures.observation() }),
    }),
  );
  assert.equal(result.value.status, 'unsupported');
});

test('swapping host and vendor labels does not change the result', () => {
  const alpha = negotiate(input({ manifest: manifestFor({ cap: fixtures.observation() }, { identity: { host: 'alpha', vendor: 'vendor-a', version: '1.0.0', pinRef: fixtures.evidenceRef() } }) }));
  const beta = negotiate(input({ manifest: manifestFor({ cap: fixtures.observation() }, { identity: { host: 'beta', vendor: 'vendor-b', version: '1.0.0', pinRef: fixtures.evidenceRef() } }) }));
  assert.deepEqual(alpha, beta);
});

test('a protocol pair the manifest does not offer is refused before any negotiation', () => {
  const result = negotiate(input({ manifest: manifestFor({ cap: fixtures.observation() }, { compatibleProtocols: [{ namespace: 'evofence.runtime/1', schemaVersion: '1.0.0' }] }) }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EFK_PROTOCOL_UNSUPPORTED');
});

test('the same capability twice is rejected even when the duplicate objects differ', () => {
  const task = fixtures.task({
    requiredGuarantees: [fixtures.requirement({ coverage: ['cov'] }), fixtures.requirement({ coverage: ['other'] })],
  });
  // The frozen schema's uniqueItems only rejects identical objects, so this task decodes ...
  assert.equal(decode('TaskContract', task).ok, true);
  // ... and the negotiation precondition refuses the ambiguity.
  const result = negotiate(input({ task }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EFK_SCHEMA_INVALID');
});
