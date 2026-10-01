# L1 人审包（`l1_replan`）

> **读者**：真人（用户）。**用途**：`l1_replan` 是 `requires_human` 门，本包是它的增量审核输入。
> **本文件不代签**：不构成 ADR accepted、不构成 fog 毕业、不构成试验授权、不构成 L2 开工许可。
> 状态：6 个 L1 节点（`l1_review` + 5 研究节点）全部 `passed`；`l1_replan` 为 `ready`，cp1/cp2 `pending`、**cp3（真人）`pending`**；10 份 ADR 全部仍 `proposed`。证据截至 2026-10-01。

## 1. 一页结论

**做完了什么。** L1 冻结了四样东西，且每条 lane 经独立交叉复核后收口：① 两宿主**固定版本**的原生能力矩阵（Pi `0.87.1`、DSH `0.2.0-rc.2`，文件级 SHA256 固定）；② 图执行语义（7 类节点、6 种边×5 维、`decide()` 判定函数 A1–A6/B1–B3/INV、11 项原子校验、10 个可判定工作例）；③ 收益评测协议（A/B/C 三臂、预注册 MVE、移位零假设、唯一有序判定函数）；④ 公共协议与 schema（`evofence.runtime/1`、schemaVersion `1.1.0`、63 对象/427 字段/423 必填、58 错误码、44 条证据索引、A01–A15 权威判据、I01–I08 导入规则）。合同一致性脚本 `verify-l1-freeze` 退出码 0。

**没有证明什么。** 没有一行实现代码。**两宿主的证据强度不对称**：Pi 有 2 次真实付费请求；DSH **0 次**（全是原生运行时 + 内存 fixture）。内核的并发/租约/fencing/原子 outbox/恢复全部是设计。收益零数据。DSH 有 13/29 项能力 `unknown`（含父子取消、工具取消、磁盘崩溃恢复、OS 隔离、外部效果核实、供应商取消计费、旧 integration 兼容）。

**人审要定什么（一句话）**：**是否接受 L1 冻结的协议、图语义与评测阈值作为 L2–L5 的实施基线，并处置 18 项待决项——其中 8 项未定案前 L2 对应模块不得开工。**

## 2. 逐节点证据表

证据等级（强度从高到低）：**provider-live**（真实供应商/真实计费请求）＞ **native-fixture**（真实宿主运行时 + 本地 fixture）＞ **内存 fixture**（宿主的 LLM/persistence 被内存替身替换）＞ **静态文档核对**（只读源码/文档/自洽性检查，无执行）。**状态词不是证据强度**：同一份 HOST-MANIFEST 里的 `verified` 也分"真实供应商验证"与"内存 fixture 验证"。

