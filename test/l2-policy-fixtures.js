/**
 * Fixtures for the `l2-policy` suite.
 *
 * Each builder returns a wire-shaped object that `decode(...)` in `../dist/protocol/index.js`
 * accepts, so the pure policy functions are exercised on the frozen protocol objects rather than on
 * convenient look-alikes. `test/l2-policy-fixtures.test.js` decodes every builder.
 */
import { decode } from '../dist/protocol/index.js';

export const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
export const DIGEST = (character) => `sha256:${character.repeat(64)}`;

export function artifact(id, schemaName = 'Artifact') {
  return {
    protocol: PROTOCOL,
    id,
    digest: DIGEST('a'),
    producer: { actorId: 'kernel-1', kind: 'kernel', identityRef: null },
    binding: null,
    schema: { name: schemaName, version: '1.1.0', digest: DIGEST('b') },
    location: `artifact://${id}`,
    visibility: 'internal',
    expiresAt: null,
    partition: 'not-evaluation',
  };
}

export function evidenceRef(kind = 'native-disk', claim = 'observed in the frozen probe scope') {
  return { file: 'probes/evidence.json', pointer: '/0', sha256: DIGEST('c'), kind, claim };
}

export function scope(overrides = {}) {
  return {
    workspaceRef: null,
    readResources: [],
    writeResources: [],
    artifactScopes: [],
    trustDomain: 'same-user',
    ...overrides,
  };
}

export function grant(overrides = {}) {
  return {
    grantId: 'grant-root',
    rootAuthorityRef: 'root-1',
    parentGrantRef: null,
    actor: { actorId: 'human-1', kind: 'human', identityRef: artifact('identity-1') },
    sessionId: 'session-1',
    nodeIds: [],
    scope: scope(),
    capabilities: [],
    maxDelegationDepth: 3,
    expiresAt: null,
    revocationEpoch: 0,
    approvalRef: null,
    ...overrides,
  };
}

export function budgetPolicy(overrides = {}) {
  return {
    poolId: 'pool-1',
    category: 'development',
    authorizationRef: null,
    maxRequests: 20,
    maxInputTokens: 60000,
    maxOutputTokens: 4096,
    maxUsdMicros: 190940,
    maxWallMs: 1200000,
    maxConcurrentRequests: 20,
    priceRef: artifact('price-1', 'PriceTable'),
    missingUsagePolicy: 'retain-reservation',
    ...overrides,
  };
}

export function usage(overrides = {}) {
  return {
    requestId: 'req-1',
    source: 'provider',
    inputUncached: 100,
    cacheRead: 0,
    cacheWrite: null,
    output: 50,
    reasoning: 10,
    total: 150,
    estimatedUsdMicros: 9547,
    invoiceUsdMicros: null,
    complete: true,
    evidenceRefs: [],
    ...overrides,
  };
}

export function capabilityScope(overrides = {}) {
  return {
    operations: ['op'],
    coverage: ['cov'],
    hostVersion: '1.0.0',
    providerModel: null,
    trustDomain: 'same-user',
    ...overrides,
  };
}

export function observation(overrides = {}) {
  return {
    status: 'verified',
    evidenceRefs: [evidenceRef()],
    scope: capabilityScope(),
    verifiedSubset: [],
    limitations: [],
    ...overrides,
  };
}

export function guaranteeStrength(overrides = {}) {
  return { status: 'unknown', coverage: [], evidenceRefs: [], ...overrides };
}

export function manifest(overrides = {}) {
  return {
    protocol: PROTOCOL,
    manifestId: 'manifest-1',
    identity: { host: 'pi', vendor: null, version: '1.0.0', pinRef: evidenceRef() },
    compatibleProtocols: [PROTOCOL],
    capabilities: {},
    model: null,
    usageSources: [],
    cancel: guaranteeStrength(),
    recovery: guaranteeStrength(),
    isolation: guaranteeStrength(),
    hostSpecific: {
      probeStatus: null,
      homeObservationRef: null,
      integrationCompatibility: 'unknown',
      rawManifestRef: evidenceRef(),
      noteRefs: [],
    },
    ...overrides,
  };
}

export function requirement(overrides = {}) {
  return {
    capability: 'cap',
    mode: 'hard',
    evidenceKinds: ['native-disk'],
    coverage: ['cov'],
    alternativeIds: [],
    ...overrides,
  };
}

export function degradation(overrides = {}) {
  return {
    alternativeId: 'alt-1',
    replacesCapability: 'cap',
    requirements: [requirement({ capability: 'alt-cap' })],
    tradeoff: 'weaker scope, documented and approved',
    approvalRef: artifact('approval-1', 'Approval'),
    ...overrides,
  };
}

export function outcome(overrides = {}) {
  return {
    outcomeId: 'out-1',
    description: 'produce the artifact',
    schema: { name: 'Result', version: '1', digest: DIGEST('d') },
    evidenceKinds: ['native-disk'],
    ...overrides,
  };
}

export function task(overrides = {}) {
  return {
    protocol: PROTOCOL,
    taskId: 'task-1',
    version: 1,
    goal: 'do the thing',
    requiredOutcomes: [outcome()],
    requiredBranches: [],
    acceptance: {
      evaluatorId: 'eval-1',
      evaluatorVersion: '1',
      protocolRef: null,
      checkRefs: [],
      requiredBranchPolicy: 'explicit-complete-report',
      outcomeSchema: { name: 'Result', version: '1', digest: DIGEST('d') },
      baselineRequired: false,
    },
    scope: scope(),
    authorityGrant: grant(),
    budget: budgetPolicy(),
    privacy: {
      visibility: 'internal',
      feedbackVisibility: 'internal',
      privateTests: 'evaluator-only',
      finalFeedback: 'no-optimization',
      secretPolicy: 'forbidden',
    },
    termination: {
      maxAttempts: 3,
      maxActiveWallMs: 60000,
      cancelMode: 'stop-and-confirm',
      unknownPolicy: 'reconcile',
      excludeHumanWait: true,
    },
    requiredGuarantees: [requirement()],
    degradations: [],
    ...overrides,
  };
}

/** Decode helper: returns the value or throws with the envelope, so a bad fixture fails loudly. */
export function decoded(name, value) {
  const result = decode(name, value);
  if (!result.ok) throw new Error(`fixture ${name} does not decode: ${JSON.stringify(result.error)}`);
  return result.value;
}
