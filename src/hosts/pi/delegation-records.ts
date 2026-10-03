import { decode, fail } from '../../protocol/index.js';
import { delegate, err, ok, stableStringify, type HostResult, type DelegationGrant } from '../../runtime/host-port/index.js';
import type { PiDelegationOptions, PiDelegationPlan, PiDelegationRecord } from './delegation-types.js';

export const PI_DELEGATION_ENTRY = 'evofence.kernel.pi.delegation.v1';
export function checkPiChildPlan(options: PiDelegationOptions, authorized: PiDelegationRecord['authorized'], plan: PiDelegationPlan): HostResult<DelegationGrant> {
  const { effect, grant } = authorized;
  const derived = delegate(grant, plan.request, options.clock.now());
  if (!derived.ok) return derived;
  // The lane supports exactly one SDK child level. Capabilities are absent from HostPort's data grant.
  if (plan.request.remainingDepth !== 0 || plan.request.expiresAt <= options.clock.now()
    || plan.request.grantId === grant.grantId || plan.effects.length === 0
    || plan.effects.length > plan.request.budget.maxRequests
    || plan.capabilities.some(c => !options.parentCapabilities.includes(c))
    || !plan.capabilities.includes('host.agent')
    || stableStringify(plan.request.budget.authorizationRef) !== stableStringify(grant.budget.authorizationRef)
    || stableStringify(plan.request.budget.priceRef) !== stableStringify(grant.budget.priceRef)
    || plan.request.budget.poolId !== options.requests.poolId) {
    return err(fail('EFK_AUTHORITY_DENIED', 'child depth/capabilities/authorization/plan exceeds its parent', [effect.effectId]));
  }
  const ids = new Set<string>(), keys = new Set<string>();
  for (const child of plan.effects) {
    const decoded = decode('Effect', child);
    if (!decoded.ok) return decoded;
    if (child.kind !== 'host.agent' || child.authorityRef !== derived.value.grantId
      || child.binding.sessionId !== options.kernelSessionId || child.binding.hostSessionId !== null
      || stableStringify(child.binding.graph) !== stableStringify(effect.payload.graphRef)
      || child.binding.epoch !== effect.binding.epoch || child.deadline > Math.min(effect.deadline, derived.value.expiresAt)
      || child.reservationRef !== effect.reservationRef || ids.has(child.effectId) || keys.has(child.idempotencyKey)) {
      return err(fail('EFK_AUTHORITY_DENIED', 'child work must retain kernel/graph/epoch/grant/parent reservation identity', [child.effectId]));
    }
    ids.add(child.effectId); keys.add(child.idempotencyKey);
  }
  return derived;
}
/** Native custom entries are observations. Reading them never creates a child or a kernel claim. */
export function readPiDelegations(options: PiDelegationOptions): HostResult<readonly PiDelegationRecord[]> {
  const records: PiDelegationRecord[] = [];
  for (const entry of options.manager.getEntries()) {
    if (entry.type !== 'custom' || entry.customType !== PI_DELEGATION_ENTRY) continue;
    const r = entry.data as PiDelegationRecord;
    if (r === null || typeof r !== 'object' || r.version !== 1 || r.parentSessionId !== options.parentSessionId
      || r.kernelSessionId !== options.kernelSessionId || !['prepared', 'created', 'dispatched', 'receipt'].includes(r.phase)
      || (r.childSessionId !== null && (typeof r.childSessionId !== 'string' || r.childSessionId === options.parentSessionId))) {
      return err(fail('EFK_SOURCE_PIN_DRIFT', 'delegation entry version/session differs'));
    }
    const decoded = decode('Effect', r.authorized.effect);
    if (!decoded.ok) return decoded;
    const derived = checkPiChildPlan({ ...options, clock: { now: () => Math.min(r.childGrant.expiresAt, r.authorized.grant.expiresAt) - 1 } }, r.authorized, r.plan);
    // Historical expiry cannot revoke read-back evidence. Current dispatch uses the real clock.
    if (!derived.ok || stableStringify(derived.value) !== stableStringify(r.childGrant)) {
      return err(fail('EFK_AUTHORITY_DENIED', 'restored child grant does not derive from its recorded parent'));
    }
    if (r.receipt !== null) {
      const receipt = decode('Receipt', r.receipt);
      if (!receipt.ok) return receipt;
      if (r.receipt.effectId !== r.authorized.effect.effectId
        || stableStringify(r.receipt.binding) !== stableStringify(r.authorized.effect.binding)) {
        return err(fail('EFK_ARTIFACT_BINDING_MISMATCH', 'delegation receipt answers another effect'));
      }
    }
    records.push(r);
  }
  return ok(records);
}
