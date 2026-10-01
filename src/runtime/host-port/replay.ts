/**
 * Replay rebuilds state and the "still to reconcile" list — and nothing else.
 *
 * `CONTRACTS.md` §5 invariant 10: "replay不会调用模型、工具或文件写入；它只重建状态与待核实列表".
 * The strongest form of that guarantee is structural: `replayView` takes committed receipts and
 * returns a projection, with no `HostPort` in scope, so it *cannot* dispatch. A test that swaps in
 * a fake host and watches its invocation count stay flat is then checking the caller, not this
 * function — which is exactly the boundary the invariant is about.
 */
import type { Receipt, ReceiptStatus } from './types.js';

/** One committed receipt as the journal holds it. */
export interface CommittedRecord {
  readonly effectId: string;
  readonly receipt: Receipt;
}

/** The rebuilt view: last known status per effect, plus the effects still `unknown`. */
export interface ReplayView {
  readonly byEffect: Readonly<Record<string, ReceiptStatus>>;
  readonly unknowns: readonly string[];
}

/** Pure. Same records in, byte-identical view out (I07). `unknowns` is a set: one id once. */
export function replayView(records: readonly CommittedRecord[]): ReplayView {
  const byEffect: Record<string, ReceiptStatus> = {};
  for (const record of records) byEffect[record.effectId] = record.receipt.status;
  return { byEffect, unknowns: Object.keys(byEffect).filter((effectId) => byEffect[effectId] === 'unknown').sort() };
}
