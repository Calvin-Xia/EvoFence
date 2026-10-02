import { decode } from '../../protocol/index.js';
import { readArtifact } from '../../kernel/artifacts/index.js';
import { canonical, storeFail, storeOk } from '../../kernel/store/index.js';
import type { StoreResult } from '../../kernel/store/index.js';
import { sameRevision } from '../../learning/assets/index.js';
import { validateContext } from '../../learning/assets/compatibility.js';
import type { MonitorInput, QualitySignal, RevocationPorts } from './types.js';

/** Reject hidden feedback before reading bytes, origin verification or emitting any state. */
export function loadSignals(ports: RevocationPorts, input: MonitorInput, at: number): StoreResult<readonly QualitySignal[]> {
  for (const ref of input.signalRefs) {
    if (!['dev', 'not-evaluation'].includes(ref.partition) || ['held-out', 'final'].includes(ref.visibility)) {
      return storeFail('EFK_PRIVACY_VIOLATION', 'continuous monitoring accepts dev or online evidence only');
    }
  }
  for (const ref of input.signalRefs) {
    if (ref.schema.name !== 'QualitySignal' || ref.schema.version !== '1.1.0' ||
      canonical(ref.producer) !== canonical(ports.monitorIssuer)) {
      return storeFail('EFK_DECISION_AUTHORITY_DENIED', 'quality signal is not from the registered monitor');
    }
    const origin = ports.verifySignal(ref); if (!origin.ok) return origin;
  }
  const inventory = ports.signalInventory(input.asset, input.context); if (!inventory.ok) return inventory;
  const identities = (refs: readonly unknown[]): string => canonical(refs.map(ref => canonical(ref)).sort());
  if (identities(inventory.value) !== identities(input.signalRefs) || new Set(input.signalRefs.map(r => r.id)).size !== input.signalRefs.length) {
    return storeFail('EFK_EVALUATION_PROTOCOL_MISMATCH', 'continuous monitoring requires the complete trusted signal inventory');
  }
  const signals: QualitySignal[] = [];
  for (const ref of input.signalRefs) {
    const bytes = readArtifact(ref, 'evaluator', at, ports.promotion.registry.artifacts); if (!bytes.ok) return bytes;
    let value: QualitySignal;
    try { value = JSON.parse(bytes.value) as QualitySignal; }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return storeFail('EFK_SCHEMA_INVALID', 'quality signal is not JSON');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'asset,context,measuredAt,metric,source,value' ||
      !['dev', 'online'].includes(value.source) || typeof value.metric !== 'string' || value.metric.length === 0 ||
      typeof value.value !== 'number' || !Number.isFinite(value.value)) {
      return storeFail('EFK_SCHEMA_INVALID', 'invalid quality signal');
    }
    const asset = decode('AssetRef', value.asset); if (!asset.ok) return asset;
    const context = validateContext(value.context); if (!context.ok) return context;
    const time = decode('Instant', value.measuredAt); if (!time.ok) return time;
    if (!sameRevision(value.asset, input.asset) || value.measuredAt > at || value.context.at !== value.measuredAt ||
      canonical({ ...value.context, at: 0 }) !== canonical({ ...input.context, at: 0 }) ||
      ref.partition !== (value.source === 'dev' ? 'dev' : 'not-evaluation')) {
      return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'quality signal differs from asset/context/time/source');
    }
    signals.push(value);
  }
  return storeOk(signals);
}
