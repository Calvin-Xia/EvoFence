/**
 * `runtime/host-port` public surface.
 *
 * One barrel, relative imports only: `runtime` may import `protocol` and itself
 * (`OWNERSHIP.md` §2), never a host SDK or a node builtin (I02). Nothing in this module runs at
 * import time — constructing a fake host is an explicit `createFakeHost(...)` call (I05).
 */
export * from './types.js';
export { DSH_CAPABILITIES, PI_CAPABILITIES, capabilityGapError, capabilityStatus, judgeRequirements, requiredCapabilities, cancelRequirements, contextRequirements, reconcileRequirements } from './capabilities.js';
export type { CapabilityGap } from './capabilities.js';
export { budgetWithin, delegate, grantCovers, grantIsLive, liveAt, revokeGrant, scopeWithin } from './grant.js';
export type { DelegationRequest } from './grant.js';
export { dedupeUsage, stableStringify, usageIsComplete } from './usage.js';
export { replayView } from './replay.js';
export type { CommittedRecord, ReplayView } from './replay.js';
export { verifyBoardAuthority, verifyEffect, verifyReceipt } from './verify.js';
export type { ReceiptDisposition, VerifyContext } from './verify.js';
export { createFakeHost } from './host-fake.js';
export type { FakeHost, FakeHostConfig, FakeHostStats, HostScript } from './host-fake.js';