| 节点 | 产物 | 实测命令与退出码 | 证据等级 | **未证明项** |
|---|---|---|---|---|
| `l1_review` | `AUTHORIZATION.json`、`SESSION-PROTOCOL.md`、`SESSION-000-HANDOFF.md`、`MODEL-BUDGET.json` | 无脚本；人工核对源线程真人授权原文 | **静态文档核对** | 不证明任何技术能力 |
| `l1_pi_probe` | `probes/pi/` 五份 + `scripts/probes/pi-native-probe.mjs`、`pi-probe-support.mjs` | `node …/pi-native-probe.mjs`、`--live`、两次 `node --check` → **全部退出码 0** | **provider-live**（**2 次真实付费请求**，结算 `$0.001982170`）+ native-fixture（16 项离线检查） | 用户真实 TUI/第三方扩展共存、EvoFence 子图委派、供应商取消计费、账单本体；`reasoningHighGuarantee` 仅 `partial` |
| `l1_dsh_probe` | `probes/dsh/` 五份 + `scripts/probes/dsh-native-probe.mjs`、`dsh-probe-support.mjs` | `node …/dsh-native-probe.mjs`、两次 `node --check` → **全部退出码 0** | **内存 fixture**（LLM 与 persistence 均为内存替身；6 次内存 adapter 调用）+ 真实原生运行时（AgentLoop / hooks / TeamService / SessionProjection / AgentRegistry.resume 实际执行） | **0 次付费请求**（`live-trace.status: "not-run"`）；13 项 `unknown`：`teamMessageDelivery`、`parentChildCancellation`、`toolCancellation`、`diskCrashRecovery`、`osSandbox`、`externalEffectReconciliation`、`reasoningHighGuarantee`、`costInvoice`、`providerCancelBilling`、`existingIntegrationCompatibility`、`grantWriteScopeEnforcement`、`skillsPluginCoexistence`、`sessionCustomEntries`；整体状态只有 `failed` / `completed-with-limitations` 两档，本次为后者 |
| `l1_graph_contract` | `spec/graph/` 三份（README / SEMANTICS / EXAMPLES，共 751 行） | 无执行脚本；10 个手推可判定工作例 | **静态文档核对**（设计层冻结） | 调度、租约、并发、恢复均无运行时；内核选型（小型确定性 reducer）为**建议采用、待人审** |
| `l1_eval_protocol` | `spec/evaluation/` 五份（PROTOCOL / SCENARIOS / METRICS / PREREGISTRATION / OPEN-QUESTIONS，共 892 行） | 无执行脚本；阈值与功效为解析式 + 蒙特卡洛复算（400k 次，确定性 PRNG） | **静态文档核对**（预注册草案，无数据） | 未跑任何实验；270 个语料实例未构建；试验额度未授权；`C−B` 整体功效 79.8% < 80% 目标 |
| `l1_api_freeze` | `spec/contracts/` 七份（共 3300 行） | `spec/contracts/README.md` 内嵌 `verify-l1-freeze` → **退出码 0**（`objectDefinitions 63 / fields 427 / requiredFields 423 / evidence 44 / errorCodes 58 / sourcePins 23 / commandKinds 15 / nativeBothRequired 15 / kernelMissingRequired 315 / hostMissingRequired 93 / humanItems 13`） | **静态文档核对** + 可执行的**文档自洽**检查（只验文档与探针 JSON 一致，不验实现） | 无实现：无 reducer、无原子 outbox、无权限强制、无崩溃恢复、无真实资产激活；423 个必填字段中仅 **15** 条有两宿主指定范围的直接原生证据，**408** 条依赖替代路线（315 共同 kernel 构造 / 93 宿主适配缺口） |

**必须读出的差**：Pi **2 次真实付费请求** vs DSH **0 次**。因此 `usageTokens` / `costInvoice` / `providerCancelBilling` 一类能力在两侧**状态词相同、证据等级不同**。

## 3. 十份 ADR 的现状与建议

**全部仍 `proposed`。以下是建议，不是裁决。** 分两类：**(A) 决策/政策类**（记录"要不要这么做"，L1 已冻结其内容且内部自洽）；**(B) 运行断言类**（记录"运行时会怎样"，L1 无运行证据）。

**(A) 建议可 accept（8 条）** —— accept 的是**决策与范围**，不是其运行后果。

| ADR | 为什么现在可以接受 | 接受的是什么、不是什么 |
|---|---|---|
| `adr_0002` 动态图与有界 loop | 语义经 7 轮独立复核（rev7）冻结：状态机、6 种边×5 维、A1–A6/B1–B3、11 项原子校验、10 个工作例 | 接受"采用动态图 + 有界 loop 的语义"；**不**表示运行时可终止/可恢复 |
| `adr_0003` 真实授权与能力协商替代品牌白名单 | `satisfies()` 六条规则 + 一致性用例已冻结；两宿主有**同一套 15 个能力键**，"按 requirements 而非品牌准入"可行 | 接受协商算法；**不**表示任一宿主已能满足 hard 要求 |
| `adr_0005` 任务完成/评价/晋升/激活分离 | `evaluateTask`（绝对验收、不比 baseline）与 `evaluateCapability`（相对、需 MVE）已是两套判定，含唯一有序函数 | 接受四类判定分离；**不**表示四类服务已实现 |
| `adr_0006` 双宿主同等准入与显式差异 | 423 个必填字段各有两侧路线，差异用 HostManifest/证据范围解释而非品牌白名单 | 接受"同等首发、语义相同、差异显式"的**政策**；**不**表示两宿主已达同等证据等级或都可用 |
| `adr_0007` 长期能力资产的来源与范围 | scope/来源/撤销字段已入 schema；S18 把"受控试验资产只由 train 产生"写成可校验规则 | 接受资产资格设计；**不**表示有跨任务价值（L4 才判） |
| `adr_0008` 收益证据的对照、盲测与总预算 | A/B/C 三臂、预注册 MVE、唯一判定函数、预算三分与护栏已冻结，并**明写**未授权时不得缩标准 | 接受**协议与诚实规则**；**不**表示额度已批、**不**表示收益成立 |
| `adr_0009` 轻量协议内核与可选基础设施 | 模块边界表 + I01–I08 可机检导入规则已定义；`verify-l1-freeze` 退出码 0 | 接受"单仓 + ports/exports 隔离、不先拆 npm 包"；**不**表示 import guard 已实现（本轮只核验规则可解析） |
| `adr_0010` 全面 breaking 与旧数据保留 | 版本三件套角色分开；旧格式显式拒绝执行（`EFK_LEGACY_NOT_EXECUTABLE`）；`1.0.0` 保留为可读 codec | 接受 breaking + 旧数据只读；**不**表示迁移工具已存在 |

