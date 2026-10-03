# 预注册表（PREREGISTRATION）

> 状态：**草案冻结（draft-frozen）**。本文列出的字段必须**在结果出现前**由人审确认并写入 `T0` 时间戳；`T0` 之后任何改动都是偏差，需登记在 §6。
> **人审裁决已发生**：`l1_replan` cp3 已完成，逐项处置见 `execution/L1-REPLAN-DECISION.md`。其中 R4（包络精确值）与 R11（reasoning payload-only）已落地本文；**R12（T0 定案：设计/额度/模型/签署）仍为 `defer`**，故本表保持 `draft-frozen`，不是 `T0`。
> 本表是 [PROTOCOL.md](PROTOCOL.md) / [SCENARIOS.md](SCENARIOS.md) / [METRICS.md](METRICS.md) / [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) 的可机读摘要；冲突时以三份正文为准，并须修正本表。

---

## 1. 冻结字段

| 字段 | 冻结值 | 冻结时机 |
|---|---|---|
| `T0` 时间戳 | `<待人审填写>` | 人审批准时 |
| 冻结人 / 凭据 | `<待填写>` | 同上 |
| 试验预算授权 | `<未授权>`（详见 §3） | T0 |
| `provider/model-id` | `<待授权>`（参考：`xiaomi/mimo-v2.6-flash`） | T0 |
| `thinking_payload` | **宿主内**三臂逐字节一致；跨宿主差异记 `reasoning_effective`（不构成 blocked）。**结论对象是 payload（R11：`payload-only`），不是未证实的服务端独立档位**；`reasoningHighGuarantee: partial` 如实保留 | T0 |
| `temperature` / 采样参数 | 显式写死，不用缺省 | T0 |
| 宿主版本 | Pi `0.87.1`（已固定）；DSH `<待探针>` | T0 |
| kernel commit | `<T0 时冻结>` | T0 |
| 价格表 | `p_uncached` / `p_cached` / `p_output` + `pricingSource` + `pricingTableHash` | T0 |
| 语料 manifest hash | `corpusManifestHash` = `<待语料构建>` | T0 |
| 拆分 hash | 四路实例 ID 列表的 hash | T0 |
| 种子 | 任务顺序种子、臂随机化种子、bootstrap 种子 | T0 |
| 分析脚本 hash | 主分析脚本 sha256 | T0 |
| PP 排除清单 hash | 预声明的排除原因列表（不含“撞 cap”） | T0 |
| 泄露度量 hash | SCENARIOS §4.1 的 tokenizer/归一化/LCS/阈值定义 | T0 |
| 评分 rubric 版本 | 见 METRICS §3 | T0 |

## 2. 冻结的设计参数

