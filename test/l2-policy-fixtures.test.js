/**
 * The fixtures are protocol objects, not convenient look-alikes: each one must decode against the
 * frozen table. If a builder drifts from `SCHEMAS.md`, this suite fails before the algorithm tests
 * can pass on a wrong input shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { decode } from '../dist/protocol/index.js';
import * as fixtures from './l2-policy-fixtures.js';

const cases = {
  Grant: () => fixtures.grant(),
  Scope: () => fixtures.scope(),
  BudgetPolicy: () => fixtures.budgetPolicy(),
  Usage: () => fixtures.usage(),
  HostManifest: () => fixtures.manifest(),
  TaskContract: () => fixtures.task(),
  GuaranteeRequirement: () => fixtures.requirement(),
  DegradationOption: () => fixtures.degradation(),
  CapabilityObservation: () => fixtures.observation(),
  EvidenceRef: () => fixtures.evidenceRef(),
  ArtifactRef: () => fixtures.artifact('artifact-1'),
};

for (const [name, build] of Object.entries(cases)) {
  test(`l2-policy fixture decodes as ${name}`, () => {
    const result = decode(name, build());
    assert.equal(result.ok, true, JSON.stringify(result.error));
  });
}