**(B) 建议暂缓（2 条）**

| ADR | 仍不足的理由 | 需要什么才能 accept |
|---|---|---|
| `adr_0001` 宿主内嵌内核与显式子图委托 | 决策面（宿主执行、内核决策、仅 scoped grant 可委托）已被两探针的 session binding 支持；但 ADR 同时承诺"必须验证两边 lifecycle/cancel/recovery"，而 DSH 的父子取消/工具取消/磁盘恢复全 `unknown`，Pi 只验到**本地 fixture** 的 stream abort（供应商取消计费未知） | L2 的 fake-host 纵向核验 + L3 两宿主真实生命周期取证（尤其 DSH 取消级联与崩溃恢复） |
| `adr_0004` 事件真相源、outbox 与恢复核实 | 核心断言全是运行属性：CAS 原子提交、outbox 只消费已提交 intention、`unknown` 必 reconcile、replay 零副作用。L1 无运行时证据（DSH `diskCrashRecovery:unknown`、`externalEffectReconciliation:unknown`；Pi 只有 JSONL reopen） | `l2_state_store` + `l2_runtime` 实现 + `l2_kernel_verification` 的崩溃/迟到回包/序列缺口故障注入 |

即使 8 条被 accept，它们**仍待 L2/L3 conformance**；真人签字**不能**把 `unknown` 写成 `verified`。

## 4. 雾区毕业评估

`graph.yaml` 的 fog `graduation` 要求**分段**毕业：`L1 的固定版本能力探针 + 图语义/API/评测协议 + l1_replan 人审` 使实施方案可信，**据实际研究以 amend 更新 fog、仅保留未解决部分，不能因 probe passed 清空全部雾区**；`完整毕业还要求 L2 并发/恢复生产核验及 L4 预注册双宿主受控收益证据达标`。

| 分段条件 | 状态 |
|---|---|
| DSH/Pi 固定版本能力探针 | **满足**（Pi `0.87.1`、DSH `0.2.0-rc.2`，VERSION-PIN 有文件级 SHA256；两个探针可独立复跑，退出码 0） |
| 图语义 / API / 评测协议 | **满足**（三条 lane 均通过独立复核并冻结；合同一致性脚本退出码 0） |
| `l1_replan` 人审 | **未满足**（cp3 `requires_human`，尚未签署） |
| L2 并发/恢复生产核验 | 未开始 |
| L4 预注册双宿主受控收益证据 | 未开始，且额度未授权 |

**结论**：**L1 段尚未完整毕业**（差人审签署）；**完整毕业**还差 L2 与 L4。

**修订后 fog 应保留的未知**：① **DSH 运行期保证**（13 项 `unknown`，整体只有 `completed-with-limitations`）；② **两宿主证据不对称**（provider-live vs 内存 fixture，HostPort 等价性从未在真实供应商上同时成立）；③ **收益未知**（完全未测，额度未授权）。

**建议：保留 fog 并 amend，不建议 `graduate-fog`。** `graduate` 会清空雾区，而上述三条都未解决——fog 文本自身也禁止"因 probe passed 清空"。正确动作是人审通过后由 graph owner 把 fog 描述收窄为这三条、`ignited` 保留已点火研究票，等 L2/L4 再谈毕业。**我不执行任何 graph 写操作。**

## 5. 必须真人定案项（18 项）

**去重口径**：`spec/contracts/OPEN-ITEMS.md` 的 H01–H13（13 项）+ `spec/evaluation/OPEN-QUESTIONS.md` 实测 **20 项**（简报写 19；实测 Q1–Q8、Q9–Q20）。真重复合并为一项并标"来源"；已由协议处理、不需人审的 4 项列于本节末。**33 → 18 项**，其中**阻塞 L2 的 8 项（R1–R8）**。按阻塞面排序。