| 参数 | 值 |
|---|---|
| 臂 | A 原宿主基线 / B 图编排 / C 图编排＋长期演化 |
| 分层配额 | S1 40% / S2 35% / S3 25% |
| 拆分规模 | train 60 / dev 30 / held-out 160 / final 20（合计 270）；取整用最大余数法、平局取份额大者 |
| 计划 n | held-out **160**/臂（确认看）；futility 看 `N/2=80` |
| 预授权自适应 upgrade | `DEFF>1.25` 且确认集被迫同一 repo `m>1` 时 `N := ⌈160×DEFF⌉`（记录，不算偏差；**边界不变**） |
| 主指标 | `task_success ∈ {0,1}`，ITT（**唯一**进入产品级结论的指标） |
| 次要指标 | `quality_score`（条件于成功）、`itt_composite`、`incomplete_rate` |
| 主检验 | **在 MVE 上的双侧检验**（`H0^±: Δ = MVE`）；`Z_MVE=(Δ̂−MVE)/SE` |
| **唯一权威判定** | **`Z_MVE` 与 `c` 比较**；BCa CI 与打分型 `SE₀` 仅作敏感性（不一致时以 `Z_MVE` 为准） |
| `positive` 规则 | `Z_MVE ≥ c = 1.960` **且** `n ≥ n_planned` |
| `negative` 规则 | `Z_MVE ≤ −1.960` **且** `n ≥ n_planned` |
| **判定优先级** | 有序函数（METRICS §5.2）：L0 可比性 → L1 完整性 → L2 look → L3 `Z_MVE` |
| 疗效中期看 | **无**（v2 的 OBF 两看 `c₁=2.772/c₂=1.979` 已取消；中期不一致对 E=22.4<25） |
| futility 看 | `N/2=80`，只看 `CP<0.20`（公式 METRICS §7.6）；**不消耗 α** 但**消耗功效**（整体：`B−A` 93.0%、`C−B` 79.8%）；不报疗效，停止结论 = `inconclusive` |
| 确认看边界 | **`c = 1.960`**（单看、双侧 α=0.05） |
| 不一致对下限 | `n01+n10 ≥ 25`，**只在确认看生效**（确认看下 B−A 44.8 / C−B 32.0） |
| 聚类 | **cluster＝repo**，held-out 每 repo 1 实例（⇒ `DEFF≡1`）；被迫 `m>1` 才启用 repo 聚类 bootstrap + DEFF（`ρ̂` 在同 repo 的 train/dev 实例上估） |
| 区间 | 分层内 + repo 聚类 bootstrap BCa，10,000 次，95%（**报告/敏感性**，不覆盖 `Z_MVE`） |
| 多重比较 | 层次固定序列 `B−A` → `C−B`；各自 α=0.05 只在确认看花一次；次要/消融 Holm |
| MVE | `B−A ≥ 0.15`；`C−B ≥ 0.10` |
| 设计备择 `Δ_alt` | **冻结为 `2 × MVE`**（`B−A 0.30`；`C−B 0.20`）；`n=7.8488π_c/m²` → 98/157 → 160 |
| 功效 @ n=160（含 futility） | 设计备择 `2×MVE` 下整体：`B−A` **93.0%**、`C−B` **79.8%**（条件功效 94.8%/80.7%；损耗 1.8/0.9pp） |
| futility 损耗补正（预批准） | 若要求 `C−B` 整体 ≥ 80%：① 去掉 futility 看（则用条件功效），或 ② `N` 提到 165 并重算——二选一 |
| 成本护栏 | `cost_per_success ≤ 2.0×` 对照 |
| 时间护栏 | `p90(wall) ≤ 1.5×` 对照 |
| 截断护栏 | `incomplete_rate ≤` 对照 `+0.10` |
| 无效性 | 条件功效 `CP < 0.20`（公式见 METRICS §7.6） |
| usage 缺口阈值 | `usage_incomplete` run 占比 > 5% → `inconclusive`（**L1 先于方向性结论**） |
| 评分者一致性 | **序数** Krippendorff's α ≥ 0.60；不达只影响质量类指标，**不影响** `task_success` |
| judge | **臂外**独立盲评流水线；成本记 `judging_cost`（**不计入臂包络**但全额报告） |
| 泄露阈值 | LCS token 重叠 ≥ 0.80 → `leak_risk=high`（度量见 SCENARIOS §4.1） |
| 单请求上限 | input ≤ 60,000 tokens；output ≤ 4,096 tokens |
| 包络（request_cap / usd_cap µUSD / 墙钟） | S1 20 / **190940** / 20min；S2 40 / **381880** / 45min；S3 80 / **763760** / 120min（R4：`usd_cap = request_cap × 9547`，精确相等） |
| 包络自洽约束 | `usd_cap = request_cap × 9547 µUSD`；`reserve = 60,000×p_unc + 4,096×p_out = 9,546.88 µUSD`，**向上取整到 µUSD**；禁止 epsilon 少预留 |
| 产品级结论门槛 | **两个宿主都 `positive`** |
| 试验预算 | T2 **请求额度** ≈ **943 USD**（**未授权**，见 §3）；开发期调用**无美元上限** |

## 3. Budget Authorization Status（预算授权状态）

**本节用于消除一个前提错误**：`MODEL-BUDGET.json` 里的 `$0.50` 与 `xiaomi/mimo-v2.6-flash` 是 2026-10-01 的**探针测试额度**（为 Pi 原生接入探针申请），**不是**本次开发的预算授权，也**不是** L4 受控试验的授权。三者互不冲突，不能互相挪用或替代。

| 类别 | 范围 | 上限 | 授权状态 | 谁批 |
|---|---|---|---|---|
| **(a) 开发期调用** | 实现/调试/自测中调用 deepseek、gpt 等模型（含 agent 编排、脚本、探针辅助） | **无美元上限**（用户 2026-10-01 明确） | **已授权** | 用户已给 |
| **(b) 试验期调用** | L4 确认性试验（A/B/C 三臂 × 宿主 × held-out/final/dev/train/消融）的全部付费调用 | **未授权**；请求额度见 §2（默认 T2 ≈**943 USD**；备选设计见 OPEN-QUESTIONS §1.1） | **未授权，需人审** | 用户须给出额度或选择缩减设计 |
| (c) 探针测试额度 | 2026-10-01 Pi 原生接入探针 | 0.50 USD，已结算 ~0.001982 USD | 已用毕/关闭 | — |

**约束（在 (b) 授权前）**：

1. **不得**以“预算不足”为由缩小成功标准、MVE、样本量定义或验收门槛。成功标准与预算额度**解耦**：没钱只会让结论变成 `exploratory`/`inconclusive`，不会让标准变松。
2. 未获 (b) 授权时，L4 只能交付：协议本身、可运行实现，以及 `exploratory`/`inconclusive` 标注下的受限证据。
3. 请求 (b) 额度时必须同时给出备选设计（OPEN-QUESTIONS §1.1），使决策是“选设计”而不是“给不给钱”。
4. (a) 的调用**不得**被挪用来充抵 (b)：开发期调用不构成试验样本，不得计入任何 `task_success`/`quality`/收益指标；反之试验调用的用量必须完整记入 `MODEL-BUDGET.json` 对应 session。
5. 任何把 (a)/(b)/(c) 混记，或把 (c) 探针额度当作 (b) 授权的行为，属协议违背，须写偏差记录。

