# l1_replan 人审结论（L1-REPLAN-DECISION）

节点：`l1_replan`（type=gate，`ctx_contract`）· 管辖 ADR：`adr_0009`
执行者：orchestrator S02 · **真人裁决人：用户 Calvin-Xia**
人审形态：用户在会话内审阅 `L1-REVIEW-PACKAGE.md` 后**明确确认**（"人审确认吧，你不用看我咋说" → "我已经确认"）。**不是代签**：cp3 的 verifier 是本会话的用户，凭据归属为真人。

> 本文件是 cp3「真人增量审核实施计划」的凭据，也是 cp1/cp2 的结论记录。
> 它**不是**收益成立的声明，也**不是**发布授权。

---

## 1. 裁决基线

- 接受 L1 冻结的四项产物作为 L2–L5 的实施基线：`probes/`（两宿主固定版本能力矩阵）、`spec/graph`、`spec/evaluation`、`spec/contracts`（`l1-freeze.2`）。
- 接受的前提是它们**已被独立交叉复核并收口**（`spec/graph` 7 轮、`spec/evaluation` 2 轮 + 收口、`spec/contracts` 3 分片 + 集成收口、`probes/dsh` 2 轮）。
- **接受冻结 ≠ 接受收益成立**。L1 没有一行实现代码、没有任何收益数据；两宿主证据强度不对称（Pi 2 次真实付费请求 / DSH 0 次）。

## 2. R1–R18 逐项处置

处置词：`accept-proposal`（按产物提案批准）/ `accept-with-scope`（批准但收窄验收范围）/ `defer`（不定，写明阻塞面）。

### 阻塞 L2 的 8 项（已全部定案）

| # | 来源 | 处置 | 决定与理由 |
|---|---|---|---|
| **R1** | H01 | **accept-proposal** | 按提案批准 `evofence.runtime/1` + `evofence.assets/1` + `schemaVersion 1.1.0`（`1.0.0` 保留可读）、core 闭包仅 `protocol/kernel/runtime`、单 journal + 四权威（`A01–A15`）、major/minor 规则。理由：`verify-l1-freeze` 脚本实测退出码 0，`adr_0009` 已 accepted；选项 (b) 要求改后重批但没有新增证据。**代价已接受**：新实现不得沿用旧 ledger 资格。 |
| **R2** | H09 | **accept-with-scope** | L2 的 `l2_state_store` 验收范围 = **内存参考实现** + 在该实现上可证明并可故障注入的 CAS / outbox / claims / leases / reservations 不变量。**耐久 backend（SQLite 或其他）为独立可选实现，不在 core 依赖内**（`adr_0009`），不构成 L2 验收项。理由：把耐久 backend 设为 L2 门槛会与被接受的 `adr_0009` 直接冲突，并引入未验证的运维范围。 |
| **R3** | H07 | **accept-proposal** | 宿主原生 board **永远只是 kernel claim 的投影**（提案 (a)），以 `A15` 作可失败判据（board task owner 必须等于 kernel claim，否则 `EFK_HOST_BOARD_AUTHORITY_CONFLICT` 且该 attempt 不推进）。**不引入 subtree authority 移交协议**。理由：移交协议需要另定原子移交/撤销/父预算/子 grant 合同与故障证明，其失效模式完全未证；仅投影是保守且可检验的所有权选择。 |
| **R4** | H11 | **accept-proposal** | 按精确值 **`9547 µUSD/请求`** 重算三层包络：**S1 `20 / 190940`、S2 `40 / 381880`、S3 `80 / 763760`**（原文档 `190900/381900/763800` 与"逐字段相等"的文字不符，差 −40/+20/−40 µUSD）。**禁止用浮点 epsilon 少预留**。理由：包络必须与"逐字段相等"的自我承诺一致；偏小的 cap 会在最坏用量下兑现不了声明的预留数。 |
| **R5** | H12 | **accept-proposal** | **不要求** DSH 具备 Pi `appendEntry`/custom-entry 等价语义（提案 (a)）。需要该保证的任务标 `unsupported`；binding/receipt 走共同 journal。理由：(b) 依赖 DSH 磁盘重开取证，而磁盘恢复正在 13 项 `unknown` 内；把它设为必填会让 L3 阻塞在一个未证能力上。 |
| **R6** | H13 | **accept-proposal** | `parentChildCancellation` 与 `toolCancellation` **不作为 task hard**（提案 (a)）。取消未确认记 `EFK_CANCEL_UNCONFIRMED` 并**保持 `unknown`**；lease 释放与 unknown 核实不以前提级联成立。理由：(b) 会要求两宿主补真实长流/子成员取消取证，当前 DSH 侧全 unknown，将导致相关任务双宿主 unsupported。 |
| **R7** | H06 | **accept-proposal** | **接受 same-user 信任域**（提案 (a)），以 task/scope/capabilities 限定范围，并**显式披露**："越过 hooks 的写入与外部动作没有检测保证"。**任何产物、文档或 UI 都不得宣称 hooks 或 worktree 等于 OS 沙箱。** 理由：与 `ARCHITECTURE §7`「初期范围是本机、同一用户信任域的多 agent」一致；(b) 要求注入外部 OS 隔离 Workspace/Host 并取证，当前 DSH `unknown`、Pi `absent`。 |
| **R8** | H05 | **accept-proposal** | 采用**共同 kernel ack 路线**（提案 (a)）：journal/outbox + 目标消费 ack。**不承诺外部 exactly-once**。理由：(b)"等宿主原生持久投递"在当前两侧均为 unsupported（DSH `checks.teamMessageDurable=false`、Pi 该键未声明），会把可靠协调整类任务挡死。 |

