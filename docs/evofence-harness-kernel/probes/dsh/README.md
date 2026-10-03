# DSH 原生能力探针：0.2.0-rc.2

节点 `l1_dsh_probe`，取证日期 2026-10-01。固定本机实际安装的 **`@deepseek-ai/dsh@0.2.0-rc.2`** 及同版本 agent/loop/tools/team/session/projection/subagent 等包，关键文件 SHA256、Node 平台和安装路径见 [VERSION-PIN.json](VERSION-PIN.json)。这是 L1 宿主机制取证，还不是 EvoFence DSH adapter。

**cp1/cp2/cp3 取证检查通过，整体结果为 `completed-with-limitations`。** 原生 AgentLoop、hooks、ToolRuntime、TeamService、in-process spawn、SessionProjectionRegistry 及 AgentRegistry.resume 都实际执行。LLM 和 persistence 是内存 fixture，不能充当供应商实跑或磁盘恢复证据。机器矩阵有 **29 项：15 verified、1 partial、13 unknown、0 absent**；局限逐项列在 `limitations`。消息已排队，但目标 receipt 与 Lead delivered acknowledgement 未观察到。

整体 `status` 仅有 **`failed` / `completed-with-limitations`** 两档，定义见 HOST-MANIFEST 的 `statusContract`：错误或 checkpoint 失败为 failed，其余为 completed-with-limitations。选择删除整体 passed 分支，因为本离线探针固定保留供应商、磁盘和真实宿主保证的未验证范围；checkpoint 的 passed 和单能力状态词表另有作用域，不受此整体词表影响。

## 复现和写入边界

在当前 worktree 根目录执行：

```powershell
node scripts/probes/dsh-native-probe.mjs
node --check scripts/probes/dsh-native-probe.mjs
node --check scripts/probes/dsh-probe-support.mjs
```

最终三条命令退出码均为 0。探针默认使用全局 npm 包；已有另一个安装可设置 `EVOFENCE_DSH_PACKAGE_ROOT`。运行时核对 CLI/package/关键依赖版本；漂移拒绝，不自动安装、回滚或更换目标。`--unknown` 返回 `PROBE_USAGE`、退出 1。`--live` 仅为离线模式的兼容参数，记录 not-run 拒绝和 `requestedMode`；它不选择真实 provider/live 路径。

脚本只写本目录的 VERSION-PIN/HOST-MANIFEST/offline-trace/live-trace 四个 JSON。README 与两个脚本由本节点交付，无额外临时文件或持久 session 目录。明确的读取范围为安装包源码/声明/manifest、仓库 integration manifest、冻结 Pi 两份 JSON，以及存在时两份指定 npm 日志的 argv 片段；部分路径位于用户 home 下。对解析出的 DSH home 只检查目录存在性，不读取其中配置、`.env` 或认证文件内容，不启动 profile，也不修改已有 instructions、Skills 或 integration。

`isolation.npmLogsRead` / `npmLogsReadCount` 记录本次是否读取指定日志；本次原日志缺失，值为 false / 0。`homeDirStatOnly:true` 表示目录存在性检查；`credentialsRead:false` 和 `userConfigRead:false` 描述探针明确执行的文件读取，第三方依赖内部的所有访问未独立插桩验证。Launcher 子进程仅执行 `--version`，环境只传平台运行所需的非认证字段；原生进程只挂载自定义 offline adapter，fetch 禁止联网，fixture 调用数上限 20，每个检查有超时并执行 teardown。凭据不打印、不写入产物。

复现比较以能力状态、检查结果及证据语义为准。时间戳和原生生成的 child sessionId 每次可变，产物不承诺逐字节一致；`offline-trace.reproducibility` 列出可变字段。

## 版本漂移与旧 integration 缺口

