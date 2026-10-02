# 双宿主字段映射（Host Field Mapping）

状态：**冻结提案 l1-freeze.2，待 l1_replan 真人定案**；不是新版kernel/adapter实现通过声明，ADR仍proposed。

native-scoped表示指定原生值/文件证据能抽取，完整adapter关联仍待实现；partial/unknown保留未知保证。每个yes-scoped必须指下方capability+raw status+具体JSON Pointer。K0为共同kernel+注入ports的拟构造路线，不能凭“可序列化”升级为verified。两侧列只判断指定范围的直接证据。

计数按SCHEMAS对象直接成员；423个必填字段 + 4个`LoopSpec`条件可选字段均有两侧路线、替代代价与审批（嵌套对象引用各类型表）。不声称所有必填字段都有原生对等API。

## 1. 固定证据索引

路径以docs/evofence-harness-kernel为根；JSON Pointer使用RFC6901。每条同时固定raw manifest能力状态和具体检查/条目。kind不设强弱全序：provider-live不推出disk/fault-injection，native-disk不推出provider-live。

| ID | 能力与 raw 状态 | 实际条目 | 证据种类 | 保证范围 |
|---|---|---|---|---|
| D1 | nativeSessionBinding: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/nativeSessionCreated` | native-fixture | 稳定原生 id，controlled plugins；未绑定当前 GUI |
| P1 | nativeSessionBinding: verified | [probes/pi/live-trace.json](../../probes/pi/live-trace.json) `/checks/sameSessionPreserved` | provider-live | 两次真实请求同原生 session；非当前用户 TUI |
| D2 | contextAndResources: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/additiveNodeContext` | native-fixture | host marker/tool 保留，未验证全部 Skills |
| P2 | contextAndResources: verified | [probes/pi/live-trace.json](../../probes/pi/live-trace.json) `/checks/hostToolsAndSkillPreserved` | provider-live | controlled AGENTS/skill/read tool 保留 |
| D3 | toolRequestGate: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/toolGateAndResults` | native-fixture | 允许/拒绝/抛错路径；无 OS 保证 |
| P3 | toolRequestGate: verified | [probes/pi/offline-trace.json](../../probes/pi/offline-trace.json) `/checks/blockedToolNeverExecutes` | native-fixture | fixture 拒绝；live 对应检查为 null |
| D4 | toolResultObservation: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/toolResults` | native-fixture | 原 callId/sessionId/isError；frozen exec |
| P4 | toolRequestGate: verified | [probes/pi/live-trace.json](../../probes/pi/live-trace.json) `/trace/13` | provider-live | tool_result 回调；未证明完整 effectId/fencing 对齐 |
| D5 | usageTokens: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/receipts` | native-fixture | 4 synthetic usage +2 null attempt；非供应商 |
| P5 | usageTokens: verified | [probes/pi/live-trace.json](../../probes/pi/live-trace.json) `/rawRequests` | provider-live | 两份 raw usage 与 receipts 一致；非 invoice |
| D6 | sdkAbort: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/cancelSignalsAndIdle` | native-fixture | stream signal/aborted turn/idle；未测供应商 |
| P6 | sdkAbort: verified | [probes/pi/offline-trace.json](../../probes/pi/offline-trace.json) `/checks/httpAbortDisconnect` | native-fixture | 本地 HTTP fixture 原生 abort/断连；未测供应商账单 |
| D7 | transcriptRecovery: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/nativeResumeWithMemoryPersistence` | native-fixture | memory persistence resume；不是磁盘 |
| P7 | transcriptRecovery: verified | [probes/pi/offline-trace.json](../../probes/pi/offline-trace.json) `/checks/diskRestore` | native-disk | JSONL transcript/custom entry reopen；不是 kernel effect 恢复 |
| D8 | sdkChildSessionIsolation: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/freshChildContextIsolation` | native-fixture | fresh child 独立 id/transcript；child fixture 有请求 |
| P8 | sdkChildSessionIsolation: verified | [probes/pi/offline-trace.json](../../probes/pi/offline-trace.json) `/checks/independentChildSession` | native-fixture | 独立 SDK child，未发 child 付费请求 |
| D9 | projectionOrdering: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/projectionGapRejected` | native-fixture | 原生投影缺 seq 拒绝；非 kernel journal 原子性 |
| P9 | sessionCustomEntries: verified | [probes/pi/offline-trace.json](../../probes/pi/offline-trace.json) `/checks/appendEntry` | native-disk | custom entry reopen；非 kernel journal |
| D10 | teamMessageDelivery: unknown | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/teamMessageDurable` | native-fixture | queued 非 delivered；检查 false |
| D11 | teamAuthorityIdentity: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/sameIdImpostorRejected` | native-fixture | exact-live 同 ID 仿造拒绝；非 kernel grant |
| D12 | nativeTeamGraphBoard: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/teamBoardRestored` | native-fixture | host board 恢复，非 kernel journal |
| P12 | nativeTeamGraphBoard: absent | [probes/pi/HOST-MANIFEST.json](../../probes/pi/HOST-MANIFEST.json) `/capabilities/nativeTeamGraphBoard` | static | 无原生 board parity 假设 |
| D13 | grantWriteScopeEnforcement: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/grantWriteScopeEnforcement` | not-run | advisory writeScopes 不证明强制 grant |
| D14 | reasoningHighGuarantee: unknown | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/reasoningParameterFixture` | native-fixture | 仅 fixture high 参数通过 |
| P14 | reasoningHighGuarantee: partial | [probes/pi/live-trace.json](../../probes/pi/live-trace.json) `/payloads` | provider-live | thinking enabled+high 返回200，独立 high 档位未证 |
| D15 | osSandbox: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/osSandbox` | not-run | OS 未测，不从 hooks/worktree 推断 |
| P15 | osSandbox: absent | [probes/pi/HOST-MANIFEST.json](../../probes/pi/HOST-MANIFEST.json) `/capabilities/osSandbox` | not-run | 未添加/测试 OS sandbox；保持 raw absent 的探针范围 |
| D16 | existingIntegrationCompatibility: unknown | [probes/dsh/VERSION-PIN.json](../../probes/dsh/VERSION-PIN.json) `/integrationGap` | static | 旧 peer/engines 0.1.7-rc.1 与0.2.0-rc.2不符 |
| DV | nativeSessionBinding: verified | [probes/dsh/VERSION-PIN.json](../../probes/dsh/VERSION-PIN.json) `/observedVersion` | static | 当前 version0.2.0-rc.2 已固定；历史 drift 未核实 |
| PV | nativeSessionBinding: verified | [probes/pi/VERSION-PIN.json](../../probes/pi/VERSION-PIN.json) `/version` | static | 固定0.99.2（用户裁决 A）；0.87.1 时代 P1–P17 为历史证据，需按 0.99.2 重验/补差，未重验项保留 unknown；新证据见 `src/hosts/pi/VERSION-DIFFERENCES.md` |
| D17 | settledAndIdle: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/providerFailureIdle` | native-fixture | whenIdle/status，任意 detached plugin 未测 |
| P17 | settledAndIdle: verified | [probes/pi/live-trace.json](../../probes/pi/live-trace.json) `/checks/settledAfterAsyncEnd` | provider-live | awaited agent_end 后 agent_settled |
| D18 | parentChildCancellation: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/parentChildCancellation` | not-run | 未证明父子取消级联 |
| D19 | diskCrashRecovery: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/diskCrashRecovery` | not-run | 未做 disk/crash 注错 |
| D20 | externalEffectReconciliation: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/externalEffectReconciliation` | not-run | 未实现外部 effect reconcile |
| P20 | externalEffectReconciliation: absent | [probes/pi/HOST-MANIFEST.json](../../probes/pi/HOST-MANIFEST.json) `/capabilities/externalEffectReconciliation` | not-run | 需 kernel journal/outbox |
| D21 | costInvoice: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/costInvoice` | not-run | 无账单或实际USD估价 |
| P21 | costInvoice: unknown | [probes/pi/VERSION-PIN.json](../../probes/pi/VERSION-PIN.json) `/price` | static | 有参考价格，不是 invoice |
| D22 | sessionCustomEntries: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/sessionCustomEntries` | not-run | 未测 Pi appendEntry 对应语义 |
| D23 | teamWaitAndInterrupt: partial | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/teamIdleStatusVocabulary` | native-fixture | 只测 inactive interrupt 和 wait signal取消 |
| D24 | skillsPluginCoexistence: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/skillsPluginCoexistence` | not-run | 真实GUI/Skills/全部插件未测 |
| D25 | teamTaskCas: verified | [probes/dsh/offline-trace.json](../../probes/dsh/offline-trace.json) `/checks/teamStaleRevisionRejected` | native-fixture | host board CAS，非 kernel CAS |
| D26 | toolCancellation: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/toolCancellation` | not-run | 长时工具调度取消未测 |
| D27 | providerCancelBilling: unknown | [probes/dsh/HOST-MANIFEST.json](../../probes/dsh/HOST-MANIFEST.json) `/capabilities/providerCancelBilling` | not-run | 供应商取消计费未测 |

