/**
 * Named resources: what one node declares, and whether a lease that is already out blocks it.
 *
 * `SEMANTICS.md §3.2` fixes the model: resources are **node declarations plus a graph-level
 * policy**, mutual exclusion is derived from the resource *name*, and a resource is never an edge.
 * The graph compiler already refuses a graph whose declarations contradict the policy (check 7),
 * so every node declaring `R` declares it with `R`'s one mode.
 *
 * That leaves exactly one clash the static check cannot see, and it is the reason this module
 * exists: a `GraphPatch` may change `R`'s policy mode while nodes from the previous revision are
 * still running under leases granted with the old mode. A lease carries the mode it was granted
 * under, so a candidate that wants `R` exclusive while a live holder holds it shared is a
 * reader/writer clash — refusing it is what keeps "no two valid writers on one resource" true
 * across a revision, not just inside one.
 *
 * Capacity (`maxHolders`) is a separate question, answered by the lease table: two holders of the
 * same mode is contention, not a clash, and a mode difference is a clash.
 */
import { fail } from '../../protocol/index.js';
import type { CompiledGraph } from '../graph/index.js';
import type { LeaseGrant, ResourceConflict, ResourceDeclaration } from './types.js';

/** What one node asks for, in the frozen `exclusive`/`shared` split. */
export function declarationsOf(graph: CompiledGraph, nodeId: string): readonly ResourceDeclaration[] {
  const node = graph.node(nodeId);
  if (node === undefined) throw fail('EFK_GRAPH_REFERENCE_INVALID', `unknown resource node ${nodeId}`, [nodeId]);
  return [...node.resources.exclusive, ...node.resources.shared].map((resourceId) => {
    // Check 7 (`SEMANTICS.md §5.1`) refuses a graph that declares a resource with no policy or with
    // the wrong mode, so a compiled graph always has the entry.
    const policy = graph.resourcePolicy.get(resourceId);
    if (policy === undefined) {
      throw fail('EFK_INVARIANT_VIOLATION', `compiled resource ${resourceId} has no policy`, [nodeId, resourceId]);
    }
    return { resourceId, mode: policy.mode, maxHolders: policy.maxHolders };
  });
}

/**
 * Reader/writer clashes between a candidate's declarations and the leases that are already out.
 * Same-mode contention is deliberately absent: `maxHolders` owns it.
 */
export function resourceConflicts(
  declared: readonly ResourceDeclaration[],
  live: readonly LeaseGrant[],
): readonly ResourceConflict[] {
  const conflicts: ResourceConflict[] = [];
  for (const want of declared) {
    for (const held of live) {
      if (held.resourceId !== want.resourceId || held.mode === want.mode) continue;
      conflicts.push({
        resourceId: want.resourceId,
        declared: want.mode,
        live: held.mode,
        ownerClaimId: held.ownerClaimId,
      });
    }
  }
  return conflicts;
}

/** `true` when the candidate may run beside everything already holding a lease. */
export function independentOf(declared: readonly ResourceDeclaration[], live: readonly LeaseGrant[]): boolean {
  return resourceConflicts(declared, live).length === 0;
}
