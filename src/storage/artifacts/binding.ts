/**
 * cp1 — attempt binding. S09: a node/effect product must carry a complete binding whose graph,
 * session, host session, node, attempt, epoch and base revision match, and a mismatched binding is
 * `EFK_ARTIFACT_BINDING_MISMATCH` with no partial acceptance.
 *
 * The base revision is the load-bearing one for evolution: an artifact produced against a
 * superseded workspace base is refused, because accepting it would let a result computed on old
 * evidence be reported as the result of the current attempt. The graph revision is refused for the
 * same reason — a product of a topology the attempt no longer runs under is not its output.
 *
 * `checkBinding` is one call, not a scattering of comparisons at each consumer: the mismatch list it
 * builds is the single place that decides what "bound to this attempt" means.
 */
import { storeFail, storeOk } from '../index.js';
import type { StoreResult } from '../index.js';
import type { ArtifactExpectation, ArtifactRef, Binding, BindingExpectation } from './types.js';

/** Frozen field names that disagree between a reference and the attempt about to consume it. */
export function bindingMismatches(binding: Binding, expected: BindingExpectation): readonly string[] {
  const mismatched: string[] = [];
  if (binding.sessionId !== expected.sessionId) mismatched.push('sessionId');
  if (binding.hostSessionId !== expected.hostSessionId) mismatched.push('hostSessionId');
  if (binding.graph.graphId !== expected.graph.graphId) mismatched.push('graph.graphId');
  if (binding.graph.revision !== expected.graph.revision) mismatched.push('graph.revision');
  if (binding.graph.digest !== expected.graph.digest) mismatched.push('graph.digest');
  if (binding.nodeId !== expected.nodeId) mismatched.push('nodeId');
  if (binding.attemptId !== expected.attemptId) mismatched.push('attemptId');
  if (binding.attemptOrdinal !== expected.attemptOrdinal) mismatched.push('attemptOrdinal');
  if (binding.epoch !== expected.epoch) mismatched.push('epoch');
  if (binding.baseDigest !== expected.baseDigest) mismatched.push('baseDigest');
  return mismatched;
}

/**
 * Bind `ref` to the attempt the consumer is holding out for.
 *
 * A `pre-source` expectation with `binding: null` asserts nothing and returns the reference's own
 * binding, which may be `null` — that is the frozen allowance for approvals, source pins and
 * protocol snapshots. Every other case must match field for field, including `baseDigest`.
 */
export function checkBinding(ref: ArtifactRef, expected: ArtifactExpectation): StoreResult<Binding | null> {
  const wanted = expected.binding;
  if (wanted === null) return storeOk(ref.binding);
  const binding = ref.binding;
  if (binding === null) {
    return storeFail(
      'EFK_ARTIFACT_BINDING_MISMATCH',
      `${expected.productKind} artifact ${ref.id} carries no attempt binding, expected node ${wanted.nodeId} attempt ${wanted.attemptId}`,
      [ref.id],
    );
  }
  const mismatched = bindingMismatches(binding, wanted);
  if (mismatched.length > 0) {
    return storeFail(
      'EFK_ARTIFACT_BINDING_MISMATCH',
      `artifact ${ref.id} is bound to a different ${mismatched.join('/')} than the consuming attempt`,
      [ref.id],
    );
  }
  return storeOk(binding);
}
