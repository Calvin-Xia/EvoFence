/**
 * Deterministic object identity for the storage layer.
 *
 * The store answers "is this the same command/effect/receipt/event?" with a content digest. The
 * digest input is the object's canonical serialization: object keys sorted, arrays in order, no
 * whitespace. Insertion order therefore cannot change an identity, which is the one property the
 * frozen `SCHEMAS.md` S22 makes load-bearing for idempotency.
 *
 * The digest itself is an injected port (I07): this module never imports `node:crypto` and never
 * picks a hash, so a memory store and a durable store can be compared byte-for-byte on the same
 * input, and a test can swap in a deterministic stub.
 */
/** Produces a content digest for exact input bytes. Injected, never discovered. */
export interface DigestPort {
  digest(bytes: string): string;
}

/** Stable rendering of a JSON-shaped value: keys sorted, arrays ordered, no whitespace. */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

/** The content identity of `value` under the injected digest port. */
export function identityDigest(port: DigestPort, value: unknown): string {
  return port.digest(canonical(value));
}
