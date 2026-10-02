# 双宿主准入对比矩阵 — `l3_dual_host_gate`

> 维度 = 生命周期 / 权限 / 预算 / 上下文 / 恢复。每格给出**两宿主各自的证据锚点**（`文件:行` / 事件 / hash），并在每维末尾显式写出**差异与解释**（`adr_0006` 要求显式差异，禁止"某宿主没有"草率带过）。
> 机器可读镜像：`admission-matrix.json`。独立复算：`evidence/independent-checks.json`（26/26 通过，0 付费）。

## 0. 两宿主的共同底座（差异只在宿主机制，不在内核契约）

| 层 | 产物 | 说明 |
|---|---|---|
| HostPort 契约 | `src/runtime/host-port/types.ts:232-238` | 两宿主实现同一 `HostPort`：`observe/execute/cancel/reconcile/context/usage` |
| scoped grant | `src/runtime/host-port/grant.ts:39,56,78,112` | `scopeWithin` / `budgetWithin` / `delegate` / `revokeGrant`，宿主不可自造权限根 |
| 能力裁决 | `src/runtime/host-port/capabilities.ts:218`（`capabilityGate`，判官 `judgeRequirements` 在 190） | 两宿主的 `execute`/`cancel` 都先过同一判官 |
| usage 只应用一次 | `src/runtime/host-port/usage.ts:34,61` | `dedupeUsage` + `usageIsComplete`；空列表 ≠ 0 |
| 任务图/裁决 | 生产 kernel `GraphPatch`/scheduler/session（两场景 `dynamic-graph-accepted`） | 图与 verdict 属内核，不属宿主 |

## 1. 生命周期（原生循环、子会话、结算、投影）

| 断言 | Pi（0.99.2） | DSH（0.2.0-rc.2） |
|---|---|---|
| 原生 session/loop | `src/hosts/pi/binding.ts:183`（只有一个 `host.agent` effect 走 `prompt/waitForIdle`）；`binding.ts:129-136` `agent_settled` 才置 settled | `src/hosts/dsh/port.ts:59`（`followup` + `whenIdle`，`turn/end` reason 映射 completed/cancelled/failed/unknown） |
| ≥2 原生子会话并行 | trace `child-created` ×5（logic `01a0fb70-66f0-…c3f1`、tests `01a0fb70-66f1-…83bb`、两个 verifier、一个 quality-verifier）`evidence/attempt-2/trace.jsonl:84-85`；provider 窗口重叠 **58,489 ms**（我复算；audit 用子会话窗口 = 58,491 ms，差 1 ms 系 provider-settled 时间戳口径） | trace `child-created` ×4；native TeamService `spawnTeammate`，logic `e4ef9bb5-…`、tests `239cd8e7-…`；provider 窗口重叠 **49,627 ms**（`MODEL-BUDGET.json` 复算；audit 一致） |
| 唯一 integration writer | `integration-write` ×5，`evidence/attempt-2/trace.jsonl`（父 session 一次 CAS 写 5 文件；作者只产出 bundle） | `integration-write` ×5，`scenarios/dsh/host.mjs:44-65`（`kernel-claim-consumed` 在 48，无 claim 不可写）；同文件冲突走 `resolve_shared_conflict`（`evidence/trace.jsonl:721`），双方提案 hash 在册 |
| 工作板 / 投影 | 无原生板：`binding.ts:213-217` `boardOwners: []`；能力 `nativeTeamGraphBoard: absent` | 原生板存在但**仅投影**：`scenarios/dsh/host.mjs:23-43` 用 `verifyBoardAuthority` 校验投影等于 kernel claims，板不派发；`final-board.json` kernelClaims=0 / nativeOwners=0 |
| 结算诚实 | 被中断 invocation 保留 `status=unknown` + `EFK_USAGE_CONFLICT`（`evidence/attempt-2/abort.json`） | 故障 `verify` 保留 `failed`，`repair` succeeded；`completion.json.nodeStates` 未涂绿 |

