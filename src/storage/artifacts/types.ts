/**
 * The artifact-reference contract this lane reads: who produced a reference, which attempt it is
 * bound to, and who is allowed to read it. Every field name below is a frozen `SCHEMAS.md` name
 * (`ArtifactRef`, `Binding`, `GraphRef`, `SchemaRef`, `ActorRef`); nothing is renamed or re-declared.
 *
 * The `Wire` mapping widens two kinds of slot, so three aliases below re-narrow what this lane
 * actually reads — the same move `../contracts.ts` makes for `EventPayload`:
 *
 * - a nested `$ref` to an object definition (`producer`, `schema`, `binding.graph`) becomes
 *   `Record<string, unknown>` because `Wire` maps the referenced schema node, not its `Decoded`
 *   form;
 * - an `anyOf` resolves to its first branch, so `binding` and `expiresAt` are typed non-null and
 *   `Binding.baseDigest` is typed as a plain `string`, although the frozen table allows `null`.
 *
 * Every narrowing still points at the same frozen definition, so no field is renamed or re-declared.
 */
import type { Decoded } from '../../protocol/index.js';
import type { ArtifactRef as Wire, ArtifactStore } from '../index.js';

export type { ArtifactStore };
export type WireArtifactRef = Wire;
export type GraphRef = Decoded<'GraphRef'>;
export type SchemaRef = Decoded<'SchemaRef'>;
export type ActorRef = Omit<Decoded<'ActorRef'>, 'identityRef'> & { readonly identityRef: Wire | null };

/** The attempt binding, with `graph` and `baseDigest` back to their frozen definitions. */
export type Binding = Omit<Decoded<'Binding'>, 'graph' | 'baseDigest'> & {
  readonly graph: GraphRef;
  readonly baseDigest: string | null;
};

/** An immutable artifact reference, with its nested references and nullable slots re-narrowed. */
export type ArtifactRef = Omit<Wire, 'producer' | 'schema' | 'binding' | 'expiresAt'> & {
  readonly producer: ActorRef;
  readonly schema: SchemaRef;
  readonly binding: Binding | null;
  readonly expiresAt: number | null;
};

/** The frozen information level (`$defs/Visibility`). */
export type Visibility = WireArtifactRef['visibility'];
/** The frozen source partition (`ArtifactRef.partition`; not inferred from visibility). */
export type Partition = WireArtifactRef['partition'];
/** UTC epoch milliseconds, supplied by the caller's injected Clock (I07) — never read here. */
export type Instant = number;

/**
 * Who is reading. A13 pairs every read path with its audience; `report` is the default report view
 * an author or operator sees, `asset-staging` is the asset writer's view.
 */
export type Audience = 'author' | 'evaluator' | 'report' | 'asset-staging';
export type ConsumerRole = 'workspace' | 'evaluator' | 'asset';

/**
 * The attempt an artifact is expected to belong to. `baseDigest` is the workspace snapshot the
 * attempt started from, and `null` means the attempt has no workspace snapshot at all.
 */
export interface BindingExpectation {
  readonly graph: GraphRef;
  readonly nodeId: string;
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly epoch: number;
  readonly baseDigest: string | null;
}

/**
 * What kind of reference a consumer is holding out for.
 *
 * `node-product` is an artifact produced *by* an attempt: S09 requires a complete binding, so the
 * expectation carries one. `pre-source` is an approval, source pin or protocol snapshot that may be
 * produced before any attempt exists; its binding may be `null` and only becomes bound when a
 * consuming command supplies the exact session/task/graph/digest, which is what a non-null
 * `binding` expectation here means. The union makes an unbound node product unrepresentable.
 */
export type ArtifactExpectation =
  | { readonly productKind: 'node-product'; readonly schema: SchemaRef; readonly binding: BindingExpectation }
  | { readonly productKind: 'pre-source'; readonly schema: SchemaRef; readonly binding: BindingExpectation | null };

/** The executor-visible partition of a reference set. Withheld references are counted, never named. */
export interface FeedbackPartition {
  readonly audience: Audience;
  readonly visible: readonly ArtifactRef[];
  readonly withheldVisibility: number;
  readonly withheldPartition: number;
}

/** An artifact a consumer has read: real bytes, not a summary of them. */
export interface AdmittedArtifact {
  readonly ref: ArtifactRef;
  readonly bytes: string;
}

export interface ConsumerAdmission {
  readonly role: ConsumerRole;
  readonly audience: Audience;
  readonly evidence: readonly AdmittedArtifact[];
}

interface BoundRefsRequest {
  readonly refs: readonly ArtifactRef[];
  readonly expectation: ArtifactExpectation;
  readonly at: Instant;
}

export type WorkspaceConsumerRequest = { readonly role: 'workspace' } & BoundRefsRequest;
export type EvaluatorConsumerRequest = { readonly role: 'evaluator' } & BoundRefsRequest;

/**
 * Asset material. `contentRefs` and `sourceTraces` are the decoded arrays of a `CapabilityAsset`
 * (their `minItems: 1` is the codec's boundary, not re-checked here). `revokedDependencies` names
 * the asset dependencies whose revocation has invalidated this qualification (S17); it is an input
 * because the registry that observed the revocation owns that fact.
 */
export interface AssetConsumerRequest {
  readonly role: 'asset';
  readonly contentRefs: readonly ArtifactRef[];
  readonly sourceTraces: readonly ArtifactRef[];
  readonly revokedDependencies: readonly string[];
  readonly at: Instant;
}

export type ConsumerRequest = WorkspaceConsumerRequest | EvaluatorConsumerRequest | AssetConsumerRequest;
