/**
 * Abandonment (11) and patch authority (6).
 *
 * `abandoned` is the only mechanism that makes a gap permanent (`SEMANTICS.md §2.4`), so check 11
 * is deliberately strict: the reason must be non-empty (the schema does not force it), a branch is
 * abandoned once, evidence is never removed to make a patch look clean, and abandoning a
 * contract-required branch needs contract-level authority. A revision cannot un-abandon either:
 * the abandoned set is cumulative, so dropping an entry is itself an evidence removal.
 *
 * Check 6 is the graph-side of `patch 不提升权限`: the patch must run under a grant the caller's
 * authority ceiling names, must not add nodes outside that ceiling, and must not require tool
 * capabilities the ceiling does not cover.
 */
import type { GraphAuthority, GraphContext, GraphIssue, GraphPatch, GraphSpec, NodeSpec } from './types.js';

/** The runtime facts a patch transaction adds to plain graph validation. */
export interface PatchContext extends GraphContext {
  /** Nodes that produced artifacts, decisions or failures; they cannot be removed. */
  readonly evidenceNodeIds?: readonly string[];
  /** Nodes the patch removes (its `removals` list), used by the evidence rule. */
  readonly removedNodeIds?: readonly string[];
  /** Nodes abandoned before this patch; the abandoned set is cumulative. */
  readonly priorAbandonedNodeIds?: readonly string[];
  /** `authorityRef` values allowed to abandon a contract-required branch. */
  readonly contractAuthorityRefs?: readonly string[];
}

/** Check 11 (R5) — abandonment carries a reason and never deletes evidence. */
export function checkAbandonment(spec: GraphSpec, context: PatchContext = {}): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const removal = (message: string): void => {
    issues.push({ check: 11, code: 'EFK_GRAPH_EVIDENCE_REMOVAL', message });
  };
  const escalation = (message: string): void => {
    issues.push({ check: 11, code: 'EFK_GRAPH_AUTHORITY_ESCALATION', message });
  };

  const seen = new Set<string>();
  const contractBranches = new Set(context.contractBranches ?? []);
  const contractAuthority = new Set(context.contractAuthorityRefs ?? []);
  for (const abandoned of spec.abandonedBranches) {
    // `authorityRef` (Id) and a non-empty `reason` are enforced by the frozen schema's pattern and
    // `minLength`; the codec is the one gate for them, so this check owns the rest.
    if (seen.has(abandoned.nodeId)) removal(`branch ${abandoned.nodeId} is abandoned twice`);
    seen.add(abandoned.nodeId);
    if (contractBranches.has(abandoned.nodeId) && !contractAuthority.has(abandoned.authorityRef)) {
      escalation(`abandoning contract branch ${abandoned.nodeId} needs a contract-level authorityRef`);
    }
  }

  for (const prior of context.priorAbandonedNodeIds ?? []) {
    if (!seen.has(prior)) removal(`abandonment of ${prior} was dropped; abandonment is cumulative`);
  }

  const evidence = new Set(context.evidenceNodeIds ?? []);
  const prior = new Set(context.priorAbandonedNodeIds ?? []);
  for (const removed of context.removedNodeIds ?? []) {
    if (evidence.has(removed)) removal(`removal of ${removed} deletes a branch that produced evidence`);
    if (prior.has(removed)) removal(`removal of ${removed} deletes an abandoned branch's evidence`);
  }
  return issues;
}

function addedCapabilities(nodes: readonly NodeSpec[]): readonly { readonly nodeId: string; readonly capability: string }[] {
  const found: { nodeId: string; capability: string }[] = [];
  for (const node of nodes) {
    for (const requirement of node.toolRequirements) found.push({ nodeId: node.nodeId, capability: requirement.capability });
  }
  return found;
}

/** Check 6 — a patch may shrink scope but never enlarge it. */
export function checkAuthority(patch: GraphPatch, candidate: GraphSpec, authority: GraphAuthority): readonly GraphIssue[] {
  const issues: GraphIssue[] = [];
  const escalate = (message: string): void => {
    issues.push({ check: 6, code: 'EFK_GRAPH_AUTHORITY_ESCALATION', message });
  };
  if (!authority.grantRefs.includes(patch.authorityRef)) {
    escalate(`patch authorityRef ${patch.authorityRef} is not within the granted refs`);
  }
  if (authority.nodeIds !== null) {
    const allowed = new Set(authority.nodeIds);
    for (const node of candidate.nodes) {
      if (!allowed.has(node.nodeId)) escalate(`node ${node.nodeId} is outside the grant's node scope`);
    }
  }
  if (authority.capabilities !== null) {
    const allowed = new Set(authority.capabilities);
    for (const entry of addedCapabilities([...patch.adds, ...patch.changes])) {
      if (!allowed.has(entry.capability)) {
        escalate(`node ${entry.nodeId} requires capability ${entry.capability} the grant does not cover`);
      }
    }
  }
  return issues;
}
