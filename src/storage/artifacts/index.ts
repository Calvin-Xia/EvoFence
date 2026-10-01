/**
 * `evofence.storage.artifacts` — the immutable-artifact reference contract: content identity,
 * producer attribution, attempt binding, access partition and availability, plus the workspace /
 * evaluator / asset consumer entry.
 *
 * This layer sits above the frozen byte store (`../index.js` `ArtifactStore`), which owns digests,
 * immutability and the S01 boundary rules. It performs no I/O of its own, reads no clock and
 * computes no digest: the `Instant` it compares against and the store it reads from are both
 * injected, so the same references produce the same admissions every run (I07).
 *
 * Single entry point for the subtree. Consumers import from here, not from a leaf module.
 */
export type {
  ActorRef,
  AdmittedArtifact,
  ArtifactExpectation,
  ArtifactRef,
  ArtifactStore,
  AssetConsumerRequest,
  Audience,
  Binding,
  BindingExpectation,
  ConsumerAdmission,
  ConsumerRequest,
  ConsumerRole,
  EvaluatorConsumerRequest,
  FeedbackPartition,
  GraphRef,
  Instant,
  Partition,
  SchemaRef,
  Visibility,
  WorkspaceConsumerRequest,
} from './types.js';

export { attributeProducer, matchSchema } from './identity.js';
export { bindingMismatches, checkBinding } from './binding.js';
export {
  defaultReportRefs,
  isRestrictedPartition,
  partitionFeedback,
  visibilityCeiling,
  withheldReason,
} from './access.js';
export { checkAvailability, readArtifact } from './availability.js';
export { admitArtifact, type AdmitRequest, type AdmissionReceipt } from './admit.js';
export { ARTIFACT_ERROR_MATRIX, verifyForConsumer } from './consumer.js';