```json
{
  "base": "docs/evofence-harness-kernel/",
  "evidence": [
    {
      "id": "D1",
      "capability": "nativeSessionBinding",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/nativeSessionBinding",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/nativeSessionCreated",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "稳定原生 id，controlled plugins；未绑定当前 GUI",
      "check": true
    },
    {
      "id": "P1",
      "capability": "nativeSessionBinding",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/nativeSessionBinding",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/live-trace.json",
      "pointer": "/checks/sameSessionPreserved",
      "sha256": "3ed696eb4983a479b79038aa20499b98c04e25f6d057eb2fe58a7fdbd525006d",
      "kind": "provider-live",
      "scope": "两次真实请求同原生 session；非当前用户 TUI",
      "check": true
    },
    {
      "id": "D2",
      "capability": "contextAndResources",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/contextAndResources",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/additiveNodeContext",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "host marker/tool 保留，未验证全部 Skills",
      "check": true
    },
    {
      "id": "P2",
      "capability": "contextAndResources",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/contextAndResources",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/live-trace.json",
      "pointer": "/checks/hostToolsAndSkillPreserved",
      "sha256": "3ed696eb4983a479b79038aa20499b98c04e25f6d057eb2fe58a7fdbd525006d",
      "kind": "provider-live",
      "scope": "controlled AGENTS/skill/read tool 保留",
      "check": true
    },
    {
      "id": "D3",
      "capability": "toolRequestGate",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/toolRequestGate",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/toolGateAndResults",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "允许/拒绝/抛错路径；无 OS 保证",
      "check": true
    },
    {
      "id": "P3",
      "capability": "toolRequestGate",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/toolRequestGate",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/offline-trace.json",
      "pointer": "/checks/blockedToolNeverExecutes",
      "sha256": "200b687995097b69cea3ed22a60bb8fa28edfecc0295f74c8ead570780bab09f",
      "kind": "native-fixture",
      "scope": "fixture 拒绝；live 对应检查为 null",
      "check": true
    },
    {
      "id": "D4",
      "capability": "toolResultObservation",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/toolResultObservation",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/toolResults",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "原 callId/sessionId/isError；frozen exec"
    },
    {
      "id": "P4",
      "capability": "toolRequestGate",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/toolRequestGate",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/live-trace.json",
      "pointer": "/trace/13",
      "sha256": "3ed696eb4983a479b79038aa20499b98c04e25f6d057eb2fe58a7fdbd525006d",
      "kind": "provider-live",
      "scope": "tool_result 回调；未证明完整 effectId/fencing 对齐"
    },
    {
      "id": "D5",
      "capability": "usageTokens",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/usageTokens",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/receipts",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "4 synthetic usage +2 null attempt；非供应商"
    },
    {
      "id": "P5",
      "capability": "usageTokens",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/usageTokens",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/live-trace.json",
      "pointer": "/rawRequests",
      "sha256": "3ed696eb4983a479b79038aa20499b98c04e25f6d057eb2fe58a7fdbd525006d",
      "kind": "provider-live",
      "scope": "两份 raw usage 与 receipts 一致；非 invoice"
    },
    {
      "id": "D6",
      "capability": "sdkAbort",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/sdkAbort",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/cancelSignalsAndIdle",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "stream signal/aborted turn/idle；未测供应商",
      "check": true
    },
    {
      "id": "P6",
      "capability": "sdkAbort",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/sdkAbort",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/offline-trace.json",
      "pointer": "/checks/httpAbortDisconnect",
      "sha256": "200b687995097b69cea3ed22a60bb8fa28edfecc0295f74c8ead570780bab09f",
      "kind": "native-fixture",
      "scope": "本地 HTTP fixture 原生 abort/断连；未测供应商账单",
      "check": true
    },
    {
      "id": "D7",
      "capability": "transcriptRecovery",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/transcriptRecovery",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/nativeResumeWithMemoryPersistence",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "memory persistence resume；不是磁盘",
      "check": true
    },
    {
      "id": "P7",
      "capability": "transcriptRecovery",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/transcriptRecovery",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/offline-trace.json",
      "pointer": "/checks/diskRestore",
      "sha256": "200b687995097b69cea3ed22a60bb8fa28edfecc0295f74c8ead570780bab09f",
      "kind": "native-disk",
      "scope": "JSONL transcript/custom entry reopen；不是 kernel effect 恢复",
      "check": true
    },
    {
      "id": "D8",
      "capability": "sdkChildSessionIsolation",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/sdkChildSessionIsolation",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/freshChildContextIsolation",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "fresh child 独立 id/transcript；child fixture 有请求",
      "check": true
    },
    {
      "id": "P8",
      "capability": "sdkChildSessionIsolation",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/sdkChildSessionIsolation",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/offline-trace.json",
      "pointer": "/checks/independentChildSession",
      "sha256": "200b687995097b69cea3ed22a60bb8fa28edfecc0295f74c8ead570780bab09f",
      "kind": "native-fixture",
      "scope": "独立 SDK child，未发 child 付费请求",
      "check": true
    },
    {
      "id": "D9",
      "capability": "projectionOrdering",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/projectionOrdering",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/projectionGapRejected",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "原生投影缺 seq 拒绝；非 kernel journal 原子性",
      "check": true
    },
    {
      "id": "P9",
      "capability": "sessionCustomEntries",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/sessionCustomEntries",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/offline-trace.json",
      "pointer": "/checks/appendEntry",
      "sha256": "200b687995097b69cea3ed22a60bb8fa28edfecc0295f74c8ead570780bab09f",
      "kind": "native-disk",
      "scope": "custom entry reopen；非 kernel journal",
      "check": true
    },
    {
      "id": "D10",
      "capability": "teamMessageDelivery",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/teamMessageDelivery",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/teamMessageDurable",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "queued 非 delivered；检查 false"
    },
    {
      "id": "D11",
      "capability": "teamAuthorityIdentity",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/teamAuthorityIdentity",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/sameIdImpostorRejected",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "exact-live 同 ID 仿造拒绝；非 kernel grant",
      "check": true
    },
    {
      "id": "D12",
      "capability": "nativeTeamGraphBoard",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/nativeTeamGraphBoard",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/teamBoardRestored",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "host board 恢复，非 kernel journal",
      "check": true
    },
    {
      "id": "P12",
      "capability": "nativeTeamGraphBoard",
      "status": "absent",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/nativeTeamGraphBoard",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "pointer": "/capabilities/nativeTeamGraphBoard",
      "sha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "kind": "static",
      "scope": "无原生 board parity 假设"
    },
    {
      "id": "D13",
      "capability": "grantWriteScopeEnforcement",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/grantWriteScopeEnforcement",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/grantWriteScopeEnforcement",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "advisory writeScopes 不证明强制 grant"
    },
    {
      "id": "D14",
      "capability": "reasoningHighGuarantee",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/reasoningHighGuarantee",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/reasoningParameterFixture",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "仅 fixture high 参数通过",
      "check": true
    },
    {
      "id": "P14",
      "capability": "reasoningHighGuarantee",
      "status": "partial",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/reasoningHighGuarantee",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/live-trace.json",
      "pointer": "/payloads",
      "sha256": "3ed696eb4983a479b79038aa20499b98c04e25f6d057eb2fe58a7fdbd525006d",
      "kind": "provider-live",
      "scope": "thinking enabled+high 返回200，独立 high 档位未证"
    },
    {
      "id": "D15",
      "capability": "osSandbox",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/osSandbox",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/osSandbox",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "OS 未测，不从 hooks/worktree 推断"
    },
    {
      "id": "P15",
      "capability": "osSandbox",
      "status": "absent",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/osSandbox",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "pointer": "/capabilities/osSandbox",
      "sha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "kind": "not-run",
      "scope": "未添加/测试 OS sandbox；保持 raw absent 的探针范围"
    },
    {
      "id": "D16",
      "capability": "existingIntegrationCompatibility",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/existingIntegrationCompatibility",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/VERSION-PIN.json",
      "pointer": "/integrationGap",
      "sha256": "8a1074518d6adfd939c2ab610d4855dac3d0cf45b6fb2518aafdd63b42bb3dbe",
      "kind": "static",
      "scope": "旧 peer/engines 0.1.7-rc.1 与0.2.0-rc.2不符"
    },
    {
      "id": "DV",
      "capability": "nativeSessionBinding",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/nativeSessionBinding",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/VERSION-PIN.json",
      "pointer": "/observedVersion",
      "sha256": "8a1074518d6adfd939c2ab610d4855dac3d0cf45b6fb2518aafdd63b42bb3dbe",
      "kind": "static",
      "scope": "当前 version0.2.0-rc.2 已固定；历史 drift 未核实"
    },
    {
      "id": "PV",
      "capability": "nativeSessionBinding",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/nativeSessionBinding",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json",
      "pointer": "/version",
      "sha256": "38c21638b9df54ae50a6d87b11705ae6cde8f24a79285a795f5d38c3f0c9c736",
      "kind": "static",
      "scope": "固定0.87.1"
    },
    {
      "id": "D17",
      "capability": "settledAndIdle",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/settledAndIdle",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/providerFailureIdle",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "whenIdle/status，任意 detached plugin 未测",
      "check": true
    },
    {
      "id": "P17",
      "capability": "settledAndIdle",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/settledAndIdle",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/live-trace.json",
      "pointer": "/checks/settledAfterAsyncEnd",
      "sha256": "3ed696eb4983a479b79038aa20499b98c04e25f6d057eb2fe58a7fdbd525006d",
      "kind": "provider-live",
      "scope": "awaited agent_end 后 agent_settled",
      "check": true
    },
    {
      "id": "D18",
      "capability": "parentChildCancellation",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/parentChildCancellation",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/parentChildCancellation",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "未证明父子取消级联"
    },
    {
      "id": "D19",
      "capability": "diskCrashRecovery",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/diskCrashRecovery",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/diskCrashRecovery",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "未做 disk/crash 注错"
    },
    {
      "id": "D20",
      "capability": "externalEffectReconciliation",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/externalEffectReconciliation",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/externalEffectReconciliation",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "未实现外部 effect reconcile"
    },
    {
      "id": "P20",
      "capability": "externalEffectReconciliation",
      "status": "absent",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/externalEffectReconciliation",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "pointer": "/capabilities/externalEffectReconciliation",
      "sha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "kind": "not-run",
      "scope": "需 kernel journal/outbox"
    },
    {
      "id": "D21",
      "capability": "costInvoice",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/costInvoice",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/costInvoice",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "无账单或实际USD估价"
    },
    {
      "id": "P21",
      "capability": "costInvoice",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/costInvoice",
      "manifestSha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "file": "docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json",
      "pointer": "/price",
      "sha256": "38c21638b9df54ae50a6d87b11705ae6cde8f24a79285a795f5d38c3f0c9c736",
      "kind": "static",
      "scope": "有参考价格，不是 invoice"
    },
    {
      "id": "D22",
      "capability": "sessionCustomEntries",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/sessionCustomEntries",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/sessionCustomEntries",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "未测 Pi appendEntry 对应语义"
    },
    {
      "id": "D23",
      "capability": "teamWaitAndInterrupt",
      "status": "partial",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/teamWaitAndInterrupt",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/teamIdleStatusVocabulary",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "只测 inactive interrupt 和 wait signal取消",
      "check": true
    },
    {
      "id": "D24",
      "capability": "skillsPluginCoexistence",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/skillsPluginCoexistence",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/skillsPluginCoexistence",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "真实GUI/Skills/全部插件未测"
    },
    {
      "id": "D25",
      "capability": "teamTaskCas",
      "status": "verified",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/teamTaskCas",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "pointer": "/checks/teamStaleRevisionRejected",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "kind": "native-fixture",
      "scope": "host board CAS，非 kernel CAS",
      "check": true
    },
    {
      "id": "D26",
      "capability": "toolCancellation",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/toolCancellation",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/toolCancellation",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "长时工具调度取消未测"
    },
    {
      "id": "D27",
      "capability": "providerCancelBilling",
      "status": "unknown",
      "manifestFile": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "manifestPointer": "/capabilities/providerCancelBilling",
      "manifestSha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "pointer": "/capabilities/providerCancelBilling",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "kind": "not-run",
      "scope": "供应商取消计费未测"
    }
  ]
}
```

