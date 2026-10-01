// Wire-shaped inputs, not copies of the production planners or reducers.
import { createHash } from 'node:crypto';
export const PROTOCOL = { namespace: 'evofence.runtime/1', schemaVersion: '1.1.0' };
export const digest = { digest: bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
export const actor = (actorId, kind) => ({ actorId, kind, identityRef: null });
export function node(nodeId, overrides = {}) {
  return { nodeId, kind: 'agent', inputRefs: [], outputSchemas: [], loop: null, subgraph: null,
    contextPlan: { inputRefs: [], maxTokens: 4096, preserveHostResources: true, isolation: 'current' },
    toolRequirements: [], modelRequirements: { providerModel: null, reasoningRequested: null,
      reasoningGuarantee: 'payload-only', payloadRef: null }, resources: { exclusive: [], shared: [] },
    termination: { maxAttempts: 3, maxActiveWallMs: 600000, cancelMode: 'stop-and-confirm',
      unknownPolicy: 'reconcile', excludeHumanWait: true }, terminal: false, requiredBranches: [], ...overrides };
}
export function graph(overrides = {}) {
  return { protocol: PROTOCOL, graphId: 'g-verify', revision: 1,
    taskContractRef: { taskId: 'task-verify', version: 1, digest: digest.digest('contract') },
    nodes: [node('work', { terminal: true })], typedEdges: [], requiredJoins: [], resourcePolicy: [],
    graphLimits: { maxNodes: 16, maxConcurrentAgents: 2, maxDepth: 3, maxAttempts: 4 },
    abandonedBranches: [], ...overrides };
}
export const edge = (edgeId, type, from, to, overrides = {}) => ({ edgeId, type, from, to,
  when: null, artifact: null, expect: null, maxAttempts: null, relation: null, ...overrides });
export const predicate = (op, path, value) => ({ op, path, value, children: [] });
export function policy(overrides = {}) {
  return { poolId: 'pool-verify', category: 'development', authorizationRef: null, maxRequests: 8,
    maxInputTokens: 60000, maxOutputTokens: 4096, maxUsdMicros: 800, maxWallMs: 600000,
    maxConcurrentRequests: 4, priceRef: null, missingUsagePolicy: 'retain-reservation', ...overrides };
}
export const usage = (requestId, overrides = {}) => ({ requestId, source: 'provider', inputUncached: 10,
  cacheRead: 0, cacheWrite: 0, output: 3, reasoning: 1, total: 13, estimatedUsdMicros: 37,
  invoiceUsdMicros: null, complete: true, evidenceRefs: [], ...overrides });