**R1 ｜协议/codec/内核边界定案**　来源：H01
① 是否批准 `evofence.runtime/1` + `assets/1` + schemaVersion `1.1.0`（`1.0.0` 保留可读）、core 仅 `protocol/kernel/runtime`、单 journal + 四权威、major/minor 规则？
② agent 不能定：这是产品格式与所有权承诺，改变破坏性边界与下游全部实现的所有权。
③ 选项：**(a) 按提案批准**（代价：新 kernel/ports/reducer + 两 adapter 全量实现，不能沿用旧 ledger 资格）；**(b) 要求改后重批**（须改版本与对应 schema，不能"同名改语义"）；**(c) defer**（须写明阻塞范围 = L2 全体）。
④ 不定阻塞：`l2_public_contracts`、`l2_state_store`、`l2_policy`。

**R2 ｜持久化 backend 与恢复 profile**　来源：H09
① 生产要求 memory-only，还是必须有耐久 backend（SQLite 或他者）？准入 profile 是什么？
② agent 不能定：这是"要不要为崩溃恢复付工程/运维成本"的产品取舍。
③ 选项：**(a) memory-only 供开发**（代价：崩溃恢复不可用，`l2_state_store` 验收范围缩到 memory）；**(b) 实现耐久 backend**，并要求 CAS+outbox+claims/leases/reservations 同事务、故障注入核验（代价：backend 实现与部署；core 仍不得强依赖 native DB）。
④ 不定阻塞：`l2_state_store` 的验收范围。

**R3 ｜宿主 board 的权威范围**　来源：H07
① 宿主原生 board 永远只是 kernel claim 的投影（提案，A15），还是要求另立显式 subtree authority 移交协议？
② agent 不能定：改变"谁拥有同一 attempt"的所有权语义，属产品级承诺。
③ 选项：**(a) 仅投影**（代价：调度权威全落共同 kernel，实现量大）；**(b) 要求移交协议**（代价：需另定原子移交/撤销/父预算/子 grant 合同 + 故障证明，且改 1.0 所有权语义需新版本）。
④ 不定阻塞：`l2_scheduler`、`l2_runtime`。

**R4 ｜微美元取整与精确包络**　来源：H11
① 三层包络（S1 `20 / 190900`、S2 `40 / 381900`、S3 `80 / 763800`）按精确值 `9547 µUSD/请求` 重算，还是保留现有金额并放宽 `request_cap`？
② agent 不能定：属预算额度与"最坏用量是否必须全部可达"的政策。实测：S1 差 **−40 µUSD**（最坏用量下兑现不了 20 份预留），S2/S3 差 +20/+40，与文档"逐字段相等"的文字不符。
③ 选项：**(a) 按 `9547` 重算三层 cap 并重算预算（提案）**；**(b) 保留金额、下调 `request_cap` 并明确放弃"全部最坏请求可达"**（须改协议文字）。**不得**用浮点 epsilon 少预留。
④ 不定阻塞：`l2_policy`（预算账本）+ T0 预算表冻结。

**R5 ｜会话 custom entry 是否进入公共合同必填**　来源：H12
① 是否要求 DSH 具备 Pi `appendEntry`/custom-entry 等价语义？
② agent 不能定：决定"部分任务在两宿主是否可执行"。
③ 选项：**(a) 不要求**（需宿主 appendEntry 保证的任务标 unsupported；binding/receipt 走共同 journal）；**(b) 要求等价**（代价：DSH adapter 实现 + 磁盘重开取证）。
④ 不定阻塞：`l2_public_contracts`、`l2_host_port`。

**R6 ｜父子取消级联与运行中工具取消是否作为 hard**　来源：H13
① `parentChildCancellation` / `toolCancellation` 是否 task hard？
② agent 不能定：决定可承接的任务类别与取消语义的产品承诺。
③ 选项：**(a) 不作为 hard**（lease 释放与 unknown 核实不以前提级联成立；cancel 未确认记 `EFK_CANCEL_UNCONFIRMED` 并保持 `unknown`）；**(b) 作为 hard**（代价：两宿主须补真实长流/子成员取消取证 + adapter 实现，否则相关任务双宿主 unsupported）。
④ 不定阻塞：`l2_runtime`、`l2_host_port`、`l3_*_delegation`。