## 2. 每字段映射

Hxx指OPEN-ITEMS。H01批准共同合同及待实现边界，不是批准未知能力为verified。默认K0保留宿主loop/tools/权限根，由独立journal构造内核字段；代价是L2/3实现和双宿主conformance。模型/可靠消息/OS等特有缺口另列审批，不凭品牌自动降级。

字段分两类：**kernel 自有协议元数据**（TaskContract/GraphSpec/NodeSpec/EdgeSpec/Binding/PrivacyPolicy/LoopSpec/GraphLimits/ResourcePolicy/Resources/ProtocolVersion/SchemaRef/ContractRef/GraphRef/Predicate/AbandonedBranch/OutcomeRequirement 等）由 kernel 直接构造、host 只透传，统一用 K0 路线；**宿主执行边界**（Effect/EffectPayload/Receipt/Usage/Command/Event/HostManifest）带宿主行为义务，逐字段给出 kernel→两侧 adapter 的落地方式，不复用同一句 K0。

### ProtocolVersion

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `namespace` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `schemaVersion` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### SchemaRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `name` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `version` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `digest` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### ContractRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `taskId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `version` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `digest` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### GraphRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `graphId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `revision` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `digest` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### ActorRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `actorId` | 是 | partial；exact-live 原生身份 D11；kernel/人审身份未实现 | unknown；P1 只证 session 身份，未证等价权限根 | unknown（权限根合同） | K0 PermissionPort 真身份+批准引用，不以字符串sessionId代替授权 | H01/H07 |
| `kind` | 是 | partial；exact-live 原生身份 D11；kernel/人审身份未实现 | unknown；P1 只证 session 身份，未证等价权限根 | unknown（权限根合同） | K0 PermissionPort 真身份+批准引用，不以字符串sessionId代替授权 | H01/H07 |
| `identityRef` | 是 | partial；exact-live 原生身份 D11；kernel/人审身份未实现 | unknown；P1 只证 session 身份，未证等价权限根 | unknown（权限根合同） | K0 PermissionPort 真身份+批准引用，不以字符串sessionId代替授权 | H01/H07 |

### Binding

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `sessionId` | 是 | unknown；kernelSession↔nativeSession 不可变关联表；D1 | unknown；同一关联表；P1 | unknown（关联未实现） | K0：adapter 绑定表+epoch 检查；代价禁止无上下文 CLI | H01 |
| `hostSessionId` | 是 | native-scoped；agent.id/session.id；D1 | native-scoped；trace.sessionId；P1 | yes-scoped（原生 id） | 保留独立 kernelSessionId，不能混成一个 revision/epoch | 无需新增批准；新绑定实现属 H01 |
| `graph` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `nodeId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `attemptId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `attemptOrdinal` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `epoch` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `baseDigest` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### Scope

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `workspaceRef` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `readResources` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `writeResources` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `artifactScopes` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `trustDomain` | 是 | unknown；D15明确未知 | absent（探针组合）；P15未加/测OS sandbox | no（OS 保证） | A-trust：仅批准same-user；或外部WorkspacePort沙箱并有fault-injection证据；hooks/worktree不可替代 | H06 |

### Grant

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `grantId` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `rootAuthorityRef` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `parentGrantRef` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `actor` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `sessionId` | 是 | unknown；kernelSession↔nativeSession 不可变关联表；D1 | unknown；同一关联表；P1 | unknown（关联未实现） | K0：adapter 绑定表+epoch 检查；代价禁止无上下文 CLI | H01 |
| `nodeIds` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `scope` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `capabilities` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `maxDelegationDepth` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `expiresAt` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `revocationEpoch` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |
| `approvalRef` | 是 | unknown；advisory scopes；D13 | unknown；P3仅请求gate，未证 grant继承 | unknown | K0 root∩parent∩task∩node 强制检查；代价工具内部效果不能假定受控 | H01/H06/H07 |

### BudgetPolicy

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `poolId` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `category` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `authorizationRef` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `maxRequests` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `maxInputTokens` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `maxOutputTokens` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `maxUsdMicros` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `maxWallMs` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `maxConcurrentRequests` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `priceRef` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `missingUsagePolicy` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |

