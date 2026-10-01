/**
 * cp2 — the read path: access, expiry, and real bytes.
 *
 * One order decides every read: the audience is checked first (A13 — an executor must not reach
 * `held-out`/`final` content at all), then the reference's own expiry, then any consumer expectation,
 * and finally the injected `ArtifactStore`. The store is the only source of bytes, so a reference
 * whose locator has gone away
 * fails typed as `EFK_ARTIFACT_UNAVAILABLE`; there is no branch that hands back the reference, its
 * digest or a summary instead. `expiresAt` is compared against an injected `Instant`, never a clock
 * read here (I07), and `null` means no expiry.
 */
import { storeFail, storeOk } from '../store/contracts.js';
import type { StoreResult } from '../store/contracts.js';
import { withheldReason } from './access.js';
import { checkBinding } from './binding.js';
import { attributeProducer, matchSchema } from './identity.js';
import type { ArtifactExpectation, ArtifactRef, ArtifactStore, Audience, Instant } from './types.js';

/** A reference is unavailable at or after its expiry; `null` never expires. */
export function checkAvailability(ref: ArtifactRef, at: Instant): StoreResult<ArtifactRef> {
  if (ref.expiresAt !== null && at >= ref.expiresAt) {
    return storeFail('EFK_ARTIFACT_UNAVAILABLE', `artifact ${ref.id} expired at ${ref.expiresAt}`, [ref.id]);
  }
  return storeOk(ref);
}

/**
 * Read one artifact's bytes for one audience. Withheld references are refused before the store is
 * consulted, so a privacy violation cannot be masked by an unavailable locator. If supplied, the
 * consumer's producer/schema/binding checks also precede byte retrieval, after access and expiry.
 */
export function readArtifact(
  ref: ArtifactRef,
  audience: Audience,
  at: Instant,
  store: ArtifactStore,
  expectation?: ArtifactExpectation,
): StoreResult<string> {
  const reason = withheldReason(ref, audience);
  if (!reason.ok) return reason;
  if (reason.value !== 'none') {
    return storeFail(
      'EFK_PRIVACY_VIOLATION',
      `artifact is withheld from the ${audience} audience (${reason.value})`,
    );
  }
  const available = checkAvailability(ref, at);
  if (!available.ok) return available;
  if (expectation !== undefined) {
    const producer = attributeProducer(ref);
    if (!producer.ok) return producer;
    const schema = matchSchema(ref, expectation.schema);
    if (!schema.ok) return schema;
    const binding = checkBinding(ref, expectation);
    if (!binding.ok) return binding;
  }
  return store.get(ref);
}