**R7 ｜同用户信任域是否可接受**　来源：H06
① 接受 same-user 信任域（明确披露"越过 hooks 的写入/外部动作无检测保证"），还是要求 OS sandbox hard？
② agent 不能定：安全边界的风险接受，不能由实现者代签。
③ 选项：**(a) 接受同用户信任域**，限定 task/scope/capabilities 并显式披露（代价：信任边界变化）；**(b) 要求 OS 隔离**（代价：注入外部 OS 隔离 Workspace/Host 实现并取证；当前 DSH `unknown` / Pi raw `absent` → 有该要求的任务不执行）。任何选项都**不得**宣称 hooks 或 worktree 等于 OS 沙箱。
④ 不定阻塞：`l2_policy`（trustDomain）、`l3_*_scenario`。

**R8 ｜可靠协调的消息保证路线**　来源：H05
① 采用"共享 journal/outbox + 目标消费 ack"（提案），还是等宿主原生持久投递保证再准入？
② agent 不能定：这是可靠消息的产品保证等级。实测 DSH `teamMessageDelivery:unknown` 且 `checks.teamMessageDurable=false`（消息已排队，目标 receipt 与 Lead delivered ack 未观察到）；Pi 该键未声明。
③ 选项：**(a) 共同 kernel ack 路线**（代价：存储 I/O、消费确认、故障恢复与延迟；仍不承诺外部 exactly-once）；**(b) 等原生保证**（代价：当前两侧 unsupported，可靠消息要求下不可派发）。
④ 不定阻塞：`l2_runtime`（outbox/ack）、`l3_*_session`。

**R9 ｜DSH integration 版本缺口**　来源：H02
① 旧 integration（`engines.dsh` 与 `peerDependencies["@deepseek-ai/dsh-tools"]` 均钉 `0.1.7-rc.1`）跟随 `0.2.0-rc.2` 升级并重测，还是明确声明不兼容？
② agent 不能定：需授权修改 integration 包并承担重测与发布范围。
③ 选项：**(a) 升级 + 真实兼容重测 + 新 pin**（代价：integration owner 改包/编译/重测，另需授权）；**(b) 显式保留"不兼容当前 DSH"**（代价：旧 plugin 不准入，只能走新目标版本 adapter 路线）。
④ 不定阻塞：`l3_dsh_session`（当前 `compatibleWithDeclaredExactVersions:false`、`runtimeCompatibility:"unverified"`）。

**R10 ｜DSH 真实 provider/生命周期取证的条件与额度**　来源：H03 **+ Q6**（Q6 的"DSH 未完成"已过期，残留项即本条）
① 是否新增 DSH 真实 provider/child/usage/activation/用户资源共存取证？范围、证据种类、预算类别与额度？
② agent 不能定：需真实付费授权与额度；**不得**把 Pi 的 2 次请求推广到 DSH，**不得**挪用已闭合的 0.50 USD 探针额度。
③ 选项：**(a) 只允许 fixture/development smoke**（代价：DSH 的 provider-live 保证全 `unknown`，DSH 臂在 T0 判 `not-yet-comparable ⇒ blocked`）；**(b) 对固定 provider/model/payload/child/retry/取消/idle 分别设有限取证计划 + 额度**（代价：真实调用费用、版本固定与覆盖测试）。
④ 不定阻塞：`l3_dsh_*`、T0 的 DSH 臂可比性。

**R11 ｜reasoning 档位：payload-only 还是 server-tier**　来源：H04 **+ Q9**
① 比较只需"payload 被接受"，还是必须服务端独立 reasoning 档位？
② agent 不能定：决定比较结论的解释范围与是否需换模型。
③ 选项：**(a) payload-only**（`reasoningGuarantee=payload-only`，任务与比较双方固定 payload，服务端不明如实披露；代价：解释范围变窄）；**(b) server-tier hard**（代价：当前两侧 unsupported，需独立档位证据或另选可验证模型）。
④ 不定阻塞：`l3_*_scenario`、T0 措辞。