### PrivacyPolicy

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `visibility` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `feedbackVisibility` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `privateTests` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `finalFeedback` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `secretPolicy` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### TerminationPolicy

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `maxAttempts` | 是 | partial；stream取消D6，tool取消D26 unknown，child级联D18 unknown，D23仅停成员 | partial；P6仅本地HTTP流取消，children/tools协同未证 | unknown（完整取消） | K0 广播cancel+每target确认+lease release；缺确认unknown；代价等待/保留额度 | H01/H03/H07 |
| `maxActiveWallMs` | 是 | partial；stream取消D6，tool取消D26 unknown，child级联D18 unknown，D23仅停成员 | partial；P6仅本地HTTP流取消，children/tools协同未证 | unknown（完整取消） | K0 广播cancel+每target确认+lease release；缺确认unknown；代价等待/保留额度 | H01/H03/H07 |
| `cancelMode` | 是 | partial；stream取消D6，tool取消D26 unknown，child级联D18 unknown，D23仅停成员 | partial；P6仅本地HTTP流取消，children/tools协同未证 | unknown（完整取消） | K0 广播cancel+每target确认+lease release；缺确认unknown；代价等待/保留额度 | H01/H03/H07 |
| `unknownPolicy` | 是 | partial；stream取消D6，tool取消D26 unknown，child级联D18 unknown，D23仅停成员 | partial；P6仅本地HTTP流取消，children/tools协同未证 | unknown（完整取消） | K0 广播cancel+每target确认+lease release；缺确认unknown；代价等待/保留额度 | H01/H03/H07 |
| `excludeHumanWait` | 是 | partial；stream取消D6，tool取消D26 unknown，child级联D18 unknown，D23仅停成员 | partial；P6仅本地HTTP流取消，children/tools协同未证 | unknown（完整取消） | K0 广播cancel+每target确认+lease release；缺确认unknown；代价等待/保留额度 | H01/H03/H07 |

### AcceptancePolicy

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `evaluatorId` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `evaluatorVersion` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `protocolRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `checkRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `requiredBranchPolicy` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `outcomeSchema` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `baselineRequired` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |

### OutcomeRequirement

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `outcomeId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `description` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `schema` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `evidenceKinds` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### GuaranteeRequirement

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `capability` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `mode` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `evidenceKinds` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `coverage` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `alternativeIds` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |

### DegradationOption

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `alternativeId` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `replacesCapability` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `requirements` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `tradeoff` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `approvalRef` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |

### TaskContract

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `taskId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `version` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `goal` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `requiredOutcomes` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `requiredBranches` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `acceptance` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `scope` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `authorityGrant` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `budget` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `privacy` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `termination` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `requiredGuarantees` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `degradations` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### ResourcePolicy

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `resourceId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `mode` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxHolders` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### Resources

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `exclusive` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `shared` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### GraphLimits

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `maxNodes` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxConcurrentAgents` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxDepth` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxAttempts` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### LoopSpec

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `bodyNodeIds` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxIterations` | 条件/可省略 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxWallClock` | 条件/可省略 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxTokensOrCost` | 条件/可省略 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxDepth` | 条件/可省略 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `stop` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `carry` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### BudgetBound

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `tokens` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |
| `usdMicros` | 是 | unknown；D5有native synthetic与隐式feedback，无生产共享账 | unknown；P5有provider usage，未交付kernel共享预算 | unknown | K0 一次请求一预留、父子同池、失败unknown保留；代价全隐式请求拦截/价格冻结 | H01/H03/H08/H11 |

### ContextPlan

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `inputRefs` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxTokens` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `preserveHostResources` | 是 | native-scoped；pre-step additive，markers/tool；D2 | native-scoped；context hook，AGENTS/skill/tool；P2 | yes-scoped（controlled 资源） | 真实用户全部 Skills/插件另需取证；代价 coexistence suite | H03 若 task 要真实共存 |
| `isolation` | 是 | native-scoped；fresh teammate 独立 transcript；D8 | native-scoped；独立 SDK child；P8 | yes-scoped（fresh transcript） | 父子 grant/预算/取消仍 K0，不能当 OS 隔离 | H01/H07 |

### ModelRequirement

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `providerModel` | 是 | unknown；raw model/providerModel null；D14/DV | native-scoped；P5+PV Xiaomi/MiMo真实模型 | no（DSH live模型未选/未测） | DSH manifest.model=null；task需provider-live时unsupported或追加取证 | H03/H08 |
| `reasoningRequested` | 是 | partial；D14仅fixture high参数；独立档位unknown | partial；P14 high payload接受，独立档位未证 | no（server-tier 保证） | A-thinking：经批准只要求payload一致；不能把批准写成server-tier verified | H04 |
| `reasoningGuarantee` | 是 | partial；D14仅fixture high参数；独立档位unknown | partial；P14 high payload接受，独立档位未证 | no（server-tier 保证） | A-thinking：经批准只要求payload一致；不能把批准写成server-tier verified | H04 |
| `payloadRef` | 是 | partial；D14仅fixture high参数；独立档位unknown | partial；P14 high payload接受，独立档位未证 | no（server-tier 保证） | A-thinking：经批准只要求payload一致；不能把批准写成server-tier verified | H04 |

### NodeSpec

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `nodeId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `kind` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `inputRefs` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `outputSchemas` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `loop` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `subgraph` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `contextPlan` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `toolRequirements` | 是 | partial；pre-execute/result 支持，kernel effect/grant 未实现；D3/D4 | partial；tool_call/tool_result支持，kernel binding 未实现；P3/P4 | unknown（完整执行合同） | K0 sidecar binding+request gate+receipt，代价 L3工具关联和误拒检查 | H01/H06 |
| `modelRequirements` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `resources` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `termination` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `terminal` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `requiredBranches` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### Predicate

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `op` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `path` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `value` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `children` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### EdgeSpec

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `edgeId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `type` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `from` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `to` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `when` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `artifact` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `expect` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `maxAttempts` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `relation` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### AbandonedBranch

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `nodeId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `authorityRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `reason` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `at` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### GraphSpec

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `graphId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `revision` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `taskContractRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `nodes` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `typedEdges` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `requiredJoins` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `resourcePolicy` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `graphLimits` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `abandonedBranches` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### GraphPatch

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `graphId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `expectedRevision` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `adds` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `changes` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `removals` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `typedEdges` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `abandonedBranches` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `reason` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `authorityRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### Command

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；kernel 协议封套；D1/D9 seam | unknown；kernel 协议封套；P1/P9 seam | unknown（非 native 字段） | K0 kernel 生成，adapter 原样透传；代价 L2 | H01 |
| `commandId` | 是 | unknown；journal 分配；D1/D9 seam | unknown；journal 分配；P1/P9 seam | unknown（非 native 字段） | K0 journal 分配并去重；代价 L2 | H01 |
| `sessionId` | 是 | unknown；kernelSession↔native 关联表；D1 | unknown；同一关联表；P1 | unknown（关联未实现） | K0 adapter 绑定表 + epoch 检查；禁止无上下文 CLI；代价 L2 | H01 |
| `expectedRevision` | 是 | unknown；host 无原生 revision；D1/D9 seam | unknown；host 无原生 revision；P1/P9 seam | unknown（非 native 字段） | K0 kernel CAS：adapter 派发前核对 expectedRevision，不匹配即拒发（不重试、不降级）；host 只做传输；代价 L2 | H01 |
| `actor` | 是 | unknown；D11 exact-live 身份 | unknown；P1 session 身份 | unknown（权限根） | K0 由 PermissionPort 解析真身份，不以字符串 sessionId 代替授权；代价 L3 权限根对账 | H01/H07 |
| `grantRef` | 是 | unknown；advisory scopes D13 | unknown；P3 仅请求 gate，未证 grant 继承 | unknown | K0 adapter 携带 grant 引用并交 host 权限根校验；未授权即拒；代价 L3 | H01/H06/H07 |
| `payload` | 是 | unknown；kernel typed payload；D1/D9 seam | unknown；kernel typed payload；P1/P9 seam | unknown（非 native 字段） | K0 kernel 编码，adapter 不透明传递不重解释；代价 L2 | H01 |

