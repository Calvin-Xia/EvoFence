/**
 * cp1 — the writer entry: admit a produced artifact, or refuse to commit it.
 *
 * The order is the contract. Producer attribution and the expected schema version come first, then
 * the attempt binding, and only then the bytes reach the injected `ArtifactStore`. A result computed
 * against an old base, a stale graph revision, or a superseded attempt never reaches the store at
 * all — `EFK_ARTIFACT_BINDING_MISMATCH` is returned before any durable effect exists.
 *
 * Byte-level content identity (bytes vs `ArtifactRef.digest`, immutability of an id, the S01 size
 * bound and credential-in-locator rule) is the store's frozen contract and is not duplicated here:
 * `store.put` owns it, and its refusal propagates unchanged. This lane computes no digest, so no
 * second digest implementation can disagree with the store's.
 */
import { storeOk } from '../index.js';
import type { StoreResult } from '../index.js';
import { checkBinding } from './binding.js';
import { attributeProducer, matchSchema } from './identity.js';
import type { ActorRef, ArtifactExpectation, ArtifactRef, ArtifactStore, Binding } from './types.js';

export interface AdmitRequest {
  /** The reference the producer claims, already through the codec's boundary. */
  readonly ref: ArtifactRef;
  readonly bytes: string;
  /** The attempt that produced it, and the schema version the consumer is entitled to. */
  readonly expectation: ArtifactExpectation;
}

export interface AdmissionReceipt {
  readonly ref: ArtifactRef;
  readonly producer: ActorRef;
  readonly binding: Binding | null;
  readonly disposition: 'stored' | 'duplicate';
}

export function admitArtifact(request: AdmitRequest, store: ArtifactStore): StoreResult<AdmissionReceipt> {
  const producer = attributeProducer(request.ref);
  if (!producer.ok) return producer;

  const schema = matchSchema(request.ref, request.expectation.schema);
  if (!schema.ok) return schema;

  const binding = checkBinding(request.ref, request.expectation);
  if (!binding.ok) return binding;

  const stored = store.put(request.ref, request.bytes);
  if (!stored.ok) return stored;

  return storeOk({
    ref: request.ref,
    producer: producer.value,
    binding: binding.value,
    disposition: stored.value.disposition,
  });
}
