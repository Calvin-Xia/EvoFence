/**
 * Version surface: namespaces, the schemaVersion this code implements, the accepted version set,
 * and the S02 gate ("namespace/精确 schemaVersion 在 compatibleProtocols 中").
 *
 * Every constant is read out of the frozen field table rather than re-typed, so there is exactly
 * one place where the strings live. `CURRENT_SCHEMA_VERSION` is the exception: it says which codec
 * *this code implements*, which is a fact about this package, not about the accepted set — the
 * frozen document states it in `INTERFACES.md` §1 and `SCHEMAS.md`'s `$id`. The drift test pins it
 * to that `$id` so it cannot silently fall behind.
 *
 * `assets` carries its own namespace and version, versioned independently of `runtime`.
 */
import { DEFS } from './objects/index.js';
import type { Decoded } from './types.js';

/** `evofence.runtime/1` — read from `$defs.ProtocolVersion.properties.namespace.const`. */
export const RUNTIME_NAMESPACE = DEFS.ProtocolVersion.properties.namespace.const;

/** `evofence.assets/1` — read from `$defs.AssetProtocolVersion.properties.namespace.const`. */
export const ASSET_NAMESPACE = DEFS.AssetProtocolVersion.properties.namespace.const;

/** The codec this package implements. Pinned to `SCHEMAS.md`'s `$id` by the drift test. */
export const CURRENT_SCHEMA_VERSION = '1.1.0' as const;

/** Every schemaVersion this package can decode, read from the frozen `enum`. */
export const SUPPORTED_SCHEMA_VERSIONS = DEFS.ProtocolVersion.properties.schemaVersion.enum;

/** A version this package can decode. */
export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

/** The runtime protocol envelope, as decoded from the frozen table. */
export type RuntimeProtocolVersion = Decoded<'ProtocolVersion'>;

/** The asset protocol envelope. */
export type AssetProtocolVersion = Decoded<'AssetProtocolVersion'>;

/** Exactly one envelope pair, as listed in `HostManifest.compatibleProtocols`. */
export interface VersionPair {
  readonly namespace: string;
  readonly schemaVersion: string;
}

/** Anything that resolves a requested pair against what a host offers. */
export type VersionGate = 'ok' | 'unsupported';

/** A schemaVersion is acceptable when it is one of the exact versions this package decodes. */
export function isSupportedSchemaVersion(value: string): value is SchemaVersion {
  return (SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(value);
}

/** True when `pair` names the runtime namespace and a schemaVersion this package decodes. */
export function gateRuntimeVersion(pair: VersionPair): VersionGate {
  if (pair.namespace !== RUNTIME_NAMESPACE) return 'unsupported';
  return isSupportedSchemaVersion(pair.schemaVersion) ? 'ok' : 'unsupported';
}

/**
 * True when `offered` (a `HostManifest.compatibleProtocols`) lists `wanted` exactly.
 * There is no range matching and no "newer is fine": the frozen rule is an exact pair.
 */
export function offersVersion(offered: readonly VersionPair[], wanted: VersionPair): boolean {
  return offered.some((pair) => pair.namespace === wanted.namespace && pair.schemaVersion === wanted.schemaVersion);
}