### 不阻塞 L2 的 10 项

| # | 来源 | 处置 | 决定与理由 |
|---|---|---|---|
| **R9** | H02 | **defer（不阻塞 L2；阻塞 `l3_dsh_session` 的准入路线选择）** | 倾向"显式声明不兼容当前 DSH"（提案 (b)），因为升级 `integrations/` 包属**发布范围**，需要单独授权。故本项挂起为**待授权项**：在授权到来前，旧 integration 不准入，只走面向 `0.2.0-rc.2` 的新 adapter 路线。已写入 `l3_dsh_session` 的 DoD。 |
| **R10** | H03+Q6 | **defer（阻塞 DSH 真实取证，不阻塞 L2）** | DSH 真实 provider/child/usage/activation/用户资源共存的取证范围与额度未定；与 R12 的预算授权一并处理。当前结论不得越过内存 fixture 的证据等级。 |
| **R11** | H04+Q9 | **accept-proposal** | reasoning **payload-only**：结论对象是三臂实际发送的 payload（Pi `high` 实测发送 `thinking.type=enabled` + `reasoning_effort=high`），**不是**未证实的服务端独立档位。`reasoningHighGuarantee: partial` 如实保留。 |
| **R12** | H08+Q1/Q5/Q13/Q16/Q17 | **defer（阻塞 `l4_capability_trial`）** | T0 定案（设计 + 额度 + 模型 + 签署）缺预算授权：T2 请求额度约 747 USD，**至今无任何已授权数字**。未授权前不得开工，也不得以"预算不足"缩小成功标准；届时如实标 `inconclusive`。已写入 `l4_capability_trial` 的 DoD。 |
| **R13** | Q2+Q15 | **defer（阻塞 L4 语料构建）** | held-out 语料来源/授权、"测试作者 ≠ 模板作者"分权未定。范围明确：只影响 `l4_*` 的评价语料，不影响 L2/L3。 |
| **R14** | Q3 | **defer（阻塞 L4 终审）** | 终审裁决主体未定（谁来判最终验收）。 |
| **R15** | Q4+Q14+Q20 | **defer（阻塞 L4 质量轴）** | 质量分所需人力与 judge 独立性未定；`α≥0.60` 门槛已在协议内冻结，缺的是执行资源。 |
| **R16** | Q7 | **defer（阻塞 L4 记忆探针阈值校准）** | 记忆探针阈值需 pilot 实测校准。 |
| **R17** | Q18 | **defer（阻塞 L4 分析可信度）** | 分析脚本目前只要求哈希，缺独立复核的正确性保证。 |
| **R18** | H10+Q19 | **accept-proposal** | 上游文档漂移由各 owner 在 L2 开工时一并合入 `spec/contracts` 的漂移记录（`OPEN-ITEMS §4` 的 T 项机制），不单独立项。 |

**已由协议处理、不作为待决项的 4 项**（记录以备查）：Q8（`human_wait_ms` 不计入 wall-cap）、Q10（供应商取消计费未知 → 保留预留不归零）、Q11（成本为 USD 参考估计 → 标 `costBasis`）、Q12（bootstrap/盲评只降低偏差 → 并列报告精确 McNemar + `α≥0.60`）。

## 3. cp1｜雾区毕业条件核对（结论）

雾区 `dual-host-runtime-and-uplift` 的分段毕业条件：

| 段 | 条件 | 结论 |
|---|---|---|
| L1 | DSH/Pi 固定版本能力探针 | ✅ 满足（`probes/pi` 与 `probes/dsh`，含 VERSION-PIN 文件级 SHA256） |
| L1 | 图语义 / API / 评测协议 | ✅ 满足（`spec/graph`、`spec/contracts`、`spec/evaluation`） |
| L1 | `l1_replan` 人审 | ✅ 满足（本文件） |
| L2 | 并发/恢复生产核验；DSH 13 项 unknown 有证据或明确保留 | ❌ 未满足 |
| L4 | 预注册双宿主受控收益证据达标 | ❌ 未满足 |

