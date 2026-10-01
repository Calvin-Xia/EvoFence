/**
 * A memory reference `ArtifactStore` for immutable evidence.
 *
 * Content addressing is the whole contract: bytes are stored under `ArtifactRef.id` and verified
 * against `ArtifactRef.digest` on the way in, so "the file exists" never stands in for "this is the
 * artifact that was produced". An id is immutable — the same id with a different digest is refused,
 * never overwritten. Two `SCHEMAS.md` S01 boundary rules also live here because this is where bytes
 * enter: the locator may not carry a credential, and serialized content is bounded at 1 MiB.
 *
 * Secret *detection* inside content is a PrivacyPolicy gate, not an artifact-store rule, and is not
 * implemented here; a credential embedded in the locator is the case this store can decide.
 */
import { decode } from '../protocol/index.js';
import type { ArtifactRef, ArtifactStore, StoreResult } from '../kernel/store/contracts.js';
import { storeFail, storeOk } from '../kernel/store/contracts.js';
import type { DigestPort } from '../kernel/store/identity.js';

/** S01: serialized UTF-8 content bound. */
const MAX_ARTIFACT_BYTES = 1024 * 1024;
/** S01: `ArtifactRef.location` is an opaque locator, not a URL with credentials. */
const CREDENTIAL_LOCATOR = /:\/\/[^\s/@]*:[^\s/@]*@/;
const encoder = new TextEncoder();

export function createMemoryArtifactStore(options: { readonly digest: DigestPort }): ArtifactStore {
  const { digest } = options;
  const blobs = new Map<string, { readonly ref: ArtifactRef; readonly bytes: string }>();

  return {
    put(rawRef: ArtifactRef, bytes: string): StoreResult<{ readonly disposition: 'stored' | 'duplicate' }> {
      const decoded = decode('ArtifactRef', rawRef);
      if (!decoded.ok) return decoded;
      const ref = decoded.value;
      if (CREDENTIAL_LOCATOR.test(ref.location)) {
        return storeFail('EFK_PRIVACY_VIOLATION', `artifact locator for ${ref.id} carries a credential`, [ref.id]);
      }
      const size = encoder.encode(bytes).length;
      if (size > MAX_ARTIFACT_BYTES) {
        return storeFail('EFK_SCHEMA_INVALID', `artifact ${ref.id} is ${size} bytes, over the ${MAX_ARTIFACT_BYTES}-byte bound`, [ref.id]);
      }
      if (digest.digest(bytes) !== ref.digest) {
        return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', `artifact ${ref.id} bytes do not match ${ref.digest}`, [ref.id]);
      }
      const existing = blobs.get(ref.id);
      if (existing !== undefined) {
        if (existing.ref.digest === ref.digest) return storeOk({ disposition: 'duplicate' });
        return storeFail('EFK_ARTIFACT_DIGEST_MISMATCH', `artifact ${ref.id} is immutable and already bound to ${existing.ref.digest}`, [ref.id]);
      }
      blobs.set(ref.id, { ref, bytes });
      return storeOk({ disposition: 'stored' });
    },

    get(rawRef: ArtifactRef): StoreResult<string> {
      const decoded = decode('ArtifactRef', rawRef);
      if (!decoded.ok) return decoded;
      const ref = decoded.value;
      const stored = blobs.get(ref.id);
      if (stored === undefined) return storeFail('EFK_ARTIFACT_UNAVAILABLE', `artifact ${ref.id} is not stored`, [ref.id]);
      if (stored.ref.digest !== ref.digest) {
        return storeFail('EFK_ARTIFACT_BINDING_MISMATCH', `artifact ${ref.id} is bound to ${stored.ref.digest}, not ${ref.digest}`, [ref.id]);
      }
      return storeOk(stored.bytes);
    },

    ids(): readonly string[] {
      return [...blobs.keys()];
    },
  };
}