**R12 ｜受控试验 T0 定案（设计 + 额度 + 模型 + 签署）**　来源：H08 **+ Q1、Q5、Q13、Q16、Q17**
① 是否冻结 v3 设计并给出额度？含 provider/model、语料与拆分 hash、工具/权限、分析脚本身份、judging 额度、`π_c`/`DEFF` 假设、功效方案、签署人。
② agent 不能定：**受控试验预算至今没有任何授权数字**（0.50 USD 是已闭合的探针额度；开发期 deepseek/gpt 无美元上限是 development 政策，**不等于** L4 授权）。
③ 选项（额度为 cap 上界估算）：**(a) `P0` 满配 n=160/臂 + 5 消融 + final 20 ≈ 943 USD**（确认性结论；但 `C−B` 整体功效 79.8% < 80%）；**(b) `P1` 去 5 个消融 ≈ 692 USD**（失去并发/检索归因）；**(c) `P2` 单宿主先行 ≈ 471 USD**（产品级结论仍待 DSH）；**(d) `P4` 试点 n=20 ≈ 60 USD**（仅 `exploratory`，可粗估 `π_c`）。设计内另有三项待选：`final` 20→10、消融 5→3、是否保留 `N/2` futility 看（去掉则条件功效 80.7% 即整体）。
④ 不定阻塞：L4 全部节点；**未授权前不得以"预算不足"缩小成功标准**（协议已预注册该禁令）。

**R13 ｜语料来源/授权与"测试作者 ≠ 模板作者"分权**　来源：Q2 **+ Q15**
① 270 个无泄漏实例的仓库来源与授权（自有/公开/构造）？`privateTests` 与 B/C 模板是否必须由不同人或不同模型产出？
② agent 不能定：涉及仓库授权与数据治理；且**同源作者会系统性偏向 B/C**（Q2 只问"谁写谁审"，未点名此冲突）。
③ 选项：**(a) 自有 + 授权公开 + 手工构造混合，并强制测试作者 ≠ 模板作者**；**(b) 允许同源**，把该偏倚登记为已知限制并在结论中披露（代价：B/C 的 positive 解释力下降）。
④ 不定阻塞：L4 语料构建、`l4_capability_trial`。

**R14 ｜终审裁决主体**　来源：Q3
① 谁签 `final` 的人审结论？双宿主是否各需一名独立审查者？
② agent 不能定：组织性授权。
③ 选项：**(a) 用户本人签双宿主**；**(b) 双宿主各指定独立审查者 + 用户终签**（代价：人力与协调）。
④ 不定阻塞：L4 的 `final` 阶段、`l5_accept`。

**R15 ｜质量分人力与 judge 独立性**　来源：Q4 **+ Q14 + Q20**（Q14 与 Q20 是同一问题，已合并）
① 20% 双评的评分者是谁（人/模型）？judge 用哪个模型、是否与被测模型或注入资产同族（自我偏好）？`judging_cost` 额度？
② agent 不能定：改变成本估计；且 judge 与被测同族会系统性污染质量分。
③ 选项：**(a) 臂外独立模型 judge + 20% 人工双评抽检**（代价：judging 额度 + 人力）；**(b) 仅模型 judge，要求与任一被测配置不同族，并披露未做人评抽检**（代价：质量分可信度下降，`α≥0.60` 门槛可能不达）。
④ 不定阻塞：L4 质量类指标（`task_success` 主判定不受影响）。

**R16 ｜记忆探针阈值校准**　来源：Q7
① LCS 重叠阈值 `0.80` 的假阳/假阴率可接受吗？
② agent 不能定：误杀会减少可用实例、漏放会污染 held-out，需人工抽查判断。
③ 选项：**(a) 按 `0.80` 执行，pilot 中人工抽查 `high`/`low` 各 10 例后按需调整**（代价：可能需重跑探针）；**(b) 直接提到 `0.90` 从严**（代价：更多实例被降级进 train，语料成本上升）。
④ 不定阻塞：L4 语料质量（可在 pilot 闭合）。

**R17 ｜分析脚本的独立复核**　来源：Q18
① 主分析脚本是否需要**非作者**复算并签字？
② agent 不能定：需要独立的人/角色承担复算（哈希只证未变，不证正确）。
③ 选项：**(a) 指定非作者复算 `c=1.960`、功效表、`DEFF` 公式、判定函数分支穷尽性并签字**；**(b) 只做哈希冻结**（代价：结论可采信度下降，真人自行承担）。
④ 不定阻塞：L4 结论可采信性。

