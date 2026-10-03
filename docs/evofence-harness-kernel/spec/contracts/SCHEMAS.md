# 字段级 schema（Field-level Schema）

状态：**冻结提案 `l1-freeze.2`，待 `l1_replan` 真人定案**；不是已发布 API 或实现通过声明。管辖 ADR 仍为 proposed。

### 变更记录

| 项 | 内容 |
|---|---|
| `1.0.0` → `1.1.0`（`l1-freeze.1` → `l1-freeze.2`） | `SessionView` 增必填 `nodeStates`（新对象 `NodeStateEntry`）；`DecisionRecord` 增 `taskEvidenceRef`/`evaluationReceiptRef`/`activationReceiptRef` 并按 `kind` 约束非 null，`contractRef` 收窄为仅 `task` 非 null；`CapabilityJudgement` 增三个护栏字段 |
| 依据 | 复核发现唯一读面无法表达 CONTRACTS §4 状态机；四类裁决只有枚举级独立 |
| 前提（必读） | 本变更**含新增必填字段**；按 `INTERFACES.md` §1「必填字段 → 下一个 major namespace」本应升 `evofence.runtime/2`。本版按 minor 处理，**因为 `1.0.0` 从未被任何实现、宿主或持久投影消费**（本文为待 `l1_replan` 的提案）。一旦存在 1.0.0 消费方，此项必须改按 major 升 `/2` |
| `1.0.0` codec | 保持可单独读取，不被本版改写；`compatibleProtocols` 可并列声明两版 |

规范 namespace：`evofence.runtime/1`；schemaVersion：`1.1.0`；资产引用独立 `evofence.assets/1`（其 schemaVersion 独立，仍为 `1.0.0`）。下列 JSON Schema 是规范载体，字段表逐成员展开，不存在第二套可选字段清单。对象拒绝额外键；仅 capabilities map 允许命名能力键。可空字段必须显式给 null；四个 loop bound 可省略，但至少出现两类。

计数口径：共享 `$defs` 对象直接成员计一次，引用不无限重复展开；嵌套类型都有单独表。共 **63 个对象定义、427 个成员、423 个必填成员**。

## 1. 规范 JSON Schema

