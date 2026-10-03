import { decode } from '../../protocol/index.js';
import { storeFail, storeOk } from '../../kernel/store/contracts.js';
import type { StoreResult } from '../../kernel/store/contracts.js';
import type { ContextInputs, WindowBudget } from './types.js';
import { canonicalContext } from './window.js';
import { safeFailure } from './access.js';

/** Only local call parameters are checked here; frozen DTOs go through the existing codec. */
function shape(value: unknown, keys: readonly string[]): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const purposes = ['evidence', 'handoff', 'human-instruction', 'host-instruction', 'candidate-feedback'];

export function validateInputs(inputs: ContextInputs, window: WindowBudget): StoreResult<true> {
  const invalid = () => storeFail('EFK_SCHEMA_INVALID', 'invalid context call parameters');
  if (!shape(inputs, ['contractRef', 'binding', 'nodeInputRefs', 'plan', 'artifacts', 'at']) ||
      !shape(window, ['windowTokens', 'reservedOutputTokens', 'hostInputTokens', 'strategy', 'excerptChars'])) return invalid();
  if (!count(inputs.at) || !Array.isArray(inputs.nodeInputRefs) || !Array.isArray(inputs.artifacts) ||
      !count(window.windowTokens) || window.windowTokens === 0 || !count(window.reservedOutputTokens) ||
      window.reservedOutputTokens === 0 || !count(window.hostInputTokens) || !count(window.excerptChars) ||
      !['reject', 'compact'].includes(window.strategy)) return invalid();
  for (const [name, value] of [
    ['ContractRef', inputs.contractRef], ['Binding', inputs.binding], ['ContextPlan', inputs.plan],
  ] as const) {
    const result = decode(name, value);
    if (!result.ok) return safeFailure(result);
  }
  const declared = new Map<string, string>();
  for (const ref of inputs.nodeInputRefs) {
    const decoded = decode('ArtifactRef', ref);
    if (!decoded.ok) return safeFailure(decoded);
    if (declared.has(ref.id)) return invalid();
    declared.set(ref.id, canonicalContext(ref));
  }
  const planned = new Map<string, string>();
  for (const ref of inputs.plan.inputRefs) {
    if (planned.has(ref.id) || declared.get(ref.id) !== canonicalContext(ref)) {
      return storeFail('EFK_GRAPH_INPUT_STALE', 'context plan contains an undeclared or substituted node input');
    }
    planned.set(ref.id, canonicalContext(ref));
  }
  const supplied = new Set<string>();
  for (const item of inputs.artifacts) {
    if (!shape(item, ['ref', 'bytes', 'purpose', 'expectation']) || typeof item.bytes !== 'string' ||
        !purposes.includes(item.purpose)) return invalid();
    const ref = decode('ArtifactRef', item.ref);
    if (!ref.ok) return safeFailure(ref);
    if (supplied.has(item.ref.id) || planned.get(item.ref.id) !== canonicalContext(item.ref)) {
      return storeFail('EFK_GRAPH_INPUT_STALE', 'hydrated context input is undeclared, duplicated or substituted');
    }
    supplied.add(item.ref.id);
    if (!shape(item.expectation, ['productKind', 'schema', 'binding']) ||
        !['node-product', 'pre-source'].includes(item.expectation.productKind) ||
        (item.expectation.productKind === 'node-product' && item.expectation.binding === null)) return invalid();
    const schema = decode('SchemaRef', item.expectation.schema);
    if (!schema.ok) return safeFailure(schema);
    if (item.expectation.binding !== null) {
      const binding = decode('Binding', item.expectation.binding);
      if (!binding.ok) return safeFailure(binding);
      const expected = item.expectation.binding;
      // Data-edge producers can be different nodes/attempts, but never a different session/base/graph.
      if (expected.sessionId !== inputs.binding.sessionId || expected.hostSessionId !== inputs.binding.hostSessionId ||
          expected.epoch !== inputs.binding.epoch || expected.baseDigest !== inputs.binding.baseDigest ||
          canonicalContext(expected.graph) !== canonicalContext(inputs.binding.graph)) {
        return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'context producer expectation belongs to an obsolete session, graph or base');
      }
    } else if (item.ref.binding !== null) {
      return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'bound context artifact requires an explicit producer expectation');
    }
  }
  return storeOk(true);
}
