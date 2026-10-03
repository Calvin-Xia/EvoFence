import { writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { difference } from './loss.js';
import { translateDelivery } from './import.js';
import { object } from './mapping.js';
import { boundary, checkedPath, external, reject } from './types.js';
import type { BridgeResult, DeliverySnapshot, FileScope, ImportedDelivery } from './types.js';

function deliveryForExport(value: ImportedDelivery): DeliverySnapshot {
  object(value, ['classification', 'executable', 'delivery', 'runtimeGraph', 'bindings', 'initialStates', 'losses'],
    ['classification', 'executable', 'delivery', 'runtimeGraph', 'bindings', 'initialStates', 'losses']);
  if (value.executable !== false || value.classification !== 'historical-delivery') {
    reject('EFK_LEGACY_NOT_EXECUTABLE', 'delivery history cannot acquire execution qualification');
  }
  const projected = translateDelivery(value.delivery, value.bindings);
  if (difference(projected, value).length !== 0) {
    reject('EFK_SOURCE_PIN_DRIFT', 'runtime/annotations changed; this bridge cannot silently discard edits or invent SP semantics');
  }
  return projected.delivery;
}
export function exportDelivery(value: ImportedDelivery): BridgeResult<DeliverySnapshot> {
  return boundary(() => deliveryForExport(value));
}
/** Exclusive creation prevents input writeback, overwritten outputs and hardlink aliases. */
export function exportDeliveryFile(value: ImportedDelivery, file: string, scope: FileScope): BridgeResult<{ file: string }> {
  return boundary(() => {
    const delivery = deliveryForExport(value), output = checkedPath(file, scope, true);
    external(() => writeFileSync(output, stringify(delivery, { aliasDuplicateObjects: false }), { flag: 'wx', encoding: 'utf8' }));
    return { file: output };
  });
}
