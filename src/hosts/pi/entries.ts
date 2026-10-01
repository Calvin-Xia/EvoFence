import { decode, fail } from '../../protocol/index.js';
import { err, ok, stableStringify, type Effect, type HostResult, type Receipt, type Usage } from '../../runtime/host-port/index.js';
import type { PiExtensionAPI, PiManager } from './types.js';

export const PI_ENTRY = 'evofence.kernel.pi.v1';
export interface PiRecord {
  readonly version: 1; readonly kernelSessionId: string; readonly hostSessionId: string;
  readonly kind: 'binding' | 'dispatch' | 'receipt';
  readonly effect: Effect | null; readonly receipt: Receipt | null;
  readonly requestUsage: readonly Usage[];
  readonly requestIds: readonly string[];
}
/** Entries are read-back evidence only. Recovery never dispatches or decides from transcript. */
export function readPiRecords(manager: PiManager, kernelSessionId: string, hostSessionId: string): HostResult<readonly PiRecord[]> {
  const records: PiRecord[] = [];
  for (const entry of manager.getEntries()) {
    if (entry.type !== 'custom' || entry.customType !== PI_ENTRY) continue;
    const r = entry.data as PiRecord;
    if (r === null || typeof r !== 'object' || r.version !== 1 || r.hostSessionId !== hostSessionId
      || r.kernelSessionId !== kernelSessionId || !['binding', 'dispatch', 'receipt'].includes(r.kind)) {
      return err(fail('EFK_SOURCE_PIN_DRIFT', 'Pi custom entry binding/version differs; reopen the exact kernel journal'));
    }
    if (!Array.isArray(r.requestUsage)) return err(fail('EFK_SCHEMA_INVALID', 'Pi entry lacks its request usage evidence'));
    if (!Array.isArray(r.requestIds) || r.requestIds.some(id => typeof id !== 'string' || id.length === 0)
      || new Set(r.requestIds).size !== r.requestIds.length) return err(fail('EFK_SCHEMA_INVALID', 'Pi entry has invalid request identities'));
    for (const row of r.requestUsage) { const decoded = decode('Usage', row); if (!decoded.ok) return decoded; }
    if (r.kind !== 'binding') {
      const effect = decode('Effect', r.effect);
      if (!effect.ok) return effect;
      if (effect.value.binding.sessionId !== kernelSessionId
        || (effect.value.binding.hostSessionId !== null && effect.value.binding.hostSessionId !== hostSessionId)) {
        return err(fail('EFK_ARTIFACT_BINDING_MISMATCH', 'restored Pi effect belongs to another session'));
      }
    }
    if (r.kind === 'receipt') {
      const receipt = decode('Receipt', r.receipt);
      if (!receipt.ok) return receipt;
      if (receipt.value.effectId !== r.effect!.effectId || stableStringify(receipt.value.binding) !== stableStringify(r.effect!.binding)) {
        return err(fail('EFK_ARTIFACT_BINDING_MISMATCH', 'restored Pi receipt does not answer its effect'));
      }
    }
    records.push(r);
  }
  return ok(records);
}
export function appendPiRecord(api: PiExtensionAPI, record: PiRecord): void { api.appendEntry(PI_ENTRY, record); }
