/**
 * `runtime/host-port` public surface.
 *
 * One barrel, relative imports only: `runtime` may import `protocol` and itself
 * (`OWNERSHIP.md` §2), never a host SDK or a node builtin (I02). At import time this module only
 * defines static data and functions — it calls no port, constructs no backend and performs no I/O
 * (I05); constructing a fake host is the explicit, non-barrel `createFakeHost(...)` deep import.
 */
export * from './types.js';
export { DSH_CAPABILITIES, PI_CAPABILITIES, RECONCILE_REQUIREMENTS, cancelConfirmationCapability, capabilityGapError, capabilityStatus, judgeRequirements, requiredCapabilities, contextRequirements } from './capabilities.js';
export type { CapabilityGap } from './capabilities.js';
export { budgetWithin, delegate, grantCovers, grantIsLive, liveAt, revokeGrant, scopeWithin } from './grant.js';
export type { DelegationRequest } from './grant.js';
export { dedupeUsage, stableStringify, usageIsComplete } from './usage.js';
export { replayView } from './replay.js';
export type { CommittedRecord, ReplayView } from './replay.js';
export { verifyBoardAuthority, verifyEffect, verifyReceipt } from './verify.js';
export type { ReceiptDisposition, VerifyContext } from './verify.js';
// Audit G07: `createFakeHost` is deliberately NOT re-exported here. It fabricates receipts and
// observations, which would make it reachable through `evofence/core` and `evofence/runtime`; it is
// now an internal deep import (`./host-fake.js`) used by tests and verification only.
export type { FakeHost, FakeHostConfig, FakeHostStats, HostScript } from './host-fake.js';