### CommandPayload

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `kind` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `task` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `graph` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `patch` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `binding` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `objectRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `manifestRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `reason` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### Event

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；kernel 协议封套；D1/D9 seam | unknown；kernel 协议封套；P1/P9 seam | unknown（非 native 字段） | K0 kernel 生成；代价 L2 | H01 |
| `eventId` | 是 | unknown；journal 分配；D1/D9 seam | unknown；journal 分配；P1/P9 seam | unknown（非 native 字段） | K0 journal 分配；代价 L2 | H01 |
| `sequence` | 是 | partial；D9 native seq/project，kernel journal 未实现 | unknown；P9 custom entry≠kernel 全序 | unknown（journal 全序） | K0 独立连续 sequence/CAS；缺口拒绝恢复，不用 host 投影冒充 journal；代价注错验证 | H01 |
| `sessionId` | 是 | unknown；kernelSession↔native 关联表；D1 | unknown；同一关联表；P1 | unknown（关联未实现） | K0 adapter 绑定表 + epoch 检查；代价 L2 | H01 |
| `revision` | 是 | unknown；journal 分配；D1/D9 seam | unknown；journal 分配；P1/P9 seam | unknown（非 native 字段） | K0 journal 分配 graph revision；代价 L2 | H01 |
| `epoch` | 是 | unknown；journal 分配；D1/D9 seam | unknown；journal 分配；P1/P9 seam | unknown（非 native 字段） | K0 journal 分配 session epoch，resume 递增；迟到回包按 epoch 归档；代价 L3 恢复核验 | H01 |
| `causedBy` | 是 | unknown；journal 因果链；D1/D9 seam | unknown；journal 因果链；P1/P9 seam | unknown（非 native 字段） | K0 journal 记录 command/effect 因果；代价 L2 | H01 |
| `type` | 是 | unknown；adapter 把 host 原生事件映射为 typed Event；D3/D4/D17 | unknown；adapter 把 host 原生事件映射为 typed Event；P3/P4/P17 | unknown（非 native 字段） | K0 由 adapter 从 host 事件（DSH D3/D4/D17、Pi P3/P4/P17）翻译为列内 type；未映射即 unknown，不猜；代价 L3 事件覆盖核验 | H01 |
| `payload` | 是 | unknown；kernel typed payload；D1/D9 seam | unknown；kernel typed payload；P1/P9 seam | unknown（非 native 字段） | K0 kernel 生成，adapter 透传；代价 L2 | H01 |
| `visibility` | 是 | unknown；kernel 合同字段；D1/D9 seam | unknown；kernel 合同字段；P1/P9 seam | unknown（非 native 字段） | K0 kernel 按 PrivacyPolicy 决定可见性；私有测试内容不回传；代价 L2 | H01 |

