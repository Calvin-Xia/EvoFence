import type { Decoded } from '../../protocol/index.js';
import type { ArtifactExpectation, ArtifactRef, Binding, SchemaRef } from '../../kernel/artifacts/index.js';
import type { DigestPort } from '../../kernel/store/identity.js';
import type { StoreResult } from '../../kernel/store/contracts.js';

export type ContextRole = 'executor' | 'fresh-verifier' | 'private-evaluator' | 'learner';
export type ContextPurpose = 'evidence' | 'handoff' | 'human-instruction' | 'host-instruction' | 'candidate-feedback';
export type ContextPlan = Omit<Decoded<'ContextPlan'>, 'inputRefs'> & { readonly inputRefs: readonly ArtifactRef[] };

/** Hydrated immutable bytes. Resolve locators outside the router; this boundary performs no I/O. */
export interface ContextArtifact {
  readonly ref: ArtifactRef;
  readonly bytes: string;
  readonly purpose: ContextPurpose;
  /** From the committed data edge/producer attempt, never inferred from the submitted ref. */
  readonly expectation: ArtifactExpectation;
}

/** Local call parameters, not a new wire contract or journal. */
export interface ContextInputs {
  readonly contractRef: Decoded<'ContractRef'>;
  readonly binding: Binding;
  readonly nodeInputRefs: readonly ArtifactRef[];
  readonly plan: ContextPlan;
  readonly artifacts: readonly ContextArtifact[];
  readonly at: number;
}

export interface WindowBudget {
  readonly windowTokens: number;
  readonly reservedOutputTokens: number;
  /** All retained native instructions/skills/tools and message framing, measured by the host. */
  readonly hostInputTokens: number;
  readonly strategy: 'reject' | 'compact';
  readonly excerptChars: number;
}

export interface ContextPorts {
  readonly digest: DigestPort;
  /** Pure counter for the exact dispatch text; the host pins a tokenizer/version here. */
  readonly tokenizer: { readonly id: string; countTokens(text: string): number };
}

/** No locator or nested identityRef: those are not a second channel into an agent's context. */
export interface EvidenceLink {
  readonly id: string;
  readonly digest: string;
  readonly visibility: ArtifactRef['visibility'];
  readonly partition: ArtifactRef['partition'];
  readonly schema: SchemaRef;
  readonly binding: Binding | null;
  readonly producer: Pick<ArtifactRef['producer'], 'actorId' | 'kind'>;
  readonly expiresAt: number | null;
}

export interface ContextEntry {
  readonly ref: EvidenceLink;
  readonly purpose: ContextPurpose;
  readonly mode: 'full' | 'excerpt' | 'reference';
  readonly text: string;
}

export interface ContextAudit {
  readonly ref: EvidenceLink;
  readonly source: 'TaskContract' | 'ContextPlan.inputRefs';
  readonly reason: 'visible-contract-reference' | ContextPurpose;
}

export interface ContextPacket {
  readonly role: ContextRole;
  readonly binding: Binding;
  readonly isolation: ContextPlan['isolation'];
  readonly preserveHostResources: true;
  /** Audience projection, deliberately not an executable TaskContract. */
  readonly task: Readonly<Record<string, unknown>>;
  readonly entries: readonly ContextEntry[];
  readonly audit: readonly ContextAudit[];
  readonly withheld: { readonly visibility: number; readonly partition: number };
}

export interface BoundedContextPacket {
  readonly packet: ContextPacket;
  /** The only text the host dispatches; includes every audit and evidence link. */
  readonly serialized: string;
  readonly tokenCount: number;
  readonly tokenLimit: number;
  readonly tokenizerId: string;
  readonly compressed: boolean;
}

export interface ContextRouter {
  buildContextPacket(
    taskContract: unknown, nodeRole: ContextRole, inputArtifacts: ContextInputs, windowBudget: WindowBudget,
  ): StoreResult<BoundedContextPacket>;
}