顶层公共对象选 root oneOf；port DTO/嵌套对象选对应 `$defs`，保留完整 bundle 解析引用。description/x-source/x-mapping 为注解；数值比较、引用、权限与状态语义由 §3 校验执行。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:evofence:runtime:1.1.0",
  "oneOf": [{"$ref":"#/$defs/TaskContract"},{"$ref":"#/$defs/GraphSpec"},{"$ref":"#/$defs/NodeSpec"},{"$ref":"#/$defs/GraphPatch"},{"$ref":"#/$defs/HostManifest"},{"$ref":"#/$defs/Command"},{"$ref":"#/$defs/Event"},{"$ref":"#/$defs/Effect"},{"$ref":"#/$defs/Receipt"},{"$ref":"#/$defs/ArtifactRef"},{"$ref":"#/$defs/DecisionRecord"},{"$ref":"#/$defs/CapabilityAsset"},{"$ref":"#/$defs/ActivationReceipt"},{"$ref":"#/$defs/AssetRef"},{"$ref":"#/$defs/CommandResult"},{"$ref":"#/$defs/SessionView"},{"$ref":"#/$defs/NegotiationResult"},{"$ref":"#/$defs/EvaluationReceipt"},{"$ref":"#/$defs/TaskEvidenceReport"},{"$ref":"#/$defs/JoinReceipt"}],
  "$defs": {
    "Id": {"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"},
    "Digest": {"type":"string","pattern":"^sha256:[0-9a-f]{64}$"},
    "Instant": {"type":"integer","minimum":0,"maximum":9007199254740991,"description":"UTC epoch milliseconds; only injected Clock supplies it"},
    "Visibility": {"type":"string","enum":["public","internal","private","held-out","final"]},
    "NodeState": {"type":"string","enum":["pending","ready","leased","running","verifying","succeeded","failed","waiting","unknown","cancelling","cancelled"]},
    "NodeStateEntry": {"type":"object","additionalProperties":false,"properties":{"nodeId":{"$ref":"#/$defs/Id","description":"节点 id","x-source":"CONTRACTS §4; graph SEMANTICS §2.2","x-mapping":"K"},"attemptOrdinal":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"该状态所属 attempt 序号","x-source":"CONTRACTS §4; graph SEMANTICS §2.3","x-mapping":"K"},"epoch":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"判定该状态时的 session epoch","x-source":"CONTRACTS §4/§5; graph SEMANTICS §2.3","x-mapping":"K"},"state":{"$ref":"#/$defs/NodeState","description":"节点当前状态；不是完成声明","x-source":"CONTRACTS §4; graph SEMANTICS §2.2","x-mapping":"K"},"sinceSequence":{"$ref":"#/$defs/Count","description":"进入该状态的 journal sequence","x-source":"CONTRACTS §4/§5","x-mapping":"ORDER"}},"required":["nodeId","attemptOrdinal","epoch","state","sinceSequence"]},
    "EvidenceKind": {"type":"string","enum":["static","native-fixture","native-disk","provider-live","invoice","kernel-conformance","fault-injection","not-run"]},
    "Status": {"type":"string","enum":["absent","partial","unknown","verified"]},
    "ProtocolVersion": {"type":"object","additionalProperties":false,"properties":{"namespace":{"const":"evofence.runtime/1","description":"独立 namespace；不复用旧 ledger/config 版本","x-source":"CONTRACTS §9; adr_0010","x-mapping":"K"},"schemaVersion":{"enum":["1.0.0","1.1.0"],"description":"精确 codec 版本；本提案自身为 1.1.0，枚举供 compatibleProtocols 逐版声明","x-source":"CONTRACTS §9; adr_0010","x-mapping":"K"}},"required":["namespace","schemaVersion"]},
    "SchemaRef": {"type":"object","additionalProperties":false,"properties":{"name":{"type":"string","minLength":1,"description":"输出 schema 名","x-source":"CONTRACTS §1","x-mapping":"K"},"version":{"type":"string","minLength":1,"description":"确切版本，不使用范围","x-source":"CONTRACTS §1","x-mapping":"K"},"digest":{"$ref":"#/$defs/Digest","description":"schema 内容摘要","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["name","version","digest"]},
    "ContractRef": {"type":"object","additionalProperties":false,"properties":{"taskId":{"$ref":"#/$defs/Id","description":"任务身份","x-source":"CONTRACTS §1","x-mapping":"K"},"version":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"任务合同修订","x-source":"CONTRACTS §1","x-mapping":"K"},"digest":{"$ref":"#/$defs/Digest","description":"精确合同内容","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["taskId","version","digest"]},
    "GraphRef": {"type":"object","additionalProperties":false,"properties":{"graphId":{"$ref":"#/$defs/Id","description":"运行图身份","x-source":"CONTRACTS §1","x-mapping":"K"},"revision":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"图拓扑版本；0 仅 bootstrap","x-source":"CONTRACTS §1","x-mapping":"K"},"digest":{"$ref":"#/$defs/Digest","description":"精确图内容摘要","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["graphId","revision","digest"]},
    "ActorRef": {"type":"object","additionalProperties":false,"properties":{"actorId":{"$ref":"#/$defs/Id","description":"可归因主体；不是裸 sessionId","x-source":"CONTRACTS §1/§5","x-mapping":"AUTH"},"kind":{"type":"string","enum":["human","kernel","host-adapter","evaluator"],"description":"主体作用域","x-source":"CONTRACTS §1/§5","x-mapping":"AUTH"},"identityRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"由权限根验证的身份凭据引用；human 批准时必须非 null；禁止含 secret","x-source":"CONTRACTS §1/§5","x-mapping":"AUTH"}},"required":["actorId","kind","identityRef"]},
    "Binding": {"type":"object","additionalProperties":false,"properties":{"sessionId":{"$ref":"#/$defs/Id","description":"内核 session；与原生会话通过不可变绑定表关联","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"SESSION"},"hostSessionId":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"原生会话 id；非宿主执行可为 null","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"SESSION_HOST"},"graph":{"$ref":"#/$defs/GraphRef","description":"该 attempt 使用的拓扑快照","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},"nodeId":{"$ref":"#/$defs/Id","description":"生产/消费节点","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},"attemptId":{"$ref":"#/$defs/Id","description":"每次 retry 新身份","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},"attemptOrdinal":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"节点尝试序号","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},"epoch":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"session 生命周期 epoch","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"},"baseDigest":{"anyOf":[{"$ref":"#/$defs/Digest"},{"type":"null"}],"description":"workspace 基础快照，无 workspace 时 null","x-source":"CONTRACTS §1; graph SEMANTICS §2.3","x-mapping":"K"}},"required":["sessionId","hostSessionId","graph","nodeId","attemptId","attemptOrdinal","epoch","baseDigest"]},
    "Scope": {"type":"object","additionalProperties":false,"properties":{"workspaceRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"显式 workspace locator；不以 cwd 猜测","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},"readResources":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"允许读取的命名资源","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},"writeResources":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"允许写入的命名资源","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},"artifactScopes":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"可产出/消费的 artifact 范围","x-source":"CONTRACTS §1/§5","x-mapping":"GRANT"},"trustDomain":{"type":"string","enum":["same-user","os-sandbox"],"description":"同用户信任域与 OS 沙箱分开","x-source":"CONTRACTS §1/§5","x-mapping":"ISOLATION"}},"required":["workspaceRef","readResources","writeResources","artifactScopes","trustDomain"]},
    "Grant": {"type":"object","additionalProperties":false,"properties":{"grantId":{"$ref":"#/$defs/Id","description":"权限子集凭据 id","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"rootAuthorityRef":{"$ref":"#/$defs/Id","description":"唯一宿主权限根","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"parentGrantRef":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"父 grant；根 grant 为 null","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"actor":{"$ref":"#/$defs/ActorRef","description":"授权主体","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"sessionId":{"$ref":"#/$defs/Id","description":"授权 session","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"SESSION"},"nodeIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"受授权节点集合","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"scope":{"$ref":"#/$defs/Scope","description":"root∩parent∩task∩node 范围","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"capabilities":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"可执行操作语义键","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"maxDelegationDepth":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"剩余可委派深度","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"expiresAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}],"description":"过期时间；null 仅根明确准许","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"revocationEpoch":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"撤销代数","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"},"approvalRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"必要人审批准引用，不代签","x-source":"CONTRACTS §1/§5; adr_0001","x-mapping":"GRANT"}},"required":["grantId","rootAuthorityRef","parentGrantRef","actor","sessionId","nodeIds","scope","capabilities","maxDelegationDepth","expiresAt","revocationEpoch","approvalRef"]},
    "BudgetPolicy": {"type":"object","additionalProperties":false,"properties":{"poolId":{"$ref":"#/$defs/Id","description":"父/子共享同一个总账池","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"category":{"type":"string","enum":["development","probe","controlled-experiment","judging"],"description":"开发、探针、试验、臂外判分分账","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"authorizationRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"预算授权的来源；controlled-experiment 必须非 null","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"maxRequests":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"全部真实/隐式/失败请求上限","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"maxInputTokens":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"每请求全部输入 token 上限，含缓存","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"maxOutputTokens":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"每请求输出上限，含 reasoning","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"maxUsdMicros":{"anyOf":[{"$ref":"#/$defs/UsdMicros"},{"type":"null"}],"description":"USD 百万分之一整数上限；null 只允许有明确无限授权的开发类别","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"maxWallMs":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"活跃墙钟上限","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"maxConcurrentRequests":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"并发预留上限","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"priceRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"冻结价格表；需要 USD 限额时非 null","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"},"missingUsagePolicy":{"const":"retain-reservation","description":"缺失 usage 保留预留，不回收为零","x-source":"CONTRACTS §5; evaluation PROTOCOL §3/§7","x-mapping":"BUDGET"}},"required":["poolId","category","authorizationRef","maxRequests","maxInputTokens","maxOutputTokens","maxUsdMicros","maxWallMs","maxConcurrentRequests","priceRef","missingUsagePolicy"]},
    "PrivacyPolicy": {"type":"object","additionalProperties":false,"properties":{"visibility":{"$ref":"#/$defs/Visibility","description":"任务缺省信息级别","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},"feedbackVisibility":{"$ref":"#/$defs/Visibility","description":"执行者能看到的反馈级别","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},"privateTests":{"const":"evaluator-only","description":"私有测试仅 evaluator 可见","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},"finalFeedback":{"const":"no-optimization","description":"终审反馈不用于优化","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"},"secretPolicy":{"const":"forbidden","description":"secret 不进入合同/journal/artifact 内容","x-source":"CONTRACTS §7; evaluation PROTOCOL §4","x-mapping":"K"}},"required":["visibility","feedbackVisibility","privateTests","finalFeedback","secretPolicy"]},
    "TerminationPolicy": {"type":"object","additionalProperties":false,"properties":{"maxAttempts":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"累计尝试上限","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},"maxActiveWallMs":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"活跃墙钟，不含人工等待","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},"cancelMode":{"const":"stop-and-confirm","description":"先停新派发，再请求确认","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},"unknownPolicy":{"const":"reconcile","description":"动作不明先 reconcile","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"},"excludeHumanWait":{"const":true,"description":"human_wait_ms 单列","x-source":"CONTRACTS §4/§5; evaluation METRICS §7.3","x-mapping":"CANCEL"}},"required":["maxAttempts","maxActiveWallMs","cancelMode","unknownPolicy","excludeHumanWait"]},
    "AcceptancePolicy": {"type":"object","additionalProperties":false,"properties":{"evaluatorId":{"$ref":"#/$defs/Id","description":"唯一 task 裁决服务 id","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},"evaluatorVersion":{"type":"string","minLength":1,"description":"确切 evaluator 版本","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},"protocolRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"能力评测引用 v3/T0 快照；普通 task 可 null","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},"checkRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"真实运行验收证据定义","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},"requiredBranchPolicy":{"const":"explicit-complete-report","description":"必需分支报告不筛掉失败/取消","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},"outcomeSchema":{"$ref":"#/$defs/SchemaRef","description":"产物验收 schema","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"},"baselineRequired":{"const":false,"description":"普通 task 不要求超越 baseline","x-source":"CONTRACTS §6; evaluation PROTOCOL §1/§5","x-mapping":"DECISION"}},"required":["evaluatorId","evaluatorVersion","protocolRef","checkRefs","requiredBranchPolicy","outcomeSchema","baselineRequired"]},
    "OutcomeRequirement": {"type":"object","additionalProperties":false,"properties":{"outcomeId":{"$ref":"#/$defs/Id","description":"可判定结果 id","x-source":"CONTRACTS §1","x-mapping":"K"},"description":{"type":"string","minLength":1,"description":"结果要求","x-source":"CONTRACTS §1","x-mapping":"K"},"schema":{"$ref":"#/$defs/SchemaRef","description":"输出 schema","x-source":"CONTRACTS §1","x-mapping":"K"},"evidenceKinds":{"type":"array","items":{"$ref":"#/$defs/EvidenceKind"},"minItems":1,"uniqueItems":true,"description":"可接受的证据种类","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["outcomeId","description","schema","evidenceKinds"]},
    "GuaranteeRequirement": {"type":"object","additionalProperties":false,"properties":{"capability":{"$ref":"#/$defs/Id","description":"语义能力键，不是品牌白名单","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},"mode":{"type":"string","enum":["hard","degradable"],"description":"hard 不允许弱化","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},"evidenceKinds":{"type":"array","items":{"$ref":"#/$defs/EvidenceKind"},"minItems":1,"uniqueItems":true,"description":"必须有指定证据，不作全序强弱折算","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},"coverage":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":1,"uniqueItems":true,"description":"所需操作/失败路径/持久范围标签","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"},"alternativeIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"仅列明可考虑的替代 id","x-source":"CONTRACTS §1/§3; adr_0006","x-mapping":"NEGOTIATE"}},"required":["capability","mode","evidenceKinds","coverage","alternativeIds"]},
    "DegradationOption": {"type":"object","additionalProperties":false,"properties":{"alternativeId":{"$ref":"#/$defs/Id","description":"替代方案身份","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"replacesCapability":{"$ref":"#/$defs/Id","description":"被替代保证","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"requirements":{"type":"array","items":{"$ref":"#/$defs/GuaranteeRequirement"},"minItems":1,"uniqueItems":true,"description":"替代方案自身必须满足的保证","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"tradeoff":{"type":"string","minLength":1,"description":"明确成本与范围变化","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"approvalRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"精确 task/manifest/替代摘要绑定的人审或已有人授权；null 不可派发","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"}},"required":["alternativeId","replacesCapability","requirements","tradeoff","approvalRef"]},
    "TaskContract": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"协议封套","x-source":"CONTRACTS §1","x-mapping":"K"},"taskId":{"$ref":"#/$defs/Id","description":"用户任务 id","x-source":"CONTRACTS §1","x-mapping":"K"},"version":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"任务修订","x-source":"CONTRACTS §1","x-mapping":"K"},"goal":{"type":"string","minLength":1,"description":"用户目标","x-source":"CONTRACTS §1","x-mapping":"K"},"requiredOutcomes":{"type":"array","items":{"$ref":"#/$defs/OutcomeRequirement"},"minItems":1,"uniqueItems":true,"description":"必须达到的结果","x-source":"CONTRACTS §1","x-mapping":"K"},"requiredBranches":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"明确必须分支，允许单 agent 空集合","x-source":"CONTRACTS §1","x-mapping":"K"},"acceptance":{"$ref":"#/$defs/AcceptancePolicy","description":"唯一 task 验收合同","x-source":"CONTRACTS §1","x-mapping":"K"},"scope":{"$ref":"#/$defs/Scope","description":"workspace/artifact 范围","x-source":"CONTRACTS §1","x-mapping":"K"},"authorityGrant":{"$ref":"#/$defs/Grant","description":"显式权限子集","x-source":"CONTRACTS §1","x-mapping":"K"},"budget":{"$ref":"#/$defs/BudgetPolicy","description":"父/子共享预算","x-source":"CONTRACTS §1","x-mapping":"K"},"privacy":{"$ref":"#/$defs/PrivacyPolicy","description":"反馈与数据边界","x-source":"CONTRACTS §1","x-mapping":"K"},"termination":{"$ref":"#/$defs/TerminationPolicy","description":"尝试/取消/时间边界","x-source":"CONTRACTS §1","x-mapping":"K"},"requiredGuarantees":{"type":"array","items":{"$ref":"#/$defs/GuaranteeRequirement"},"minItems":1,"uniqueItems":true,"description":"准入要求","x-source":"CONTRACTS §1","x-mapping":"K"},"degradations":{"type":"array","items":{"$ref":"#/$defs/DegradationOption"},"minItems":0,"uniqueItems":true,"description":"显式替代，禁止隐式弱化","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["protocol","taskId","version","goal","requiredOutcomes","requiredBranches","acceptance","scope","authorityGrant","budget","privacy","termination","requiredGuarantees","degradations"]},
    "ResourcePolicy": {"type":"object","additionalProperties":false,"properties":{"resourceId":{"$ref":"#/$defs/Id","description":"资源名，不是节点对/边","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},"mode":{"type":"string","enum":["exclusive","shared"],"description":"排他或共享","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},"maxHolders":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"exclusive 必须为 1；shared 可为 0 表示不可用","x-source":"graph SEMANTICS §3.2","x-mapping":"K"}},"required":["resourceId","mode","maxHolders"],"allOf":[{"if":{"properties":{"mode":{"const":"exclusive"}}},"then":{"properties":{"maxHolders":{"const":1}}}}]},
    "Resources": {"type":"object","additionalProperties":false,"properties":{"exclusive":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"排他资源集合","x-source":"graph SEMANTICS §3.2","x-mapping":"K"},"shared":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"共享资源集合","x-source":"graph SEMANTICS §3.2","x-mapping":"K"}},"required":["exclusive","shared"]},
    "GraphLimits": {"type":"object","additionalProperties":false,"properties":{"maxNodes":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"节点数界","x-source":"graph SEMANTICS §4/§5","x-mapping":"K"},"maxConcurrentAgents":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"原生并发会话界","x-source":"graph SEMANTICS §4/§5","x-mapping":"K"},"maxDepth":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"loop/subgraph 总深度界","x-source":"graph SEMANTICS §4/§5","x-mapping":"K"},"maxAttempts":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"图级累计尝试界","x-source":"graph SEMANTICS §4/§5","x-mapping":"K"}},"required":["maxNodes","maxConcurrentAgents","maxDepth","maxAttempts"]},
    "LoopSpec": {"type":"object","additionalProperties":false,"properties":{"bodyNodeIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":1,"uniqueItems":true,"description":"显式 loop body","x-source":"graph SEMANTICS §4","x-mapping":"K"},"maxIterations":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"迭代上限（§4 的 `bound{...}` 包装在本版拍平为顶层字段）","x-source":"graph SEMANTICS §4","x-mapping":"K"},"maxWallClock":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"loop 累计活跃毫秒（同上）","x-source":"graph SEMANTICS §4","x-mapping":"K"},"maxTokensOrCost":{"$ref":"#/$defs/BudgetBound","description":"累计 token/USD 界（同上）","x-source":"graph SEMANTICS §4","x-mapping":"K"},"maxDepth":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"嵌套深度界（同上）","x-source":"graph SEMANTICS §4","x-mapping":"K"},"stop":{"type":"array","items":{"type":"string","enum":["body-success","bound-exhausted","irreparable-failure"]},"minItems":1,"uniqueItems":true,"description":"仅 body-success/bound-exhausted/irreparable-failure","x-source":"graph SEMANTICS §4","x-mapping":"K"},"carry":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"显式迭代输入增量","x-source":"graph SEMANTICS §4","x-mapping":"K"}},"required":["bodyNodeIds","stop","carry"],"allOf":[{"anyOf":[{"required":["maxIterations","maxWallClock"]},{"required":["maxIterations","maxTokensOrCost"]},{"required":["maxIterations","maxDepth"]},{"required":["maxWallClock","maxTokensOrCost"]},{"required":["maxWallClock","maxDepth"]},{"required":["maxTokensOrCost","maxDepth"]}]}]},
    "BudgetBound": {"type":"object","additionalProperties":false,"properties":{"tokens":{"anyOf":[{"$ref":"#/$defs/PositiveCount"},{"type":"null"}],"description":"累计 token 界","x-source":"graph SEMANTICS §4; 两者至少一个非 null","x-mapping":"BUDGET"},"usdMicros":{"anyOf":[{"$ref":"#/$defs/UsdMicros","minimum":1},{"type":"null"}],"description":"累计 USD 微单位界","x-source":"graph SEMANTICS §4; 两者至少一个非 null","x-mapping":"BUDGET"}},"required":["tokens","usdMicros"],"anyOf":[{"properties":{"tokens":{"$ref":"#/$defs/PositiveCount"}}},{"properties":{"usdMicros":{"$ref":"#/$defs/UsdMicros"}}}]},
    "ContextPlan": {"type":"object","additionalProperties":false,"properties":{"inputRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"有限输入 packet","x-source":"CONTRACTS §1/§3","x-mapping":"K"},"maxTokens":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"上下文注入界","x-source":"CONTRACTS §1/§3","x-mapping":"K"},"preserveHostResources":{"const":true,"description":"保留原 instructions/skills/tools","x-source":"CONTRACTS §1/§3","x-mapping":"CONTEXT"},"isolation":{"type":"string","enum":["current","fresh"],"description":"当前会话或新 transcript","x-source":"CONTRACTS §1/§3","x-mapping":"CHILD"}},"required":["inputRefs","maxTokens","preserveHostResources","isolation"]},
    "ModelRequirement": {"type":"object","additionalProperties":false,"properties":{"providerModel":{"anyOf":[{"$ref":"#/$defs/ModelId"},{"type":"null"}],"description":"真实 provider/model；未选定 null","x-source":"evaluation PROTOCOL §9","x-mapping":"MODEL"},"reasoningRequested":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"请求参数标签","x-source":"evaluation PROTOCOL §9","x-mapping":"HIGH"},"reasoningGuarantee":{"type":"string","enum":["payload-only","server-tier"],"description":"参数接受不等于独立档位","x-source":"evaluation PROTOCOL §9","x-mapping":"HIGH"},"payloadRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"宿主内三臂 thinking payload 内容摘要","x-source":"evaluation PROTOCOL §9","x-mapping":"HIGH"}},"required":["providerModel","reasoningRequested","reasoningGuarantee","payloadRef"]},
    "NodeSpec": {"type":"object","additionalProperties":false,"properties":{"nodeId":{"$ref":"#/$defs/Id","description":"运行节点 id","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"kind":{"type":"string","enum":["agent","tool","deterministic","evaluate","join","human","subgraph"],"description":"七类节点","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"inputRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"本 attempt 消费输入","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"outputSchemas":{"type":"array","items":{"$ref":"#/$defs/SchemaRef"},"minItems":0,"uniqueItems":true,"description":"输出约束","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"loop":{"anyOf":[{"$ref":"#/$defs/LoopSpec"},{"type":"null"}],"description":"显式有界 loop","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"subgraph":{"anyOf":[{"$ref":"#/$defs/GraphRef"},{"type":"null"}],"description":"被委派子图","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"contextPlan":{"$ref":"#/$defs/ContextPlan","description":"有限上下文","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"toolRequirements":{"type":"array","items":{"$ref":"#/$defs/GuaranteeRequirement"},"minItems":0,"uniqueItems":true,"description":"原生工具能力","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"TOOL"},"modelRequirements":{"$ref":"#/$defs/ModelRequirement","description":"模型条件","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"resources":{"$ref":"#/$defs/Resources","description":"资源声明而非边；CONTRACTS §1 的 read/write resources 在本版按 SEMANTICS §3.2 表达为 exclusive/shared（Scope 仍保留 readResources/writeResources）","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"termination":{"$ref":"#/$defs/TerminationPolicy","description":"停止边界","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"terminal":{"type":"boolean","description":"显式终局标记，无 real consumer 必须 true","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"},"requiredBranches":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"join 的明确 fan-in，非 join 必须空","x-source":"CONTRACTS §1; graph SEMANTICS §2/§4","x-mapping":"K"}},"required":["nodeId","kind","inputRefs","outputSchemas","loop","subgraph","contextPlan","toolRequirements","modelRequirements","resources","termination","terminal","requiredBranches"]},
    "Predicate": {"type":"object","additionalProperties":false,"properties":{"op":{"type":"string","enum":["eq","neq","all","any","not","true"],"description":"纯数据谓词 AST；禁止 eval/代码字符串","x-source":"graph SEMANTICS §3.0/§3.1","x-mapping":"K"},"path":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"outcome/reason/env 中显式路径；复合谓词为 null","x-source":"graph SEMANTICS §3.0/§3.1","x-mapping":"K"},"value":{"anyOf":[{"type":"string"},{"type":"boolean"},{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},{"type":"null"}],"description":"eq/neq 比较JSON标量；复合谓词为null","x-source":"graph SEMANTICS §3.0/§3.1; 冻结提案","x-mapping":"K"},"children":{"type":"array","items":{"$ref":"#/$defs/Predicate"},"minItems":0,"uniqueItems":true,"description":"复合操作子谓词；原子谓词空","x-source":"graph SEMANTICS §3.0/§3.1","x-mapping":"K"}},"required":["op","path","value","children"]},
    "EdgeSpec": {"type":"object","additionalProperties":false,"properties":{"edgeId":{"$ref":"#/$defs/Id","description":"边身份","x-source":"graph SEMANTICS §3","x-mapping":"K"},"type":{"type":"string","enum":["dependency","data","route","repair","fallback","provenance"],"description":"六类边，不含 resource/join","x-source":"graph SEMANTICS §3","x-mapping":"K"},"from":{"$ref":"#/$defs/Id","description":"上游/生产者","x-source":"graph SEMANTICS §3","x-mapping":"K"},"to":{"$ref":"#/$defs/Id","description":"下游/消费者","x-source":"graph SEMANTICS §3","x-mapping":"K"},"when":{"anyOf":[{"$ref":"#/$defs/Predicate"},{"type":"null"}],"description":"routing 条件，非 routing 为 null","x-source":"graph SEMANTICS §3","x-mapping":"K"},"artifact":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"data 的实际输入绑定","x-source":"graph SEMANTICS §3","x-mapping":"K"},"expect":{"anyOf":[{"$ref":"#/$defs/SchemaRef"},{"type":"null"}],"description":"data 消费 schema","x-source":"graph SEMANTICS §3","x-mapping":"K"},"maxAttempts":{"anyOf":[{"$ref":"#/$defs/PositiveCount"},{"type":"null"}],"description":"repair/fallback 累计 attempt 界","x-source":"graph SEMANTICS §3","x-mapping":"K"},"relation":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"provenance 关系，不参与 ready","x-source":"graph SEMANTICS §3","x-mapping":"K"}},"required":["edgeId","type","from","to","when","artifact","expect","maxAttempts","relation"]},
    "AbandonedBranch": {"type":"object","additionalProperties":false,"properties":{"nodeId":{"$ref":"#/$defs/Id","description":"被明确放弃分支","x-source":"graph SEMANTICS §2.4","x-mapping":"K"},"authorityRef":{"$ref":"#/$defs/Id","description":"有权放弃的 grant","x-source":"graph SEMANTICS §2.4","x-mapping":"K"},"reason":{"type":"string","minLength":1,"description":"可审计理由","x-source":"graph SEMANTICS §2.4","x-mapping":"K"},"at":{"$ref":"#/$defs/Instant","description":"注入 Clock 记录，非排序依据","x-source":"graph SEMANTICS §2.4","x-mapping":"K"}},"required":["nodeId","authorityRef","reason","at"]},
    "GraphSpec": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"协议封套","x-source":"CONTRACTS §1","x-mapping":"K"},"graphId":{"$ref":"#/$defs/Id","description":"产品图，独立于 SP","x-source":"CONTRACTS §1","x-mapping":"K"},"revision":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"图修订","x-source":"CONTRACTS §1","x-mapping":"K"},"taskContractRef":{"$ref":"#/$defs/ContractRef","description":"确切任务合同","x-source":"CONTRACTS §1","x-mapping":"K"},"nodes":{"type":"array","items":{"$ref":"#/$defs/NodeSpec"},"minItems":1,"uniqueItems":true,"description":"允许单 agent，禁止强制拆分","x-source":"CONTRACTS §1","x-mapping":"K"},"typedEdges":{"type":"array","items":{"$ref":"#/$defs/EdgeSpec"},"minItems":0,"uniqueItems":true,"description":"类型边集合","x-source":"CONTRACTS §1","x-mapping":"K"},"requiredJoins":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"所有 join node ids","x-source":"CONTRACTS §1","x-mapping":"K"},"resourcePolicy":{"type":"array","items":{"$ref":"#/$defs/ResourcePolicy"},"minItems":0,"uniqueItems":true,"description":"图级命名资源策略","x-source":"CONTRACTS §1","x-mapping":"K"},"graphLimits":{"$ref":"#/$defs/GraphLimits","description":"明确边界","x-source":"CONTRACTS §1","x-mapping":"K"},"abandonedBranches":{"type":"array","items":{"$ref":"#/$defs/AbandonedBranch"},"minItems":0,"uniqueItems":true,"description":"保留证据，仅经 patch 写入","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["protocol","graphId","revision","taskContractRef","nodes","typedEdges","requiredJoins","resourcePolicy","graphLimits","abandonedBranches"]},
    "GraphPatch": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"协议封套","x-source":"graph SEMANTICS §5","x-mapping":"K"},"graphId":{"$ref":"#/$defs/Id","description":"目标图","x-source":"graph SEMANTICS §5","x-mapping":"K"},"expectedRevision":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"拓扑 CAS","x-source":"graph SEMANTICS §5","x-mapping":"K"},"adds":{"type":"array","items":{"$ref":"#/$defs/NodeSpec"},"minItems":0,"uniqueItems":true,"description":"新增节点","x-source":"graph SEMANTICS §5","x-mapping":"K"},"changes":{"type":"array","items":{"$ref":"#/$defs/NodeSpec"},"minItems":0,"uniqueItems":true,"description":"替换完整未认领 NodeSpec","x-source":"graph SEMANTICS §5","x-mapping":"K"},"removals":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"仅无证据、未认领节点","x-source":"graph SEMANTICS §5","x-mapping":"K"},"typedEdges":{"type":"array","items":{"$ref":"#/$defs/EdgeSpec"},"minItems":0,"uniqueItems":true,"description":"显式完整新边集，无隐式猜测","x-source":"graph SEMANTICS §5","x-mapping":"K"},"abandonedBranches":{"type":"array","items":{"$ref":"#/$defs/AbandonedBranch"},"minItems":0,"uniqueItems":true,"description":"累计放弃标注","x-source":"graph SEMANTICS §5","x-mapping":"K"},"reason":{"type":"string","minLength":1,"description":"变更理由","x-source":"graph SEMANTICS §5","x-mapping":"K"},"authorityRef":{"$ref":"#/$defs/Id","description":"不得提升权限","x-source":"graph SEMANTICS §5","x-mapping":"K"}},"required":["protocol","graphId","expectedRevision","adds","changes","removals","typedEdges","abandonedBranches","reason","authorityRef"]},
    "Command": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §1","x-mapping":"K"},"commandId":{"$ref":"#/$defs/Id","description":"幂等身份，同 id 不同内容拒绝","x-source":"CONTRACTS §1","x-mapping":"K"},"sessionId":{"$ref":"#/$defs/Id","description":"目标内核 session","x-source":"CONTRACTS §1","x-mapping":"SESSION"},"expectedRevision":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"journal revision CAS，与 graph revision 分离","x-source":"CONTRACTS §1","x-mapping":"K"},"actor":{"$ref":"#/$defs/ActorRef","description":"发起者","x-source":"CONTRACTS §1","x-mapping":"K"},"grantRef":{"$ref":"#/$defs/Id","description":"有效权限子集","x-source":"CONTRACTS §1","x-mapping":"K"},"payload":{"$ref":"#/$defs/CommandPayload","description":"封闭类型操作","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["protocol","commandId","sessionId","expectedRevision","actor","grantRef","payload"]},
    "CommandPayload": {"type":"object","additionalProperties":false,"properties":{"kind":{"type":"string","enum":["session.create","graph.patch","node.claim","session.pause","session.resume","session.cancel","effect.reconcile","task.evaluate","candidate.evaluate","asset.promote","asset.activate","asset.revoke","host.observe","effect.receipt","effect.dispatch"],"description":"操作鉴别符","x-source":"CONTRACTS §2","x-mapping":"K"},"task":{"anyOf":[{"$ref":"#/$defs/TaskContract"},{"type":"null"}],"description":"session.create 必填","x-source":"CONTRACTS §2","x-mapping":"K"},"graph":{"anyOf":[{"$ref":"#/$defs/GraphSpec"},{"type":"null"}],"description":"session.create 必填","x-source":"CONTRACTS §2","x-mapping":"K"},"patch":{"anyOf":[{"$ref":"#/$defs/GraphPatch"},{"type":"null"}],"description":"graph.patch 必填","x-source":"CONTRACTS §2","x-mapping":"K"},"binding":{"anyOf":[{"$ref":"#/$defs/Binding"},{"type":"null"}],"description":"node.claim/task.evaluate 必填","x-source":"CONTRACTS §2","x-mapping":"K"},"objectRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"effect/host observation/receipt/candidate/asset 的精确输入","x-source":"CONTRACTS §2","x-mapping":"K"},"manifestRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"session.create/resume 必填","x-source":"CONTRACTS §2","x-mapping":"K"},"reason":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"cancel/revoke/pause 的理由","x-source":"CONTRACTS §2","x-mapping":"K"}},"required":["kind","task","graph","patch","binding","objectRef","manifestRef","reason"],"allOf":[{"if":{"properties":{"kind":{"const":"session.create"}}},"then":{"properties":{"task":{"not":{"type":"null"}},"graph":{"not":{"type":"null"}},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"type":"null"},"manifestRef":{"not":{"type":"null"}},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"graph.patch"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"not":{"type":"null"}},"binding":{"type":"null"},"objectRef":{"type":"null"},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"node.claim"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"not":{"type":"null"}},"objectRef":{"type":"null"},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"session.pause"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"type":"null"},"manifestRef":{"type":"null"},"reason":{"not":{"type":"null"}}}}},{"if":{"properties":{"kind":{"const":"session.resume"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"type":"null"},"manifestRef":{"not":{"type":"null"}},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"session.cancel"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"type":"null"},"manifestRef":{"type":"null"},"reason":{"not":{"type":"null"}}}}},{"if":{"properties":{"kind":{"const":"effect.reconcile"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"task.evaluate"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"not":{"type":"null"}},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"candidate.evaluate"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"asset.promote"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"asset.activate"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"asset.revoke"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"not":{"type":"null"}}}}},{"if":{"properties":{"kind":{"const":"host.observe"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"effect.receipt"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}},{"if":{"properties":{"kind":{"const":"effect.dispatch"}}},"then":{"properties":{"task":{"type":"null"},"graph":{"type":"null"},"patch":{"type":"null"},"binding":{"type":"null"},"objectRef":{"not":{"type":"null"}},"manifestRef":{"type":"null"},"reason":{"type":"null"}}}}]},
    "Event": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §1","x-mapping":"K"},"eventId":{"$ref":"#/$defs/Id","description":"稳定幂等身份","x-source":"CONTRACTS §1","x-mapping":"K"},"sequence":{"type":"integer","minimum":0,"maximum":9007199254740991,"description":"journal 连续序列；不得拿 host seq 直接当 journal seq","x-source":"CONTRACTS §1","x-mapping":"ORDER"},"sessionId":{"$ref":"#/$defs/Id","description":"kernel session","x-source":"CONTRACTS §1","x-mapping":"SESSION"},"revision":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"journal 事务 revision","x-source":"CONTRACTS §1","x-mapping":"K"},"epoch":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"session epoch","x-source":"CONTRACTS §1","x-mapping":"K"},"causedBy":{"$ref":"#/$defs/Id","description":"command/effect/receipt identity","x-source":"CONTRACTS §1","x-mapping":"K"},"type":{"type":"string","enum":["graph.accepted","graph.patched","node.transition","effect.intended","effect.dispatched","receipt.archived","receipt.applied","decision.recorded","session.epoch-changed","grant.revoked","budget.changed","asset.transition","host.observed","session.paused","session.resumed","session.cancel-requested","session.cancel-confirmed"],"description":"封闭事件目录","x-source":"CONTRACTS §1","x-mapping":"K"},"payload":{"$ref":"#/$defs/EventPayload","description":"typed transition/ref payload","x-source":"CONTRACTS §1","x-mapping":"K"},"visibility":{"$ref":"#/$defs/Visibility","description":"不可越权回传","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["protocol","eventId","sequence","sessionId","revision","epoch","causedBy","type","payload","visibility"]},
    "EventPayload": {"type":"object","additionalProperties":false,"properties":{"binding":{"anyOf":[{"$ref":"#/$defs/Binding"},{"type":"null"}],"description":"节点/effect 绑定","x-source":"CONTRACTS §1/§5","x-mapping":"K"},"objectRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"不可变对象/receipt 内容引用","x-source":"CONTRACTS §1/§5","x-mapping":"K"},"before":{"anyOf":[{"$ref":"#/$defs/NodeState"},{"type":"null"}],"description":"仅 node.transition 使用；其余事件必须 null（session.epoch-changed 的新 epoch 由 Event.epoch 承载）","x-source":"CONTRACTS §1/§5","x-mapping":"K"},"after":{"anyOf":[{"$ref":"#/$defs/NodeState"},{"type":"null"}],"description":"仅 node.transition 使用；其余事件必须 null","x-source":"CONTRACTS §1/§5","x-mapping":"K"},"effectId":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"effect/receipt 事件必填","x-source":"CONTRACTS §1/§5","x-mapping":"K"},"decisionId":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"decision.recorded 必填","x-source":"CONTRACTS §1/§5","x-mapping":"K"},"changedIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"受影响对象 id","x-source":"CONTRACTS §1/§5","x-mapping":"K"},"error":{"anyOf":[{"$ref":"#/$defs/ErrorEnvelope"},{"type":"null"}],"description":"错误原因；不放任意异常对象","x-source":"CONTRACTS §1/§5","x-mapping":"K"}},"required":["binding","objectRef","before","after","effectId","decisionId","changedIds","error"]},
    "LeaseRef": {"type":"object","additionalProperties":false,"properties":{"resourceId":{"$ref":"#/$defs/Id","description":"排他/共享命名资源","x-source":"CONTRACTS §5; graph SEMANTICS §2.3","x-mapping":"LEASE"},"ownerClaimId":{"$ref":"#/$defs/Id","description":"唯一当前 claim","x-source":"CONTRACTS §5; graph SEMANTICS §2.3","x-mapping":"LEASE"},"epoch":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"获授 session epoch","x-source":"CONTRACTS §5; graph SEMANTICS §2.3","x-mapping":"LEASE"},"fencingToken":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"单调 token，与 revision/attempt 分开","x-source":"CONTRACTS §5; graph SEMANTICS §2.3","x-mapping":"LEASE"},"expiresAt":{"$ref":"#/$defs/Instant","description":"租约 expiry","x-source":"CONTRACTS §5; graph SEMANTICS §2.3","x-mapping":"LEASE"}},"required":["resourceId","ownerClaimId","epoch","fencingToken","expiresAt"]},
    "Effect": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §1","x-mapping":"K"},"effectId":{"$ref":"#/$defs/Id","description":"持久 intention id","x-source":"CONTRACTS §1","x-mapping":"K"},"idempotencyKey":{"$ref":"#/$defs/Id","description":"同一确认未执行重发用同 key","x-source":"CONTRACTS §1","x-mapping":"K"},"binding":{"$ref":"#/$defs/Binding","description":"含 epoch/node/attempt/base","x-source":"CONTRACTS §1","x-mapping":"K"},"authorityRef":{"$ref":"#/$defs/Id","description":"有效 scoped grant","x-source":"CONTRACTS §1","x-mapping":"K"},"reservationRef":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"模型/计费动作必须预算预留","x-source":"CONTRACTS §1","x-mapping":"K"},"leases":{"type":"array","items":{"$ref":"#/$defs/LeaseRef"},"minItems":0,"uniqueItems":true,"description":"排他写与 activation 必须有 lease","x-source":"CONTRACTS §1","x-mapping":"K"},"inputRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"精确输入","x-source":"CONTRACTS §1","x-mapping":"K"},"deadline":{"$ref":"#/$defs/Instant","description":"派发期限，注入 Clock","x-source":"CONTRACTS §1","x-mapping":"K"},"kind":{"type":"string","enum":["host.agent","host.tool","host.delegate","host.cancel","host.activate","host.reconcile","timer.wait"],"description":"宿主/基础设施执行目录","x-source":"CONTRACTS §1","x-mapping":"K"},"payload":{"$ref":"#/$defs/EffectPayload","description":"操作要求，实际动作只能由注入 port","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["protocol","effectId","idempotencyKey","binding","authorityRef","reservationRef","leases","inputRefs","deadline","kind","payload"]},
    "EffectPayload": {"type":"object","additionalProperties":false,"properties":{"context":{"anyOf":[{"$ref":"#/$defs/ContextPlan"},{"type":"null"}],"description":"agent/delegate 上下文","x-source":"CONTRACTS §1/§2","x-mapping":"K"},"toolName":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"tool 类型必须非 null","x-source":"CONTRACTS §1/§2","x-mapping":"TOOL"},"argumentsRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"tool 参数工件引用","x-source":"CONTRACTS §1/§2","x-mapping":"K"},"graphRef":{"anyOf":[{"$ref":"#/$defs/GraphRef"},{"type":"null"}],"description":"delegate 类型子图","x-source":"CONTRACTS §1/§2","x-mapping":"K"},"targetIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"cancel/reconcile 涉及的真实会话/effect 集合","x-source":"CONTRACTS §1/§2","x-mapping":"CANCEL"},"assetRef":{"anyOf":[{"$ref":"#/$defs/AssetRef"},{"type":"null"}],"description":"activate 精确资产","x-source":"CONTRACTS §1/§2","x-mapping":"K"},"previousSnapshot":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"activate 必填，失败保留","x-source":"CONTRACTS §1/§2","x-mapping":"K"},"deliveryGuarantee":{"type":"string","enum":["none","acknowledged-durable"],"description":"可靠发送不能用 enqueue 代替","x-source":"CONTRACTS §1/§2","x-mapping":"DELIVERY"}},"required":["context","toolName","argumentsRef","graphRef","targetIds","assetRef","previousSnapshot","deliveryGuarantee"]},
    "Usage": {"type":"object","additionalProperties":false,"properties":{"requestId":{"$ref":"#/$defs/Id","description":"一次请求身份；同请求只结算一次","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"source":{"type":"string","enum":["synthetic","provider","host-normalized","estimate","unknown"],"description":"证据来源，禁止 synthetic 充当 provider","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"inputUncached":{"anyOf":[{"$ref":"#/$defs/Count"},{"type":"null"}],"description":"未缓存输入 token","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"cacheRead":{"anyOf":[{"$ref":"#/$defs/Count"},{"type":"null"}],"description":"缓存读取输入 token","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"cacheWrite":{"anyOf":[{"$ref":"#/$defs/Count"},{"type":"null"}],"description":"单独缓存写入 token，未知为 null","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"output":{"anyOf":[{"$ref":"#/$defs/Count"},{"type":"null"}],"description":"总输出，已包含 reasoning","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"reasoning":{"anyOf":[{"$ref":"#/$defs/Count"},{"type":"null"}],"description":"output 的子集，不重复加","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"total":{"anyOf":[{"$ref":"#/$defs/Count"},{"type":"null"}],"description":"按来源定义规范化总量","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"estimatedUsdMicros":{"anyOf":[{"$ref":"#/$defs/UsdMicros"},{"type":"null"}],"description":"冻结价格估价，非账单","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"COST"},"invoiceUsdMicros":{"anyOf":[{"$ref":"#/$defs/UsdMicros"},{"type":"null"}],"description":"真实账单数值，未查 null","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"INVOICE"},"complete":{"type":"boolean","description":"原始 usage 完整且归一化校验通过","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"},"evidenceRefs":{"type":"array","items":{"$ref":"#/$defs/EvidenceRef"},"minItems":0,"uniqueItems":true,"description":"原始与规范化证据","x-source":"CONTRACTS §1/§5; evaluation PROTOCOL §7","x-mapping":"USAGE"}},"required":["requestId","source","inputUncached","cacheRead","cacheWrite","output","reasoning","total","estimatedUsdMicros","invoiceUsdMicros","complete","evidenceRefs"]},
    "Receipt": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §1","x-mapping":"K"},"receiptId":{"$ref":"#/$defs/Id","description":"幂等回执","x-source":"CONTRACTS §1","x-mapping":"K"},"effectId":{"$ref":"#/$defs/Id","description":"持久 intention 关联","x-source":"CONTRACTS §1","x-mapping":"K"},"hostInvocationId":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"原生调用身份；无法关联则 unknown","x-source":"CONTRACTS §1","x-mapping":"INVOCATION"},"binding":{"$ref":"#/$defs/Binding","description":"原始 epoch/attempt 绑定不改写","x-source":"CONTRACTS §1","x-mapping":"K"},"status":{"type":"string","enum":["completed","failed","cancelled","unknown","not-executed"],"description":"actual outcome，不以模型自述替代","x-source":"CONTRACTS §1","x-mapping":"ACTUAL"},"artifactRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"真实输出引用","x-source":"CONTRACTS §1","x-mapping":"K"},"usage":{"type":"array","items":{"$ref":"#/$defs/Usage"},"minItems":0,"uniqueItems":true,"description":"空列表不代表免费；模型动作无记录即 incomplete","x-source":"CONTRACTS §1","x-mapping":"K"},"observability":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"可证明的执行/取消/送达范围","x-source":"CONTRACTS §1","x-mapping":"ACTUAL"},"error":{"anyOf":[{"$ref":"#/$defs/ErrorEnvelope"},{"type":"null"}],"description":"固定错误 envelope","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["protocol","receiptId","effectId","hostInvocationId","binding","status","artifactRefs","usage","observability","error"]},
    "ArtifactRef": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §1","x-mapping":"K"},"id":{"$ref":"#/$defs/Id","description":"不可变工件 id","x-source":"CONTRACTS §1","x-mapping":"K"},"digest":{"$ref":"#/$defs/Digest","description":"真实字节 hash；不得由作者自述替代","x-source":"CONTRACTS §1","x-mapping":"K"},"producer":{"$ref":"#/$defs/ActorRef","description":"生产者身份；事先源/批准/协议快照的 producer 为产出该快照的主体（可使 kind=kernel）","x-source":"CONTRACTS §1","x-mapping":"K"},"binding":{"description":"node/effect产物必须完整binding；事先源/批准/协议快照可null并由消费命令绑定","x-source":"CONTRACTS §1","x-mapping":"K","anyOf":[{"$ref":"#/$defs/Binding"},{"type":"null"}]},"schema":{"$ref":"#/$defs/SchemaRef","description":"schema 名与版本","x-source":"CONTRACTS §1","x-mapping":"K"},"location":{"type":"string","minLength":1,"description":"opaque locator；不是可执行 URL，不包含 credential","x-source":"CONTRACTS §1","x-mapping":"K"},"visibility":{"$ref":"#/$defs/Visibility","description":"信息级别","x-source":"CONTRACTS §1","x-mapping":"K"},"expiresAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}],"description":"到期时间","x-source":"CONTRACTS §1","x-mapping":"K"},"partition":{"type":"string","enum":["train","dev","held-out","final","not-evaluation"],"description":"来源分区不由 visibility 推断","x-source":"evaluation SCENARIOS §3/§4","x-mapping":"K"}},"required":["protocol","id","digest","producer","binding","schema","location","visibility","expiresAt","partition"]},
    "EvidenceRef": {"type":"object","additionalProperties":false,"properties":{"file":{"type":"string","minLength":1,"description":"相对 lane 根的已固定证据路径","x-source":"CONTRACTS §1; probes evidence","x-mapping":"EVIDENCE"},"pointer":{"type":"string","minLength":1,"description":"RFC6901 JSON Pointer；Markdown 用 section:标题","x-source":"CONTRACTS §1; probes evidence","x-mapping":"EVIDENCE"},"sha256":{"$ref":"#/$defs/Digest","description":"完整文件 hash","x-source":"CONTRACTS §1; probes evidence","x-mapping":"EVIDENCE"},"kind":{"$ref":"#/$defs/EvidenceKind","description":"该条证据种类","x-source":"CONTRACTS §1; probes evidence","x-mapping":"EVIDENCE"},"claim":{"type":"string","minLength":1,"description":"明确可验证断言及范围","x-source":"CONTRACTS §1; probes evidence","x-mapping":"EVIDENCE"}},"required":["file","pointer","sha256","kind","claim"]},
    "CapabilityScope": {"type":"object","additionalProperties":false,"properties":{"operations":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"验证的具体操作","x-source":"CONTRACTS §1/§3; probes","x-mapping":"CAP"},"coverage":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"持久/取消/上下文/失败路径覆盖标签","x-source":"CONTRACTS §1/§3; probes","x-mapping":"CAP"},"hostVersion":{"type":"string","minLength":1,"description":"确切宿主版本","x-source":"CONTRACTS §1/§3; probes","x-mapping":"VERSION"},"providerModel":{"anyOf":[{"$ref":"#/$defs/ModelId"},{"type":"null"}],"description":"供应商实测绑定；fixture 时 null","x-source":"CONTRACTS §1/§3; probes","x-mapping":"MODEL"},"trustDomain":{"type":"string","enum":["same-user","os-sandbox"],"description":"实际安全强度","x-source":"CONTRACTS §1/§3; probes","x-mapping":"ISOLATION"}},"required":["operations","coverage","hostVersion","providerModel","trustDomain"]},
    "CapabilityObservation": {"type":"object","additionalProperties":false,"properties":{"status":{"$ref":"#/$defs/Status","description":"统一四值，缺 key 为 unknown","x-source":"CONTRACTS §1; DSH/Pi HOST-MANIFEST","x-mapping":"CAP"},"evidenceRefs":{"type":"array","items":{"$ref":"#/$defs/EvidenceRef"},"minItems":0,"uniqueItems":true,"description":"每个成立结论需要具体证据","x-source":"CONTRACTS §1; DSH/Pi HOST-MANIFEST","x-mapping":"CAP"},"scope":{"$ref":"#/$defs/CapabilityScope","description":"禁止无范围的 verified","x-source":"CONTRACTS §1; DSH/Pi HOST-MANIFEST","x-mapping":"CAP"},"verifiedSubset":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"partial 中实际成立的有限子集","x-source":"CONTRACTS §1; DSH/Pi HOST-MANIFEST","x-mapping":"CAP"},"limitations":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"非成立保证/不适用范围","x-source":"CONTRACTS §1; DSH/Pi HOST-MANIFEST","x-mapping":"CAP"}},"required":["status","evidenceRefs","scope","verifiedSubset","limitations"]},
    "GuaranteeStrength": {"type":"object","additionalProperties":false,"properties":{"status":{"$ref":"#/$defs/Status","description":"统一能力状态","x-source":"CONTRACTS §1; probes","x-mapping":"CAP"},"coverage":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"明确保证范围","x-source":"CONTRACTS §1; probes","x-mapping":"CAP"},"evidenceRefs":{"type":"array","items":{"$ref":"#/$defs/EvidenceRef"},"minItems":0,"uniqueItems":true,"description":"具体断言与证据种类","x-source":"CONTRACTS §1; probes","x-mapping":"CAP"}},"required":["status","coverage","evidenceRefs"]},
    "HostIdentity": {"type":"object","additionalProperties":false,"properties":{"host":{"$ref":"#/$defs/Id","description":"身份标签不参与品牌准入","x-source":"CONTRACTS §1; probes VERSION-PIN","x-mapping":"HOST"},"vendor":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"可举证 publisher；Pi artifact 未单列 vendor 则 null","x-source":"CONTRACTS §1; probes VERSION-PIN","x-mapping":"VENDOR"},"version":{"type":"string","minLength":1,"description":"本次固定目标版本","x-source":"CONTRACTS §1; probes VERSION-PIN","x-mapping":"VERSION"},"pinRef":{"$ref":"#/$defs/EvidenceRef","description":"VERSION-PIN 全文摘要","x-source":"CONTRACTS §1; probes VERSION-PIN","x-mapping":"VERSION"}},"required":["host","vendor","version","pinRef"]},
    "ModelObservation": {"type":"object","additionalProperties":false,"properties":{"providerModel":{"$ref":"#/$defs/ModelId","description":"真实 provider/model","x-source":"evaluation PROTOCOL §9; probes","x-mapping":"MODEL"},"reasoningRequested":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"原生请求值","x-source":"evaluation PROTOCOL §9; probes","x-mapping":"HIGH"},"reasoningEffective":{"type":"string","enum":["payload-accepted","server-tier-verified","unknown"],"description":"Pi high 只可记 payload-accepted","x-source":"evaluation PROTOCOL §9; probes","x-mapping":"HIGH"},"payloadRef":{"anyOf":[{"$ref":"#/$defs/EvidenceRef"},{"type":"null"}],"description":"实测 payload；不得继承另一宿主证据","x-source":"evaluation PROTOCOL §9; probes","x-mapping":"HIGH"},"priceRef":{"anyOf":[{"$ref":"#/$defs/EvidenceRef"},{"type":"null"}],"description":"冻结价表，非账单","x-source":"evaluation PROTOCOL §9; probes","x-mapping":"COST"}},"required":["providerModel","reasoningRequested","reasoningEffective","payloadRef","priceRef"]},
    "HostManifest": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"新版 schema envelope，raw probe manifest 不直接当执行资格","x-source":"CONTRACTS §1","x-mapping":"K"},"manifestId":{"$ref":"#/$defs/Id","description":"规范化 manifest 身份","x-source":"CONTRACTS §1","x-mapping":"K"},"identity":{"$ref":"#/$defs/HostIdentity","description":"宿主/版本资格","x-source":"CONTRACTS §1","x-mapping":"K"},"compatibleProtocols":{"type":"array","items":{"$ref":"#/$defs/ProtocolVersion"},"minItems":1,"uniqueItems":true,"description":"适配器明确支持的确切协议集合","x-source":"CONTRACTS §1","x-mapping":"K"},"capabilities":{"type":"object","propertyNames":{"$ref":"#/$defs/Id"},"additionalProperties":{"$ref":"#/$defs/CapabilityObservation"},"description":"语义能力 map；缺项 unknown","x-source":"CONTRACTS §1","x-mapping":"CAP"},"model":{"anyOf":[{"$ref":"#/$defs/ModelObservation"},{"type":"null"}],"description":"DSH 未实测供应商选型为 null","x-source":"CONTRACTS §1","x-mapping":"MODEL"},"usageSources":{"type":"array","items":{"$ref":"#/$defs/EvidenceKind"},"minItems":0,"uniqueItems":true,"description":"DSH fixture 与 Pi provider-live 不等价","x-source":"CONTRACTS §1","x-mapping":"USAGE"},"cancel":{"$ref":"#/$defs/GuaranteeStrength","description":"stream/tool/child/vendor 分层","x-source":"CONTRACTS §1","x-mapping":"CANCEL"},"recovery":{"$ref":"#/$defs/GuaranteeStrength","description":"transcript/disk/journal/effects 分层","x-source":"CONTRACTS §1","x-mapping":"RECOVERY"},"isolation":{"$ref":"#/$defs/GuaranteeStrength","description":"OS 保证不能从 hooks/worktree 推断","x-source":"CONTRACTS §1","x-mapping":"ISOLATION"},"hostSpecific":{"$ref":"#/$defs/HostSpecific","description":"显式保留宿主特有元数据","x-source":"CONTRACTS §1","x-mapping":"K"}},"required":["protocol","manifestId","identity","compatibleProtocols","capabilities","model","usageSources","cancel","recovery","isolation","hostSpecific"]},
    "HostSpecific": {"type":"object","additionalProperties":false,"properties":{"probeStatus":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"DSH 整体 status；Pi 无该字段则 null","x-source":"DSH/Pi HOST-MANIFEST; VERSION-PIN","x-mapping":"CAP"},"homeObservationRef":{"anyOf":[{"$ref":"#/$defs/EvidenceRef"},{"type":"null"}],"description":"DSH 路径观察；Pi 无对应字段则 null","x-source":"DSH/Pi HOST-MANIFEST; VERSION-PIN","x-mapping":"CAP"},"integrationCompatibility":{"$ref":"#/$defs/Status","description":"DSH 旧 plugin unknown；Pi 未测为 unknown","x-source":"DSH/Pi HOST-MANIFEST; VERSION-PIN","x-mapping":"INTEGRATION"},"rawManifestRef":{"$ref":"#/$defs/EvidenceRef","description":"原始 29/15 项矩阵，不修改","x-source":"DSH/Pi HOST-MANIFEST; VERSION-PIN","x-mapping":"EVIDENCE"},"noteRefs":{"type":"array","items":{"$ref":"#/$defs/EvidenceRef"},"minItems":0,"uniqueItems":true,"description":"drift/静态/未验证说明","x-source":"DSH/Pi HOST-MANIFEST; VERSION-PIN","x-mapping":"EVIDENCE"}},"required":["probeStatus","homeObservationRef","integrationCompatibility","rawManifestRef","noteRefs"]},
    "DecisionRecord": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"decisionId":{"$ref":"#/$defs/Id","description":"唯一裁决记录 id","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"kind":{"type":"string","enum":["task","candidate","promotion","activation"],"description":"四类决策互不替代","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"inputs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":1,"uniqueItems":true,"description":"内容与绑定","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"contractRef":{"anyOf":[{"$ref":"#/$defs/ContractRef"},{"type":"null"}],"description":"task 裁决必须非 null；candidate/promotion/activation 为 null","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"taskEvidenceRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"task 裁决必须非 null：TaskEvidenceReport 内容引用","x-source":"CONTRACTS §6; evaluation METRICS §2","x-mapping":"DECISION"},"evaluationReceiptRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"candidate/promotion 裁决必须非 null：EvaluationReceipt 内容引用","x-source":"CONTRACTS §6/§7","x-mapping":"DECISION"},"activationReceiptRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"activation 裁决必须非 null：ActivationReceipt 内容引用","x-source":"CONTRACTS §6/§7","x-mapping":"DECISION"},"evaluatorVersion":{"type":"string","minLength":1,"description":"版本化裁决算法","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"evaluationProtocolRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"收益评价需 T0 版本","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"outcome":{"type":"string","minLength":1,"description":"按 kind 限定枚举，见 INTERFACES","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"reasons":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"结构化可解释原因","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"evidenceRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":0,"uniqueItems":true,"description":"真实证据，模型自述不充分","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"feedbackVisibility":{"$ref":"#/$defs/Visibility","description":"任务反馈不泄露私有/终审","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"issuer":{"$ref":"#/$defs/ActorRef","description":"仅对应唯一决策服务/真实 host receipt 归约","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"},"capabilityJudgement":{"anyOf":[{"$ref":"#/$defs/CapabilityJudgement"},{"type":"null"}],"description":"candidate 独立收益判定，不能代替 task","x-source":"CONTRACTS §6; evaluation METRICS §5.2","x-mapping":"DECISION"}},"required":["protocol","decisionId","kind","inputs","contractRef","taskEvidenceRef","evaluationReceiptRef","activationReceiptRef","evaluatorVersion","evaluationProtocolRef","outcome","reasons","evidenceRefs","feedbackVisibility","issuer","capabilityJudgement"],"allOf":[{"if":{"properties":{"kind":{"const":"task"}}},"then":{"properties":{"outcome":{"type":"string","enum":["completed","repair","failed","needs-human","unknown"]},"contractRef":{"not":{"type":"null"}},"taskEvidenceRef":{"not":{"type":"null"}}}}},{"if":{"properties":{"kind":{"const":"candidate"}}},"then":{"properties":{"outcome":{"type":"string","enum":["validated","rejected","inconclusive"]},"evaluationReceiptRef":{"not":{"type":"null"}},"capabilityJudgement":{"not":{"type":"null"}}}}},{"if":{"properties":{"kind":{"const":"promotion"}}},"then":{"properties":{"outcome":{"type":"string","enum":["promoted","denied","needs-human"]},"evaluationReceiptRef":{"not":{"type":"null"}}}}},{"if":{"properties":{"kind":{"const":"activation"}}},"then":{"properties":{"outcome":{"type":"string","enum":["active","failed","unknown"]},"activationReceiptRef":{"not":{"type":"null"}}}}}]},
    "CapabilityJudgement": {"type":"object","additionalProperties":false,"properties":{"cellStatus":{"type":"string","enum":["complete","capability_absent","not-yet-comparable"],"description":"取 METRICS §5.3 字面值；上游为 underscore/hyphen 混合，本层不做规范化","x-source":"evaluation METRICS §5.2/§5.3","x-mapping":"DECISION"},"look":{"type":"string","enum":["FUTILITY_LOOK","CONFIRMATORY_LOOK","other"],"description":"确认或 futility 看","x-source":"evaluation METRICS §5.2/§5.3","x-mapping":"DECISION"},"verdict":{"type":"string","enum":["positive","negative","inconclusive","blocked","exploratory_only"],"description":"METRICS §5.2 有序函数结果","x-source":"evaluation METRICS §5.2/§5.3","x-mapping":"DECISION"},"protocolRef":{"$ref":"#/$defs/ArtifactRef","description":"明确 v3/T0 hash","x-source":"evaluation METRICS §5.2/§5.3","x-mapping":"DECISION"},"analysisRef":{"$ref":"#/$defs/ArtifactRef","description":"分析脚本与实际数据 hash","x-source":"evaluation METRICS §5.2/§5.3","x-mapping":"DECISION"},"costBasis":{"type":"string","enum":["measured-usage-estimate","estimate","unknown"],"description":"measured usage×价格仍非 invoice","x-source":"evaluation METRICS §5.2/§5.3","x-mapping":"DECISION"},"guardrailCost":{"type":"string","enum":["passed","failed","unknown"],"description":"cost_per_success 护栏；统计 positive 不得代替护栏","x-source":"evaluation METRICS §5.1/§5.2; PROTOCOL §8","x-mapping":"DECISION"},"guardrailWall":{"type":"string","enum":["passed","failed","unknown"],"description":"p90(wall) 护栏","x-source":"evaluation METRICS §5.1/§5.2; PROTOCOL §8","x-mapping":"DECISION"},"guardrailTruncation":{"type":"string","enum":["passed","failed","unknown"],"description":"incomplete_rate 护栏","x-source":"evaluation METRICS §5.1/§5.2; PROTOCOL §8","x-mapping":"DECISION"}},"required":["cellStatus","look","verdict","protocolRef","analysisRef","costBasis","guardrailCost","guardrailWall","guardrailTruncation"]},
    "AssetRef": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/AssetProtocolVersion","description":"资产独立 namespace","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"assetId":{"$ref":"#/$defs/Id","description":"资产身份","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"revision":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"精确版本","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"digest":{"$ref":"#/$defs/Digest","description":"完整资产内容","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"scope":{"$ref":"#/$defs/Scope","description":"资格与激活作用域","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"qualificationRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"评价/晋升完整 binding；未取得资格为 null","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"}},"required":["protocol","assetId","revision","digest","scope","qualificationRef"]},
    "CapabilityAsset": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/AssetProtocolVersion","description":"封套","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"asset":{"$ref":"#/$defs/AssetRef","description":"不可变内容绑定","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"kind":{"type":"string","enum":["skill","template","memory","tool-policy"],"description":"资产类型","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"contentRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":1,"uniqueItems":true,"description":"项目 staging，原全局 Skills 只读","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"sourceTraces":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"minItems":1,"uniqueItems":true,"description":"train 来源证据","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"dependencies":{"type":"array","items":{"$ref":"#/$defs/AssetRef"},"minItems":0,"uniqueItems":true,"description":"精确依赖 revision","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"hypothesis":{"type":"string","minLength":1,"description":"直接能力假设","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"qualification":{"type":"string","enum":["staged","validated","rejected","inconclusive","promoted","expired","revoked"],"description":"active 不作全局资格 bool","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"evaluationRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"候选评价 receipt","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"expiresAt":{"anyOf":[{"$ref":"#/$defs/Instant"},{"type":"null"}],"description":"资格 expiry","x-source":"CONTRACTS §7","x-mapping":"ASSET"},"revocationRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"撤销证据","x-source":"CONTRACTS §7","x-mapping":"ASSET"}},"required":["protocol","asset","kind","contentRefs","sourceTraces","dependencies","hypothesis","qualification","evaluationRef","expiresAt","revocationRef"]},
    "ActivationReceipt": {"type":"object","additionalProperties":false,"properties":{"protocol":{"$ref":"#/$defs/ProtocolVersion","description":"封套","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"asset":{"$ref":"#/$defs/AssetRef","description":"精确 asset revision","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"hostSessionId":{"$ref":"#/$defs/Id","description":"具体 host session","x-source":"CONTRACTS §1/§7","x-mapping":"SESSION_HOST"},"scope":{"$ref":"#/$defs/Scope","description":"激活范围","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"previousSnapshot":{"$ref":"#/$defs/ArtifactRef","description":"旧 snapshot 不覆盖","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"newSnapshot":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"实际激活成功才非 null","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"actualStatus":{"type":"string","enum":["active","failed","unknown"],"description":"真实 host 确认，safe idle 不等于已激活","x-source":"CONTRACTS §1/§7","x-mapping":"ACTIVATION"},"authorizationRef":{"$ref":"#/$defs/Id","description":"激活 grant","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"},"evaluationRef":{"$ref":"#/$defs/ArtifactRef","description":"完整资格绑定","x-source":"CONTRACTS §1/§7","x-mapping":"ASSET"}},"required":["protocol","asset","hostSessionId","scope","previousSnapshot","newSnapshot","actualStatus","authorizationRef","evaluationRef"]},
    "ErrorEnvelope": {"type":"object","additionalProperties":false,"properties":{"code":{"$ref":"#/$defs/ErrorCode","description":"ERRORS 冻结枚举","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},"message":{"type":"string","minLength":1,"description":"无 secret 的短说明","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},"retry":{"type":"string","enum":["never","after-refresh","after-authorization","after-reconcile"],"description":"不能按 code 自行重放外部效果","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},"refs":{"type":"array","items":{"$ref":"#/$defs/Id"},"minItems":0,"uniqueItems":true,"description":"相关 session/command/effect 身份","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"},"visibility":{"$ref":"#/$defs/Visibility","description":"私有测试原因只给安全摘要","x-source":"CONTRACTS §6; ERRORS","x-mapping":"K"}},"required":["code","message","retry","refs","visibility"]},
    "ModelId": {"type":"string","pattern":"^[A-Za-z0-9._-]+/[A-Za-z0-9._:-]+$"},
    "AssetProtocolVersion": {"type":"object","additionalProperties":false,"required":["namespace","schemaVersion"],"properties":{"namespace":{"const":"evofence.assets/1","description":"资产 namespace，与旧全局 Skills/旧资产格式分离","x-source":"adr_0010","x-mapping":"ASSET"},"schemaVersion":{"const":"1.0.0","description":"本提案资产引用版本","x-source":"adr_0010","x-mapping":"ASSET"}}},
    "ErrorCode": {"type":"string","enum":["EFK_SCHEMA_INVALID","EFK_PROTOCOL_UNSUPPORTED","EFK_LEGACY_NOT_EXECUTABLE","EFK_SOURCE_PIN_DRIFT","EFK_REVISION_CONFLICT","EFK_GRAPH_REFERENCE_INVALID","EFK_GRAPH_DEPENDENCY_CYCLE","EFK_GRAPH_INPUT_STALE","EFK_GRAPH_JOIN_INCOMPLETE","EFK_GRAPH_AUTHORITY_ESCALATION","EFK_GRAPH_RESOURCE_CONFLICT","EFK_GRAPH_BOUND_INVALID","EFK_GRAPH_NON_TERMINATING","EFK_GRAPH_TERMINAL_REQUIRED","EFK_GRAPH_EVIDENCE_REMOVAL","EFK_GRAPH_ACTIVE_NODE_MUTATION","EFK_GRAPH_NO_MATCHING_ROUTE","EFK_INVARIANT_VIOLATION","EFK_CAPABILITY_UNSUPPORTED","EFK_CAPABILITY_EVIDENCE_INSUFFICIENT","EFK_DEGRADATION_APPROVAL_REQUIRED","EFK_AUTHORITY_DENIED","EFK_GRANT_EXPIRED","EFK_GRANT_REVOKED","EFK_CLAIM_CONFLICT","EFK_LEASE_STALE","EFK_IDEMPOTENCY_COLLISION","EFK_BUDGET_NOT_AUTHORIZED","EFK_BUDGET_EXHAUSTED","EFK_BUDGET_ENVELOPE_INCONSISTENT","EFK_USAGE_INCOMPLETE","EFK_USAGE_CONFLICT","EFK_ARTIFACT_DIGEST_MISMATCH","EFK_ARTIFACT_BINDING_MISMATCH","EFK_ARTIFACT_UNAVAILABLE","EFK_HOST_BOARD_AUTHORITY_CONFLICT","EFK_HOST_SESSION_MISMATCH","EFK_HOST_EXECUTION_FAILED","EFK_HOST_REVISION_CONFLICT","EFK_HOST_DELIVERY_UNCONFIRMED","EFK_CANCEL_UNCONFIRMED","EFK_RECEIPT_STALE","EFK_RECOVERY_SEQUENCE_GAP","EFK_RECOVERY_SCHEMA_MISMATCH","EFK_EFFECT_UNKNOWN","EFK_EFFECT_NON_IDEMPOTENT_RETRY","EFK_EVALUATION_INSUFFICIENT","EFK_EVALUATION_DATA_DEGRADED","EFK_EVALUATION_PROTOCOL_MISMATCH","EFK_DECISION_AUTHORITY_DENIED","EFK_ASSET_QUALIFICATION_INVALID","EFK_ASSET_SCOPE_DENIED","EFK_ASSET_REVOKED","EFK_ASSET_EXPIRED","EFK_ACTIVATION_NOT_SETTLED","EFK_ACTIVATION_UNCONFIRMED","EFK_PRIVACY_VIOLATION","EFK_HUMAN_APPROVAL_MISSING"]},
    "Count": {"type":"integer","minimum":0,"maximum":9007199254740991},
    "PositiveCount": {"type":"integer","minimum":1,"maximum":9007199254740991},
    "UsdMicros": {"type":"integer","minimum":0,"maximum":9007199254740991,"description":"Integer micro-USD; reservation/estimated charge rounds upward"},
    "CommandResult": {"type":"object","additionalProperties":false,"properties":{"commandId":{"$ref":"#/$defs/Id","description":"原命令身份","x-source":"CONTRACTS §2","x-mapping":"K"},"disposition":{"enum":["committed","duplicate","rejected","archived"],"description":"原子提交/同内容去重/拒绝/迟到归档","x-source":"CONTRACTS §2","x-mapping":"K"},"sessionId":{"$ref":"#/$defs/Id","description":"内核会话","x-source":"CONTRACTS §2","x-mapping":"K"},"revision":{"$ref":"#/$defs/Count","description":"当前 journal revision","x-source":"CONTRACTS §2","x-mapping":"K"},"eventIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"该事务事件身份","x-source":"CONTRACTS §2","x-mapping":"K"},"effectIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"已提交 outbox intention；未提交不得派发","x-source":"CONTRACTS §2","x-mapping":"K"},"decisionRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"四类裁决工件引用","x-source":"CONTRACTS §2","x-mapping":"K"},"error":{"anyOf":[{"$ref":"#/$defs/ErrorEnvelope"},{"type":"null"}],"description":"typed failure，禁止任意异常序列化","x-source":"CONTRACTS §2","x-mapping":"K"}},"required":["commandId","disposition","sessionId","revision","eventIds","effectIds","decisionRef","error"]},
    "SessionView": {"type":"object","additionalProperties":false,"properties":{"sessionId":{"$ref":"#/$defs/Id","description":"只读内核 session","x-source":"CONTRACTS §2","x-mapping":"K"},"revision":{"$ref":"#/$defs/Count","description":"journal revision","x-source":"CONTRACTS §2","x-mapping":"K"},"epoch":{"$ref":"#/$defs/PositiveCount","description":"当前 session epoch","x-source":"CONTRACTS §2","x-mapping":"K"},"taskRef":{"$ref":"#/$defs/ContractRef","description":"任务绑定","x-source":"CONTRACTS §2","x-mapping":"K"},"graphRef":{"$ref":"#/$defs/GraphRef","description":"图绑定","x-source":"CONTRACTS §2","x-mapping":"K"},"manifestRef":{"$ref":"#/$defs/ArtifactRef","description":"准入 snapshot","x-source":"CONTRACTS §2","x-mapping":"K"},"nodeBindings":{"type":"array","items":{"$ref":"#/$defs/Binding"},"uniqueItems":true,"description":"各 attempt 身份，不暗示完成","x-source":"CONTRACTS §2","x-mapping":"K"},"nodeStates":{"type":"array","items":{"$ref":"#/$defs/NodeStateEntry"},"uniqueItems":true,"description":"journal 派生的节点状态投影；不暗示完成","x-source":"CONTRACTS §4; graph SEMANTICS §2.2","x-mapping":"K"},"unknownEffectIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"仍需核实的外部效果","x-source":"CONTRACTS §2","x-mapping":"K"},"lastSequence":{"anyOf":[{"$ref":"#/$defs/Count"},{"type":"null"}],"description":"空 journal 为 null","x-source":"CONTRACTS §2","x-mapping":"K"},"dispatchMode":{"type":"string","enum":["active","paused","cancelling","cancelled"],"description":"仅session派发模式；paused不表示child已停，unknown见unknownEffectIds","x-source":"CONTRACTS §2/§4; 冻结提案","x-mapping":"K"}},"required":["sessionId","revision","epoch","taskRef","graphRef","manifestRef","nodeBindings","nodeStates","unknownEffectIds","lastSequence","dispatchMode"]},
    "GuaranteeGap": {"type":"object","additionalProperties":false,"properties":{"capability":{"$ref":"#/$defs/Id","description":"所缺语义","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"reason":{"enum":["missing","absent","partial","unknown","evidence-kind","coverage","version","approval"],"description":"确定缺口分类","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"evidenceRefs":{"type":"array","items":{"$ref":"#/$defs/EvidenceRef"},"uniqueItems":true,"description":"保留不足证据","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"alternativeIds":{"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"待核验显式替代","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"}},"required":["capability","reason","evidenceRefs","alternativeIds"]},
    "NegotiationResult": {"type":"object","additionalProperties":false,"properties":{"status":{"enum":["executable","needs-degradation","unsupported"],"description":"准入结果","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"taskDigest":{"$ref":"#/$defs/Digest","description":"精确原合同","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"manifestDigest":{"$ref":"#/$defs/Digest","description":"精确规范化 manifest","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"satisfied":{"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"原要求已满足","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"gaps":{"type":"array","items":{"$ref":"#/$defs/GuaranteeGap"},"uniqueItems":true,"description":"未满足原要求","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"selectedAlternatives":{"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"已批准且技术上满足的替代","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"},"approvalRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"uniqueItems":true,"description":"不是批准一个 unknown 为 verified","x-source":"CONTRACTS §1; adr_0006","x-mapping":"NEGOTIATE"}},"required":["status","taskDigest","manifestDigest","satisfied","gaps","selectedAlternatives","approvalRefs"]},
    "EvaluationReceipt": {"type":"object","additionalProperties":false,"properties":{"evaluationId":{"$ref":"#/$defs/Id","description":"评价身份","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"candidate":{"$ref":"#/$defs/AssetRef","description":"完整 candidate digest/revision/scope","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"baseDigest":{"$ref":"#/$defs/Digest","description":"评价 base","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"dependencyRefs":{"type":"array","items":{"$ref":"#/$defs/AssetRef"},"uniqueItems":true,"description":"精确依赖版本","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"protocolRef":{"$ref":"#/$defs/ArtifactRef","description":"完整协议 T0/开发评价快照","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"dataSplitRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"uniqueItems":true,"description":"数据拆分摘要","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"hostManifestRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"uniqueItems":true,"description":"每宿主版本和证据范围","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"modelBindings":{"type":"array","items":{"$ref":"#/$defs/ModelRequirement"},"uniqueItems":true,"description":"供应商模型/payload 绑定","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"requiredJudgements":{"type":"array","items":{"$ref":"#/$defs/CapabilityJudgement"},"uniqueItems":true,"description":"完整必需评价结果，不筛掉失败","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"usageComplete":{"type":"boolean","description":"缺用量不补零","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"},"evidenceRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"uniqueItems":true,"description":"产物/真实测试/分析证据","x-source":"CONTRACTS §7; evaluation PREREGISTRATION §1/§5","x-mapping":"DECISION"}},"required":["evaluationId","candidate","baseDigest","dependencyRefs","protocolRef","dataSplitRefs","hostManifestRefs","modelBindings","requiredJudgements","usageComplete","evidenceRefs"]},
    "BranchEvidence": {"type":"object","additionalProperties":false,"required":["nodeId","binding","state","artifactRefs","decisionRef","gapReason"],"properties":{"nodeId":{"$ref":"#/$defs/Id","description":"必须分支id，不过滤缺失分支","x-source":"graph SEMANTICS §5.3; evaluation METRICS §2","x-mapping":"DECISION"},"binding":{"anyOf":[{"$ref":"#/$defs/Binding"},{"type":"null"}],"description":"分支attempt绑定；缺失null","x-source":"graph SEMANTICS §5.3; evaluation METRICS §2","x-mapping":"DECISION"},"state":{"anyOf":[{"$ref":"#/$defs/NodeState"},{"type":"null"}],"description":"实际状态；missing为null而非succeeded","x-source":"graph SEMANTICS §5.3; evaluation METRICS §2","x-mapping":"DECISION"},"artifactRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"uniqueItems":true,"description":"真实分支产物","x-source":"graph SEMANTICS §5.3; evaluation METRICS §2","x-mapping":"DECISION"},"decisionRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"唯一TaskDecision引用","x-source":"graph SEMANTICS §5.3; evaluation METRICS §2","x-mapping":"DECISION"},"gapReason":{"anyOf":[{"$ref":"#/$defs/Id"},{"type":"null"}],"description":"失败/取消/未满足的显式理由","x-source":"graph SEMANTICS §5.3; evaluation METRICS §2","x-mapping":"DECISION"}}},
    "TaskEvidenceReport": {"type":"object","additionalProperties":false,"required":["contractRef","binding","privateTestsPassed","requiredOutcomesMet","branchReport","artifactRefs","actualDiffRef","runStatus","usageComplete","privacyChecked"],"properties":{"contractRef":{"$ref":"#/$defs/ContractRef","description":"精确task合同","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"binding":{"$ref":"#/$defs/Binding","description":"本次受评attempt","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"privateTestsPassed":{"anyOf":[{"type":"boolean"},{"type":"null"}],"description":"有私有验收要求而null时unknown；不回传源码","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"requiredOutcomesMet":{"anyOf":[{"type":"boolean"},{"type":"null"}],"description":"逐outcome工件足证才true","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"branchReport":{"type":"array","items":{"$ref":"#/$defs/BranchEvidence"},"uniqueItems":true,"description":"完整requiredBranches，不丢失败/取消","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"artifactRefs":{"type":"array","items":{"$ref":"#/$defs/ArtifactRef"},"uniqueItems":true,"description":"真实字节和运行结果证据","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"actualDiffRef":{"anyOf":[{"$ref":"#/$defs/ArtifactRef"},{"type":"null"}],"description":"编码任务实际diff；非workspace任务可null","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"runStatus":{"enum":["completed","incomplete","timeout","cancelled","usage_incomplete","needs-human","unknown"],"description":"task生产结果与评测ITT映射分离","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"usageComplete":{"type":"boolean","description":"失败/取消未知不补零","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"},"privacyChecked":{"type":"boolean","description":"私有/终审信息未进入执行者反馈","x-source":"evaluation METRICS §2; PROTOCOL §5","x-mapping":"DECISION"}}},
    "JoinReceipt": {"type":"object","additionalProperties":false,"required":["binding","requiredBranches","branchReport","status"],"properties":{"binding":{"$ref":"#/$defs/Binding","description":"join自身epoch/revision","x-source":"graph SEMANTICS §5.3","x-mapping":"K"},"requiredBranches":{"type":"array","items":{"$ref":"#/$defs/Id"},"uniqueItems":true,"description":"明确必需分支清单","x-source":"graph SEMANTICS §5.3","x-mapping":"K"},"branchReport":{"type":"array","items":{"$ref":"#/$defs/BranchEvidence"},"uniqueItems":true,"description":"逐分支完整报告","x-source":"graph SEMANTICS §5.3","x-mapping":"K"},"status":{"enum":["verifying","waiting","failed"],"description":"全成功才verifying；B1/B3 waiting，B2 failed","x-source":"graph SEMANTICS §5.3","x-mapping":"K"}}}
  }
}
```

## 2. 字段目录

Count 为安全非负整数，PositiveCount≥1；Instant 仅为 UTC epoch 毫秒，UsdMicros 为 USD 微单位。visibility 与来源 partition 分离；reasoning 是 output 子集。“来源”指授权的设计/取证输入，不表示新字段已存在于宿主。

### ProtocolVersion

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `namespace` | "evofence.runtime/1" | 是 | 独立 namespace；不复用旧 ledger/config 版本 | CONTRACTS §9; adr_0010 |
| `schemaVersion` | 1.0.0 / 1.1.0 | 是 | 精确 codec 版本；本提案自身为 1.1.0，枚举供 compatibleProtocols 逐版声明 | CONTRACTS §9; adr_0010 |

### SchemaRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `name` | string | 是 | 输出 schema 名 | CONTRACTS §1 |
| `version` | string | 是 | 确切版本，不使用范围 | CONTRACTS §1 |
| `digest` | Digest | 是 | schema 内容摘要 | CONTRACTS §1 |

### ContractRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `taskId` | Id | 是 | 任务身份 | CONTRACTS §1 |
| `version` | integer | 是 | 任务合同修订 | CONTRACTS §1 |
| `digest` | Digest | 是 | 精确合同内容 | CONTRACTS §1 |

### GraphRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `graphId` | Id | 是 | 运行图身份 | CONTRACTS §1 |
| `revision` | integer | 是 | 图拓扑版本；0 仅 bootstrap | CONTRACTS §1 |
| `digest` | Digest | 是 | 精确图内容摘要 | CONTRACTS §1 |

### ActorRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `actorId` | Id | 是 | 可归因主体；不是裸 sessionId | CONTRACTS §1/§5 |
| `kind` | human / kernel / host-adapter / evaluator | 是 | 主体作用域 | CONTRACTS §1/§5 |
| `identityRef` | ArtifactRef / null | 是 | 由权限根验证的身份凭据引用；human 批准时必须非 null；禁止含 secret | CONTRACTS §1/§5 |

### Binding

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `sessionId` | Id | 是 | 内核 session；与原生会话通过不可变绑定表关联 | CONTRACTS §1; graph SEMANTICS §2.3 |
| `hostSessionId` | Id / null | 是 | 原生会话 id；非宿主执行可为 null | CONTRACTS §1; graph SEMANTICS §2.3 |
| `graph` | GraphRef | 是 | 该 attempt 使用的拓扑快照 | CONTRACTS §1; graph SEMANTICS §2.3 |
| `nodeId` | Id | 是 | 生产/消费节点 | CONTRACTS §1; graph SEMANTICS §2.3 |
| `attemptId` | Id | 是 | 每次 retry 新身份 | CONTRACTS §1; graph SEMANTICS §2.3 |
| `attemptOrdinal` | integer | 是 | 节点尝试序号 | CONTRACTS §1; graph SEMANTICS §2.3 |
| `epoch` | integer | 是 | session 生命周期 epoch | CONTRACTS §1; graph SEMANTICS §2.3 |
| `baseDigest` | Digest / null | 是 | workspace 基础快照，无 workspace 时 null | CONTRACTS §1; graph SEMANTICS §2.3 |

### Scope

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `workspaceRef` | ArtifactRef / null | 是 | 显式 workspace locator；不以 cwd 猜测 | CONTRACTS §1/§5 |
| `readResources` | array<Id> | 是 | 允许读取的命名资源 | CONTRACTS §1/§5 |
| `writeResources` | array<Id> | 是 | 允许写入的命名资源 | CONTRACTS §1/§5 |
| `artifactScopes` | array<Id> | 是 | 可产出/消费的 artifact 范围 | CONTRACTS §1/§5 |
| `trustDomain` | same-user / os-sandbox | 是 | 同用户信任域与 OS 沙箱分开 | CONTRACTS §1/§5 |

### Grant

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `grantId` | Id | 是 | 权限子集凭据 id | CONTRACTS §1/§5; adr_0001 |
| `rootAuthorityRef` | Id | 是 | 唯一宿主权限根 | CONTRACTS §1/§5; adr_0001 |
| `parentGrantRef` | Id / null | 是 | 父 grant；根 grant 为 null | CONTRACTS §1/§5; adr_0001 |
| `actor` | ActorRef | 是 | 授权主体 | CONTRACTS §1/§5; adr_0001 |
| `sessionId` | Id | 是 | 授权 session | CONTRACTS §1/§5; adr_0001 |
| `nodeIds` | array<Id> | 是 | 受授权节点集合 | CONTRACTS §1/§5; adr_0001 |
| `scope` | Scope | 是 | root∩parent∩task∩node 范围 | CONTRACTS §1/§5; adr_0001 |
| `capabilities` | array<Id> | 是 | 可执行操作语义键 | CONTRACTS §1/§5; adr_0001 |
| `maxDelegationDepth` | integer | 是 | 剩余可委派深度 | CONTRACTS §1/§5; adr_0001 |
| `expiresAt` | Instant / null | 是 | 过期时间；null 仅根明确准许 | CONTRACTS §1/§5; adr_0001 |
| `revocationEpoch` | integer | 是 | 撤销代数 | CONTRACTS §1/§5; adr_0001 |
| `approvalRef` | ArtifactRef / null | 是 | 必要人审批准引用，不代签 | CONTRACTS §1/§5; adr_0001 |

### BudgetPolicy

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `poolId` | Id | 是 | 父/子共享同一个总账池 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `category` | development / probe / controlled-experiment / judging | 是 | 开发、探针、试验、臂外判分分账 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `authorizationRef` | ArtifactRef / null | 是 | 预算授权的来源；controlled-experiment 必须非 null | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `maxRequests` | integer | 是 | 全部真实/隐式/失败请求上限 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `maxInputTokens` | integer | 是 | 每请求全部输入 token 上限，含缓存 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `maxOutputTokens` | integer | 是 | 每请求输出上限，含 reasoning | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `maxUsdMicros` | UsdMicros / null | 是 | USD 百万分之一整数上限；null 只允许有明确无限授权的开发类别 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `maxWallMs` | integer | 是 | 活跃墙钟上限 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `maxConcurrentRequests` | integer | 是 | 并发预留上限 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `priceRef` | ArtifactRef / null | 是 | 冻结价格表；需要 USD 限额时非 null | CONTRACTS §5; evaluation PROTOCOL §3/§7 |
| `missingUsagePolicy` | "retain-reservation" | 是 | 缺失 usage 保留预留，不回收为零 | CONTRACTS §5; evaluation PROTOCOL §3/§7 |

### PrivacyPolicy

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `visibility` | Visibility | 是 | 任务缺省信息级别 | CONTRACTS §7; evaluation PROTOCOL §4 |
| `feedbackVisibility` | Visibility | 是 | 执行者能看到的反馈级别 | CONTRACTS §7; evaluation PROTOCOL §4 |
| `privateTests` | "evaluator-only" | 是 | 私有测试仅 evaluator 可见 | CONTRACTS §7; evaluation PROTOCOL §4 |
| `finalFeedback` | "no-optimization" | 是 | 终审反馈不用于优化 | CONTRACTS §7; evaluation PROTOCOL §4 |
| `secretPolicy` | "forbidden" | 是 | secret 不进入合同/journal/artifact 内容 | CONTRACTS §7; evaluation PROTOCOL §4 |

### TerminationPolicy

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `maxAttempts` | integer | 是 | 累计尝试上限 | CONTRACTS §4/§5; evaluation METRICS §7.3 |
| `maxActiveWallMs` | integer | 是 | 活跃墙钟，不含人工等待 | CONTRACTS §4/§5; evaluation METRICS §7.3 |
| `cancelMode` | "stop-and-confirm" | 是 | 先停新派发，再请求确认 | CONTRACTS §4/§5; evaluation METRICS §7.3 |
| `unknownPolicy` | "reconcile" | 是 | 动作不明先 reconcile | CONTRACTS §4/§5; evaluation METRICS §7.3 |
| `excludeHumanWait` | true | 是 | human_wait_ms 单列 | CONTRACTS §4/§5; evaluation METRICS §7.3 |

### AcceptancePolicy

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `evaluatorId` | Id | 是 | 唯一 task 裁决服务 id | CONTRACTS §6; evaluation PROTOCOL §1/§5 |
| `evaluatorVersion` | string | 是 | 确切 evaluator 版本 | CONTRACTS §6; evaluation PROTOCOL §1/§5 |
| `protocolRef` | ArtifactRef / null | 是 | 能力评测引用 v3/T0 快照；普通 task 可 null | CONTRACTS §6; evaluation PROTOCOL §1/§5 |
| `checkRefs` | array<ArtifactRef> | 是 | 真实运行验收证据定义 | CONTRACTS §6; evaluation PROTOCOL §1/§5 |
| `requiredBranchPolicy` | "explicit-complete-report" | 是 | 必需分支报告不筛掉失败/取消 | CONTRACTS §6; evaluation PROTOCOL §1/§5 |
| `outcomeSchema` | SchemaRef | 是 | 产物验收 schema | CONTRACTS §6; evaluation PROTOCOL §1/§5 |
| `baselineRequired` | false | 是 | 普通 task 不要求超越 baseline | CONTRACTS §6; evaluation PROTOCOL §1/§5 |

### OutcomeRequirement

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `outcomeId` | Id | 是 | 可判定结果 id | CONTRACTS §1 |
| `description` | string | 是 | 结果要求 | CONTRACTS §1 |
| `schema` | SchemaRef | 是 | 输出 schema | CONTRACTS §1 |
| `evidenceKinds` | array<EvidenceKind> | 是 | 可接受的证据种类 | CONTRACTS §1 |

### GuaranteeRequirement

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `capability` | Id | 是 | 语义能力键，不是品牌白名单 | CONTRACTS §1/§3; adr_0006 |
| `mode` | hard / degradable | 是 | hard 不允许弱化 | CONTRACTS §1/§3; adr_0006 |
| `evidenceKinds` | array<EvidenceKind> | 是 | 必须有指定证据，不作全序强弱折算 | CONTRACTS §1/§3; adr_0006 |
| `coverage` | array<Id> | 是 | 所需操作/失败路径/持久范围标签 | CONTRACTS §1/§3; adr_0006 |
| `alternativeIds` | array<Id> | 是 | 仅列明可考虑的替代 id | CONTRACTS §1/§3; adr_0006 |

### DegradationOption

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `alternativeId` | Id | 是 | 替代方案身份 | CONTRACTS §1; adr_0006 |
| `replacesCapability` | Id | 是 | 被替代保证 | CONTRACTS §1; adr_0006 |
| `requirements` | array<GuaranteeRequirement> | 是 | 替代方案自身必须满足的保证 | CONTRACTS §1; adr_0006 |
| `tradeoff` | string | 是 | 明确成本与范围变化 | CONTRACTS §1; adr_0006 |
| `approvalRef` | ArtifactRef / null | 是 | 精确 task/manifest/替代摘要绑定的人审或已有人授权；null 不可派发 | CONTRACTS §1; adr_0006 |

### TaskContract

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 协议封套 | CONTRACTS §1 |
| `taskId` | Id | 是 | 用户任务 id | CONTRACTS §1 |
| `version` | integer | 是 | 任务修订 | CONTRACTS §1 |
| `goal` | string | 是 | 用户目标 | CONTRACTS §1 |
| `requiredOutcomes` | array<OutcomeRequirement> | 是 | 必须达到的结果 | CONTRACTS §1 |
| `requiredBranches` | array<Id> | 是 | 明确必须分支，允许单 agent 空集合 | CONTRACTS §1 |
| `acceptance` | AcceptancePolicy | 是 | 唯一 task 验收合同 | CONTRACTS §1 |
| `scope` | Scope | 是 | workspace/artifact 范围 | CONTRACTS §1 |
| `authorityGrant` | Grant | 是 | 显式权限子集 | CONTRACTS §1 |
| `budget` | BudgetPolicy | 是 | 父/子共享预算 | CONTRACTS §1 |
| `privacy` | PrivacyPolicy | 是 | 反馈与数据边界 | CONTRACTS §1 |
| `termination` | TerminationPolicy | 是 | 尝试/取消/时间边界 | CONTRACTS §1 |
| `requiredGuarantees` | array<GuaranteeRequirement> | 是 | 准入要求 | CONTRACTS §1 |
| `degradations` | array<DegradationOption> | 是 | 显式替代，禁止隐式弱化 | CONTRACTS §1 |

### ResourcePolicy

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `resourceId` | Id | 是 | 资源名，不是节点对/边 | graph SEMANTICS §3.2 |
| `mode` | exclusive / shared | 是 | 排他或共享 | graph SEMANTICS §3.2 |
| `maxHolders` | integer | 是 | exclusive 必须为 1；shared 可为 0 表示不可用 | graph SEMANTICS §3.2 |

`resourcePolicy` 的规范形状是**数组**（本节）。`SEMANTICS.md` §3.2 的 YAML 示例（按资源名为键的 map、含 `quota` 键）是**非规范示例**：`quota` 对应本节的 `maxHolders`。两处形状待 `SEMANTICS.md`（`spec/graph` lane）改为一致；本 lane 以本节为准。

### Resources

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `exclusive` | array<Id> | 是 | 排他资源集合 | graph SEMANTICS §3.2 |
| `shared` | array<Id> | 是 | 共享资源集合 | graph SEMANTICS §3.2 |

### GraphLimits

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `maxNodes` | integer | 是 | 节点数界 | graph SEMANTICS §4/§5 |
| `maxConcurrentAgents` | integer | 是 | 原生并发会话界 | graph SEMANTICS §4/§5 |
| `maxDepth` | integer | 是 | loop/subgraph 总深度界 | graph SEMANTICS §4/§5 |
| `maxAttempts` | integer | 是 | 图级累计尝试界 | graph SEMANTICS §4/§5 |

### LoopSpec

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `bodyNodeIds` | array<Id> | 是 | 显式 loop body | graph SEMANTICS §4 |
| `maxIterations` | integer | 条件/可省略 | 迭代上限（§4 的 `bound{...}` 包装在本版拍平为顶层字段） | graph SEMANTICS §4 |
| `maxWallClock` | integer | 条件/可省略 | loop 累计活跃毫秒（同上） | graph SEMANTICS §4 |
| `maxTokensOrCost` | BudgetBound | 条件/可省略 | 累计 token/USD 界（同上） | graph SEMANTICS §4 |
| `maxDepth` | integer | 条件/可省略 | 嵌套深度界（同上） | graph SEMANTICS §4 |
| `stop` | array<body-success / bound-exhausted / irreparable-failure> | 是 | 仅 body-success/bound-exhausted/irreparable-failure | graph SEMANTICS §4 |
| `carry` | array<ArtifactRef> | 是 | 显式迭代输入增量 | graph SEMANTICS §4 |

### BudgetBound

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `tokens` | PositiveCount / null | 是 | 累计 token 界 | graph SEMANTICS §4; 两者至少一个非 null |
| `usdMicros` | UsdMicros / null | 是 | 累计 USD 微单位界 | graph SEMANTICS §4; 两者至少一个非 null |

### ContextPlan

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `inputRefs` | array<ArtifactRef> | 是 | 有限输入 packet | CONTRACTS §1/§3 |
| `maxTokens` | integer | 是 | 上下文注入界 | CONTRACTS §1/§3 |
| `preserveHostResources` | true | 是 | 保留原 instructions/skills/tools | CONTRACTS §1/§3 |
| `isolation` | current / fresh | 是 | 当前会话或新 transcript | CONTRACTS §1/§3 |

### ModelRequirement

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `providerModel` | ModelId / null | 是 | 真实 provider/model；未选定 null | evaluation PROTOCOL §9 |
| `reasoningRequested` | Id / null | 是 | 请求参数标签 | evaluation PROTOCOL §9 |
| `reasoningGuarantee` | payload-only / server-tier | 是 | 参数接受不等于独立档位 | evaluation PROTOCOL §9 |
| `payloadRef` | ArtifactRef / null | 是 | 宿主内三臂 thinking payload 内容摘要 | evaluation PROTOCOL §9 |

### NodeSpec

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `nodeId` | Id | 是 | 运行节点 id | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `kind` | agent / tool / deterministic / evaluate / join / human / subgraph | 是 | 七类节点 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `inputRefs` | array<ArtifactRef> | 是 | 本 attempt 消费输入 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `outputSchemas` | array<SchemaRef> | 是 | 输出约束 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `loop` | LoopSpec / null | 是 | 显式有界 loop | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `subgraph` | GraphRef / null | 是 | 被委派子图 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `contextPlan` | ContextPlan | 是 | 有限上下文 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `toolRequirements` | array<GuaranteeRequirement> | 是 | 原生工具能力 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `modelRequirements` | ModelRequirement | 是 | 模型条件 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `resources` | Resources | 是 | 资源声明而非边；CONTRACTS §1 的 read/write resources 在本版按 SEMANTICS §3.2 表达为 exclusive/shared（Scope 仍保留 readResources/writeResources） | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `termination` | TerminationPolicy | 是 | 停止边界 | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `terminal` | boolean | 是 | 显式终局标记，无 real consumer 必须 true | CONTRACTS §1; graph SEMANTICS §2/§4 |
| `requiredBranches` | array<Id> | 是 | join 的明确 fan-in，非 join 必须空 | CONTRACTS §1; graph SEMANTICS §2/§4 |

### Predicate

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `op` | eq / neq / all / any / not / true | 是 | 纯数据谓词 AST；禁止 eval/代码字符串 | graph SEMANTICS §3.0/§3.1 |
| `path` | Id / null | 是 | outcome/reason/env 中显式路径；复合谓词为 null | graph SEMANTICS §3.0/§3.1 |
| `value` | string / boolean / safe integer / null | 是 | eq/neq 比较JSON标量；复合谓词为null | graph SEMANTICS §3.0/§3.1; 冻结提案 |
| `children` | array<Predicate> | 是 | 复合操作子谓词；原子谓词空 | graph SEMANTICS §3.0/§3.1 |

### EdgeSpec

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `edgeId` | Id | 是 | 边身份 | graph SEMANTICS §3 |
| `type` | dependency / data / route / repair / fallback / provenance | 是 | 六类边，不含 resource/join | graph SEMANTICS §3 |
| `from` | Id | 是 | 上游/生产者 | graph SEMANTICS §3 |
| `to` | Id | 是 | 下游/消费者 | graph SEMANTICS §3 |
| `when` | Predicate / null | 是 | routing 条件，非 routing 为 null | graph SEMANTICS §3 |
| `artifact` | ArtifactRef / null | 是 | data 的实际输入绑定 | graph SEMANTICS §3 |
| `expect` | SchemaRef / null | 是 | data 消费 schema | graph SEMANTICS §3 |
| `maxAttempts` | PositiveCount / null | 是 | repair/fallback 累计 attempt 界 | graph SEMANTICS §3 |
| `relation` | Id / null | 是 | provenance 关系，不参与 ready | graph SEMANTICS §3 |

### AbandonedBranch

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `nodeId` | Id | 是 | 被明确放弃分支 | graph SEMANTICS §2.4 |
| `authorityRef` | Id | 是 | 有权放弃的 grant | graph SEMANTICS §2.4 |
| `reason` | string | 是 | 可审计理由 | graph SEMANTICS §2.4 |
| `at` | Instant | 是 | 注入 Clock 记录，非排序依据 | graph SEMANTICS §2.4 |

### GraphSpec

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 协议封套 | CONTRACTS §1 |
| `graphId` | Id | 是 | 产品图，独立于 SP | CONTRACTS §1 |
| `revision` | integer | 是 | 图修订 | CONTRACTS §1 |
| `taskContractRef` | ContractRef | 是 | 确切任务合同 | CONTRACTS §1 |
| `nodes` | array<NodeSpec> | 是 | 允许单 agent，禁止强制拆分 | CONTRACTS §1 |
| `typedEdges` | array<EdgeSpec> | 是 | 类型边集合 | CONTRACTS §1 |
| `requiredJoins` | array<Id> | 是 | 所有 join node ids | CONTRACTS §1 |
| `resourcePolicy` | array<ResourcePolicy> | 是 | 图级命名资源策略 | CONTRACTS §1 |
| `graphLimits` | GraphLimits | 是 | 明确边界 | CONTRACTS §1 |
| `abandonedBranches` | array<AbandonedBranch> | 是 | 保留证据，仅经 patch 写入 | CONTRACTS §1 |

### GraphPatch

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 协议封套 | graph SEMANTICS §5 |
| `graphId` | Id | 是 | 目标图 | graph SEMANTICS §5 |
| `expectedRevision` | integer | 是 | 拓扑 CAS | graph SEMANTICS §5 |
| `adds` | array<NodeSpec> | 是 | 新增节点 | graph SEMANTICS §5 |
| `changes` | array<NodeSpec> | 是 | 替换完整未认领 NodeSpec | graph SEMANTICS §5 |
| `removals` | array<Id> | 是 | 仅无证据、未认领节点 | graph SEMANTICS §5 |
| `typedEdges` | array<EdgeSpec> | 是 | 显式完整新边集，无隐式猜测 | graph SEMANTICS §5 |
| `abandonedBranches` | array<AbandonedBranch> | 是 | 累计放弃标注 | graph SEMANTICS §5 |
| `reason` | string | 是 | 变更理由 | graph SEMANTICS §5 |
| `authorityRef` | Id | 是 | 不得提升权限 | graph SEMANTICS §5 |

### Command

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 封套 | CONTRACTS §1 |
| `commandId` | Id | 是 | 幂等身份，同 id 不同内容拒绝 | CONTRACTS §1 |
| `sessionId` | Id | 是 | 目标内核 session | CONTRACTS §1 |
| `expectedRevision` | integer | 是 | journal revision CAS，与 graph revision 分离 | CONTRACTS §1 |
| `actor` | ActorRef | 是 | 发起者 | CONTRACTS §1 |
| `grantRef` | Id | 是 | 有效权限子集 | CONTRACTS §1 |
| `payload` | CommandPayload | 是 | 封闭类型操作 | CONTRACTS §1 |

### CommandPayload

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `kind` | session.create / graph.patch / node.claim / session.pause / session.resume / session.cancel / effect.reconcile / task.evaluate / candidate.evaluate / asset.promote / asset.activate / asset.revoke / host.observe / effect.receipt / effect.dispatch | 是 | 操作鉴别符 | CONTRACTS §2 |
| `task` | TaskContract / null | 是 | session.create 必填 | CONTRACTS §2 |
| `graph` | GraphSpec / null | 是 | session.create 必填 | CONTRACTS §2 |
| `patch` | GraphPatch / null | 是 | graph.patch 必填 | CONTRACTS §2 |
| `binding` | Binding / null | 是 | node.claim/task.evaluate 必填 | CONTRACTS §2 |
| `objectRef` | ArtifactRef / null | 是 | effect/host observation/receipt/candidate/asset 的精确输入 | CONTRACTS §2 |
| `manifestRef` | ArtifactRef / null | 是 | session.create/resume 必填 | CONTRACTS §2 |
| `reason` | Id / null | 是 | cancel/revoke/pause 的理由 | CONTRACTS §2 |

### Event

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 封套 | CONTRACTS §1 |
| `eventId` | Id | 是 | 稳定幂等身份 | CONTRACTS §1 |
| `sequence` | integer | 是 | journal 连续序列；不得拿 host seq 直接当 journal seq | CONTRACTS §1 |
| `sessionId` | Id | 是 | kernel session | CONTRACTS §1 |
| `revision` | integer | 是 | journal 事务 revision | CONTRACTS §1 |
| `epoch` | integer | 是 | session epoch | CONTRACTS §1 |
| `causedBy` | Id | 是 | command/effect/receipt identity | CONTRACTS §1 |
| `type` | graph.accepted / graph.patched / node.transition / effect.intended / effect.dispatched / receipt.archived / receipt.applied / decision.recorded / session.epoch-changed / grant.revoked / budget.changed / asset.transition / host.observed / session.paused / session.resumed / session.cancel-requested / session.cancel-confirmed | 是 | 封闭事件目录 | CONTRACTS §1 |
| `payload` | EventPayload | 是 | typed transition/ref payload | CONTRACTS §1 |
| `visibility` | Visibility | 是 | 不可越权回传 | CONTRACTS §1 |

### EventPayload

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `binding` | Binding / null | 是 | 节点/effect 绑定 | CONTRACTS §1/§5 |
| `objectRef` | ArtifactRef / null | 是 | 不可变对象/receipt 内容引用 | CONTRACTS §1/§5 |
| `before` | NodeState / null | 是 | 仅 node.transition 使用；其余事件必须 null（session.epoch-changed 的新 epoch 由 Event.epoch 承载） | CONTRACTS §1/§5 |
| `after` | NodeState / null | 是 | 仅 node.transition 使用；其余事件必须 null | CONTRACTS §1/§5 |
| `effectId` | Id / null | 是 | effect/receipt 事件必填 | CONTRACTS §1/§5 |
| `decisionId` | Id / null | 是 | decision.recorded 必填 | CONTRACTS §1/§5 |
| `changedIds` | array<Id> | 是 | 受影响对象 id | CONTRACTS §1/§5 |
| `error` | ErrorEnvelope / null | 是 | 错误原因；不放任意异常对象 | CONTRACTS §1/§5 |

### LeaseRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `resourceId` | Id | 是 | 排他/共享命名资源 | CONTRACTS §5; graph SEMANTICS §2.3 |
| `ownerClaimId` | Id | 是 | 唯一当前 claim | CONTRACTS §5; graph SEMANTICS §2.3 |
| `epoch` | integer | 是 | 获授 session epoch | CONTRACTS §5; graph SEMANTICS §2.3 |
| `fencingToken` | integer | 是 | 单调 token，与 revision/attempt 分开 | CONTRACTS §5; graph SEMANTICS §2.3 |
| `expiresAt` | Instant | 是 | 租约 expiry | CONTRACTS §5; graph SEMANTICS §2.3 |

### Effect

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 封套 | CONTRACTS §1 |
| `effectId` | Id | 是 | 持久 intention id | CONTRACTS §1 |
| `idempotencyKey` | Id | 是 | 同一确认未执行重发用同 key | CONTRACTS §1 |
| `binding` | Binding | 是 | 含 epoch/node/attempt/base | CONTRACTS §1 |
| `authorityRef` | Id | 是 | 有效 scoped grant | CONTRACTS §1 |
| `reservationRef` | Id / null | 是 | 模型/计费动作必须预算预留 | CONTRACTS §1 |
| `leases` | array<LeaseRef> | 是 | 排他写与 activation 必须有 lease | CONTRACTS §1 |
| `inputRefs` | array<ArtifactRef> | 是 | 精确输入 | CONTRACTS §1 |
| `deadline` | Instant | 是 | 派发期限，注入 Clock | CONTRACTS §1 |
| `kind` | host.agent / host.tool / host.delegate / host.cancel / host.activate / host.reconcile / timer.wait | 是 | 宿主/基础设施执行目录 | CONTRACTS §1 |
| `payload` | EffectPayload | 是 | 操作要求，实际动作只能由注入 port | CONTRACTS §1 |

### EffectPayload

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `context` | ContextPlan / null | 是 | agent/delegate 上下文 | CONTRACTS §1/§2 |
| `toolName` | Id / null | 是 | tool 类型必须非 null | CONTRACTS §1/§2 |
| `argumentsRef` | ArtifactRef / null | 是 | tool 参数工件引用 | CONTRACTS §1/§2 |
| `graphRef` | GraphRef / null | 是 | delegate 类型子图 | CONTRACTS §1/§2 |
| `targetIds` | array<Id> | 是 | cancel/reconcile 涉及的真实会话/effect 集合 | CONTRACTS §1/§2 |
| `assetRef` | AssetRef / null | 是 | activate 精确资产 | CONTRACTS §1/§2 |
| `previousSnapshot` | ArtifactRef / null | 是 | activate 必填，失败保留 | CONTRACTS §1/§2 |
| `deliveryGuarantee` | none / acknowledged-durable | 是 | 可靠发送不能用 enqueue 代替 | CONTRACTS §1/§2 |

### Usage

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `requestId` | Id | 是 | 一次请求身份；同请求只结算一次 | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `source` | synthetic / provider / host-normalized / estimate / unknown | 是 | 证据来源，禁止 synthetic 充当 provider | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `inputUncached` | Count / null | 是 | 未缓存输入 token | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `cacheRead` | Count / null | 是 | 缓存读取输入 token | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `cacheWrite` | Count / null | 是 | 单独缓存写入 token，未知为 null | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `output` | Count / null | 是 | 总输出，已包含 reasoning | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `reasoning` | Count / null | 是 | output 的子集，不重复加 | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `total` | Count / null | 是 | 按来源定义规范化总量 | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `estimatedUsdMicros` | UsdMicros / null | 是 | 冻结价格估价，非账单 | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `invoiceUsdMicros` | UsdMicros / null | 是 | 真实账单数值，未查 null | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `complete` | boolean | 是 | 原始 usage 完整且归一化校验通过 | CONTRACTS §1/§5; evaluation PROTOCOL §7 |
| `evidenceRefs` | array<EvidenceRef> | 是 | 原始与规范化证据 | CONTRACTS §1/§5; evaluation PROTOCOL §7 |

### Receipt

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 封套 | CONTRACTS §1 |
| `receiptId` | Id | 是 | 幂等回执 | CONTRACTS §1 |
| `effectId` | Id | 是 | 持久 intention 关联 | CONTRACTS §1 |
| `hostInvocationId` | Id / null | 是 | 原生调用身份；无法关联则 unknown | CONTRACTS §1 |
| `binding` | Binding | 是 | 原始 epoch/attempt 绑定不改写 | CONTRACTS §1 |
| `status` | completed / failed / cancelled / unknown / not-executed | 是 | actual outcome，不以模型自述替代 | CONTRACTS §1 |
| `artifactRefs` | array<ArtifactRef> | 是 | 真实输出引用 | CONTRACTS §1 |
| `usage` | array<Usage> | 是 | 空列表不代表免费；模型动作无记录即 incomplete | CONTRACTS §1 |
| `observability` | array<Id> | 是 | 可证明的执行/取消/送达范围 | CONTRACTS §1 |
| `error` | ErrorEnvelope / null | 是 | 固定错误 envelope | CONTRACTS §1 |

### ArtifactRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 封套 | CONTRACTS §1 |
| `id` | Id | 是 | 不可变工件 id | CONTRACTS §1 |
| `digest` | Digest | 是 | 真实字节 hash；不得由作者自述替代 | CONTRACTS §1 |
| `producer` | ActorRef | 是 | 生产者身份；事先源/批准/协议快照的 producer 为产出该快照的主体（可使 kind=kernel） | CONTRACTS §1 |
| `binding` | Binding / null | 是 | node/effect产物必须完整binding；事先源/批准/协议快照可null并由消费命令绑定 | CONTRACTS §1 |
| `schema` | SchemaRef | 是 | schema 名与版本 | CONTRACTS §1 |
| `location` | string | 是 | opaque locator；不是可执行 URL，不包含 credential | CONTRACTS §1 |
| `visibility` | Visibility | 是 | 信息级别 | CONTRACTS §1 |
| `expiresAt` | Instant / null | 是 | 到期时间 | CONTRACTS §1 |
| `partition` | train / dev / held-out / final / not-evaluation | 是 | 来源分区不由 visibility 推断 | evaluation SCENARIOS §3/§4 |

### EvidenceRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `file` | string | 是 | 相对 lane 根的已固定证据路径 | CONTRACTS §1; probes evidence |
| `pointer` | string | 是 | RFC6901 JSON Pointer；Markdown 用 section:标题 | CONTRACTS §1; probes evidence |
| `sha256` | Digest | 是 | 完整文件 hash | CONTRACTS §1; probes evidence |
| `kind` | EvidenceKind | 是 | 该条证据种类 | CONTRACTS §1; probes evidence |
| `claim` | string | 是 | 明确可验证断言及范围 | CONTRACTS §1; probes evidence |

### CapabilityScope

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `operations` | array<Id> | 是 | 验证的具体操作 | CONTRACTS §1/§3; probes |
| `coverage` | array<Id> | 是 | 持久/取消/上下文/失败路径覆盖标签 | CONTRACTS §1/§3; probes |
| `hostVersion` | string | 是 | 确切宿主版本 | CONTRACTS §1/§3; probes |
| `providerModel` | ModelId / null | 是 | 供应商实测绑定；fixture 时 null | CONTRACTS §1/§3; probes |
| `trustDomain` | same-user / os-sandbox | 是 | 实际安全强度 | CONTRACTS §1/§3; probes |

### CapabilityObservation

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `status` | Status | 是 | 统一四值，缺 key 为 unknown | CONTRACTS §1; DSH/Pi HOST-MANIFEST |
| `evidenceRefs` | array<EvidenceRef> | 是 | 每个成立结论需要具体证据 | CONTRACTS §1; DSH/Pi HOST-MANIFEST |
| `scope` | CapabilityScope | 是 | 禁止无范围的 verified | CONTRACTS §1; DSH/Pi HOST-MANIFEST |
| `verifiedSubset` | array<Id> | 是 | partial 中实际成立的有限子集 | CONTRACTS §1; DSH/Pi HOST-MANIFEST |
| `limitations` | array<Id> | 是 | 非成立保证/不适用范围 | CONTRACTS §1; DSH/Pi HOST-MANIFEST |

### GuaranteeStrength

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `status` | Status | 是 | 统一能力状态 | CONTRACTS §1; probes |
| `coverage` | array<Id> | 是 | 明确保证范围 | CONTRACTS §1; probes |
| `evidenceRefs` | array<EvidenceRef> | 是 | 具体断言与证据种类 | CONTRACTS §1; probes |

### HostIdentity

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `host` | Id | 是 | 身份标签不参与品牌准入 | CONTRACTS §1; probes VERSION-PIN |
| `vendor` | Id / null | 是 | 可举证 publisher；Pi artifact 未单列 vendor 则 null | CONTRACTS §1; probes VERSION-PIN |
| `version` | string | 是 | 本次固定目标版本 | CONTRACTS §1; probes VERSION-PIN |
| `pinRef` | EvidenceRef | 是 | VERSION-PIN 全文摘要 | CONTRACTS §1; probes VERSION-PIN |

### ModelObservation

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `providerModel` | ModelId | 是 | 真实 provider/model | evaluation PROTOCOL §9; probes |
| `reasoningRequested` | Id / null | 是 | 原生请求值 | evaluation PROTOCOL §9; probes |
| `reasoningEffective` | payload-accepted / server-tier-verified / unknown | 是 | Pi high 只可记 payload-accepted | evaluation PROTOCOL §9; probes |
| `payloadRef` | EvidenceRef / null | 是 | 实测 payload；不得继承另一宿主证据 | evaluation PROTOCOL §9; probes |
| `priceRef` | EvidenceRef / null | 是 | 冻结价表，非账单 | evaluation PROTOCOL §9; probes |

### HostManifest

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 新版 schema envelope，raw probe manifest 不直接当执行资格 | CONTRACTS §1 |
| `manifestId` | Id | 是 | 规范化 manifest 身份 | CONTRACTS §1 |
| `identity` | HostIdentity | 是 | 宿主/版本资格 | CONTRACTS §1 |
| `compatibleProtocols` | array<ProtocolVersion> | 是 | 适配器明确支持的确切协议集合 | CONTRACTS §1 |
| `capabilities` | map<Id,CapabilityObservation> | 是 | 语义能力 map；缺项 unknown | CONTRACTS §1 |
| `model` | ModelObservation / null | 是 | DSH 未实测供应商选型为 null | CONTRACTS §1 |
| `usageSources` | array<EvidenceKind> | 是 | DSH fixture 与 Pi provider-live 不等价 | CONTRACTS §1 |
| `cancel` | GuaranteeStrength | 是 | stream/tool/child/vendor 分层 | CONTRACTS §1 |
| `recovery` | GuaranteeStrength | 是 | transcript/disk/journal/effects 分层 | CONTRACTS §1 |
| `isolation` | GuaranteeStrength | 是 | OS 保证不能从 hooks/worktree 推断 | CONTRACTS §1 |
| `hostSpecific` | HostSpecific | 是 | 显式保留宿主特有元数据 | CONTRACTS §1 |

### HostSpecific

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `probeStatus` | Id / null | 是 | DSH 整体 status；Pi 无该字段则 null | DSH/Pi HOST-MANIFEST; VERSION-PIN |
| `homeObservationRef` | EvidenceRef / null | 是 | DSH 路径观察；Pi 无对应字段则 null | DSH/Pi HOST-MANIFEST; VERSION-PIN |
| `integrationCompatibility` | Status | 是 | DSH 旧 plugin unknown；Pi 未测为 unknown | DSH/Pi HOST-MANIFEST; VERSION-PIN |
| `rawManifestRef` | EvidenceRef | 是 | 原始 29/15 项矩阵，不修改 | DSH/Pi HOST-MANIFEST; VERSION-PIN |
| `noteRefs` | array<EvidenceRef> | 是 | drift/静态/未验证说明 | DSH/Pi HOST-MANIFEST; VERSION-PIN |

### DecisionRecord

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 封套 | CONTRACTS §6; evaluation METRICS §5.2 |
| `decisionId` | Id | 是 | 唯一裁决记录 id | CONTRACTS §6; evaluation METRICS §5.2 |
| `kind` | task / candidate / promotion / activation | 是 | 四类决策互不替代 | CONTRACTS §6; evaluation METRICS §5.2 |
| `inputs` | array<ArtifactRef> | 是 | 内容与绑定 | CONTRACTS §6; evaluation METRICS §5.2 |
| `contractRef` | ContractRef / null | 是 | task 裁决必须非 null；candidate/promotion/activation 为 null | CONTRACTS §6; evaluation METRICS §5.2 |
| `taskEvidenceRef` | ArtifactRef / null | 是 | task 裁决必须非 null：TaskEvidenceReport 内容引用 | CONTRACTS §6; evaluation METRICS §2 |
| `evaluationReceiptRef` | ArtifactRef / null | 是 | candidate/promotion 裁决必须非 null：EvaluationReceipt 内容引用 | CONTRACTS §6/§7 |
| `activationReceiptRef` | ArtifactRef / null | 是 | activation 裁决必须非 null：ActivationReceipt 内容引用 | CONTRACTS §6/§7 |
| `evaluatorVersion` | string | 是 | 版本化裁决算法 | CONTRACTS §6; evaluation METRICS §5.2 |
| `evaluationProtocolRef` | ArtifactRef / null | 是 | 收益评价需 T0 版本 | CONTRACTS §6; evaluation METRICS §5.2 |
| `outcome` | string | 是 | 按 kind 限定枚举，见 INTERFACES | CONTRACTS §6; evaluation METRICS §5.2 |
| `reasons` | array<Id> | 是 | 结构化可解释原因 | CONTRACTS §6; evaluation METRICS §5.2 |
| `evidenceRefs` | array<ArtifactRef> | 是 | 真实证据，模型自述不充分 | CONTRACTS §6; evaluation METRICS §5.2 |
| `feedbackVisibility` | Visibility | 是 | 任务反馈不泄露私有/终审 | CONTRACTS §6; evaluation METRICS §5.2 |
| `issuer` | ActorRef | 是 | 仅对应唯一决策服务/真实 host receipt 归约 | CONTRACTS §6; evaluation METRICS §5.2 |
| `capabilityJudgement` | CapabilityJudgement / null | 是 | candidate 独立收益判定，不能代替 task | CONTRACTS §6; evaluation METRICS §5.2 |

### CapabilityJudgement

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `cellStatus` | complete / capability_absent / not-yet-comparable | 是 | 取 METRICS §5.3 字面值；上游为 underscore/hyphen 混合，本层不做规范化 | evaluation METRICS §5.2/§5.3 |
| `look` | FUTILITY_LOOK / CONFIRMATORY_LOOK / other | 是 | 确认或 futility 看 | evaluation METRICS §5.2/§5.3 |
| `verdict` | positive / negative / inconclusive / blocked / exploratory_only | 是 | METRICS §5.2 有序函数结果 | evaluation METRICS §5.2/§5.3 |
| `protocolRef` | ArtifactRef | 是 | 明确 v3/T0 hash | evaluation METRICS §5.2/§5.3 |
| `analysisRef` | ArtifactRef | 是 | 分析脚本与实际数据 hash | evaluation METRICS §5.2/§5.3 |
| `costBasis` | measured-usage-estimate / estimate / unknown | 是 | measured usage×价格仍非 invoice | evaluation METRICS §5.2/§5.3 |
| `guardrailCost` | passed / failed / unknown | 是 | cost_per_success 护栏；统计 positive 不得代替护栏 | evaluation METRICS §5.1/§5.2; PROTOCOL §8 |
| `guardrailWall` | passed / failed / unknown | 是 | p90(wall) 护栏 | evaluation METRICS §5.1/§5.2; PROTOCOL §8 |
| `guardrailTruncation` | passed / failed / unknown | 是 | incomplete_rate 护栏 | evaluation METRICS §5.1/§5.2; PROTOCOL §8 |

### AssetRef

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | AssetProtocolVersion | 是 | 资产独立 namespace | CONTRACTS §1/§7 |
| `assetId` | Id | 是 | 资产身份 | CONTRACTS §1/§7 |
| `revision` | integer | 是 | 精确版本 | CONTRACTS §1/§7 |
| `digest` | Digest | 是 | 完整资产内容 | CONTRACTS §1/§7 |
| `scope` | Scope | 是 | 资格与激活作用域 | CONTRACTS §1/§7 |
| `qualificationRef` | ArtifactRef / null | 是 | 评价/晋升完整 binding；未取得资格为 null | CONTRACTS §1/§7 |

### CapabilityAsset

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | AssetProtocolVersion | 是 | 封套 | CONTRACTS §7 |
| `asset` | AssetRef | 是 | 不可变内容绑定 | CONTRACTS §7 |
| `kind` | skill / template / memory / tool-policy | 是 | 资产类型 | CONTRACTS §7 |
| `contentRefs` | array<ArtifactRef> | 是 | 项目 staging，原全局 Skills 只读 | CONTRACTS §7 |
| `sourceTraces` | array<ArtifactRef> | 是 | train 来源证据 | CONTRACTS §7 |
| `dependencies` | array<AssetRef> | 是 | 精确依赖 revision | CONTRACTS §7 |
| `hypothesis` | string | 是 | 直接能力假设 | CONTRACTS §7 |
| `qualification` | staged / validated / rejected / inconclusive / promoted / expired / revoked | 是 | active 不作全局资格 bool | CONTRACTS §7 |
| `evaluationRef` | ArtifactRef / null | 是 | 候选评价 receipt | CONTRACTS §7 |
| `expiresAt` | Instant / null | 是 | 资格 expiry | CONTRACTS §7 |
| `revocationRef` | ArtifactRef / null | 是 | 撤销证据 | CONTRACTS §7 |

### ActivationReceipt

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `protocol` | ProtocolVersion | 是 | 封套 | CONTRACTS §1/§7 |
| `asset` | AssetRef | 是 | 精确 asset revision | CONTRACTS §1/§7 |
| `hostSessionId` | Id | 是 | 具体 host session | CONTRACTS §1/§7 |
| `scope` | Scope | 是 | 激活范围 | CONTRACTS §1/§7 |
| `previousSnapshot` | ArtifactRef | 是 | 旧 snapshot 不覆盖 | CONTRACTS §1/§7 |
| `newSnapshot` | ArtifactRef / null | 是 | 实际激活成功才非 null | CONTRACTS §1/§7 |
| `actualStatus` | active / failed / unknown | 是 | 真实 host 确认，safe idle 不等于已激活 | CONTRACTS §1/§7 |
| `authorizationRef` | Id | 是 | 激活 grant | CONTRACTS §1/§7 |
| `evaluationRef` | ArtifactRef | 是 | 完整资格绑定 | CONTRACTS §1/§7 |

### ErrorEnvelope

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `code` | ErrorCode | 是 | ERRORS 冻结枚举 | CONTRACTS §6; ERRORS |
| `message` | string | 是 | 无 secret 的短说明 | CONTRACTS §6; ERRORS |
| `retry` | never / after-refresh / after-authorization / after-reconcile | 是 | 不能按 code 自行重放外部效果 | CONTRACTS §6; ERRORS |
| `refs` | array<Id> | 是 | 相关 session/command/effect 身份 | CONTRACTS §6; ERRORS |
| `visibility` | Visibility | 是 | 私有测试原因只给安全摘要 | CONTRACTS §6; ERRORS |

### AssetProtocolVersion

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `namespace` | "evofence.assets/1" | 是 | 资产 namespace，与旧全局 Skills/旧资产格式分离 | adr_0010 |
| `schemaVersion` | "1.0.0" | 是 | 本提案资产引用版本 | adr_0010 |

### CommandResult

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `commandId` | Id | 是 | 原命令身份 | CONTRACTS §2 |
| `disposition` | committed / duplicate / rejected / archived | 是 | 原子提交/同内容去重/拒绝/迟到归档 | CONTRACTS §2 |
| `sessionId` | Id | 是 | 内核会话 | CONTRACTS §2 |
| `revision` | Count | 是 | 当前 journal revision | CONTRACTS §2 |
| `eventIds` | array<Id> | 是 | 该事务事件身份 | CONTRACTS §2 |
| `effectIds` | array<Id> | 是 | 已提交 outbox intention；未提交不得派发 | CONTRACTS §2 |
| `decisionRef` | ArtifactRef / null | 是 | 四类裁决工件引用 | CONTRACTS §2 |
| `error` | ErrorEnvelope / null | 是 | typed failure，禁止任意异常序列化 | CONTRACTS §2 |

### SessionView

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `sessionId` | Id | 是 | 只读内核 session | CONTRACTS §2 |
| `revision` | Count | 是 | journal revision | CONTRACTS §2 |
| `epoch` | PositiveCount | 是 | 当前 session epoch | CONTRACTS §2 |
| `taskRef` | ContractRef | 是 | 任务绑定 | CONTRACTS §2 |
| `graphRef` | GraphRef | 是 | 图绑定 | CONTRACTS §2 |
| `manifestRef` | ArtifactRef | 是 | 准入 snapshot | CONTRACTS §2 |
| `nodeBindings` | array<Binding> | 是 | 各 attempt 身份，不暗示完成 | CONTRACTS §2 |
| `nodeStates` | array<NodeStateEntry> | 是 | journal 派生的节点状态投影；不暗示完成 | CONTRACTS §4; graph SEMANTICS §2.2 |
| `unknownEffectIds` | array<Id> | 是 | 仍需核实的外部效果 | CONTRACTS §2 |
| `lastSequence` | Count / null | 是 | 空 journal 为 null | CONTRACTS §2 |
| `dispatchMode` | active / paused / cancelling / cancelled | 是 | 仅session派发模式；paused不表示child已停，unknown见unknownEffectIds | CONTRACTS §2/§4; 冻结提案 |

### NodeStateEntry

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `nodeId` | Id | 是 | 节点 id | CONTRACTS §4; graph SEMANTICS §2.2 |
| `attemptOrdinal` | integer | 是 | 该状态所属 attempt 序号 | CONTRACTS §4; graph SEMANTICS §2.3 |
| `epoch` | integer | 是 | 判定该状态时的 session epoch | CONTRACTS §4/§5; graph SEMANTICS §2.3 |
| `state` | NodeState | 是 | 节点当前状态；不是完成声明 | CONTRACTS §4; graph SEMANTICS §2.2 |
| `sinceSequence` | Count | 是 | 进入该状态的 journal sequence | CONTRACTS §4/§5 |

### GuaranteeGap

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `capability` | Id | 是 | 所缺语义 | CONTRACTS §1; adr_0006 |
| `reason` | missing / absent / partial / unknown / evidence-kind / coverage / version / approval | 是 | 确定缺口分类 | CONTRACTS §1; adr_0006 |
| `evidenceRefs` | array<EvidenceRef> | 是 | 保留不足证据 | CONTRACTS §1; adr_0006 |
| `alternativeIds` | array<Id> | 是 | 待核验显式替代 | CONTRACTS §1; adr_0006 |

### NegotiationResult

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `status` | executable / needs-degradation / unsupported | 是 | 准入结果 | CONTRACTS §1; adr_0006 |
| `taskDigest` | Digest | 是 | 精确原合同 | CONTRACTS §1; adr_0006 |
| `manifestDigest` | Digest | 是 | 精确规范化 manifest | CONTRACTS §1; adr_0006 |
| `satisfied` | array<Id> | 是 | 原要求已满足 | CONTRACTS §1; adr_0006 |
| `gaps` | array<GuaranteeGap> | 是 | 未满足原要求 | CONTRACTS §1; adr_0006 |
| `selectedAlternatives` | array<Id> | 是 | 已批准且技术上满足的替代 | CONTRACTS §1; adr_0006 |
| `approvalRefs` | array<ArtifactRef> | 是 | 不是批准一个 unknown 为 verified | CONTRACTS §1; adr_0006 |

### EvaluationReceipt

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `evaluationId` | Id | 是 | 评价身份 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `candidate` | AssetRef | 是 | 完整 candidate digest/revision/scope | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `baseDigest` | Digest | 是 | 评价 base | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `dependencyRefs` | array<AssetRef> | 是 | 精确依赖版本 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `protocolRef` | ArtifactRef | 是 | 完整协议 T0/开发评价快照 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `dataSplitRefs` | array<ArtifactRef> | 是 | 数据拆分摘要 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `hostManifestRefs` | array<ArtifactRef> | 是 | 每宿主版本和证据范围 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `modelBindings` | array<ModelRequirement> | 是 | 供应商模型/payload 绑定 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `requiredJudgements` | array<CapabilityJudgement> | 是 | 完整必需评价结果，不筛掉失败 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `usageComplete` | boolean | 是 | 缺用量不补零 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |
| `evidenceRefs` | array<ArtifactRef> | 是 | 产物/真实测试/分析证据 | CONTRACTS §7; evaluation PREREGISTRATION §1/§5 |

### BranchEvidence

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `nodeId` | Id | 是 | 必须分支id，不过滤缺失分支 | graph SEMANTICS §5.3; evaluation METRICS §2 |
| `binding` | Binding / null | 是 | 分支attempt绑定；缺失null | graph SEMANTICS §5.3; evaluation METRICS §2 |
| `state` | NodeState / null | 是 | 实际状态；missing为null而非succeeded | graph SEMANTICS §5.3; evaluation METRICS §2 |
| `artifactRefs` | array<ArtifactRef> | 是 | 真实分支产物 | graph SEMANTICS §5.3; evaluation METRICS §2 |
| `decisionRef` | ArtifactRef / null | 是 | 唯一TaskDecision引用 | graph SEMANTICS §5.3; evaluation METRICS §2 |
| `gapReason` | Id / null | 是 | 失败/取消/未满足的显式理由 | graph SEMANTICS §5.3; evaluation METRICS §2 |

### TaskEvidenceReport

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `contractRef` | ContractRef | 是 | 精确task合同 | evaluation METRICS §2; PROTOCOL §5 |
| `binding` | Binding | 是 | 本次受评attempt | evaluation METRICS §2; PROTOCOL §5 |
| `privateTestsPassed` | boolean / null | 是 | 有私有验收要求而null时unknown；不回传源码 | evaluation METRICS §2; PROTOCOL §5 |
| `requiredOutcomesMet` | boolean / null | 是 | 逐outcome工件足证才true | evaluation METRICS §2; PROTOCOL §5 |
| `branchReport` | array<BranchEvidence> | 是 | 完整requiredBranches，不丢失败/取消 | evaluation METRICS §2; PROTOCOL §5 |
| `artifactRefs` | array<ArtifactRef> | 是 | 真实字节和运行结果证据 | evaluation METRICS §2; PROTOCOL §5 |
| `actualDiffRef` | ArtifactRef / null | 是 | 编码任务实际diff；非workspace任务可null | evaluation METRICS §2; PROTOCOL §5 |
| `runStatus` | completed / incomplete / timeout / cancelled / usage_incomplete / needs-human / unknown | 是 | task生产结果与评测ITT映射分离 | evaluation METRICS §2; PROTOCOL §5 |
| `usageComplete` | boolean | 是 | 失败/取消未知不补零 | evaluation METRICS §2; PROTOCOL §5 |
| `privacyChecked` | boolean | 是 | 私有/终审信息未进入执行者反馈 | evaluation METRICS §2; PROTOCOL §5 |

### JoinReceipt

| 名称 | 类型 | 必填 | 语义 | 来源 |
|---|---|---|---|---|
| `binding` | Binding | 是 | join自身epoch/revision | graph SEMANTICS §5.3 |
| `requiredBranches` | array<Id> | 是 | 明确必需分支清单 | graph SEMANTICS §5.3 |
| `branchReport` | array<BranchEvidence> | 是 | 逐分支完整报告 | graph SEMANTICS §5.3 |
| `status` | verifying / waiting / failed | 是 | 全成功才verifying；B1/B3 waiting，B2 failed | graph SEMANTICS §5.3 |

## 3. 规范语义校验（Semantic Validation）

下列规则也是 schema 合同；解析成功不表示通过这些规则。L2 必须实现纯校验器与失败用例，当前没有其运行证据。

| 规则 | 必须成立 | 拒绝码 |
|---|---|---|
| S01 | secret不得进入数据；序列化UTF-8≤1 MiB、深度≤64；Id/Digest不猜路径 | EFK_SCHEMA_INVALID / EFK_PRIVACY_VIOLATION |
| S02 | namespace/精确schemaVersion在compatibleProtocols中；不自动迁移旧格式 | EFK_PROTOCOL_UNSUPPORTED |
| S03 | command/effect/receipt/request identity重复时内容摘要相同，归约/结算仅一次 | EFK_IDEMPOTENCY_COLLISION / EFK_USAGE_CONFLICT |
| S04 | journal revision、graph revision、attemptOrdinal、epoch、fencingToken分开；旧回执仅归档 | EFK_REVISION_CONFLICT / EFK_RECEIPT_STALE |
| S05 | Grant=权限根∩父grant∩task∩node；真身份、未撤销、未过期；委派只缩小权限/剩余深度 | EFK_AUTHORITY_DENIED / EFK_GRANT_REVOKED / EFK_GRANT_EXPIRED |
| S06 | claim/lease/reservation/outbox与journal同CAS事务；派发前核当前epoch/token/deadline | EFK_CLAIM_CONFLICT / EFK_LEASE_STALE / EFK_HOST_BOARD_AUTHORITY_CONFLICT / EFK_INVARIANT_VIOLATION |
| S07 | 授权绑定类别/价表；settled+outstanding≤cap；每真实/隐式请求预留；USD向上取整到微单位；缺usage保留 | EFK_BUDGET_NOT_AUTHORIZED / EFK_BUDGET_EXHAUSTED / EFK_USAGE_INCOMPLETE |
| S08 | request_cap×每请求最坏微单位预留≤usd_cap；评测表近似值不作精确派发额度 | EFK_BUDGET_ENVELOPE_INCONSISTENT |
| S09 | node/effect产物binding必非null且真实字节hash、producer、base、schema、graph/attempt匹配；源/批准/协议快照可null，消费命令须绑定精确session/task/graph/digest与权限 | EFK_ARTIFACT_DIGEST_MISMATCH / EFK_ARTIFACT_BINDING_MISMATCH |
| S10 | CommandPayload.kind只准对应字段非null；resume不重放unknown动作 | EFK_SCHEMA_INVALID / EFK_EFFECT_UNKNOWN |
| S11 | node.transition有binding/before/after；effect/receipt事件有effectId；decision.recorded有decisionId/objectRef；其它对象事件有objectRef | EFK_SCHEMA_INVALID |
| S12 | Effect.kind遵循下表；未提交intention/未批准替代不派发 | EFK_SCHEMA_INVALID / EFK_DEGRADATION_APPROVAL_REQUIRED |
| S13 | 真实model不填fixture标签；server-tier需要独立档位证据，payload接受不足 | EFK_CAPABILITY_EVIDENCE_INSUFFICIENT |
| S14 | Usage.complete=false或必需计量缺失时未知值null；cancel/failed的SDK零值不证明免费 | EFK_USAGE_INCOMPLETE |
| S15 | total按原来源语义校验；cache分账，reasoning≤output且不重复加；DSH provider归一化未测 | EFK_USAGE_CONFLICT |
| S16 | DecisionRecord.kind/outcome 枚举对应，且 **kind 专属充分输入引用按 kind 必须非 null**（task→`taskEvidenceRef`+`contractRef`；candidate/promotion→`evaluationReceiptRef`；activation→`activationReceiptRef`；candidate 另需 `capabilityJudgement`）；候选收益走冻结METRICS v3，不代替task；promotion/activation独立issuer | EFK_DECISION_AUTHORITY_DENIED |
| S17 | 晋升/激活绑定完整EvaluationReceipt：digest/base/dependencies/protocol/model/host/scope；过期/撤销使资格失效 | EFK_ASSET_QUALIFICATION_INVALID |
| S18 | 受控试验资产sourceTraces只能train；dev只评价/选型，held-out/final不产生资产 | EFK_EVALUATION_PROTOCOL_MISMATCH |
| S19 | active需safe idle+grant/lease+实际newSnapshot回执；失败保留previousSnapshot，unknown先核实 | EFK_ACTIVATION_UNCONFIRMED |
| S20 | requiredBranches/requiredJoins不筛掉失败/取消/缺失；11图校验和A1–A6/B1–B3/INV保持来源顺序 | EFK_GRAPH_JOIN_INCOMPLETE / EFK_INVARIANT_VIOLATION |
| S21 | hard只收verified+指定证据种类/coverage/pin；缺key为unknown；批准降级不等于提升unknown状态 | EFK_CAPABILITY_UNSUPPORTED |
| S22 | 工件按真实字节SHA256；对象身份按下述确定JSON编码摘要；拒绝重复键/非法Unicode/-0/非安全整数 | EFK_SCHEMA_INVALID / EFK_IDEMPOTENCY_COLLISION |
| S23 | data的expect非null、artifact可为待产出null；route仅when非null；repair/fallback仅when/maxAttempts非null；provenance仅relation非null；其它相关可空槽位null | EFK_SCHEMA_INVALID |
| S24 | graph/node额外tool/model要求在图接受与claim按同协商规则检查，且权限/预算不越task ceiling；非active模式禁止新dispatch | EFK_CAPABILITY_UNSUPPORTED / EFK_AUTHORITY_DENIED |
| S25 | `SessionView.nodeStates` 是 journal 的派生投影：每项 `state` 必须等于该 `(nodeId, attemptOrdinal)` 在 `sinceSequence` 处 `node.transition` 的 `after`，`epoch` 与当次判定一致；不新增第二真相源 | EFK_INVARIANT_VIOLATION / EFK_RECOVERY_SEQUENCE_GAP |
| S26 | `task.evaluate` 命令的 `objectRef`（及 `DecisionRecord.taskEvidenceRef` 指向的工件）必须解码为 `TaskEvidenceReport`（`ArtifactRef.schema.name` 匹配）；不得用其它对象冒充 | EFK_ARTIFACT_BINDING_MISMATCH |

**CONTRACTS §5 十条不变量的载体映射**（轴：字段/约束——不靠散在注解里的承诺）：

| # | 不变量 | 载体 | 机检规则 |
|---|---|---|---|
| 1 | 同 node+attempt 最多一个有效 claim | claim 是 `EventStore` 事务内状态，**无 wire 对象**；`LeaseRef.ownerClaimId` 引用它 | S06；唯一键 `(sessionId, nodeId, attemptOrdinal, epoch)` 由 store 事务保证 |
| 2 | lease 带 fencing/epoch，过期 owner 不能提交 | `LeaseRef.epoch` / `fencingToken` | S04、S06 |
| 3 | parent/child 共享预算总账；先预留后结算 | `BudgetPolicy.poolId` + `Effect.reservationRef`；reservation 同样是 **store 内**状态 | S07 |
| 4 | journal 与 outbox 同 CAS 提交 | `EventStore.append(expectedRevision, Event[], Effect[])` + `CommandResult.effectIds` | S06 |
| 5 | host 请求/receipt 可重复送达，只归约一次 | `Command.commandId`、`Effect.idempotencyKey`、`Receipt.receiptId`、`Usage.requestId` | S03 |
| 6 | 外部动作不保证 exactly-once；unknown 必须 reconcile | `Receipt.status`（含 `unknown`/`not-executed`）、`Effect.kind=host.reconcile` | S10 |
| 7 | integration/asset writer 串行 | 无专属字段；由 `GraphSpec.resourcePolicy` 把 `integrationWriter` 声明为 `exclusive` | S06（资源冲突） |
| 8 | fan-in 消费明确分支清单，不筛掉失败 | `JoinReceipt.requiredBranches` + `branchReport` | S20 |
| 9 | schema/epoch/sequence 缺口不得用缓存投影假装恢复 | `Event.sequence` 连续、`SessionView.lastSequence`、`NodeStateEntry.sinceSequence` | S04、S25 |
| 10 | replay 不调用模型/工具/写盘 | 纯 reducer 的**实现约束**；schema 侧无字段 | OWNERSHIP I01–I08（import 闭包） |

claim 与 reservation 不设 wire 对象是**有意选择**：二者生命周期完全落在 `EventStore.append` 的一个 CAS 事务内，跨边界的只有其 id 引用（`LeaseRef.ownerClaimId`、`Effect.reservationRef`）。

SEMANTICS §3.0.2 的 `graphActions` 在 schema 侧无独立字段：A2 的 `enable(t)` 由目标节点 `node.transition: pending→ready` 表达，A3 的 `newAttempt(t)` 由新 `Binding.attemptId`/`attemptOrdinal` 表达。

对象身份编码固定：对象键按Unicode码点升序（本schema键均ASCII），递归序列化；字符串按JSON转义并UTF-8编码，不做Unicode规范化；数组顺序保留，数值仅安全整数且0写0，null/true/false标准小写；不插空白/BOM/结尾换行。重复对象键、孤立代理项、-0、NaN/Infinity或不安全整数拒绝。Command重复身份比较完整封套的确定字节摘要；ArtifactRef.digest核原始工件字节，不对文件内容擅自重编码。该编码是1.0.0语义，不沿用JSON.stringify对象插入顺序。

SessionView.dispatchMode只控制新派发，节点状态另算；pause不递增epoch，旧任务回执仍按原binding核验；resume/恢复递增epoch并先reconcile在途动作。session.paused/resumed/cancel-requested/cancel-confirmed事件有objectRef和causedBy；只有全部targets实际停止、所需leases释放或证明未执行才cancel-confirmed。非active模式不可新dispatch，已授权cancel/reconcile不受该禁令阻断。

EffectPayload“必需”表示非null；不属于当前kind的可空字段为null，不属于它的集合为空。deliveryGuarantee=acknowledged-durable无目标消费ack不能completed。

| Effect.kind | 必需字段 | 执行规则 |
|---|---|---|
| host.agent | context | 原生loop；reservation必需；不新建无上下文CLI |
| host.tool | toolName / argumentsRef | 真实tool path；计费动作需reservation，写动作需lease |
| host.delegate | graphRef / context | 子图/子grant/父池；不授予第二裁决/权限根 |
| host.cancel | targetIds | 每target确认+lease释放；不代表供应商免费 |
| host.activate | assetRef / previousSnapshot | 实际新snapshot确认；idle仅前置 |
| host.reconcile | targetIds | 核实真实动作，不默认重执行 |
| timer.wait | targetIds | timer/Clock由注入port执行 |

data边在建图时可显式声明expect并令artifact=null，表示该producer的待产出；不是输入已满足。1.0.0以from+expect.name/version/digest作为显式输出selector，必须匹配producer.outputSchemas唯一声明；receipt后仅绑定该producer当前attempt/base的唯一匹配工件，歧义拒绝，consumer claim前将真实ArtifactRef固化进消费记录。不重新猜依赖或取latest；若建图时已有artifact，须校验同selector/binding。读取中撤回仍需cancel确认+新attempt/显式rebind，不能就地替换已leased输入。

GraphSpec/GraphPatch原子校验固定为SEMANTICS §5.1的11项：①schema版本 ②引用 ③dependency∪data无环 ④data可消费 ⑤fan-in完整 ⑥不提升权限 ⑦资源owner无冲突 ⑧attempt/loop/depth/budget界 ⑨可达环有界 ⑩无real consumer必须terminal ⑪abandoned具authority/reason且不删证据。禁止resource/join边，resources放节点/图级策略。leased/running/verifying/unknown/cancelling节点不能就地改，cancel确认后新attempt+显式rebind。

loop至少两类bound；body/stop/carry显式；maxTokensOrCost至少一非null正值；父预算不因新attempt/loop/fallback重置。谓词是纯AST，只读取明确outcome/reason/env，不执行JS/shell，也不做宿主品牌白名单。

## 4. 证据边界

逐字段映射见 [HOST-MAPPING.md](HOST-MAPPING.md)。kernel构造项是新提案，运行保证unknown；原生id/context/usage只在对应证据范围成立。schema/引用覆盖核验不证明durability、原子outbox、权限强制或收益，这些属于L2/L3与人审后取证。