### EventPayload

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `binding` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `objectRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `before` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `after` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `effectId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `decisionId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `changedIds` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `error` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### LeaseRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `resourceId` | 是 | unknown；D25 hostCAS≠lease/fencing | unknown；P12 board absent，未有kernel leases | unknown | K0 EventStore原子claim/leases/outbox；代价注错验证，不用hostboard作第二owner | H01/H07 |
| `ownerClaimId` | 是 | unknown；D25 hostCAS≠lease/fencing | unknown；P12 board absent，未有kernel leases | unknown | K0 EventStore原子claim/leases/outbox；代价注错验证，不用hostboard作第二owner | H01/H07 |
| `epoch` | 是 | unknown；D25 hostCAS≠lease/fencing | unknown；P12 board absent，未有kernel leases | unknown | K0 EventStore原子claim/leases/outbox；代价注错验证，不用hostboard作第二owner | H01/H07 |
| `fencingToken` | 是 | unknown；D25 hostCAS≠lease/fencing | unknown；P12 board absent，未有kernel leases | unknown | K0 EventStore原子claim/leases/outbox；代价注错验证，不用hostboard作第二owner | H01/H07 |
| `expiresAt` | 是 | unknown；D25 hostCAS≠lease/fencing | unknown；P12 board absent，未有kernel leases | unknown | K0 EventStore原子claim/leases/outbox；代价注错验证，不用hostboard作第二owner | H01/H07 |

### Effect

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；kernel 协议封套；D1/D9 提供绑定/投影 seam | unknown；kernel 协议封套；P1/P9 提供绑定/custom entry seam | unknown（非 native 字段） | K0 kernel 生成封套，adapter 原样透传不重解释；代价 L2 实现 | H01 |
| `effectId` | 是 | unknown；journal 分配；D4 的 toolResults.callId 可关联 | unknown；journal 分配；P4 tool_result 可关联 | unknown（关联未证） | K0 journal 分配 effectId；adapter 建 effectId↔host invocation 绑定表，缺失即 unknown。DSH 走 D3/D4、Pi 走 P3/P4；代价 L3 回执关联 | H01 |
| `idempotencyKey` | 是 | unknown；host 无原生字段；D3/D4 可附带 sidecar | unknown；host 无原生字段；P3/P4 可附带 sidecar | unknown（非 native 字段） | K0 由 effectId+epoch+输入摘要派生稳定 key；adapter 必须把它附在外发调用上并在 receipt 回显，重复 key 由 kernel 去重、未回显按 unknown reconcile；代价 adapter sidecar + 故障注错 | H01 |
| `binding` | 是 | unknown；kernelSession↔native 关联表；D1 | unknown；同一关联表；P1 | unknown（关联未实现） | K0 adapter 绑定表 + epoch 检查；禁止用裸 sessionId 代替 binding；代价禁无上下文 CLI | H01 |
| `authorityRef` | 是 | unknown；D11 exact-live 身份≠kernel grant | unknown；P1 session 身份≠等价权限根 | unknown（权限根） | K0 派发前由 adapter 用 host 权限根核对 grant；DSH seam D11、Pi seam P1；不匹配即拒发；代价 L3 权限根对账 | H01/H07 |
| `reservationRef` | 是 | unknown；D5 有隐式 usage，无共享预留 | unknown；P5 有 provider usage，未接 kernel 预算 | unknown（共享账未实现） | K0 派发前在共享池预留；adapter 不得越过 reservation 外发；缺 usage 保留预留不回收；代价全隐式请求拦截 | H01/H03/H08 |
| `leases` | 是 | unknown；D25 host CAS≠kernel lease/fencing | unknown；P12 无原生 board，未有 kernel leases | unknown（lease 未实现） | K0 EventStore 原子 claim/lease/fencing；host board 仅投影，不作第二 owner；代价注错验证 | H01/H07 |
| `inputRefs` | 是 | unknown；kernel artifact refs；D1/D9 seam | unknown；kernel artifact refs；P1/P9 seam | unknown（非 native 字段） | K0 由 kernel 解析 ArtifactRef 并注入 host 上下文；digest 不符即拒（不静默降级）；代价 L3 注入核验 | H01 |
| `deadline` | 是 | partial；stream 取消 D6，child 级联 D18 未证 | partial；P6 仅本地 HTTP 流取消 | unknown（完整取消） | K0 派发时下发 deadline；adapter 到点触发 abort（DSH D6/Pi P6）并回 receipt；未回确认按 unknown；代价等待/保留额度 | H01/H03/H07 |
| `kind` | 是 | unknown；D2/D3 提供 model/tool 路由原语 | unknown；P2/P3/P8 提供 context/tool/child 原语 | unknown（dispatch 合同） | K0 按 kind 选择 host 原语（model/tool/child/human）；DSH 走 D2/D3/D8、Pi 走 P2/P3/P8；host 不自行改路由；代价 L3 映射核验 | H01/H07 |
| `payload` | 是 | unknown；kernel typed payload；D1/D9 seam | unknown；kernel typed payload；P1/P9 seam | unknown（非 native 字段） | K0 kernel 编码，adapter 不透明传递不重解释；代价 L2 实现 | H01 |

### EffectPayload

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `context` | 是 | partial；pre-step additive markers/tool；D2 | native-scoped；context hook AGENTS/skill/tool；P2 | unknown（完整 context 合同） | K0 kernel 组装节点 context packet，adapter 在 host 安全点注入并保留原 instructions；DSH D2/Pi P2；代价 L3 注入核验 | H01 |
| `toolName` | 是 | partial；pre-execute/result 支持，kernel effect/grant 未实现；D3/D4 | partial；tool_call/tool_result 支持，kernel binding 未实现；P3/P4 | unknown（完整执行合同） | K0 sidecar binding + request gate + receipt；adapter 用 host 原生 gate 拦未授权 tool；代价 L3 工具关联和误拒检查 | H01/H06 |
| `argumentsRef` | 是 | unknown；kernel artifact ref；D1/D9 seam | unknown；kernel artifact ref；P1/P9 seam | unknown（非 native 字段） | K0 kernel 解析 ArtifactRef 为 host tool 参数；digest 不符即拒发；代价 L3 关联 | H01 |
| `graphRef` | 是 | unknown；kernel 图快照 ref；D1/D9 seam | unknown；kernel 图快照 ref；P1/P9 seam | unknown（非 native 字段） | K0 kernel 内部引用，adapter 只透传不消费；代价 L2 | H01 |
| `targetIds` | 是 | partial；stream 取消 D6，child 级联 D18 unknown，D23 仅停成员 | partial；P6 仅本地 HTTP 流取消，children/tools 协同未证 | unknown（完整取消） | K0 广播 cancel + 每 target 确认 + lease release；缺确认 unknown；代价等待/保留额度 | H01/H03/H07 |
| `assetRef` | 是 | unknown；kernel 资产 ref；D17 idle 不证明激活，D22 custom entries 未测 | unknown；kernel 资产 ref；P17 idle/P9 entry 不证明激活 | unknown | K0 immutable registry + scoped staged asset + 安全点 snapshot receipt；adapter 只在 host 安全点注入；代价 L3 演化/回滚 | H01/H10 |
| `previousSnapshot` | 是 | unknown；kernel snapshot ref；D19 disk/crash 未证 | unknown；kernel snapshot ref；P7 JSONL reopen 不证明 snapshot 回滚 | unknown | K0 kernel 记录激活前快照并支持回退；host 侧只按引用恢复；代价 L3 回滚注错 | H01/H09 |
| `deliveryGuarantee` | 是 | unknown；D10 false，queued≠target ack | unknown；P12 没有原生可靠 team channel 证据 | unknown | A-message：共同 journal/outbox + ArtifactStore 拉取 + target 消费 ack；代价 I/O/延迟；未实现 | H05 |

### Usage

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `requestId` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `source` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `inputUncached` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `cacheRead` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `cacheWrite` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `output` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `reasoning` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `total` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `estimatedUsdMicros` | 是 | unknown；D21无供应商/price证据 | partial；P21参考价格+P5用量估价，非invoice | no（成本来源） | USD估价与invoice分开；缺价格保留预留，不继承Pi价格到DSH provider | H03/H08/H11 |
| `invoiceUsdMicros` | 是 | unknown；D21；取消计费 D27 unknown | unknown；P21 | unknown | null保留账单未知；若 task 要 invoice 或要“取消不重复计费”则 unsupported；代价外部账单取证 | H03 |
| `complete` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `evidenceRefs` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |

### Receipt

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；kernel 协议封套；D1/D9 seam | unknown；kernel 协议封套；P1/P9 seam | unknown（非 native 字段） | K0 kernel 生成，adapter 原样透传；代价 L2 | H01 |
| `receiptId` | 是 | unknown；journal 分配；D1/D9 seam | unknown；journal 分配；P1/P9 seam | unknown（非 native 字段） | K0 journal 分配；代价 L2 | H01 |
| `effectId` | 是 | unknown；journal 分配；D4 toolResults 可关联 | unknown；journal 分配；P4 tool_result 可关联 | unknown（关联未证） | K0 kernel 生成，adapter 必须回显同一 effectId；无法回显按 unknown reconcile；代价 L3 关联 | H01 |
| `hostInvocationId` | 是 | unknown；D4 有 tool.callId，agent 真实 provider 调用关联未证 | partial；P5 rawRequests.id，完整 effectId/epoch 关联未证 | unknown | K0 adapter 记录 host 原生 invocation id（DSH D4 callId、Pi P4/P5 id）并写入绑定表；未回填即 unknown，不合成；代价 L3 回执关联 | H01/H03 |
| `binding` | 是 | unknown；kernelSession↔native 关联表；D1 | unknown；同一关联表；P1 | unknown（关联未实现） | K0 adapter 绑定表 + epoch 检查；代价 L2 | H01 |
| `status` | 是 | partial；D4 工具结果/D10 送达未确认 | partial；P4 工具结果，外部 exactly-once 未证 | unknown（完整 effect outcome） | K0 只接受 host actual receipt；缺回执走 unknown→reconcile，不以 worker summary/缺省填成功；代价 L3 恢复核验 | H01/H05 |
| `artifactRefs` | 是 | unknown；D4 toolResults 提供原始产物引用 | unknown；P4 tool_result 提供产物引用 | unknown（非 native 字段） | K0 adapter 从 host 结果抽取产物并按 digest 绑定；missing digest 不构造 verified；代价 L3 产物对账 | H01 |
| `usage` | 是 | unknown；D5 synthetic，失败/取消 null | native-scoped；P5 provider usage 与 receipts 相符 | unknown（provider 证据不对等） | K0 adapter 附上 D5/P5 usage；失败/取消缺失即 null + complete=false 并保留预留；不把 null 归零、不借用 Pi 账单；代价 L3 usage 完整性 | H01/H03/H08 |
| `observability` | 是 | partial；D4 工具结果/D10 送达未确认 | partial；P4 工具结果，外部 exactly-once 未证 | unknown（完整 effect outcome） | K0 记录 host 可观测等级；不可观测即显式 unknown，不推断成功；代价 L2/L3 | H01/H05 |
| `error` | 是 | unknown；D4 denied/thrown 结果可映射 | unknown；P4 denied/thrown 结果可映射 | unknown（非 native 字段） | K0 adapter 映射 host 错误为 typed error envelope；不吞错、不降级为成功；代价 L3 错误映射 | H01 |

### ArtifactRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `id` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `digest` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `producer` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `binding` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `schema` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `location` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `visibility` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `expiresAt` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `partition` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### EvidenceRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `file` | 是 | native-scoped；固定probe文件/具体pointer/hash；DV | native-scoped；固定probe文件/具体pointer/hash；PV | yes-scoped（证据引用） | namespace格式sha256:由确定性封装；不存在项不构造verified | H01 仅新封装 |
| `pointer` | 是 | native-scoped；固定probe文件/具体pointer/hash；DV | native-scoped；固定probe文件/具体pointer/hash；PV | yes-scoped（证据引用） | namespace格式sha256:由确定性封装；不存在项不构造verified | H01 仅新封装 |
| `sha256` | 是 | native-scoped；固定probe文件/具体pointer/hash；DV | native-scoped；固定probe文件/具体pointer/hash；PV | yes-scoped（证据引用） | namespace格式sha256:由确定性封装；不存在项不构造verified | H01 仅新封装 |
| `kind` | 是 | native-scoped；固定probe文件/具体pointer/hash；DV | native-scoped；固定probe文件/具体pointer/hash；PV | yes-scoped（证据引用） | namespace格式sha256:由确定性封装；不存在项不构造verified | H01 仅新封装 |
| `claim` | 是 | native-scoped；固定probe文件/具体pointer/hash；DV | native-scoped；固定probe文件/具体pointer/hash；PV | yes-scoped（证据引用） | namespace格式sha256:由确定性封装；不存在项不构造verified | H01 仅新封装 |

### CapabilityScope

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `operations` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `coverage` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `hostVersion` | 是 | native-scoped；VERSION-PIN observedVersion；DV | native-scoped；VERSION-PIN version；PV | yes-scoped（版本元数据） | 固定真实版本；hash 漂移重新准入 | H02 涉及旧 integration 的选项 |
| `providerModel` | 是 | unknown；raw model/providerModel null；D14/DV | native-scoped；P5+PV Xiaomi/MiMo真实模型 | no（DSH live模型未选/未测） | DSH manifest.model=null；task需provider-live时unsupported或追加取证 | H03/H08 |
| `trustDomain` | 是 | unknown；D15明确未知 | absent（探针组合）；P15未加/测OS sandbox | no（OS 保证） | A-trust：仅批准same-user；或外部WorkspacePort沙箱并有fault-injection证据；hooks/worktree不可替代 | H06 |

### CapabilityObservation

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `status` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `evidenceRefs` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `scope` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `verifiedSubset` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `limitations` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |

### GuaranteeStrength

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `status` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `coverage` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `evidenceRefs` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |

### HostIdentity

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `host` | 是 | native-scoped；manifest.host+原生 session；D1/DV | native-scoped；manifest.host+原生 session；P1/PV | yes-scoped（身份标签） | 身份只绑定证据，不用于品牌白名单 | 无需 |
| `vendor` | 是 | unknown；raw 未冻结 publisher identity；DV | unknown；raw 未单列 vendor；PV | unknown（允许 null） | null 保留未知；无执行能力影响 | H01 接受可空元数据 |
| `version` | 是 | native-scoped；VERSION-PIN observedVersion；DV | native-scoped；VERSION-PIN version；PV | yes-scoped（版本元数据） | 固定真实版本；hash 漂移重新准入 | H02 涉及旧 integration 的选项 |
| `pinRef` | 是 | native-scoped；VERSION-PIN observedVersion；DV | native-scoped；VERSION-PIN version；PV | yes-scoped（版本元数据） | 固定真实版本；hash 漂移重新准入 | H02 涉及旧 integration 的选项 |

### ModelObservation

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `providerModel` | 是 | unknown；raw model/providerModel null；D14/DV | native-scoped；P5+PV Xiaomi/MiMo真实模型 | no（DSH live模型未选/未测） | DSH manifest.model=null；task需provider-live时unsupported或追加取证 | H03/H08 |
| `reasoningRequested` | 是 | partial；D14仅fixture high参数；独立档位unknown | partial；P14 high payload接受，独立档位未证 | no（server-tier 保证） | A-thinking：经批准只要求payload一致；不能把批准写成server-tier verified | H04 |
| `reasoningEffective` | 是 | partial；D14仅fixture high参数；独立档位unknown | partial；P14 high payload接受，独立档位未证 | no（server-tier 保证） | A-thinking：经批准只要求payload一致；不能把批准写成server-tier verified | H04 |
| `payloadRef` | 是 | partial；D14仅fixture high参数；独立档位unknown | partial；P14 high payload接受，独立档位未证 | no（server-tier 保证） | A-thinking：经批准只要求payload一致；不能把批准写成server-tier verified | H04 |
| `priceRef` | 是 | unknown；D21无供应商/price证据 | partial；P21参考价格+P5用量估价，非invoice | no（成本来源） | USD估价与invoice分开；缺价格保留预留，不继承Pi价格到DSH provider | H03/H08/H11 |

### HostManifest

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `manifestId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `identity` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `compatibleProtocols` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `capabilities` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `model` | 是 | unknown；raw model/providerModel null；D14/DV | native-scoped；P5+PV Xiaomi/MiMo真实模型 | no（DSH live模型未选/未测） | DSH manifest.model=null；task需provider-live时unsupported或追加取证 | H03/H08 |
| `usageSources` | 是 | partial；D5只有synthetic，failure/abort null | native-scoped；P5 raw/provider与receipts相符 | no（provider 证据不对等） | 保留synthetic范围，或追加DSH受控provider取证；缺usage null/complete=false；代价试验准入受阻 | H03/H08 |
| `cancel` | 是 | partial；stream取消D6，child级联D18 unknown，D23仅停成员 | partial；P6仅本地HTTP流取消，children/tools协同未证 | unknown（完整取消） | K0 广播cancel+每target确认+lease release；缺确认unknown；代价等待/保留额度 | H01/H03/H07 |
| `recovery` | 是 | partial；D7 memory恢复，D19 disk/crash unknown，D20 effects unknown | partial；P7 disk transcript，P20 effect reconcile absent | no（完整恢复） | K0 独立journal+host绑定核对+unknown reconcile；DSH disk需取证；代价持久store选择 | H01/H03/H09 |
| `isolation` | 是 | unknown；D15明确未知 | absent（探针组合）；P15未加/测OS sandbox | no（OS 保证） | A-trust：仅批准same-user；或外部WorkspacePort沙箱并有fault-injection证据；hooks/worktree不可替代 | H06 |
| `hostSpecific` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### HostSpecific

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `probeStatus` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `homeObservationRef` | 是 | partial；原29项状态可读取，完整新scope/coverage须显式转译；D1/D5/D15 | partial；原15项保留，缺union key为unknown；P1/P5/P15 | unknown（生产规范化资格） | K0 原probe→新版manifest；不增强status；证据归类/coverage需 conformance | H01 |
| `integrationCompatibility` | 是 | unknown；D16 exact peer/engines旧版 | unknown；Pi integration未作为probe输入；P1不证明旧插件 | unknown | DSH升级并重测或声明旧插件不兼容；Pi不推断未测插件兼容 | H02 |
| `rawManifestRef` | 是 | native-scoped；固定probe文件/具体pointer/hash；DV | native-scoped；固定probe文件/具体pointer/hash；PV | yes-scoped（证据引用） | namespace格式sha256:由确定性封装；不存在项不构造verified | H01 仅新封装 |
| `noteRefs` | 是 | native-scoped；固定probe文件/具体pointer/hash；DV | native-scoped；固定probe文件/具体pointer/hash；PV | yes-scoped（证据引用） | namespace格式sha256:由确定性封装；不存在项不构造verified | H01 仅新封装 |

