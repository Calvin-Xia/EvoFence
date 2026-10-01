/**
 * cp1 — producer attribution and the expected schema version.
 *
 * `ArtifactRef.producer` is required by the frozen table, and `ActorRef` fixes one rule this lane
 * can decide: a `human` producer must carry the identity reference the authority root verified.
 * A human claim with `identityRef: null` is therefore an unattributable producer, refused as a
 * binding mismatch rather than accepted on the strength of the label.
 *
 * `ArtifactRef.schema` is the version triple (`name`/`version`/`digest`). A consumer that expects a
 * version compares all three: a matching name at a different version, or the same name/version with
 * different schema bytes, is a different artifact contract, not a near miss.
 */
import { storeFail, storeOk } from '../index.js';
import type { StoreResult } from '../index.js';
import type { ActorRef, ArtifactRef, SchemaRef } from './types.js';

/**
 * The producer identity of a reference, or a refusal when the reference cannot be attributed to a
 * subject at all.
 */
export function attributeProducer(ref: ArtifactRef): StoreResult<ActorRef> {
  if (ref.producer.kind === 'human' && ref.producer.identityRef === null) {
    return storeFail(
      'EFK_ARTIFACT_BINDING_MISMATCH',
      `artifact ${ref.id} claims a human producer with no verified identity reference`,
      [ref.id],
    );
  }
  return storeOk(ref.producer);
}

/** The declared schema triple, or a refusal when it is not the version the consumer expects. */
export function matchSchema(ref: ArtifactRef, expected: SchemaRef): StoreResult<SchemaRef> {
  const declared = ref.schema;
  if (declared.name !== expected.name || declared.version !== expected.version || declared.digest !== expected.digest) {
    return storeFail(
      'EFK_ARTIFACT_BINDING_MISMATCH',
      `artifact ${ref.id} declares schema ${declared.name}@${declared.version}, the consumer expects ${expected.name}@${expected.version}`,
      [ref.id],
    );
  }
  return storeOk(declared);
}
