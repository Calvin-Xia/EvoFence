/**
 * Field table, group `assets` (4 definitions).
 *
 * Transcribed once from `SCHEMAS.md` §1 `$defs` (l1-freeze.2, schemaVersion 1.1.0).
 * Do not hand-edit: `test/protocol/schema-drift.test.ts` re-parses the frozen document and
 * fails on any divergence in the definition set, property set, required set or field type.
 */
import type { DefsSchema } from '../defs.js';

export const ASSETS_DEFS = {
  "AssetRef": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "protocol": {"$ref":"#/$defs/AssetProtocolVersion","description":"资产独立 namespace","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "assetId": {"$ref":"#/$defs/Id","description":"资产身份","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "revision": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"精确版本","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "digest": {"$ref":"#/$defs/Digest","description":"完整资产内容","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "scope": {"$ref":"#/$defs/Scope","description":"资格与激活作用域","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "qualificationRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"评价/晋升完整 binding；未取得资格为 null","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
    },
    "required": ["protocol","assetId","revision","digest","scope","qualificationRef"],
  },
  "CapabilityAsset": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "protocol": {"$ref":"#/$defs/AssetProtocolVersion","description":"封套","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "asset": {"$ref":"#/$defs/AssetRef","description":"不可变内容绑定","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "kind": {"type":"string","enum":["skill","template","memory","tool-policy"],"description":"资产类型","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "contentRefs": {"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":1,"uniqueItems":true,"description":"项目 staging，原全局 Skills 只读","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "sourceTraces": {"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":1,"uniqueItems":true,"description":"train 来源证据","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "dependencies": {"type":"array","items":{"$ref":"#/$defs/AssetRef"},"minItems":0,"uniqueItems":true,"description":"精确依赖 revision","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "hypothesis": {"type":"string","minLength":1,"description":"直接能力假设","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "qualification": {"type":"string","enum":["staged","validated","rejected","inconclusive","promoted","expired","revoked"],"description":"active 不作全局资格 bool","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "evaluationRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"候选评价 receipt","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "expiresAt": {"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}],"description":"资格 expiry","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
      "revocationRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"撤销证据","x-source":"CONTRACTS §7","x-mapping":"ASSET"},
    },
    "required": ["protocol","asset","kind","contentRefs","sourceTraces","dependencies","hypothesis","qualification","evaluationRef","expiresAt","revocationRef"],
  },
  "ActivationReceipt": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "protocol": {"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "asset": {"$ref":"#/$defs/AssetRef","description":"精确 asset revision","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "hostSessionId": {"$ref":"#/$defs/Id","description":"具体 host session","x-source":"CONTRACTS §1/§7","x-mapping":"SESSION_HOST"},
      "scope": {"$ref":"#/$defs/Scope","description":"激活范围","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "previousSnapshot": {"$ref":"#/$defs/ArtifactRef","description":"旧 snapshot 不覆盖","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "newSnapshot": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"实际激活成功才非 null","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "actualStatus": {"type":"string","enum":["active","failed","unknown"],"description":"真实 host 确认，safe idle 不等于已激活","x-source":"CONTRACTS §1/§7","x-mapping":"ACTIVATION"},
      "authorizationRef": {"$ref":"#/$defs/Id","description":"激活 grant","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
      "evaluationRef": {"$ref":"#/$defs/ArtifactRef","description":"完整资格绑定","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},
    },
    "required": ["protocol","asset","hostSessionId","scope","previousSnapshot","newSnapshot","actualStatus","authorizationRef","evaluationRef"],
  },
  "ErrorEnvelope": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "code": {"$ref":"#/$defs/ErrorCode","description":"ERRORS 冻结枚举","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},
      "message": {"type":"string","minLength":1,"description":"无 secret 的短说明","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},
      "retry": {"type":"string","enum":["never","after-refresh","after-authorization","after-reconcile"],"description":"不能按 code 自行重放外部效果","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},
      "refs": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"相关 session/command/effect 身份","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},
      "visibility": {"$ref":"#/$defs/Visibility","description":"私有测试原因只给安全摘要","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},
    },
    "required": ["code","message","retry","refs","visibility"],
  },
} as const satisfies DefsSchema;