## 4. 交付文件 hash（草案快照）

`T0` 冻结时须重算并替换；下表为**本轮 v3 草案** hash，用于追踪修订：

| 文件 | 行数 | sha256（草案） |
|---|---:|---|
| `PROTOCOL.md` | 234 | `52c1f9360824bac0b70eafddbd97bde26ff4f6e0099b456fa651252034f7e3d4` |
| `SCENARIOS.md` | 147 | `d87bb76b0e5526037403658c0ee0c35b6a6155f6a4c8f2ed5bfe332da89111e6` |
| `METRICS.md` | 310 | `dd5c75fdf1437a9fece6586ebd3317fa4879ac90caf4d2c83365af81c58f34fd` |
| `OPEN-QUESTIONS.md` | 70 | `66bde5072e1c1d34d1f37abdc4a458cfd4deb522136700fe871000b4610fdc74` |
| `PREREGISTRATION.md` | 本文件 | 自哈希在 T0 由审查者生成 |

## 5. 分析产物清单（`T0` 后只读）

1. 每个 run 的原始记录：usage、wall、`human_wait_ms`、status、产物 digest、实际 diff、`DecisionRecord`、包络命中。
2. 配对表：`(instanceId, repoId, familyId, stratum, arm, host) → success, quality, cost, wall, incomplete`（**`repoId` 必需**：cluster 单位是 repo，repo 级 bootstrap/jackknife 靠它分组）。
3. 主分析输出：`Δ̂`、`n01/n10`、`Z_MVE`、BCa CI、中期/最终判定、功效、**DEFF/ρ̂**、`incomplete_rate`、ITT 与 PP 与“三臂皆完成”敏感性三版。
4. 消融输出（5 个，含 `B−parallel`）、分层事后分析。
5. 偏差记录、排除清单、`usage_incomplete` 清单、污染发现清单、包络命中清单。
6. 负结果、`inconclusive` 与 `blocked` 必须与正结果一同报告。

## 6. 偏差政策（deviations）

| 类型 | 允许 | 要求 |
|---|---|---|
| `T0` 后改阈值/样本量 | 仅在人审批准后 | 写偏差记录：原因、批准人、对结论的影响、标 `post-hoc` |
| 改分析脚本 | 仅修复已证明的实现错误 | 记录 diff + hash，重跑全部结果 |
| 排除 run | 仅限 `T0` 冻结的排除清单 | 清单外排除一律算协议违背 |
| 提前终止 | 预注册 futility 看或外部中断 | 记录触发时点与数据；futility 停止结论 = `inconclusive` |
| 补测 | 不允许"跑到显著为止" | 任何补测视为新试验，需重新预注册 |
| 预授权自适应 | `DEFF>1.25` 时 n→`⌈160×DEFF⌉`；分析脚本只修 bug | 记录触发证据，不算偏差；但不得用于改 MVE/α/设计备择 |

## 7. 签署

| 角色 | 姓名/凭据 | 日期 | 结论 |
|---|---|---|---|
| 协议作者（首稿） | pi pane `verify-main`（即 `l1_eval_protocol` 执行者） | 2026-10-01 | v1 草案提交 |
| 交叉复标 r1 | pi pane `review-2`（独立、非作者） | 2026-10-01 | 需修订：1 BLOCKER + 多 MAJOR（已全部处理，见 `execution/reviews/l1_eval_protocol-review-r1.md`） |
| 协议作者（v2 修订） | pi pane `verify-main` | 2026-10-01 | 移位零假设/OBF 边界/聚类/包络自洽 已修；提交二次复核 |
| 交叉复核 r2 | pi pane `review-1`（独立、非作者） | 2026-10-01 | 需修订：1 BLOCKER + 3 MAJOR（已处理，见 `execution/reviews/l1_eval_protocol-review-r2.md`） |
| 协议作者（v3 修订） | pi pane `verify-main` | 2026-10-01 | 判定有序函数 / 取消疗效中期 / 单看 c=1.960 / DEFF 边界 / 判分解耦 已修；提交三次复核 |
| 收口复核（MINOR 清扇） | pi pane `review-1` | 2026-10-01 | 可接受；6 项 MINOR/NIT 已处理（SCENARIOS v3 口径、配对表 `repoId`、§4.4 含 futility 功效、删除不可复现的“精确口径”列、repo 跨分区污染通道、judge 同价） |
| 分析脚本独立复核 | `<待> `（**非作者**） | | 重算 `c=1.960`、功效表、DEFF 公式、判定函数分支穷尽性（OPEN-QUESTIONS Q18） |
| 人审批准（`T0`） | `<待> ` | | |
