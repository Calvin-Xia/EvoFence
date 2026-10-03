/** Learning-layer entry. See README.md for workspace/evaluation handoff obligations. */
export { buildContextPacket, createContextRouter } from './build.js';
export { audienceForRole } from './access.js';
export { canonicalContext } from './window.js';
export type {
  BoundedContextPacket, ContextArtifact, ContextAudit, ContextEntry, ContextInputs, ContextPacket,
  ContextPlan, ContextPorts, ContextPurpose, ContextRole, ContextRouter, EvidenceLink, WindowBudget,
} from './types.js';
