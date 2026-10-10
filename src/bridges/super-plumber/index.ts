import { fail } from '../../protocol/index.js';
import { importDelivery, importDeliveryFile } from './import.js';
import { exportDelivery, exportDeliveryFile } from './export.js';
import type { FileScope, ImportedDelivery, RuntimeBindings } from './types.js';

export { MAPPINGS } from './mapping.js';
export { difference, mappingReport, renderLossReport } from './loss.js';
export type { Difference } from './loss.js';
export type { BridgeResult, DeliverySnapshot, FileScope, ImportedDelivery, Json, LossEntry, RuntimeBindings } from './types.js';

/**
 * Optional data bridge. The boundary against execution is structural, not witnessed: the factory
 * takes no ports (audit finding G20 removed a `ports` parameter that no method ever read, which
 * made "ports witness zero authority I/O" look like a guarantee while nothing consulted them).
 * `claim` / `dispatchEffect` / `execute` are fail-closed stubs, and that is what
 * `test/l5-sp-bridge-semantics.test.js` pins.
 */
export function createSPBridge() {
  const denied = () => ({ ok: false as const, error: fail('EFK_LEGACY_NOT_EXECUTABLE', 'imported delivery data is inert; author a new authorized runtime task') });
  return {
    importData(value: unknown, bindings: RuntimeBindings) {
      return importDelivery(value, bindings);
    },
    importFile(file: string, scope: FileScope, bindings: RuntimeBindings) { return importDeliveryFile(file, scope, bindings); },
    importRecords(graph: unknown, nodes: unknown, edges: unknown, bindings: RuntimeBindings) {
      return importDelivery({ format: 'evofence.sp-snapshot/1', graph, nodes, edges }, bindings);
    },
    exportData(value: ImportedDelivery) { return exportDelivery(value); },
    exportRecords(value: ImportedDelivery) {
      const result = exportDelivery(value);
      if (!result.ok) return result;
      const { graph, nodes, edges } = result.value;
      return { ok: true as const, value: { graph, nodes, edges } };
    },
    exportFile(value: ImportedDelivery, file: string, scope: FileScope) { return exportDeliveryFile(value, file, scope); },
    claim: denied, dispatchEffect: denied, execute: denied,
  };
}
