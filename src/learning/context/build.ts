import { decode } from '../../protocol/index.js';
import { verifyForConsumer } from '../../kernel/artifacts/index.js';
import type { ArtifactRef } from '../../kernel/artifacts/index.js';
import { storeFail } from '../../kernel/store/contracts.js';
import type { StoreResult } from '../../kernel/store/contracts.js';
import { createMemoryArtifactStore } from '../../storage/index.js';
import { audienceForRole, evidenceLink, partitionFeedback, projectTask, safeFailure, withheldReason } from './access.js';
import { validateInputs } from './validate.js';
import { canonicalContext, fitWindow } from './window.js';
import type { BoundedContextPacket, ContextInputs, ContextPorts, ContextRole, ContextRouter, WindowBudget } from './types.js';

/** No construction-time work and no host/store/model/clock callbacks; ports are pure functions. */
export function createContextRouter(ports: ContextPorts): ContextRouter {
  return { buildContextPacket: (task, role, inputs, window) => buildContextPacket(task, role, inputs, window, ports) };
}

export function buildContextPacket(
  taskContract: unknown, nodeRole: ContextRole, inputs: ContextInputs, window: WindowBudget, ports: ContextPorts,
): StoreResult<BoundedContextPacket> {
  const audience = audienceForRole(nodeRole);
  if (!audience.ok) return audience;
  const decoded = decode('TaskContract', taskContract);
  if (!decoded.ok) return safeFailure(decoded);
  const task = decoded.value;
  const validated = validateInputs(inputs, window);
  if (!validated.ok) return validated;
  if (task.taskId !== inputs.contractRef.taskId || task.version !== inputs.contractRef.version ||
      ports.digest.digest(canonicalContext(task)) !== inputs.contractRef.digest) {
    return storeFail('EFK_SOURCE_PIN_DRIFT', 'context TaskContract differs from the pinned contract');
  }
  if (inputs.binding.sessionId !== task.authorityGrant.sessionId) {
    return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', 'context recipient differs from the task session');
  }
  if (nodeRole === 'fresh-verifier' && inputs.plan.isolation !== 'fresh') {
    return storeFail('EFK_PRIVACY_VIOLATION', 'fresh verifier requires a fresh transcript');
  }
  // Apply the task's information level through the same artifact audience rule, without a rank table.
  const taskLevel: ArtifactRef = {
    protocol: task.protocol, id: task.taskId, digest: inputs.contractRef.digest,
    producer: { actorId: 'context-router', kind: 'kernel', identityRef: null }, binding: null,
    schema: { name: 'TaskContract', version: task.protocol.schemaVersion, digest: inputs.contractRef.digest },
    location: 'context:task', visibility: task.privacy.visibility, partition: 'not-evaluation', expiresAt: null,
  } as ArtifactRef;
  const taskAccess = withheldReason(taskLevel, audience.value);
  if (!taskAccess.ok) return safeFailure(taskAccess);
  if (taskAccess.value !== 'none') return storeFail('EFK_PRIVACY_VIOLATION', 'task is withheld from this context role');
  const projected = projectTask(task, audience.value, inputs.at);
  if (!projected.ok) return projected;
  const partition = partitionFeedback(inputs.plan.inputRefs, audience.value);
  if (!partition.ok) return safeFailure(partition);

  // A local verification buffer for hydrated bytes, not a second durable truth or locator resolver.
  const store = createMemoryArtifactStore({ digest: ports.digest });
  const entries = [];
  const audit = [...projected.value.audit];
  for (const ref of partition.value.visible) {
    const item = inputs.artifacts.find(item => item.ref.id === ref.id);
    if (item === undefined) return storeFail('EFK_ARTIFACT_UNAVAILABLE', 'a declared visible context input has no hydrated bytes');
    if (item.purpose === 'candidate-feedback' && nodeRole !== 'private-evaluator') {
      return storeFail('EFK_PRIVACY_VIOLATION', 'candidate verification feedback is evaluator-only');
    }
    if ((item.purpose === 'human-instruction' && ref.producer.kind !== 'human') ||
        (item.purpose === 'host-instruction' && ref.producer.kind !== 'host-adapter')) {
      return storeFail('EFK_AUTHORITY_DENIED', 'instruction provenance does not match its declared purpose');
    }
    // Hidden bytes never reach put/get/tokenizer, so they cannot affect summaries or their hashes.
    const stored = store.put(ref, item.bytes);
    if (!stored.ok) return safeFailure(stored);
    const admitted = verifyForConsumer({
      role: audience.value === 'evaluator' ? 'evaluator' : 'workspace',
      refs: [ref], expectation: item.expectation, at: inputs.at,
    }, store);
    if (!admitted.ok) return safeFailure(admitted);
    const link = evidenceLink(ref);
    entries.push({ ref: link, purpose: item.purpose, mode: 'full' as const, text: admitted.value.evidence[0].bytes });
    audit.push({ ref: link, source: 'ContextPlan.inputRefs' as const, reason: item.purpose });
  }
  const tokenLimit = Math.min(
    (task.budget.maxInputTokens as number) - window.hostInputTokens, inputs.plan.maxTokens,
    window.windowTokens - window.reservedOutputTokens - window.hostInputTokens,
  );
  if (window.reservedOutputTokens > (task.budget.maxOutputTokens as number) || tokenLimit <= 0) {
    return storeFail('EFK_BUDGET_EXHAUSTED', 'host window or output reservation exceeds the task budget');
  }
  return fitWindow({
    role: nodeRole, binding: inputs.binding, isolation: inputs.plan.isolation, preserveHostResources: true,
    task: projected.value.task, entries, audit,
    withheld: {
      visibility: partition.value.withheldVisibility + projected.value.visibility,
      partition: partition.value.withheldPartition + projected.value.partition,
    },
  }, window, tokenLimit, ports);
}
