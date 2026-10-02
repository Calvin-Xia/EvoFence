import { deriveAuthority } from '../../kernel/policy/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { sameRevision } from '../assets/index.js';
import type { AssetRef, QualificationContext } from '../assets/index.js';
import type { AssetPointer, PromotionPorts, PromotionRule, PromotionState } from './types.js';

export function authorize(ports: PromotionPorts, ruleId: string, action: 'promote' | 'activate' | 'revoke',
  asset: AssetRef, context: QualificationContext, temporary: boolean): StoreResult<PromotionRule> {
  const loaded = ports.policy.rule(ruleId); if (!loaded.ok) return loaded;
  if (loaded.value === null) return storeFail('EFK_AUTHORITY_DENIED', 'no preauthorized promotion rule');
  const rule = loaded.value;
  if (rule.ruleId !== ruleId || rule.hostSessionId !== context.hostSessionId ||
    !rule.assets.some(ref => sameRevision(ref, asset)) || (temporary && !rule.allowTemporary)) {
    return storeFail('EFK_AUTHORITY_DENIED', 'preauthorization does not bind this revision/session/origin');
  }
  const authority = deriveAuthority({ ...rule.authority, now: context.at, node: { ...rule.authority.node,
    scope: context.scope, capabilities: [action === 'activate' ? 'host.activate' : `asset.${action}`] } });
  return authority.ok ? storeOk(rule) : authority;
}
export function comparePointer(state: PromotionState, expected: AssetPointer): StoreResult<AssetPointer> {
  const current = state.pointers.find(p => p.pointerId === expected.pointerId);
  if (current === undefined || canonical(current) !== canonical(expected)) {
    return storeFail('EFK_REVISION_CONFLICT', 'CAS differs in old pointer/version/scope/snapshot');
  }
  return storeOk(current);
}
export function sessionReady(state: PromotionState, hostSessionId: string): StoreResult<true> {
  return state.promotions.some(p => p.status === 'pending' && p.context.hostSessionId === hostSessionId) ?
    storeFail('EFK_ACTIVATION_UNCONFIRMED', 'session has an unresolved activation; reconcile before pointer changes') : storeOk(true);
}