**R18 ｜上游文档漂移的 owner 合入**　来源：H10 **+ Q19**
① 两处已知漂移由谁合入：① PROTOCOL §2 说"C 从 train/dev 产生资产"而 §4 与 SCENARIOS 是 train-only；② `CONTRACTS §8`（"阈值、样本量尚未决定"）与 `ARCHITECTURE §11`（"不在无数据时编造数值"）与已冻结的 `n=160 / π_c=0.28` 对立。
② agent 不能定：两文件不在本 lane，改动须经各自 owner 合入。
③ 选项：**(a) 按较严的 train-only + "已在 spec/evaluation 预注册待审"更新上游文字**（代价：owner 同步并重哈希）；**(b) 保留原文并声明被冻结提案覆盖**（代价：同一 worktree 内长期存在两套说法）。
④ 不定阻塞：T0 冻结的一致性；间接影响 L4。

**不需人审、已由协议处理（4 项，列出以证去重完整）**：Q8（`human_wait_ms` 不计入 wall-cap，已预注册，仅需 pilot 实测确认）、Q10（供应商取消计费未知 → 保留预留、不归零）、Q11（成本是 USD 参考估计而非账单 → 标 `costBasis`）、Q12（bootstrap/盲评只降低偏差 → 并列报告精确 McNemar + `α≥0.60` 门槛）。这 4 项**不是待决项**，但须写进结论措辞。

## 6. 高优先级风险清单

1. **DSH 无付费实跑证据** —— `live-trace.json` 为 `not-run`、`paidRequests: 0`，13/29 能力 `unknown`。任何"DSH 可用"的说法目前**无真实供应商证据**；DSH 臂在 T0 只能判 `not-yet-comparable ⇒ blocked`。
2. **DSH integration 版本缺口** —— 仓库 integration 钉 `dsh 0.1.7-rc.1` / `@deepseek-ai/dsh-tools 0.1.7-rc.1`，本机 `0.2.0-rc.2`；`compatibleWithDeclaredExactVersions:false`、`runtimeCompatibility:"unverified"`。旧 plugin 不是可用路径。
3. **版本漂移无原始证据** —— `drift.evidence: []`、`verificationStatus:"unverified"`、`changeTime:null`；原 npm 日志据报被 `logs-max:10` 轮转删除，探针未重新验证轮转策略。0.1.7→0.2.0 只有会话报告，**不能**写成已核对的精确时间。
4. **`teamMessageDurable: false`** —— 消息已排队但目标 receipt 与 Lead delivered ack 未观察到；可靠消息两侧都无保证（Pi 该键未声明）。
5. **Pi `reasoningHighGuarantee: partial`** —— 只证明 `thinking.enabled` + `reasoning_effort=high` 的 payload 被接受并返回 200；服务端独立档位未证实。结论对象只能是 payload。
6. **`C−B` 整体功效 79.8% < 80% 目标** —— "长期演化相对图编排"的确认可能在设计上达不到宣称功效（条件功效 80.7%）。协议已给两条预批准补正（去掉 futility 看，或 `N→165` 重算），**至今无人选定**。
7. **受控试验额度未授权** —— `T2 ≈ 943 USD` 是**请求额度/设计估算**，不是批准；0.50 USD 探针额度已闭合。未授权前 L4 只能产出 `exploratory`/`inconclusive`。
8. **内核零运行证据** —— 并发、租约、fencing、原子 outbox、CAS、reconcile 全为设计。本包不把"图校验全绿"或"脚本退出码 0"当作实现正确。
9. **设计期矛盾真实存在且发现得很晚** —— 独立复核累计：`spec/graph` 7 轮（8 BLOCKER）、`spec/evaluation` 3 轮（2 BLOCKER + 13 MAJOR）、`spec/contracts` 1 轮（1 BLOCKER，即 A15 权威洞）、`probes/dsh` 1 轮（1 BLOCKER）。各 lane 目前已收口为"可接受"，但**不能排除仍有未被发现的内部矛盾**；L2 conformance 与后续人审是检验点。

## 7. L2 入口

**L2 = 宿主无关内核，9 个节点**（全部 `pending`）：