### DecisionRecord

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `decisionId` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `kind` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `inputs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `contractRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `evaluatorVersion` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `evaluationProtocolRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `outcome` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `reasons` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `evidenceRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `feedbackVisibility` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `issuer` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `capabilityJudgement` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `taskEvidenceRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService：`task` kind 非 null、其余 kind 为 null 由 kernel 校验；代价 L3/评测实现和T0 | H01/H08/H10 |
| `evaluationReceiptRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService：`candidate/promotion` kind 绑定 EvaluationReceipt，缺失即拒；代价 L3 | H01/H08/H10 |
| `activationReceiptRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService：`activation` kind 绑定 ActivationReceipt；代价 L3 | H01/H08/H10 |

### CapabilityJudgement

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `cellStatus` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `look` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `verdict` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `protocolRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `analysisRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `costBasis` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `guardrailCost` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 DecisionService 记录 `cost_per_success ≤ 2×` 护栏结果；不过则不得 positive；代价 L3 | H01/H08/H10 |
| `guardrailWall` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 DecisionService 记录 `p90(wall) ≤ 1.5×` 护栏结果；不过则不得 positive；代价 L3 | H01/H08/H10 |
| `guardrailTruncation` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 DecisionService 记录 `incomplete_rate ≤ 对照+0.10` 护栏结果；不过则不得 positive；代价 L3 | H01/H08/H10 |

### AssetRef

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `assetId` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `revision` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `digest` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `scope` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `qualificationRef` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |

### CapabilityAsset

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `asset` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `kind` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `contentRefs` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `sourceTraces` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `dependencies` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `hypothesis` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `qualification` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `evaluationRef` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `expiresAt` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `revocationRef` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |

### ActivationReceipt

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `protocol` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `asset` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `hostSessionId` | 是 | native-scoped；agent.id/session.id；D1 | native-scoped；trace.sessionId；P1 | yes-scoped（原生 id） | 保留独立 kernelSessionId，不能混成一个 revision/epoch | 无需新增批准；新绑定实现属 H01 |
| `scope` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `previousSnapshot` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `newSnapshot` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `actualStatus` | 是 | unknown；D17 only idle | unknown；P17 only settled | unknown | K0 HostPort.activate 实际确认才active，否则unknown保留旧快照 | H01/H10 |
| `authorizationRef` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `evaluationRef` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |

### ErrorEnvelope

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `code` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `message` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `retry` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `refs` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `visibility` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### AssetProtocolVersion

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `namespace` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |
| `schemaVersion` | 是 | unknown；D17 idle不证明资产激活，D22 custom entries未测 | unknown；P17 idle/P9 entry不证明资产激活 | unknown | K0 immutable registry+scoped staged asset+safe-point实际snapshot receipt；代价 L3演化/回滚 | H01/H10 |

### CommandResult

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `commandId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `disposition` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `sessionId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `revision` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `eventIds` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `effectIds` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `decisionRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `error` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### SessionView

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `dispatchMode` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `sessionId` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `revision` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `epoch` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `taskRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `graphRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `manifestRef` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `nodeBindings` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `nodeStates` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `unknownEffectIds` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `lastSequence` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

### NodeStateEntry

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `nodeId` | 是 | unknown；kernel 构造；D1/D9 提供绑定/投影 seam | unknown；kernel 构造；P1/P9 提供绑定/custom entry seam | unknown（非 native 字段） | K0 kernel 分配节点 id，adapter 只透传；代价 L2 | H01 |
| `attemptOrdinal` | 是 | unknown；kernel 构造；D1/D9 提供绑定/投影 seam | unknown；kernel 构造；P1/P9 提供绑定/custom entry seam | unknown（非 native 字段） | K0 kernel 记录 attempt 序号；host 只承载不判完成；代价 L2 | H01 |
| `epoch` | 是 | unknown；kernel 构造；D1/D9 提供绑定/投影 seam | unknown；kernel 构造；P1/P9 提供绑定/custom entry seam | unknown（非 native 字段） | K0 kernel 记录判定时 epoch；resume 递增；代价 L3 恢复核验 | H01 |
| `state` | 是 | unknown；kernel 构造；D1/D9 提供绑定/投影 seam | unknown；kernel 构造；P1/P9 提供绑定/custom entry seam | unknown（非 native 字段） | K0 kernel 由 journal 派生 NodeState；host 原生状态只作投影，不冒充完成声明；代价 L2 | H01 |
| `sinceSequence` | 是 | partial；D9 native seq/project，kernel journal 未实现 | unknown；P9 custom entry≠kernel 全序 | unknown（journal 全序） | K0 独立连续 sequence；缺口拒绝恢复，不用 host 投影冒充 journal；代价注错验证 | H01 |