Orchestrator 报告本会话 17:57 本地 CLI 为 0.1.7-rc.1；本探针当前实际读取 package/CLI 为 0.2.0-rc.2。**此前引用的两份 npm 日志在本次采集前已缺失，本 artifact 不含原日志证据，也没有从会话叙述重建原日志。** 独立评审报告它们已被 npm `logs-max:10` 轮转删除；探针确认指定路径不存在，但未重新验证轮转策略或删除原因。

VERSION-PIN 的 `drift.evidence` 为 []，`verificationStatus` 为 `unverified`，`changeTime` 为 null；`missingEvidenceFiles` 和 `collection` 记录缺失情况。`reportedChange` 单独保留 orchestrator 提供的时间与 `latesr` / `latest` 命令叙述，明确来源是会话报告，不能视为本 artifact 核对过的日志内容。若以后原日志存在，脚本只捕获白名单 argv 片段与 hash；只有两份片段均命中才填本地日志时间。

按 orchestrator 的报告保留 `observedExternalChange:true`、`attributedTo:external (user-side), not this fleet`；`observationSource` / `attributionBasis` 标明报告来源，日志 argv 本身也不证明操作者身份。本执行者没有运行安装命令。用户回复“就用最新版”，orchestrator 随后明确把本节点目标改为 0.2.0-rc.2；当前目标已重新固定。

仓库内 `integrations/deepseek-harness/package.json` 仍是 `@local/evofence-deepseek-harness@0.1.1`，声明：

```json
{
  "engines": {"node": "^22.19.0 || >=24.0.0", "dsh": "0.1.7-rc.1"},
  "peerDependencies": {"@deepseek-ai/dsh-tools": "0.1.7-rc.1"}
}
```

这些 exact pins 与本机 0.2.0-rc.2 不匹配。文件 SHA256 与真实字段已写入 VERSION-PIN 的 `integrationGap`；集成 runtime compatibility 标 unverified，未加载或修改旧 integration。此缺口应进入 `l1_api_freeze` / `l3_dsh_session` 的消费合同，不能因 native probe 通过而声称旧只读插件已经兼容。

本机 home 用实际 `dsh-home-paths.resolveDshHome()` 只读调用核实为 `${USER_HOME}\.dsh`，来源为 OS home 默认值，当前没有有效 `DSH_HOME` 环境覆盖。结果保存在 manifest 的 `homeObservation`。这不证明用户当前 GUI/profile 启动时没有另传显式 home。

## 共享比较口径

能力 `status` 使用 Pi 的四值词表 **`absent / partial / unknown / verified`**。`unknown` 表示未验证或证据不足；`partial` 表示明确子集已验证、完整保证未验证；`absent` 需要明确的不可用证据，不从“未测试”推断；`verified` 只覆盖列出的检查与证据级别。旧 DSH `unverified` 归入 `unknown`，避免误报能力不存在；显式 `verificationStatus:unverified` 保留未验证标记，team wait/interrupt 的有限子集用 partial。

DSH 已覆盖 Pi 全部 HOST-MANIFEST 顶层字段、全部 15 个能力键和全部 VERSION-PIN 顶层字段。`sdkChildSessionIsolation` 对应实际 fresh child id/transcript 分离；`sessionCustomEntries` 为 unknown，未假定 DSH 有或没有 Pi 的 appendEntry 语义。

共享 `model` / `providerModel` 只表示真实选定的供应商模型。DSH `model` 与 VERSION-PIN 的 `providerModel/selectedModel/catalogSource/pricingSource/price/thinkingSource` 均为 null，原因见 `modelSelectionNote`；fixture 标签放在 `hostSpecific.fixtureModel`，不会和 Pi 的真实模型混用。`reasoningRequested:high` 在本侧只代表 fixture 请求参数。

`HOST-MANIFEST.comparisonContract` 只读计算两侧字段差集并保存冻结 Pi 文件 hash。DSH 未缺 Pi 字段或能力键；Pi 缺少 DSH 的 status/homeObservation/hostSpecific/局限汇总等字段，以及 DSH 专属能力键、VERSION-PIN 安装/漂移/集成信息。**Pi 产物保持冻结，这些缺口交给 `l1_api_freeze` 定义 union 字段、null/unknown 处理与 host-specific 映射。** 状态词表一致不代表证据强度相同：Pi 有真实供应商/磁盘证据，DSH 是 synthetic adapter / memory storage。

