# 冻结错误码（Frozen Error Codes）

状态：**冻结提案 l1-freeze.2，待l1_replan人审**；ADR仍proposed。本版随 SCHEMAS.md 变更记录（`l1-freeze.1`→`l1-freeze.2`：`SessionView` 增必填 `nodeStates`／新对象 `NodeStateEntry`；`DecisionRecord` 按 `kind` 约束各 receipt ref；`CapabilityJudgement` 增护栏字段）对齐 lane 版本与 schemaVersion `1.1.0`；错误码表语义不由该变更改写。公共wire code为58个固定EFK_*字符串，与probe PROBE_*及宿主TEAM_*分开。SDK/CLI/host消费同一个ErrorEnvelope，不发明第二套判据；本文件 58 码已完成；**SCHEMAS.ErrorCode.enum 已同步为 58**（含 `EFK_HOST_BOARD_AUTHORITY_CONFLICT`），README 计数与 A01–A15/H01–H13 引用亦已同步——T02 全链闭合（由 orchestrator 在集成收口时实测确认，见 OPEN-ITEMS §4 T02）。

never=原请求原样不可重试；after-refresh=重读后新commandId/expectedRevision；after-authorization=新真实授权；after-reconcile=先核实实际效果和保留历史。后两者不是自动重放许可。只有已确认未执行且幂等的effect，才可依合同重发同idempotencyKey；未知非幂等动作不盲重试。同内容重复command返回duplicate。同一事件命中多码时的优先级：具体码优先于 EFK_INVARIANT_VIOLATION（后者只用于没有更具体码的绕过）；graph/预算/usage/artifact 域码优先于 host 域码；kernel 域优先于同义 host 域（如 EFK_REVISION_CONFLICT 优先于 EFK_HOST_REVISION_CONFLICT）。