### GuaranteeGap

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `capability` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `reason` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `evidenceRefs` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `alternativeIds` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |

### NegotiationResult

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `status` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `taskDigest` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `manifestDigest` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `satisfied` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `gaps` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `selectedAlternatives` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |
| `approvalRefs` | 是 | unknown；D1/D5矩阵只是输入，算法未实现 | unknown；P1/P5矩阵只是输入，算法未实现 | unknown（共同算法提案） | K0 品牌无关纯函数：status+kind+coverage+pin+批准替代；代价 conformance | H01/H03/H04/H05/H06 |

### EvaluationReceipt

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `evaluationId` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `candidate` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `baseDigest` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `dependencyRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `protocolRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `dataSplitRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `hostManifestRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `modelBindings` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `requiredJudgements` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `usageComplete` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `evidenceRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |

### BranchEvidence

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `nodeId` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `binding` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `state` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `artifactRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `decisionRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `gapReason` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |

### TaskEvidenceReport

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `contractRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `binding` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `privateTestsPassed` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `requiredOutcomesMet` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `branchReport` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `artifactRefs` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `actualDiffRef` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `runStatus` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `usageComplete` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |
| `privacyChecked` | 是 | unknown；D1只提供loop，probe capabilityUpliftProved=false | unknown；P1仅loop，probe capabilityUpliftProved=false | unknown（唯一新裁决服务） | K0 EvaluatorPort+DecisionService，四种kind独立；代价 L3/评测实现和T0 | H01/H08/H10 |

### JoinReceipt

| 字段 | 必填 | DSH 映射 | Pi 映射 | 两侧直接证据 | 替代方案与代价 | 审批 |
|---|---|---|---|---|---|---|
| `binding` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `requiredBranches` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `branchReport` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |
| `status` | 是 | unknown；共同 kernel 构造；D1/D9 仅提供绑定/投影 seam | unknown；共同 kernel 构造；P1/P9 仅提供绑定/custom entry seam | unknown（非 native 字段） | K0：版本化 reducer+注入 ports；代价 L2 实现与双宿主 conformance | H01 |

## 3. 计数与不可抹平的差异

```json
{
  "counting": "unique definition.member, not expanded recursive paths",
  "fields": 427,
  "requiredFields": 423,
  "directBothScoped": 15,
  "directBothScopedHost": 8,
  "directBothScopedEvidenceMeta": 7,
  "noDirectBothRequired": 408,
  "commonKernelRequired": 315,
  "hostGapRequired": 93,
  "commonKernelProfiles": [
    "K",
    "SESSION",
    "ORDER",
    "DECISION",
    "ASSET",
    "NEGOTIATE"
  ],
  "hostGapProfiles": {
    "GRANT": 15, "BUDGET": 13, "CAP": 13, "USAGE": 11, "CANCEL": 7,
    "EVIDENCE": 7, "HIGH": 6, "LEASE": 5, "MODEL": 4, "AUTH": 3,
    "ISOLATION": 3, "VERSION": 3, "SESSION_HOST": 2, "TOOL": 2, "COST": 2,
    "ACTUAL": 2, "CONTEXT": 1, "CHILD": 1, "DELIVERY": 1, "INVOICE": 1,
    "INVOCATION": 1, "HOST": 1, "VENDOR": 1, "RECOVERY": 1, "INTEGRATION": 1,
    "ACTIVATION": 1
  }
}
```

“没有两侧直接证据”包括共同kernel构造项，不表示某宿主没有这些能力；运行保证unknown，逐字段有替代/审批。commonKernelProfiles按schema的x-mapping分类为K/SESSION/ORDER/DECISION/ASSET/NEGOTIATE（协议控制、会话索引、序列、裁决、资产定义和协商）；其余非yes-scoped必填归hostGapRequired，涉及权限/计量/执行/能力证据等adapter覆盖。该归属分类不是能力状态升级。

**复算指引**：每个字段的 profile 取 [SCHEMAS.md](SCHEMAS.md) 对应属性的 `x-mapping`。`commonKernelProfiles` 6 类共 **315** 条；其余 profile 共 **108** 条（见上 `hostGapProfiles` 直方图），其中 15 条同时是 `directBothScoped`，故 `hostGapRequired = 108 − 15 = 93`。

**`directBothScoped` 的两类含义**：15 条里 8 条是宿主能力/身份/版本（`hostSessionId`、`preserveHostResources`、`isolation`、`hostVersion`、`host`、`version`、`pinRef`、`ActivationReceipt.hostSessionId`），7 条是证据包自身的元数据（`EvidenceRef.file/pointer/sha256/kind/claim`、`HostSpecific.rawManifestRef/noteRefs`，取自 `VERSION-PIN`/probe 文件）。后者只表示 kernel 可从固定证据文件填入，不等于宿主有对应原生对等字段。

| 冲突 | 冻结处理 | 禁止抹平 |
|---|---|---|
| DSH 0.1.7→0.2漂移 | DV当前0.2.0-rc.2；D16 integration旧pins；drift.evidence=[]/changeTime=null/verificationStatus=unverified，历史归因是orchestrator报告 | 重建原npm日志、称旧plugin已兼容、回滚/重装 |
| Pi high partial | P14只证thinking enabled+reasoning_effort=high接受；reasoningEffective=payload-accepted | 写server-tier-verified或独立high已证 |
| DSH 0 paid vs Pi 2 paid | D5/D14是native-fixture；P5/P14是provider-live；DSH真实model/price缺值 | 同status当同证据，synthetic充provider，继承Pi账单 |
| DSH teamMessageDurable=false | D10 unknown，queued非target ack；要求可靠消息走H05替代或unsupported | enqueue即delivered/completed |
| DSH OS unknown / Pi raw absent | D15/P15原词保留；要OS保证当前双方都不能满足 | hooks/worktree声明OS sandbox |

## 4. Raw probe → 新HostManifest规范化算法

1. 读取固定VERSION-PIN/manifest/trace并核对hash，原文件只读；两侧同一schema成员。品牌字符串只进identity，不能进入准入分支。
2. 能力键取并集；raw已声明项保留原status，缺项unknown/evidenceRefs=[]/coverage=[]。Pi缺DSH-only键不从名字推断absent/verified；tool_result回调存在不证明无限覆盖的执行保证。
3. identity.version取DV/PV；compatibleProtocols必须由未来adapter通过此协议conformance后显式登记。raw探针无该字段，不能自填已兼容。model取真实供应商，DSH为null；fixture只在hostSpecific中说明。
4. evidenceRefs填写file/pointer/hash/kind/claim；coverage仅取检查范围，不能从master文档填。DSH usage=synthetic/native-fixture，Pi两份正常请求=provider-live；Pi恢复有native-disk，DSH没有。not-run不为必要保证供证。
5. cancel分stream/tool/child/vendor billing；recovery分transcript/native disk/kernel journal/external effect；isolation分same-user/OS。memory resume、disk transcript都不推出kernel journal/outbox。
6. raw没有的metadata用null/unknown：Pi probeStatus/homeObservationRef=null；未测integration=unknown；DSH旧integration明确不匹配。rawManifestRef/noteRefs保留原证据，不接受opaque任意插件字段。
7. Pi offline aborted receipt中的input/output=0只属本地fixture，不证明真实供应商免费；真实cancel场景Usage.complete=false、未知token/金额null、保留原证据与预留。DSH两份失败/取消null不填零。Pi正常请求inputUncached=13615/116、cacheRead=0/13568、output=60/18，reasoning=37/14已包含output。
8. native id/order/caller identity供关联核对；kernel epoch/journal seq/grant/effectId/lease由K0构造验证。projection/custom entries是旁证/投影，不是第二持久真相源。

规范化算法仍需l3_*_session实际conformance。新字段有null/unknown是协议的一部分，不把raw metadata缺项视为冻结提案阻塞，也不冒充生产准入。本lane不修改raw探针。

## 5. 数据流与当前可用范围

TaskContract+GraphSpec+规范化HostManifest → 纯协商 → Command → 权限/预算/11图校验 → journal/outbox同事务 → 唯一HostPort执行 → 原生actual result/usage → 关联Receipt → 唯一DecisionService → journal投影/下一Effect；candidate→evaluation→promotion→activation各有独立记录。expectedRevision/epoch/fencing分别核对，原宿主资源保留。

当前只有有限机制fixture/原生字段证据。双宿主生产任务、DSH真实供应商、跨进程claims、可靠消息、强制grant、崩溃恢复、长期收益尚未准入。human gate、技术conformance、试验额度分别检查，不因图节点passed跳过。