**差异（显式解释）**：DSH 有原生 team graph board，Pi 没有。这不是"Pi 缺能力"了事——含义是：DSH 把原生任务板作为**只读投影**（`verifyBoardAuthority` 证明投影不越过 kernel claim），Pi 的协作面只有 SDK child session + 内核图，所以 Pi 场景用内核 scheduler 派发、宿主不提供板。两个方向都不产生第二个调度器或第二个裁决者（见 §2）。另：Pi 场景直接使用**生产** `src/hosts/pi`（`scenarios/pi/native.mjs:6-9` 导入 `bindPiSession`/`bindPiChildExecutor`/`bindPiSharedRequests`/`mapPiUsage`，`run.mjs:6` 导入 `bindPiDelegation`）；DSH 场景使用**场景适配** `scenarios/dsh/host.mjs`（只从 dist 导入 `DSH_CAPABILITIES`/`verifyBoardAuthority`），未跑生产 `createDshHost`/`createDshBinding`。这是**证据不对称**，DSH lane 已自行声明（见 `gate-verdict.md` §3.1）。

## 2. 权限（scoped grant、不授予第二裁决）

| 断言 | Pi | DSH |
|---|---|---|
| 子 grant = 父∩任务∩节点，只收不放 | 共享 `grant.ts:39-67,78-110`：scope 子集 + `remainingDepth` 严格递减 + `budgetWithin`；委派走 `src/hosts/pi/delegation.ts:16` `bindPiDelegation` | 同一 `grant.ts`；委派走 `src/hosts/dsh/delegation.ts`（生产）与场景内 TeamService |
| 权限根不由宿主自造 | `grant.ts` 头注：不 mint 权限根，根在 `PolicyPort`（`src/kernel/policy/authority.ts:136` `deriveAuthority`） | 同上，内核一处决策 |
| 不授予第二裁决 | `binding.ts:211-217` `observe` 只报自身状态；verdict/evaluator 在内核；Pi 无 board | `host.mjs:39` 板投影被 `verifyBoardAuthority` 约束为 claims 的像；模型工具集无板调度入口 |
| 写范围强制 | 内核 claim 层 `src/lib/cli/**` 边界由场景 owner 约束；`grantWriteScopeEnforcement` 无探针 → **unknown**（不证强制） | `grantWriteScopeEnforcement: unknown`（`probes/dsh/HOST-MANIFEST.json`，advisory writeScopes）；场景以有限工具 allowlist 落实目录所有权 |

**差异（显式解释）**：两宿主的 grant 数据规则**完全同源**（同一个 `grant.ts`），因此"权限语义"本身没有宿主差异；差异只在**强制层级**：DSH 的 native `writeScopes` 是 advisory（探针 unknown），Pi 无对应探针。两者都**没有** OS 级写范围强制（`osSandbox`：Pi `absent`、DSH `unknown`）。**不把"工具 allowlist + claim 所有权"写成"已强制 grant"**。

## 3. 预算（parent+child、缺 usage 不归零）

| 断言 | Pi | DSH |
|---|---|---|
| 同池父子预算、子 ≤ 父 | `budgetWithin`（`grant.ts:56-67`）要求同 `poolId`/`category`，各 ceiling 子 ≤ 父；分角色账在 `MODEL-BUDGET.json`（parent 30 + logic 13 + tests 15 + verifier 20 + quality 3 + quality-verifier 3） | 同 `budgetWithin`；`MODEL-BUDGET.json`（parent 20 + logic 5 + tests 17 + verifier 28 + 角色登记缺失期 5，sessionId 均为父会话） |
| 逐请求记账、追加不重置 | `scenarioTotals.requests=84, tokens=2,047,716, referenceUsd=0.24026418`；legacy 2 行原样保留 | `requests=75, tokens=1,684,159, referenceUsd=0.14603358`；`scenarioRuns[].limitUsd=null`，`reservations: []` |
| 缺 usage 不归零 | `usage.ts:61-66` `usageIsComplete` 空列表 → false；被中断 receipt 保留 reservation（`abort.json` 的 `unknown`），`scenarioTotals.unknownRequests=[]` 只表示 84 条原始 usage 完整 | `usageIsComplete` 同源；4 条（`dsh-http-1/3/5/6`）provider raw 捕获 unknown，按真实 native receipt 结算并保留 `reconciliation.originalOutcome`，**未填 0、未造 raw frame** |
| 参考价非账单 | 本地固定 tariff（0.30/1.20/0.006 per M）；`invoice: false`、无美元硬上限 | 同 tariff；`invoiceUsd: null`；我独立复算 75 行公式 **0 处不符** |

