/** Pure scheduler/policy consumer. Time and all admission inputs are explicit values. */
import { budgetSnapshot, decide as policyDecide, usageCompleteness } from '../../kernel/policy/index.js';
import { computeFrontier, dispatchRound, emptyFairness, liveGrants } from '../../kernel/scheduler/index.js';
import { grantCovers, budgetWithin } from '../host-port/index.js';
import { storeFail, storeOk } from '../../kernel/store/index.js';
import type { BranchFacts, NodeFacts, ArtifactRef as GraphArtifact } from '../../kernel/graph/index.js';
import { bindingFor, currentAttemptOf, nodeStateOf } from './project.js';
import { event, transition } from './journal.js';
import type { Admission, Effect, EventDraft, PlannedBatch, RoundPlan, RuntimeState, SessionSeed, StoreResult } from './types.js';

export function factsFor(state: RuntimeState, seed: SessionSeed, now: RoundPlan['now']): NodeFacts {
  const states: NodeFacts['states'] = new Map(seed.graph.spec.nodes.flatMap(n => {
    const s = nodeStateOf(state, n.nodeId, currentAttemptOf(state, n.nodeId));
    return s === null ? [] : [[n.nodeId, s] as const];
  }));
  const applied = new Set(state.events.filter(e => e.type === 'receipt.applied').map(e => e.payload.objectRef!.id));
  const artifacts = new Map<string, GraphArtifact | null>();
  const branches = new Map<string, BranchFacts>();
  for (const node of seed.graph.spec.nodes) {
    const matching = Object.values(state.receipts).filter(r => applied.has(r.receiptId)
      && r.binding.nodeId === node.nodeId && r.binding.attemptOrdinal === currentAttemptOf(state, node.nodeId));
    const refs = [...new Map(matching.flatMap(r => r.artifactRefs).map(r => [r.id, r])).values()] as GraphArtifact[];
    // NodeFacts has one output slot. Ambiguous multiple outputs are an explicit input gap.
    artifacts.set(node.nodeId, refs.length === 1 ? refs[0] : null);
    const terminal = states.get(node.nodeId) ?? null;
    branches.set(node.nodeId, { state: terminal, binding: matching.length === 0 ? null : matching[0].binding,
      artifactRefs: refs, decisionRef: null, gapReason: terminal === 'failed' || terminal === 'cancelled' ? terminal : null });
  }
  const holders = new Map<string, { active: number; abandoned: number }>();
  for (const lease of liveGrants(state.scheduler.leases, now)) {
    const counts = holders.get(lease.resourceId) ?? { active: 0, abandoned: 0 };
    holders.set(lease.resourceId, { active: counts.active + 1, abandoned: counts.abandoned });
  }
  return { states, artifacts, holders, branches, seq: state.lastSequence ?? 0 };
}
export function dispatchAdmission(state: RuntimeState, input: Admission, reservedRequest: string | null = null): ReturnType<typeof policyDecide> {
  const applied = new Set(state.events.filter(e => e.type === 'receipt.applied').map(e => e.payload.objectRef!.id));
  const usage = Object.values(state.receipts).filter(r => applied.has(r.receiptId)).flatMap(r => r.usage);
  const snapshot = budgetSnapshot(state.budget);
  // Exhaustion means no ADDITIONAL reservation fits. Dispatch of an existing reservation does
  // not ask for another slot or copy/increase the pool; its already committed funds remain pinned.
  const issue = state.usageIssues.find(e => e.code !== 'EFK_USAGE_INCOMPLETE') ?? null;
  const completeRequests = new Set(usage.filter(row => row.complete).map(row => row.requestId));
  return policyDecide({ ...input, budget: { snapshot: { ...snapshot, exhausted: reservedRequest === null && snapshot.exhausted }, error: issue },
    usage: usageCompleteness(usage.filter(row => row.complete || !completeRequests.has(row.requestId)), [...state.budget.reservations, ...state.budget.settlements]
      .map(r => r.requestId).filter(id => id !== reservedRequest)) });
}
export function planRound(state: RuntimeState, seed: SessionSeed, plan: RoundPlan,
  admissions: Readonly<Record<string, Admission>>, commandId: string): StoreResult<PlannedBatch> {
  if (state.dispatchMode !== 'active') return storeOk({ events: [], effects: [], receipts: [] });
  const facts = factsFor(state, seed, plan.now);
  // Control targets become eligible only after the chosen action is journalled. This does not
  // re-evaluate any route predicate; only graph.decide is allowed to choose the action.
  const schedulable = { ...seed.graph, spec: { ...seed.graph.spec, nodes: seed.graph.spec.nodes.filter(node =>
    state.attempts[node.nodeId] !== undefined || !seed.graph.edgesTo(node.nodeId).some(edge =>
      edge.from !== edge.to && (edge.type === 'route' || edge.type === 'repair' || edge.type === 'fallback'))) } };
  const frontier = computeFrontier(schedulable, facts, state.scheduler);
  for (const entry of frontier.filter(e => e.disposition === 'dispatchable')) {
    const decision = dispatchAdmission(state, admissions[entry.nodeId]);
    if (decision.error !== null) return { ok: false, error: decision.error };
    if (seed.operations[entry.nodeId] === undefined) {
      return storeFail('EFK_CAPABILITY_UNSUPPORTED', `node ${entry.nodeId} has no injected execution operation`, [entry.nodeId]);
    }
  }
  const round = dispatchRound({ graph: schedulable, facts, state: state.scheduler, budget: state.budget,
    fairness: emptyFairness(), bindingFor: id => bindingFor(state, seed, id), ...plan });
  const events: EventDraft[] = [];
  const effects: Effect[] = [];
  for (const entry of frontier) {
    const binding = bindingFor(state, seed, entry.nodeId);
    const slot = seed.graph.spec.nodes.findIndex(n => n.nodeId === entry.nodeId);
    if (entry.state === 'waiting' && entry.readiness.state === 'ready') {
      events.push(transition(state, commandId, `wake:${slot}`, binding, 'waiting', 'pending'));
    } else if ((entry.state === null || entry.state === 'pending' || entry.state === 'ready') && entry.readiness.state !== 'ready') {
      // Audit G06: the gap target of a join node is the node itself, and `changedIds` is declared
      // `uniqueItems: true` on the wire, so the id list has to be de-duplicated here.
      const changedIds = [...new Set([entry.nodeId, ...(entry.readiness.state === 'waiting' ? [entry.readiness.gap.node] : [])])];
      events.push(transition(state, commandId, `gap:${slot}`, binding, entry.state, entry.readiness.state, { changedIds }));
    }
  }
  for (const decision of round.decisions) {
    if (decision.verdict !== 'dispatch') continue;
    const binding = decision.claim!.binding;
    const operation = seed.operations[decision.nodeId];
    const slot = seed.graph.spec.nodes.findIndex(n => n.nodeId === decision.nodeId);
    const authority = admissions[decision.nodeId].authority;
    const grant = seed.grants.find(g => authority.ok && grantCovers(g, authority.value.scope, plan.now) && budgetWithin(seed.policy, g.budget));
    if (grant === undefined) return storeFail('EFK_AUTHORITY_DENIED', 'no live injected delegation grant', [decision.nodeId]);
    const effect: Effect = { ...operation, protocol: state.protocol, effectId: `effect:${commandId}:n${slot}`,
      idempotencyKey: `send:${commandId}:n${slot}`, binding, authorityRef: grant.grantId,
      reservationRef: decision.reservationRef, leases: decision.leases, deadline: plan.now + plan.effectTtlMs };
    const before = nodeStateOf(state, binding.nodeId, binding.attemptOrdinal);
    if (before === null) events.push(transition(state, commandId, `pending:${slot}`, binding, null, 'pending'));
    if (before !== 'ready') events.push(transition(state, commandId, `ready:${slot}`, binding, before === null ? 'pending' : before, 'ready'));
    events.push(transition(state, commandId, `leased:${slot}`, binding, 'ready', 'leased'));
    events.push(event(state, commandId, `intended:${slot}`, 'effect.intended', { binding, effectId: effect.effectId }));
    effects.push(effect);
  }
  return storeOk({ events, effects, receipts: [] });
}