| 节点 | 一句话职责 |
|---|---|
| `l2_public_contracts` | 依冻结 schema 实现无副作用协议层（branded ID、版本化 command/event/effect、类型化错误） |
| `l2_state_store` | EventStore/SnapshotStore/Outbox/ArtifactStore 的 memory 参考实现与可选持久实现；单机 writer/CAS/revision 与原子 journal+outbox |
| `l2_graph_model` | GraphSpec 编译、依赖投影检查、类型边解析、artifact 绑定、图 revision 与 patch 事务 |
| `l2_policy` | AuthorityGrant / RiskPolicy / capability requirements / usage 完整性 / 预算预留与结算 |
| `l2_host_port` | HostPort 的 observe/execute/cancel/reconcile/context/usage 与 scoped DelegationGrant（**fake host**） |
| `l2_artifact_port` | 产物摘要、生产者身份、binding、权限分区与可用性检查 |
| `l2_scheduler` | ready frontier、claims、fence/epoch、子图深度/并发限制、资源锁与完整 fan-in |
| `l2_runtime` | create/step/pause/resume/cancel/observe/reconcile/close；归一化 host 事件，原子保存 events+outbox |
| `l2_kernel_verification` | 用 fake host + 真实持久实现走普通任务/动态委派/验证失败修复/超预算/崩溃恢复，核验唯一 policy/evaluation 入口 |

**L2 会证明**：协议层无副作用；journal/outbox 原子性；图编译与原子修订；预算与权限判定；跨模块去重与恢复 reducer 的自洽；**用 fake host** 能跑通普通任务、动态委派、修复、超预算、崩溃与恢复，且不留 "NOT WIRED" 影子判定。

**L2 不会证明**：
- **不等于任一宿主可用**——L2 的 host 是 fake；真实 DSH/Pi adapter 属 L3，DSH 的 13 项 `unknown` 一项都不会被 L2 消掉。
- **不等于收益成立**——L2 无收益实验，也不构建语料。
- **不等于 OS 隔离或供应商保证**——隔离强度、真实取消计费、可靠消息投递仍是未知。
- **不等于资产演化可用**——学习/晋升/撤销属 L4。

**L2 的开工前提**：`l2_public_contracts` 的 `ready_gate` 当前唯一 unmet 项是 **`l1_replan`（`ready`）**；其余 L2 节点同样串在这道门后。**人审通过前，L2 任何节点不得认领。**

## 8. 人审如何放行

**你的停点就是这里。** `l1_replan` 是 `requires_human` 门，cp3 只有真人能签；本包只提供输入。

建议顺序：

1. **读本包 + 抽查原始证据**（不必通读 3300 + 892 + 751 行）：至少实跑 `node scripts/probes/pi-native-probe.mjs` 与 `node scripts/probes/dsh-native-probe.mjs`（离线），确认退出码 0；再跑 `spec/contracts/README.md` 内嵌的 `verify-l1-freeze`（预期退出码 0）。
2. **逐项处置 R1–R18**：accept-proposal / request-revision / defer / reject。**defer 必须写明阻塞范围，空白不等于接受。** R1–R8 决定 L2 能否开工。
3. **逐份处置 10 份 ADR**（§3 只是建议）：由 **graph owner** 走图流程把决议落到 ADR 状态（`proposed → accepted` 或驳回）。**本 lane 不改 `.graph/`。** ADR 的 accept 与"技术保证已验证"是两件事。
4. **雾区**：**建议 amend 而非 graduate**（§4）。`graduate-fog` 会清空雾区，与 fog 文本自身约束冲突。此项由 graph owner 执行。
5. **签署载体**：真签署工件需要可验证的 human actor/authority root、时间戳、精确的内容/版本/范围/预算引用；`approvalRef` 指向该工件的 `ArtifactRef`（含 digest/schema/visibility）。**不得把本清单当作 approval**（`OPEN-ITEMS.md` 的 H01–H13 当前全为 `pending`，approvalRef 全 `null`）。
6. **`l1_replan` 状态流转**：由 orchestrator 经 graph CLI 记录（cp1 核对雾区条件、cp2 改图并重验、cp3 真人审核）；若需写图级审查凭据，走 `graph approve`（记录 review/design_approved 审计）——**这不是技术通过，也不改 ADR 状态**。
7. **L2 认领时点**：`l1_replan` 判 `passed` **且** R1（H01）有结论之后，`l2_public_contracts` 方可由 `pending` 置 `ready` 并认领；其余 8 个 L2 节点按依赖依次放开。若 R1 被 defer/reject，**L2 不得开工**。

**放行不改变的边界**：L2 全绿也不构成"DSH/Pi 可用"，更不构成收益成立；发布、release tag、npm publish 仍另需明确授权；旧 ledger / config / graph 保持原样。