**差异（显式解释）**：记账口径与缺失语义两宿主**同源同结果**；差异只在角色构成与请求数（Pi 84 / DSH 75，因任务相同但失败/续跑路径不同，且基线 commit 不同 `5ec65f1` vs `b574b1c`）。**不得**把请求数/费用差当作能力或效率信号（`adr_0008`）：样本、基线、模型绑定都不同。Pi 场景的 `result.json` 有一处 stale 字段（`settledRequests=78`，随后 quality 追加 6 条、finalize 未回填），权威账以 budget/request-pool/cost-summary 为准（84 全 settled），列为非阻塞观察。

## 4. 上下文（保真与注入边界）

| 断言 | Pi | DSH |
|---|---|---|
| 注入 seam | `binding.ts:125-141` `context()`：只接受 `isolation === 'current'`，否则 `EFK_CAPABILITY_UNSUPPORTED`；解析出 packet 后由 `context` hook 追加，`preservedHostResources: true` | `port.ts:12-24` `contextPacket()` + `port.ts:51-58`：`isolation === 'fresh'` 直接拒绝（"requires the explicit delegation binding"），读 artifact 后写 `contextText`，`preservedHostResources: true` |
| 上下文保真证据 | 生产探针 `probes/pi/live-trace.json` `/checks/hostToolsAndSkillPreserved`（provider-live，AGENTS/skill/read tool 保留）；场景 `binding.ts:101-104` 只在 active+attached 时注入 | 探针 `probes/dsh/offline-trace.json` `/checks/additiveNodeContext`（native-fixture，host marker/tool 保留）；场景 `child-graph-*.json` 携带子图 reference（有限任务上下文） |
| 共享文件冲突（边界） | 目录所有权互不重叠（logic=`src/lib/cli/**`、tests=`test|docs`），无同文件冲突 | 两 worker 都触达 `docs/cli-limit-scenario.md`：`conflict-resolved`（`evidence/trace.jsonl:721`，proposalHashes `c1e41f10…`/`edb36ce4…`，resolvedHash `7f2ba9c2…` = artifact-hashes）显式解决，无静默覆盖 |
| fresh transcript 隔离 | 生产 `PI_SESSION_CAPABILITIES` 把 `sdkChildSessionIsolation` 收窄为 **unknown**（`src/hosts/pi/capabilities.ts`），故 session lane 拒绝 fresh；child 走 `delegation-executor.ts` | 生产 `DSH_CAPABILITIES` 为 **verified**，但主 port 拒绝 fresh，child 走 `src/hosts/dsh/delegation.ts` |

**差异（显式解释）**：同一"current 注入"语义，但**原生 child 隔离的声明不同**：DSH 探针判 verified（native-fixture），Pi 在 0.99.2 session lane 主动收窄为 unknown（0.87.1 时代 P8 是 native-fixture verified）。解释：这是版本漂移下的**保守收窄**，且两宿主都把 fresh transcript 放到独立 binding（`delegation*.ts`），主 port 一律拒绝——因此"能不能注入当前上下文"两宿主一致，"fresh 子会话"两宿主都需走委派 binding，且 DSH 生产委派 E2E 未证（见 `gate-verdict.md` §3.2）。Pi 探针的 file:line 证据为 provider-live，DSH 为 native-fixture——这是**证据等级不对称**，已在限制报告记录。

## 5. 恢复（中断 → 同会话恢复、不盲重放）