**处置：`amend`，不 `graduate-fog`。** 依据 fog 自身文本"不能因 probe passed 清空全部雾区"。已通过 `graph update-graph --set-fog` 把雾区描述改写为"L1 段已解决 + 剩余三条未知"，`graduation` 改写为完整毕业条件，`ignited` 改指 `l2_kernel_verification` / `l3_dsh_session` / `l4_capability_trial`。

> 操作事故记录：S02 于 2026-10-01 12:4x **误用 MCP `graph_update_graph`**，该工具面根在**主 checkout**（`.graph/active` = `evofence-042-hardening`），导致雾区文本一度被写进 042 图。已用 `graph graduate-fog --graph evofence-042-hardening` 清除并留痕（含 `fog_graduated` + `graph_amended` 事件，reason 写明是跨图误写撤销），042 图 `validate` 回到 **0 错误 0 警告**。**正确通道是 worktree 内的 CLI + `--graph`**；本图后续所有图级写入一律走 CLI，不再用 MCP。

## 4. cp2｜改图并重验（做了什么）

| 动作 | 依据 | 结果 |
|---|---|---|
| 雾区 amend | cp1 结论 | `--set-fog` 重写 description/graduation/ignited |
| **ADR 采纳 8 份** | `L1-REVIEW-PACKAGE §4` 建议 + 用户确认 | `adr_0002/0003/0005/0006/0007/0008/0009/0010` → `accepted` |
| **ADR 暂缓 2 份** | 同上 | `adr_0001`、`adr_0004` **保持 `proposed`**：二者的**决定**不被质疑，但它们含"必须验证 lifecycle/cancel/recovery"与"CAS/outbox 原子性、unknown 必 reconcile、replay 零副作用"等**运行**承诺，L1 无运行证据，留待 L2 核验后采纳 |
| 节点修订 `l4_capability_trial` | R12 + `METRICS §4.4` | 追加两条 DoD：受控试验须先获预算授权（否则 `inconclusive`，不得缩小成功标准）；开工前须执行预批准的功效补正之一（去 futility 看 或 N→165 重算），并披露 C−B 整体功效 79.8% 低于 80% 目标 |
| 节点修订 `l3_dsh_session` | R9 + `probes/dsh/VERSION-PIN.json` | 追加一条 DoD：目标版本以实测 `0.2.0-rc.2` 为准；`integrations/` 仍钉 `0.1.7-rc.1`，须由用户决定跟随升级或显式声明不兼容，不得静默按旧版本适配 |

**重验**：`graph validate --graph evofence-harness-kernel` → **0 错误 / 1 警告**（唯一警告是雾区未毕业提示，属预期）；`graph export --docs --check` → **无漂移（21 文件）**。

## 5. cp3｜真人审核实施计划（结论）

**人审结论：批准 L1 冻结基线作为 L2–L5 的实施基线。** 依据：

1. 五份 L1 产物全部经独立交叉复核并收口，且跨 lane 漂移已由 orchestrator 集成收口（`verify-l1-freeze` 退出码 0）。
2. R1–R8 全部定案，L2 的三个直接前置（R1/R2/R3）已给出明确范围；R4 的数值修正已在结论中给出并派给 owner。
3. 人审**认可实际选型、协议与实现节点**（DoD 第二条）：内核选型为"小型确定性 reducer（`adr_0009` 已 accepted）"，协议为 `l1-freeze.2`，实现节点保持 L2 九节点不变。
4. `program` 档位**保持不变**——不因 research passed 自动降档。

**未随本结论放行的事项**（不得被读成已批准）：
- 不批准任何**发布**动作（npm publish / release tag），不授权修改 `integrations/` 包（R9）。
- 不批准任何**收益成立**的表述；L4 结论仍受 R12–R17 阻塞。
- `adr_0001`、`adr_0004` 仍为 proposed。
- `l5_accept` 的人审**不在本次委托范围内**，仍须真人在交付时裁决。

---

## 6. L2 进入条件

- `l1_replan` 判定 `passed`（本文件即 cp3 凭据）后，`l2_public_contracts` 由 `pending` 置 `ready` 并认领；其余 8 个 L2 节点按依赖依次放开。
- L2 执行分工（本轮实测依据）：`pi + deepseek/deepseek-flash high` 承担接口/schema/骨架写作与快速校验；`codex + gpt-6.1-sol xhigh` 只用于真实宿主探针、内核并发/恢复与跨文档一致性裁定（`l1_api_freeze` 单节点耗 codex 1h19m，同类写作节点 pi 用 10–20 分钟且同样通过独立复核）。
- 代码风格：**禁止防御性编程**（用户直接指令；对 gpt 系为硬性要求），例外见 `SESSION-PROTOCOL.md` 的 5 类有意失败闭合。
