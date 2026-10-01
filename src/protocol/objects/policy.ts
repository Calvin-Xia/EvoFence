/**
 * Field table, group `policy` (12 definitions).
 *
 * Transcribed once from `SCHEMAS.md` §1 `$defs` (l1-freeze.2, schemaVersion 1.1.0).
 * Do not hand-edit: `test/protocol/schema-drift.test.ts` re-parses the frozen document and
 * fails on any divergence in the definition set, property set, required set or field type.
 */
import type { DefsSchema } from '../defs.js';

export const POLICY_DEFS = {
  "BudgetPolicy": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "poolId": {"$ref":"#/$defs/Id","description":"父/子共享同一个总账池","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "category": {"type":"string","enum":["development","probe","controlled-experiment","judging"],"description":"开发、探针、试验、臂外判分分账","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "authorizationRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"预算授权的来源；controlled-experiment 必须非 null","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "maxRequests": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"全部真实/隐式/失败请求上限","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "maxInputTokens": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"每请求全部输入 token 上限，含缓存","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "maxOutputTokens": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"每请求输出上限，含 reasoning","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "maxUsdMicros": {"anyOf":[{"$ref":"#/$defs/UsdMicros"},{"type":"null"}],"description":"USD 百万分之一整数上限；null 只允许有明确无限授权的开发类别","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "maxWallMs": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"活跃墙钟上限","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "maxConcurrentRequests": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"并发预留上限","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "priceRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"冻结价格表；需要 USD 限额时非 null","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
      "missingUsagePolicy": {"const":"retain-reservation","description":"缺失 usage 保留预留，不回收为零","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},
    },
    "required": ["poolId","category","authorizationRef","maxRequests","maxInputTokens","maxOutputTokens","maxUsdMicros","maxWallMs","maxConcurrentRequests","priceRef","missingUsagePolicy"],
  },
  "PrivacyPolicy": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "visibility": {"$ref":"#/$defs/Visibility","description":"任务缺省信息级别","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},
      "feedbackVisibility": {"$ref":"#/$defs/Visibility","description":"执行者能看到的反馈级别","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},
      "privateTests": {"const":"evaluator-only","description":"私有测试仅 evaluator 可见","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},
      "finalFeedback": {"const":"no-optimization","description":"终审反馈不用于优化","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},
      "secretPolicy": {"const":"forbidden","description":"secret 不进入合同/journal/artifact 内容","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},
    },
    "required": ["visibility","feedbackVisibility","privateTests","finalFeedback","secretPolicy"],
  },
  "TerminationPolicy": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "maxAttempts": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"累计尝试上限","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},
      "maxActiveWallMs": {"type":"integer","minimum":1,"maximum":9007199254740991,"description":"活跃墙钟，不含人工等待","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},
      "cancelMode": {"const":"stop-and-confirm","description":"先停新派发，再请求确认","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},
      "unknownPolicy": {"const":"reconcile","description":"动作不明先 reconcile","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},
      "excludeHumanWait": {"const":true,"description":"human_wait_ms 单列","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},
    },
    "required": ["maxAttempts","maxActiveWallMs","cancelMode","unknownPolicy","excludeHumanWait"],
  },
  "AcceptancePolicy": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "evaluatorId": {"$ref":"#/$defs/Id","description":"唯一 task 裁决服务 id","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},
      "evaluatorVersion": {"type":"string","minLength":1,"description":"确切 evaluator 版本","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},
      "protocolRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"能力评测引用 v3/T0 快照；普通 task 可 null","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},
      "checkRefs": {"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"真实运行验收证据定义","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},
      "requiredBranchPolicy": {"const":"explicit-complete-report","description":"必需分支报告不筛掉失败/取消","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},
      "outcomeSchema": {"$ref":"#/$defs/SchemaRef","description":"产物验收 schema","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},
      "baselineRequired": {"const":false,"description":"普通 task 不要求超越 baseline","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},
    },
    "required": ["evaluatorId","evaluatorVersion","protocolRef","checkRefs","requiredBranchPolicy","outcomeSchema","baselineRequired"],
  },
  "OutcomeRequirement": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "outcomeId": {"$ref":"#/$defs/Id","description":"可判定结果 id","x-source":"CONTRACTS §1","x-mapping":"K"},
      "description": {"type":"string","minLength":1,"description":"结果要求","x-source":"CONTRACTS §1","x-mapping":"K"},
      "schema": {"$ref":"#/$defs/SchemaRef","description":"输出 schema","x-source":"CONTRACTS §1","x-mapping":"K"},
      "evidenceKinds": {"type":"array","items":{"$ref":"#/$defs/EvidenceKind"},"minItems":1,"uniqueItems":true,"description":"可接受的证据种类","x-source":"CONTRACTS §1","x-mapping":"K"},
    },
    "required": ["outcomeId","description","schema","evidenceKinds"],
  },
  "GuaranteeRequirement": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "capability": {"$ref":"#/$defs/Id","description":"语义能力键，不是品牌白名单","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},
      "mode": {"type":"string","enum":["hard","degradable"],"description":"hard 不允许弱化","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},
      "evidenceKinds": {"type":"array","items":{"$ref":"#/$defs/EvidenceKind"},"minItems":1,"uniqueItems":true,"description":"必须有指定证据，不作全序强弱折算","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},
      "coverage": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":1,"uniqueItems":true,"description":"所需操作/失败路径/持久范围标签","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},
      "alternativeIds": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"仅列明可考虑的替代 id","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},
    },
    "required": ["capability","mode","evidenceKinds","coverage","alternativeIds"],
  },
  "DegradationOption": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "alternativeId": {"$ref":"#/$defs/Id","description":"替代方案身份","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "replacesCapability": {"$ref":"#/$defs/Id","description":"被替代保证","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "requirements": {"type":"array","items":{"$ref":"#/$defs/GuaranteeRequirement"},"minItems":1,"uniqueItems":true,"description":"替代方案自身必须满足的保证","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "tradeoff": {"type":"string","minLength":1,"description":"明确成本与范围变化","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "approvalRef": {"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"精确 task/manifest/替代摘要绑定的人审或已有人授权；null 不可派发","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
    },
    "required": ["alternativeId","replacesCapability","requirements","tradeoff","approvalRef"],
  },
  "GuaranteeGap": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "capability": {"$ref":"#/$defs/Id","description":"所缺语义","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "reason": {"enum":["missing","absent","partial","unknown","evidence-kind","coverage","version","approval"],"description":"确定缺口分类","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "evidenceRefs": {"type":"array","items":{"$ref":"#/$defs/EvidenceRef"},"uniqueItems":true,"description":"保留不足证据","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "alternativeIds": {"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"待核验显式替代","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
    },
    "required": ["capability","reason","evidenceRefs","alternativeIds"],
  },
  "NegotiationResult": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "status": {"enum":["executable","needs-degradation","unsupported"],"description":"准入结果","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "taskDigest": {"$ref":"#/$defs/Digest","description":"精确原合同","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "manifestDigest": {"$ref":"#/$defs/Digest","description":"精确规范化 manifest","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "satisfied": {"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"原要求已满足","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "gaps": {"type":"array","items":{"$ref":"#/$defs/GuaranteeGap"},"uniqueItems":true,"description":"未满足原要求","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "selectedAlternatives": {"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"已批准且技术上满足的替代","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
      "approvalRefs": {"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"uniqueItems":true,"description":"不是批准一个 unknown 为 verified","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},
    },
    "required": ["status","taskDigest","manifestDigest","satisfied","gaps","selectedAlternatives","approvalRefs"],
  },
  "BudgetBound": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "tokens": {"anyOf":[{"$ref":"#/$defs/PositiveCount"},{"type":"null"}],"description":"累计 token 界","x-source":"graph SEMANTICS §4; 两者至少一个非 null","x-mapping":"BUDGET"},
      "usdMicros": {"anyOf":[{"$ref":"#/$defs/UsdMicros","minimum":1},{"type":"null"}],"description":"累计 USD 微单位界","x-source":"graph SEMANTICS §4; 两者至少一个非 null","x-mapping":"BUDGET"},
    },
    "required": ["tokens","usdMicros"],
    "anyOf": [{"properties":{"tokens":{"$ref":"#/$defs/PositiveCount"}}},{"properties":{"usdMicros":{"$ref":"#/$defs/UsdMicros"}}}],
  },
  "Resources": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "exclusive": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"排他资源集合","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},
      "shared": {"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"共享资源集合","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},
    },
    "required": ["exclusive","shared"],
  },
  "ResourcePolicy": {
    "type": "object",
    "additionalProperties": false,
    properties: {
      "resourceId": {"$ref":"#/$defs/Id","description":"资源名，不是节点对/边","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},
      "mode": {"type":"string","enum":["exclusive","shared"],"description":"排他或共享","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},
      "maxHolders": {"type":"integer","minimum":0,"maximum":9007199254740991,"description":"exclusive 必须为 1；shared 可为 0 表示不可用","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},
    },
    "required": ["resourceId","mode","maxHolders"],
    "allOf": [{"if":{"properties":{"mode":{"const":"exclusive"}}},"then":{"properties":{"maxHolders":{"const":1}}}}],
  },
} as const satisfies DefsSchema;