`live-trace.json` 保留简报规定的文件名，内容和 `hostSpecific.evidenceLevels` 均标 `not-run`，不算真实 live 证据。静态声明有 package/version/file/行号和 `symbolNotFound`；cp1 要求清单非空、文件存在且每个符号命中。已按本机声明将旧查询 `withInitiator(`/`addExecutionGuard(`/`register(` 修正为 `withInitiator<`/`guard(guard:`/`register<`，不把 master 或错误查询当本机 API。

## 能力矩阵

下表逐键对应 [HOST-MANIFEST.json](HOST-MANIFEST.json)。`verified` 均为明确的 **native runtime + fixture** 检查；静态声明不能独自升级为 verified。

| capability key | 状态 | 实测证据与局限 |
|---|---|---|
| nativeSessionBinding | verified | registry.create、awaited async agent/created、稳定 id、status、dispose；未接入用户 GUI |
| contextAndResources | verified | controlled host instruction/tool 保留；真实用户资源发现另记 unknown |
| agentPreStep | verified | await next 后加节点消息；reject 不触发 adapter 调用 |
| toolRequestGate | verified | denied tool execute=0，允许/异常工具各执行一次；仅 ToolRuntime 路径 |
| toolResultObservation | verified | 成功/拒绝/抛错的 callId、sessionId、isError，frozen exec 身份 |
| settledAndIdle | verified | native status/whenIdle，cancel 与 provider failure 后回 idle；任意 detached plugin 未测 |
| usageTokens | verified | 4 份完成回执含 child/completion feedback；failure/abort usage=null，不填零；全部 synthetic |
| teamDelegation | verified | TeamService + spawn 创建 fresh child，parentSession 关联，消息 durable enqueue；fork 未测 |
| teamMessageDelivery | unknown | 已排队，目标 receipt 与 Lead delivered 未观察到；不归因为全部 DSH 环境缺陷 |
| nativeTeamGraphBoard | verified | claim rev2→complete rev3，resume 后 board 保留；writeScopes 不证明强制隔离 |
| teamTaskCas | verified | 旧 revision 用 TEAM_TASK_STALE_REVISION 拒绝；跨进程竞争未测 |
| teamAuthorityIdentity | verified | Lead membership、同 ID 仿造拒绝、非 Lead spawn 拒绝、旧对象拒绝、新 resumed 身份接受 |
| sdkAbort | verified | 原生 stream signal 取消、aborted turn 和 idle；供应商断连/退款未测 |
| transcriptRecovery | verified | 42 条 Lead events 与 memory persistence 一致，flush/dispose/resume 后恢复，无 adapter 重放 |
| projectionOrdering | verified | seq 连续，snapshot/checkpoint/restore 一致，缺 seq 与错误 stateVersion tail 拒绝 |
| parentChildCancellation | unknown | 未验证自动团队 cascade 或父子取消传播 |
| toolCancellation | unknown | 未调度运行中的长工具取消 |
| diskCrashRecovery | unknown | 未建 native JSONL；memory flush 不证明 durability/torn-tail 恢复 |
| osSandbox | unknown | 未测试 OS sandbox；工具 hooks 不证明工具内部权限控制 |
| externalEffectReconciliation | unknown | 无外部效果、kernel journal/outbox 或 reconcile |
| reasoningHighGuarantee | unknown | synthetic reasoningEffort=high 参数已测；Xiaomi/provider 语义保证未测 |
| costInvoice | unknown | 无付费请求或账单查询 |
| providerCancelBilling | unknown | 无供应商取消计费实测 |
| existingIntegrationCompatibility | unknown | 旧 engines/peer exact pins 不匹配；运行兼容性未测 |
| grantWriteScopeEnforcement | unknown | task writeScopes 可记录；文件强制门禁、kernel grants/leases、grant 继承均未验证 |
| teamWaitAndInterrupt | partial | waitForChange signal 取消、停成员 interrupt 返回 inactive 已测；运行成员 interrupt/传播未验证 |
| skillsPluginCoexistence | unknown | 未执行真实 Skills/GUI/profile/全部第三方插件共存 |
| sdkChildSessionIsolation | verified | 独立 child sessionId/transcript、无父工具历史；不证明 OS/跨进程隔离 |
| sessionCustomEntries | unknown | 未验证 Pi appendEntry/custom-entry 的 DSH 对应语义和磁盘恢复 |