| 固定 code | 触发条件 | 重试 |
|---|---|---|
| EFK_SCHEMA_INVALID | 字段、枚举、额外键或判别式不合法 | never |
| EFK_PROTOCOL_UNSUPPORTED | namespace/精确 schemaVersion 未协商 | never |
| EFK_LEGACY_NOT_EXECUTABLE | 旧 ledger/config/bundle 请求新版恢复或激活 | never |
| EFK_SOURCE_PIN_DRIFT | 宿主/模型/证据文件 hash 与准入 snapshot 不符；重读无法修复，须重新准入 | after-authorization |
| EFK_REVISION_CONFLICT | kernel journal 或 GraphPatch 的 expectedRevision 不符（注明域） | after-refresh |
| EFK_GRAPH_REFERENCE_INVALID | 节点、边、join 或产物引用悬空 | never |
| EFK_GRAPH_DEPENDENCY_CYCLE | dependency∪data 投影有环 | never |
| EFK_GRAPH_INPUT_STALE | 已绑定输入 digest/schema 不可消费，须显式 rebind | after-refresh |
| EFK_GRAPH_JOIN_INCOMPLETE | 必需分支缺失，报告不可过滤，未 abandoned 则 waiting | after-refresh |
| EFK_GRAPH_AUTHORITY_ESCALATION | patch 或子 grant 超过父/root 范围 | never |
| EFK_GRAPH_RESOURCE_CONFLICT | 新图试图制造并存排他 owner | never |
| EFK_GRAPH_BOUND_INVALID | loop <2 类 bound 或 attempts/depth/budget 越界 | never |
| EFK_GRAPH_NON_TERMINATING | 可达控制环没有显式 bound | never |
| EFK_GRAPH_TERMINAL_REQUIRED | 无 real consumer 的节点未 terminal（R4） | never |
| EFK_GRAPH_EVIDENCE_REMOVAL | 删除已有失败/取消/产物证据或 abandoned 无 reason/grant（R5） | never |
| EFK_GRAPH_ACTIVE_NODE_MUTATION | leased/running/verifying/unknown/cancelling 节点被就地改输入 | after-reconcile |
| EFK_GRAPH_NO_MATCHING_ROUTE | A5：有 routing 出边但 outcome 无匹配；保留原 reason | never |
| EFK_INVARIANT_VIOLATION | INV/唯一 owner/outbox 原子性等被绕过；告警且保留原状态 | after-reconcile |
| EFK_CAPABILITY_UNSUPPORTED | hard 保证不存在或无法提供合格替代 | never |
| EFK_CAPABILITY_EVIDENCE_INSUFFICIENT | 状态、证据种类、覆盖或版本未满足 | after-refresh |
| EFK_DEGRADATION_APPROVAL_REQUIRED | 替代技术上可行但缺精确批准绑定 | after-authorization |
| EFK_AUTHORITY_DENIED | actor 不是真实 live 身份或 action 超 grant/root | never |
| EFK_GRANT_EXPIRED | 授予已过期限 | after-authorization |
| EFK_GRANT_REVOKED | 撤销代数不符或授予被撤回 | after-authorization |
| EFK_CLAIM_CONFLICT | 同 attempt 已有有效 claim，竞态留 ready | after-refresh |
| EFK_LEASE_STALE | epoch/fencing/expiry 无效；不得应用写入/激活 | after-reconcile |
| EFK_IDEMPOTENCY_COLLISION | 同 command/effect/receipt/request identity 内容摘要不同 | never |
| EFK_BUDGET_NOT_AUTHORIZED | 类别/范围缺真实预算授权，禁止借用别类额度 | after-authorization |
| EFK_BUDGET_EXHAUSTED | settled+outstanding 或 request/wall cap 达界 | after-authorization |
| EFK_BUDGET_ENVELOPE_INCONSISTENT | 冻结价格与单请求界推出的预留无法容纳所声明请求数 | never |
| EFK_USAGE_INCOMPLETE | 真实请求 usage 缺失/失联/取消零值无账单证据；保留预留 | after-reconcile |
| EFK_USAGE_CONFLICT | 同 requestId 的已结算 usage 内容不一致或重复 reasoning | after-reconcile |
| EFK_ARTIFACT_DIGEST_MISMATCH | 实际字节摘要与引用不符 | never |
| EFK_ARTIFACT_BINDING_MISMATCH | graph/node/attempt/base/schema 或依赖 revision 不符 | never |
| EFK_ARTIFACT_UNAVAILABLE | locator 失效/无权读/expired；不猜 cwd 最新文件 | after-refresh |
| EFK_HOST_SESSION_MISMATCH | native session 切换/恢复后与 binding 不符 | after-reconcile |
| EFK_HOST_EXECUTION_FAILED | 真实 host ack/result 明确失败（无通用自动重试） | after-reconcile |
| EFK_HOST_REVISION_CONFLICT | 宿主 board CAS 不符，不冒充 kernel revision 冲突 | after-refresh |
| EFK_HOST_BOARD_AUTHORITY_CONFLICT | 宿主原生 board 对某 node/attempt 的 task owner ≠ kernel claim，或存在无 kernel 映射的原生 task（A15） | after-reconcile |
| EFK_HOST_DELIVERY_UNCONFIRMED | 只有 queued，缺目标 receipt/ack | after-reconcile |
| EFK_CANCEL_UNCONFIRMED | child/tool/stream 停止或 lease 释放未确认 | after-reconcile |
| EFK_RECEIPT_STALE | 旧 epoch/attempt/fencing 回执；归档不应用 | after-reconcile |
| EFK_RECOVERY_SEQUENCE_GAP | journal 连续序列有缺口；拒绝恢复 | after-reconcile |
| EFK_RECOVERY_SCHEMA_MISMATCH | projection/schema/namespace 无合法恢复路径 | never |
| EFK_EFFECT_UNKNOWN | 实际外部动作不明；不盲重放 | after-reconcile |
| EFK_EFFECT_NON_IDEMPOTENT_RETRY | 非幂等动作未知或未得新执行批准 | after-authorization |
| EFK_EVALUATION_INSUFFICIENT | 未 T0/未达 n/低不一致对/无收益证据，保留 inconclusive/exploratory | after-refresh |
| EFK_EVALUATION_DATA_DEGRADED | 污染/泄露/usage incomplete ratio 超冻结阈值 | never |
| EFK_EVALUATION_PROTOCOL_MISMATCH | 数据拆分、算法、模型或价格绑定不符 | never |
| EFK_DECISION_AUTHORITY_DENIED | worker 自判成功/推广/激活或第二服务写同域裁决 | never |
| EFK_ASSET_QUALIFICATION_INVALID | candidate digest/base/dependencies/protocol/评价不完整 | never |
| EFK_ASSET_SCOPE_DENIED | 资产拟激活范围超资格/授权 | never |
| EFK_ASSET_REVOKED | 源或依赖撤销使派生资格失效 | never |
| EFK_ASSET_EXPIRED | 资产资格过期 | after-authorization |
| EFK_ACTIVATION_NOT_SETTLED | 仍有 host continuation/异步 handler/必要分支未结束 | after-refresh |
| EFK_ACTIVATION_UNCONFIRMED | 缺真实应用 snapshot 回执或部分失败 | after-reconcile |
| EFK_PRIVACY_VIOLATION | 秘密/私有测试/final 内容向执行者或公开工件泄露 | never |
| EFK_HUMAN_APPROVAL_MISSING | required_human 事项缺身份和精确内容绑定的真实签署 | after-authorization |

