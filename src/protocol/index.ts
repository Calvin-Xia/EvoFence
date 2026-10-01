/**
 * `evofence.protocol` — the frozen wire contract, and nothing else.
 *
 * What this module owns: branded ids, the version surface, the 58 error codes and their single
 * envelope, the frozen field table, and the one codec that validates against it.
 *
 * What it does not do: no I/O, no clock, no digest, no configuration, no host SDK, no database.
 * Every import in this closure is relative (I02/I03), nothing is constructed on import, and there
 * is no default backend or implicit singleton (I05/I06). `Clock`, randomness and digests are
 * injected ports in the layers above; see `OWNERSHIP.md` I01–I08 and
 * `execution/L2-PROTOCOL-NOTES.md`.
 */
export { ANNOTATION_KEYWORDS, ASSERTION_KEYWORDS, type Def, type DefsSchema } from './defs.js';
export { asDigest, asInstant, brand, type Brand, type Digest, type Id, type Instant, type ModelId } from './ids.js';
export { ERROR_CODES, RETRY_POLICY, fail, type ErrorCode, type ErrorEnvelope, type RetryPolicy } from './errors.js';
export { DEFS, type DefName } from './objects/index.js';
export {
  ASSET_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  RUNTIME_NAMESPACE,
  SUPPORTED_SCHEMA_VERSIONS,
  gateRuntimeVersion,
  isSupportedSchemaVersion,
  offersVersion,
  type AssetProtocolVersion,
  type RuntimeProtocolVersion,
  type SchemaVersion,
  type VersionGate,
  type VersionPair,
} from './version.js';
export { decode, decodeProtocolVersion, decodeRuntimeVersion, type Validated } from './codec.js';
export { type Decoded, type ObjectName, type ScalarName, type Wire } from './types.js';
