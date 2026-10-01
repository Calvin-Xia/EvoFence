/**
 * Field table, group `core` (21 definitions).
 *
 * Transcribed once from `SCHEMAS.md` §1 `$defs` (l1-freeze.2, schemaVersion 1.1.0).
 * Do not hand-edit: `test/protocol-schema-drift.test.js` re-parses the frozen document and
 * fails on any divergence in the definition set, property set, required set or field type.
 */
import type { DefsSchema } from '../defs.js';

export const CORE_DEFS = {
  "Id": {
    "type": "string",
    "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
  },
  "Digest": {
    "type": "string",
    "pattern": "^sha256:[0-9a-f]{64}$",
  },
  "Instant": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991,
    "description": "UTC epoch milliseconds; only injected Clock supplies it",
  },
  "Visibility": {
    "type": "string",
    "enum": ["public","internal","private","held-out","final"],
  },
  "NodeState": {
    "type": "string",
    "enum": ["pending","ready","leased","running","verifying","succeeded","failed","waiting","unknown","cancelling","cancelled"],
  },
  "EvidenceKind": {
    "type": "string",
    "enum": ["static","native-fixture","native-disk","provider-live","invoice","kernel-conformance","fault-injection","not-run"],
  },
  "Status": {
    "type": "string",
    "enum": ["absent","partial","unknown","verified"],
  },
  "ModelId": {
    "type": "string",
    "pattern": "^[A-Za-z0-9._-]+/[A-Za-z0-9._:-]+$",
  },
  "ErrorCode": {
    "type": "string",
    "enum": ["EFK_SCHEMA_INVALID","EFK_PROTOCOL_UNSUPPORTED","EFK_LEGACY_NOT_EXECUTABLE","EFK_SOURCE_PIN_DRIFT","EFK_REVISION_CONFLICT","EFK_GRAPH_REFERENCE_INVALID","EFK_GRAPH_DEPENDENCY_CYCLE","EFK_GRAPH_INPUT_STALE","EFK_GRAPH_JOIN_INCOMPLETE","EFK_GRAPH_AUTHORITY_ESCALATION","EFK_GRAPH_RESOURCE_CONFLICT","EFK_GRAPH_BOUND_INVALID","EFK_GRAPH_NON_TERMINATING","EFK_GRAPH_TERMINAL_REQUIRED","EFK_GRAPH_EVIDENCE_REMOVAL","EFK_GRAPH_ACTIVE_NODE_MUTATION","EFK_GRAPH_NO_MATCHING_ROUTE","EFK_INVARIANT_VIOLATION","EFK_CAPABILITY_UNSUPPORTED","EFK_CAPABILITY_EVIDENCE_INSUFFICIENT","EFK_DEGRADATION_APPROVAL_REQUIRED","EFK_AUTHORITY_DENIED","EFK_GRANT_EXPIRED","EFK_GRANT_REVOKED","EFK_CLAIM_CONFLICT","EFK_LEASE_STALE","EFK_IDEMPOTENCY_COLLISION","EFK_BUDGET_NOT_AUTHORIZED","EFK_BUDGET_EXHAUSTED","EFK_BUDGET_ENVELOPE_INCONSISTENT","EFK_USAGE_INCOMPLETE","EFK_USAGE_CONFLICT","EFK_ARTIFACT_DIGEST_MISMATCH","EFK_ARTIFACT_BINDING_MISMATCH","EFK_ARTIFACT_UNAVAILABLE","EFK_HOST_BOARD_AUTHORITY_CONFLICT","EFK_HOST_SESSION_MISMATCH","EFK_HOST_EXECUTION_FAILED","EFK_HOST_REVISION_CONFLICT","EFK_HOST_DELIVERY_UNCONFIRMED","EFK_CANCEL_UNCONFIRMED","EFK_RECEIPT_STALE","EFK_RECOVERY_SEQUENCE_GAP","EFK_RECOVERY_SCHEMA_MISMATCH","EFK_EFFECT_UNKNOWN","EFK_EFFECT_NON_IDEMPOTENT_RETRY","EFK_EVALUATION_INSUFFICIENT","EFK_EVALUATION_DATA_DEGRADED","EFK_EVALUATION_PROTOCOL_MISMATCH","EFK_DECISION_AUTHORITY_DENIED","EFK_ASSET_QUALIFICATION_INVALID","EFK_ASSET_SCOPE_DENIED","EFK_ASSET_REVOKED","EFK_ASSET_EXPIRED","EFK_ACTIVATION_NOT_SETTLED","EFK_ACTIVATION_UNCONFIRMED","EFK_PRIVACY_VIOLATION","EFK_HUMAN_APPROVAL_MISSING"],
  },
  "Count": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991,
  },
  "PositiveCount": {
    "type": "integer",
    "minimum": 1,
    "maximum": 9007199254740991,
  },
  "UsdMicros": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991,
    "description": "Integer micro-USD; reservation/estimated charge rounds upward",
  },
  "SchemaRef": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "name": {"type":"string","minLength":1,"description":"输出 schema 名","x-source":"CONTRACTS §1","x-mapping":"K"},
      "version": {"type":"string","minLength":1,"description":"确切版本，不使用范围","x-source":"CONTRACTS §1","x-mapping":"K"},
      "digest": {"$ref":"#/$defs/Digest","description":"schema 内容摘要","x-source":"CONTRACTS §1","x-mapping":"K"},
    },
    "required": ["name","version","digest"],
  },
  "ContractRef": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "taskId": {"$ref":"#/$defs/Id","description":"任务身份","x-source":"CONTRACTS §1","x-mapping":"K"},
      "version": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"任务合同修订","x-source":"CONTRACTS §1","x-mapping":"K"},
      "digest": {"$ref":"#/$defs/Digest","description":"精确合同内容","x-source":"CONTRACTS §1","x-mapping":"K"},
    },
    "required": ["taskId","version","digest"],
  },
  "GraphRef": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "graphId": {"$ref":"#/$defs/Id","description":"运行图身份","x-source":"CONTRACTS §1","x-mapping":"K"},
      "revision": {"type":"integer","minimum":0,"maximum":9007199254740991,"description":"图拓扑版本；0 仅 bootstrap","x-source":"CONTRACTS §1","x-mapping":"K"},
      "digest": {"$ref":"#/$defs/Digest","description":"精确图内容摘要","x-source":"CONTRACTS §1","x-mapping":"K"},
    },
    "required": ["graphId","revision","digest"],
  },
  "ActorRef": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "actorId": {"$ref":"#/$defs/Id","description":"可归因主体；不是裸 sessionId","x-source":"CONTRACTS §1/§5","x-mapping":"AUTH"},
      "kind": {"type":"string","enum":["human","kernel","host-adapter","evaluator"],"description":"主体作用域","x-source":"CONTRACTS §1/§5","x-mapping":"AUTH"},
      "identityRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"由权限根验证的身份凭据引用；human 批准时必须非 null；禁止含 secret","x-source":"CONTRACTS §1/§5","x-mapping":"AUTH"},
    },
    "required": ["actorId","kind","identityRef"],
  },
  "Binding": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "sessionId": {"$ref":"#/$defs/Id","description":"内核 session；与原生会话通过不可变绑定表关联","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"SESSION"},
      "hostSessionId": {"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"原生会话 id；非宿主执行可为 null","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"SESSION_HOST"},
      "graph": {"$ref":"#/$defs/GraphRef","description":"该 attempt 使用的拓扑快照","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},
      "nodeId": {"$ref":"#/$defs/Id","description":"生产/消费节点","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},
      "attemptId": {"$ref":"#/$defs/Id","description":"每次 retry 新身份","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},
      "attemptOrdinal": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"节点尝试序号","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},
      "epoch": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"session 生命周期 epoch","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},
      "baseDigest": {"anyOf":[{"$ref":"#/$defs/Digest"},{"type":"null"}],"description":"workspace 基础快照，无 workspace 时 null","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},
    },
    "required": ["sessionId","hostSessionId","graph","nodeId","attemptId","attemptOrdinal","epoch","baseDigest"],
  },
  "Scope": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "workspaceRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"显式 workspace locator；不以 cwd 猜测","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},
      "readResources": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"允许读取的命名资源","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},
      "writeResources": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"允许写入的命名资源","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},
      "artifactScopes": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"可产出/消费的 artifact 范围","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},
      "trustDomain": {"type":"string","enum":["same-user","os-sandbox"],"description":"同用户信任域与 OS 沙箱分开","x-source":"CONTRACTS §1/§5","x-mapping":"ISOLATION"},
    },
    "required": ["workspaceRef","readResources","writeResources","artifactScopes","trustDomain"],
  },
  "Grant": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "grantId": {"$ref":"#/$defs/Id","description":"权限子集凭据 id","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "rootAuthorityRef": {"$ref":"#/$defs/Id","description":"唯一宿主权限根","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "parentGrantRef": {"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"父 grant；根 grant 为 null","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "actor": {"$ref":"#/$defs/ActorRef","description":"授权主体","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "sessionId": {"$ref":"#/$defs/Id","description":"授权 session","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"SESSION"},
      "nodeIds": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"受授权节点集合","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "scope": {"$ref":"#/$defs/Scope","description":"root∩parent∩task∩node 范围","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "capabilities": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"可执行操作语义键","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "maxDelegationDepth": {"type":"integer","minimum":0,"maximum":9007199254740991,"description":"剩余可委派深度","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "expiresAt": {"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}],"description":"过期时间；null 仅根明确准许","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "revocationEpoch": {"type":"integer","minimum":0,"maximum":9007199254740991,"description":"撤销代数","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
      "approvalRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"必要人审批准引用，不代签","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},
    },
    "required": ["grantId","rootAuthorityRef","parentGrantRef","actor","sessionId","nodeIds","scope","capabilities","maxDelegationDepth","expiresAt","revocationEpoch","approvalRef"],
  },
  "ProtocolVersion": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "namespace": {"const":"evofence.runtime/1","description":"独立 namespace；不复用旧 ledger/config 版本","x-source":"CONTRACTS §9; adr_0010","x-mapping":"K"},
      "schemaVersion": {"enum":["1.0.0","1.1.0"],"description":"精确 codec 版本；本提案自身为 1.1.0，枚举供 compatibleProtocols 逐版声明","x-source":"CONTRACTS §9; adr_0010","x-mapping":"K"},
    },
    "required": ["namespace","schemaVersion"],
  },
  "AssetProtocolVersion": {
    "type": "object",
    "additionalProperties": false,
    "required": ["namespace","schemaVersion"],
    properties: {
      "namespace": {"const":"evofence.assets/1","description":"资产 namespace，与旧全局 Skills/旧资产格式分离","x-source":"adr_0010","x-mapping":"ASSET"},
      "schemaVersion": {"const":"1.0.0","description":"本提案资产引用版本","x-source":"adr_0010","x-mapping":"ASSET"},
    },
  },
} as const satisfies DefsSchema;