## 原生错误归一化

索引Dxx/Pxx指 [HOST-MAPPING.md](HOST-MAPPING.md) 的固定capability+status+pointer。

| 原始证据/来源 | 公共映射 | 限制 |
|---|---|---|
| D11 sameIdImpostorRejected / TEAM_NOT_MEMBER | EFK_AUTHORITY_DENIED | 仅exact-live，不证明kernel grant |
| D11 nonLeadSpawnRejected / TEAM_LEAD_REQUIRED | EFK_AUTHORITY_DENIED | grant不能自提升lead |
| D12 teamStaleRevisionRejected / TEAM_TASK_STALE_REVISION | EFK_HOST_REVISION_CONFLICT | host board CAS不是journal/graph CAS |
| A15 枚举到 owner ≠ kernel claim 的原生 board task（DSH D12 证明该能力存在） | EFK_HOST_BOARD_AUTHORITY_CONFLICT | board CAS 不是 kernel claim；拒绝后把 board 归回投影，原 claim 不变 |
| D9 projectionGapRejected | EFK_RECOVERY_SEQUENCE_GAP | 原生投影旁证，kernel仍自己校验 |
| D9 projectionVersionTailRejected | EFK_RECOVERY_SCHEMA_MISMATCH | 未知schema尾段不能假恢复 |
| D10 teamMessageDurable=false | EFK_HOST_DELIVERY_UNCONFIRMED | queued保留，无消费ack不交付 |
| D5 null失败/取消；P6供应商cancel未测 | EFK_USAGE_INCOMPLETE | 预留保留，abort不等于免费 |
| task/capability证据不足 | EFK_EVALUATION_INSUFFICIENT | unknown/inconclusive/exploratory，不伪造negative |

## 错误与产品状态

正常的needs-human/unknown/inconclusive不是异常栈。GRAPH_JOIN_INCOMPLETE通常waiting，只有上游明确abandoned且无cover才failed（B2）；GRAPH_NO_MATCHING_ROUTE对应A5 failed，保留原outcome/reason。INV保留原状态并告警/reconcile；cancel未确认保持unknown，不写cancelled。EFK_BUDGET_EXHAUSTED在受控试验按协议记录incomplete，ITT计0，不能静默删run。

旧epoch receipt归档不应用新状态；实际用量证据保留，由当前epoch的reconcile命令核实原effect/reservation，原requestId只结算一次。不能以“迟到被丢弃”来漏报费用，也不能直接以迟到回执推进当前attempt。

ErrorEnvelope仅固定code、安全message、retry、refs、visibility。原生Error/stack/prompt/headers不直写；私有测试细节不回传。需要诊断只给受权限控制的工件引用。固定code含义/重试意义改变需新major；新增code需minor及显式版本协商，旧消费者不能误判为成功。该词表是拟实现合同，不是现有CLI错误码改动。