实际轨迹见 [offline-trace.json](offline-trace.json)。全部 39 个检查均被能力条目引用，`checkCoverage` 无 orphan 或引用未执行项；unknown/partial 条目引用通过的诊断检查不会升级其完整保证。轨迹不保存完整 prompt、thinking、认证 headers 或凭据。`checks.teamMessageDurable=false` 保留未成立观察，其它检查通过不抹掉这一项。

## 用量与证据边界

最终离线运行共 **6 次内存 adapter 调用**：两次 Lead 工具 loop、一次 child、一次原生 child completion feedback 唤醒 Lead、一次受控 provider failure、一次 cancel。成功 fixture usage 每次是 `inputTokens=100, cacheReadTokens=20, cacheWriteTokens=5, outputTokens=22, totalTokens=147`，其中 reasoningTokens=4 已计入 output。成功回执合计 synthetic total=588；失败/取消各自 usage=null，所以不能把 588 冒充完整实际用量或费用上界。

原生 child 完成后会唤醒 Lead 产生一次额外请求。这是实际观察到的后台模型效应；后续预算预留必须覆盖，不能只统计显式 parent/child 初始请求。当前只用免费内存 fixture；**真实付费请求为 0**，共享 MODEL-BUDGET.json 未改。[live-trace.json](live-trace.json) 明确 not-run。

内存 persistence 实现 native SessionPersistence seam，包括 post-commit event feed、single-writer handle、read/append/flush/close 和 Symbol.asyncDispose。它只用于验证真实 AgentRegistry.resume 与 Team projection 消费，不能验证 JSONL backend、跨进程 CAS/lease 或崩溃持久性。本轮开发时发现 fixture 最初缺少 event feed，已修正；这不是目标包缺陷，最终 trace 来自修正后的实际执行。

当前阻塞：交付无文件/登录/费用阻塞；历史漂移原日志已轮转缺失，无法提供原文。消息交付、父子取消、运行中工具取消、fork、真实 Skills/GUI、disk crash 与供应商保证仍为明确的适配/取证缺口。L2/L3 要建立单一 scheduler 权威、scoped grant/shared budget、完整 fan-in、lease/fencing、journal/outbox/reconcile 和资源保留；本探针不证明长程闭环或能力收益。

## 官方资料和 API 差异

先经 Context7 resolve `/deepseek-ai/deepseek-harness`，再查询 hooks/team/usage/cancel/resume/projection 与 minimal native fixture；返回的官方来源是 master：[agent-team](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/agent-team.md)、[LLM adapter](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/llm-adapter.md)、[runtime-types](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/src/runtime-types.ts)、[tools](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts)、[session-projection](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-projection/src/index.ts)。这些提供调查线索，最终 verified 结论来自已哈希的本机版本执行。

Context7 master 的 TeamService 示例列出 remoteView/remoteCreateTask/remoteUpdateTask，并称 interrupt.previousStatus 可含 idle；本机 0.2.0-rc.2 的 TeamService 类型未声明这些 remote 方法，interrupt 类型为 running/inactive，本轮实际停成员返回 inactive。适配应依据固定版本的服务合同，不照抄 master。当前没有改目标包补接口，也没有改 Pi 冻结产物、图状态、产品源码、tests、package.json、integration 或 Git 元数据。