| 断言 | Pi | DSH |
|---|---|---|
| 中断方式 | `binding.ts:221-239` `cancel`：仅拥有中的 active effect；abort + settled + idle 才 `native-ack`，否则 `unconfirmed`；trace `native-abort-ack`（`trace.jsonl:63`） | `port.ts:164-180` `cancel`：仅 active `host.agent` loop 走 `Agent.cancel({kind:user})` + `whenIdle`；trace `native-cancel-ack`（`trace.jsonl:233`，`reason.kind=aborted`） |
| 同会话恢复（非新建冒充） | 父 session `01a0fb70-04e7-…01af`；abort 快照前 79,067 B sha256 `e7e3a14c…` = `same-session-recovery.prefixHash`（`trace.jsonl:78`）；文件现 245,403 B，同路径追加；nonce `CONTINUITY_5832393e-…` 在 transcript 内 | 父 session `dsh-scenario-9c1c6eb8-…`；取消前 39 事件 `JSON.stringify` 前缀 sha256 `d7d75e13…` = `interruption.beforeHash`，磁盘同文件现 177 行（header + 176 事件）追加；nonce `CONTINUITY_7e8cf4d4-…` 复现 |
| 不盲重放 | `binding.ts:241-249` `reconcile` 返回 `resolved` / `not-executed` / `unknown`；unknown 附 `EFK_EFFECT_UNKNOWN`，不重派 | `port.ts:182-194` `reconcile` 只返回 `resolved` / `unknown`（**无** `not-executed`）；reconciled blocked integration 记"不重发、不重放"（`trace.jsonl:649,699`） |
| 崩溃/强杀 | **未证明**：本轮是显式 abort + 同 id 磁盘 reopen | **未证明**：本轮是 native cancel + 同 id 磁盘 reopen |

**差异（显式解释）**：语义一致（同会话、不盲重放），但原语不同——Pi 是 `AgentSession.abort()` + JSONL reopen，DSH 是 `Agent.cancel` + `AgentRegistry.resume`。一个**功能性**差异：Pi 的 `reconcile` 能给出 `not-executed`（"可证明未派发"），DSH 只给 `resolved`/`unknown`；因此 DSH 对"未派发"的判定依赖核销路径（`reconciled-blocked-integration`），而非 port verdict。两者都**不**证明 process-kill/disk crash（`diskCrashRecovery`：DSH unknown；Pi 无该项探针）。取消计费与供应商账单两宿主都 unknown。

## 6. 差异清单（汇总，逐条含解释）

1. **原生任务板**：DSH 有（仅投影，`verifyBoardAuthority`），Pi 无 → Pi 用内核图调度。不产生第二裁决者。
2. **fresh child 隔离声明**：DSH verified（native-fixture），Pi 0.99.2 收窄为 unknown → 保守收窄 + 两宿主都把 fresh 放在独立 delegation binding。
3. **reconcile verdict 集合**：Pi 有 `not-executed`，DSH 无 → DSH 用核销记录表达"未派发"。
4. **场景↔生产接线**：Pi 场景直接用生产 `src/hosts/pi`；DSH 场景用适配 `host.mjs` → 生产 DSH HostPort 只做静态 conformance，多请求 E2E 未证（DSH lane 已声明）。
5. **基线不同**：Pi `5ec65f1`，DSH `b574b1c`（合同允许派单指定 commit，已显式声明）→ 不得跨基线比较次数/费用/耗时。
6. **聚焦测试形态**：Pi 7 例纯 CLI 子进程；DSH 4 例 CLI 子进程 + 真实 SQLite → 都是真实公共边界，覆盖点不同。
7. **失败路径形态**：Pi 有 attempt-1 动态边错误等 4 个负结果文件；DSH 有首会话外传审批拒绝 / 原生流 usage 旁路失效 / 角色登记缺失 → 负结果都原样保留，不互相抵消。
8. **探针证据等级**：Pi 多项 provider-live，DSH 多项 native-fixture → 本包不把 native-fixture 升级为 provider-live。
9. **证据呈现 minor**：Pi `result.json.settledRequests` stale；DSH `shared-file-conflict.json` 未内嵌 proposal hash、`audit.json.sourceHostDiff` 硬编码 0、2 行缺 `usageBasis` → 非阻塞，列入 `gate-verdict.md` §3.3。
