# 收益评测协议（PROTOCOL）

> 状态：**预注册草案（pre-registration draft）**，等待人审冻结为 `T0`。本文不含任何实验结果。
> 管辖：`l1_eval_protocol`；ADR `adr_0005`（四类判定分离）、`adr_0008`（受控收益）。消费方：`l4_capability_trial`、`l4_evolution_eval`、`l3_task_evaluation`。
> 配套文件：[SCENARIOS.md](SCENARIOS.md)（场景与拆分）、[METRICS.md](METRICS.md)（指标与阈值）、[PREREGISTRATION.md](PREREGISTRATION.md)（冻结字段表）、[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)（未定案项）。

本协议把"图编排与长期演化是否真的提高未见编码任务表现"写成一份**可在结果出现前冻结、之后只能按偏差记录修改**的执行规范。所有**阈值与判定公式**都是具体数字（不是“视情况而定”）；其取值依赖的**语料/模型/价格/种子**在 `T0` 填实并冻结，占位字段见 PREREGISTRATION §1。

---

## 1. 目的、范围与两条分离的验收合同

| 合同 | 判定入口 | 判什么 | 是否与 baseline 比较 | 文件 |
|---|---|---|---|---|
| 任务验收 `TaskVerdict` | `evaluateTask`（唯一生产裁决入口） | 这一个任务是否达到其 task contract | **不比较** | METRICS §2 |
| 能力收益 `EvaluationReceipt` | `evaluateCapability` | 配置/资产相对对照是否真有提升 | **比较**，需资源匹配 | METRICS §3 |

一个任务"完成了"不构成"能力提高了"的证据；一次收益试验不改变单个任务的验收标准。`TaskVerdict` 永不要求胜过 baseline（ADR-0005）。

**非目标**：本文不实现 kernel、不产出数据、不跑付费实验、不判断某一次具体实验的成败。它冻结"什么样的实验才算数"。

**外部证据边界**：本协议引用的宿主事实以 `probes/pi/` 的实测为准（Pi `0.87.1`，见 §8）；DSH 侧事实以 `probes/dsh/` 的探针结论为准，探针未完成前 DSH 的对照臂标记 `not-yet-comparable`（§9）。

---

## 2. 三个对照臂的最小可运行定义

三臂同模型、同工具集、同权限范围、同任务、同种子、同 `E` 包络（§3）。

| 臂 | 名称 | 最小可运行定义（Minimum Runnable Definition） | 明确不含 |
|---|---|---|---|
| **A** | 原宿主基线 host-native baseline | 一个宿主原生会话 + 一个 agent loop；输入＝base commit 的仓库快照、任务需求文本、公开验收信息、宿主默认工具与权限、包络 `E`；允许其内部自行规划（todo），但只有一个 writer、无独立 verifier 节点 | 无 kernel、无动态子图、无资产检索、无学习写入 |
| **B** | 图编排 graph orchestration | `E` 包络内的动态子图：1 个 planner 节点（产出 GraphSpec 并经 kernel 校验）→ 1–6 个 worker agent 节点（写域互斥；S1 层恰为 1 个）→ 1 个串行 integration writer → 1 个 fresh verifier（独立 context，只看产物与合同）→ 至多 2 次 repair attempt；kernel 负责 ready/lease/join/取消/预算 | **无**资产检索、**无**候选生成与晋升（AssetRegistry 关闭且为空） |
| **C** | 图编排＋长期演化 graph + long-term evolution | 完全包含 B；额外开启学习闭环：任务开始按 scope 检索 top-k（k≤5）已晋升资产并注入上下文；任务结束生成候选、在 dev/train 上独立评价、按预授权规则晋升、在宿主安全点激活 | 检索只允许命中 **train/dev** 产生的资产；held-out/final 永不产生资产 |

**B 与 C 的唯一差异必须是"学习闭环开/关"**。任何其他差异（模板、并发上限、工具集）算协议违背，须写偏差记录。

### 2.1 消融臂（exploratory，不改主结论）

| 消融 | 定义 | 预注册方向假设 |
|---|---|---|
| `B−verifier` | B 去掉 fresh verifier 节点，其余不变 | 成功率比 B 低 ≥ 0.05 |
| `B−parallel` | B 强制单 worker（不 fan-out），其余不变 | 成功率比 B 低 ≥ 0.05 |
| `C−retrieval` | C 关闭资产注入，但保留候选生成/晋升 | 与 B 无可区分差异（即价值来自检索） |
| `C−dynamic` | C 使用固定模板（不动态生成图） | 成功率低于 C |
| `C−retrieval` vs `C` | 同上两臂直接对比 | 检索的单独贡献 ≥ 0.05 |

`B−parallel` 是 v2 新增：ADR-0008 要求“不把更多 token 和并发当能力提高”，v1 的三个消融均未隔离 fan-out/并发。消融在主指标上只作**探索性**报告，不产生确认性收益声明。

---

## 3. 资源匹配：同包络（同成本上限、同墙钟上限）

匹配的对象是**每任务每臂的硬包络 `E`**（同上限），而非实际用量；并发度本身是处理的一部分，由 `B−parallel` 消融隔离。v1 标题写“同成本、同墙钟”但实际是“同 cap”，名不副实，已改。

### 3.1 包络定义（按场景层，三臂完全相同）

| 场景层 | 占比 | `request_cap` | `usd_cap` / run（µUSD，精确） | `usd_cap` / run (USD) | `wall_cap` / run | 并发预留上限 |
|---|---:|---:|---:|---:|---:|---:|
| S1 restricted | 40% | 20 | **190,940** | 0.190940 | 20 min | 20 |
| S2 cross | 35% | 40 | **381,880** | 0.381880 | 45 min | 40 |
| S3 repo | 25% | 80 | **763,760** | 0.763760 | 120 min | 80 |

- 单请求上限：`max_input_tokens_per_request = 60,000`（含 cached）、`max_output_tokens_per_request = 4,096`。
- 预留额 `reserve = 60,000 × p_uncached + 4,096 × p_output` = **9,546.88 µUSD**，按**向上取整到 µUSD** 冻结为 **9,547 µUSD**（= 0.009547 USD）；**`usd_cap = request_cap × 9547` 逐字段精确相等**，故 `usd_cap` 永不阻塞合法请求数。**禁止用浮点 epsilon 少预留**（R4 裁决）。原文档的 `190900 / 381900 / 763800` 与“逐字段相等”不符（精确值 − 原值 = **+40 / −20 / +40 µUSD**，即原 S1/S3 少预留、S2 多预留），已废。
- **校验口径冻结**：`settled_spend + outstanding_reservations ≤ usd_cap`（派发时检查）；完整 usage 后释放未用预留。v1 用整窗 reserve（0.14795）与 S1 cap 0.15 矛盾（只容 1 个并发预留），已按同式重算。
- 命中任一 cap 即终止该 run，状态记 `incomplete`，在 ITT（intent-to-treat）中计为**失败**（不是排除）。
- **并行不豁免**：三臂共用同一 `usd_cap`/`wall_cap`/`request_cap`；`usd_cap` 是父/子共享总账（planner、worker、verifier、learning、evaluation 全部计入）。
- **人工等待**：`human_wait_ms` 单列，**不计入** `wall_ms`/`wall_cap`。
- 实际用量必须逐 run 记录并报告；提前结束少花钱是**结果**，由 METRICS 的成本护栏评估。

### 3.2 匹配的可比性检查

| 检查 | 通过条件 | 不通过时 |
|---|---|---|
| 模型与宿主体一致 | 三臂同一 `provider/model-id`、同一宿主版本、同一 thinking payload | 该 cell 作废，重跑 |
| 包络一致 | 同一任务的 `E` 逐字段相同 | 协议违背，该任务整体作废 |
| 价格表一致 | 同一冻结 `pricingTableHash` | 成本类指标标 `cost-unknown` |
| 工具与权限一致 | 三臂可用工具集与权限根相同 | cell 记 `capability_absent`，该宿主判定固定 `blocked`（§9.1），不得静默削弱 A |

**A 不得被削弱**：禁止为了"让对照更公平"而移除 A 本来可用的工具。若 kernel 宿主拿不到某工具，记 `capability_absent`，并如实说明该宿主本次试验不可比。

---

## 4. 分区、污染控制与盲测

完整定义见 [SCENARIOS.md](SCENARIOS.md)。协议层只钉死四条不可协商规则：

1. **仓库不相交（v3 收紧）**：一个 repo **只属于一个分区**，**不得**用 commit 时间切分让同一 repo 跨分区（那会开一条 `train → held-out` 污染通道）。不得已时该 repo 整体降到 `train`。
2. **资产来源隔离**：C 的资产只由 `train` 生成；`dev` 只用于模板/超参选择；`held-out` 与 `final` 永不产生资产、永不用于调参。
3. **泄露检测**：每个候选任务先做记忆探针（memorization probe）。冷启动仅给 issue 文本、不给仓库；若复现参考补丁关键 hunk 的**定义化 token 重叠** ≥ 0.80，标 `leak_risk=high`，移出 held-out（降级进 train）并记录。度量算法、参考补丁来源与探测模型在 SCENARIOS §4 冻结（v1 只写“token 重叠”而无算法，已补）。
4. **盲评**：逐产物比较时，评测者看不到臂身份、看不到作者推理轨迹，只看到去标识（opaque ID、随机顺序）的产物、合同与私有测试。

---

## 5. 唯一裁决入口与 judge 独立性

| 关注点 | 冻结做法 |
|---|---|
| 唯一裁决入口 | 全部 task-level 判定只经 `evaluateTask` 产出 `DecisionRecord`；任何 worker/verifier 的自述"完成"都不是证据 |
| 成功的定义 | 私有 held-out 测试通过 **且** task contract 的必须分支均有绑定证据（产物 digest + 实际 diff + 运行输出） |
| judge 独立性（v3） | 质量分由**臂外独立盲评流水线**给出（同一流水线判全部 A/B/C，去臂标识）；**不得**用被评臂自己的 fresh verifier 判自己的质量分 |
| judge 的花费（v3） | 臂外 judge 记入独立 `judging_cost` 台账，**不计入被评臂包络**（测量不得污染处理成本）；但必须全额报告。臂**内** verifier 是 B/C 的处理，计入臂包络 |
| judge 成本的可比性（v3） | 臂外 judge 对 A/B/C 用**同一模型、同一 rubric、同一价格表**，且不去标识时不变；因此 `judging_cost` **在臂间视为同价**，不构成处理差异，也不需计入臂包络 |
| 一致性（v3） | 抽 20% 产物由第二名盲评者重评；**序数** Krippendorff's α < 0.60 → **仅质量类指标** `inconclusive`，**不影响** `task_success` 主判定与整体 verdict |
| 反馈可见性 | 失败反馈可回给执行者以 repair，但**私有测试内容与终审集内容永不回传** |

"唯一裁决入口"保证普通任务完成与能力收益走不同代码路径（ADR-0005）；judge 独立性保证收益不是被"自己人"判出来的。

---

## 6. 统计方法、阈值与冻结

主线：配对设计，每个任务在三臂各跑一次；按场景层分层。完整公式、样本量与阈值见 [METRICS.md](METRICS.md)。协议层钉死：

- 主指标：`task_success ∈ {0,1}`（ITT）。
- **主检验（v3）**：在 MVE 上做**双侧**检验（`H0^±: Δ = MVE`），`Z_MVE = (Δ̂ − MVE)/SE`；**判定一律走 `Z_MVE`**，`positive ⇔ Z_MVE ≥ c`、`negative ⇔ Z_MVE ≤ −c`，`c = 1.960`。v2 的“⇔ CI 下界 ≥ MVE”在 **BCa（非对称）下不精确**，已降为**敏感性分析**（不一致时以 `Z_MVE` 为准）。
- 主对比：**层次固定序列**，先测 `B−A`，仅当其 `positive` 才测 `C−B`；各自双侧 α=0.05，**只在确认看花一次**。
- **无疗效中期看（v3）**：v2 的 OBF 两看（`c₁=2.772`/`c₂=1.979`）**已取消**——中期不一致对 `E[n01+n10]=22.4<25`，疗效停止基本不可用（`P(≥25)=29.6%`）。保留一个 **futility-only** 看在 `N/2`（只看 `CP<0.20`，不报疗效），它是**不消耗 α 的停止**（`positive` 事件 ⊆ `{Z_final ≥ c}`），但**消耗功效**（METRICS §4.4 列出 0.9–6.0pp 损耗，`B−A` 整体 93.0%、`C−B` 整体 79.8%）。
- 每个宿主**分别**判定；产品级结论要求**两个宿主在确认看都 `positive`**。
- 区间：配对 bootstrap（BCa，10,000 次，**分层内 + repo 聚类**重采样）作为报告与敏感性；并列报告精确 McNemar（对 `Δ=0`）作次要参考。
- **不一致对下限（v3）**：**只在确认看生效**，`n01+n10 < 25` → `inconclusive`。确认看下 `B−A E=44.8 (P=99.99%)`、`C−B E=32.0 (P=93.5%)` 均满足。
- **聚类与升 n（v3）**：**cluster 单位＝repo**，held-out 每 repo 1 实例（⇒ `DEFF≡1`）；若被迫 `m>1` 则 repo 聚类 bootstrap + `DEFF`，`DEFF>1.25` 时 `N := ⌈160×DEFF⌉`（**边界不变**，因单看 α 与信息分数无关；futility 看移到 `N/2`）。`ρ̂` 只能在该 repo 于 `train`/`dev` 的其他实例上估。
- 多重比较（次要对比与消融）：Holm，α=0.05，标 `secondary/exploratory`。
- **最小有价值收益（MVE）**：`B−A ≥ +0.15`；`C−B ≥ +0.10`（绝对风险差，带推断效力）。设计备择冻结为 `Δ_alt = 2×MVE`；`n = 7.8488·π_c/m²` → 98/157 → **计划 160**。
- **护栏**：`cost_per_success ≤ 2.0×`；`p90(wall) ≤ 1.5×`；`incomplete_rate ≤ 对照+0.10`。护栏不过则不能判 `positive`。
- **结果前冻结**：所有阈值、样本量、边界值、语料 hash、种子、价格表在 `T0` 写入 [PREREGISTRATION.md](PREREGISTRATION.md) 并哈希；之后任何修改只能作为偏差记录，且修改需标 `post-hoc`。

外部方法的前提与局限（不堆名词）：

| 方法 | 适用前提 | 本协议下的局限 |
|---|---|---|
| 配对 bootstrap BCa | 任务实例之间可交换、同层内近似同分布 | 实例数少、二元指标离散；需加并列修正与 repo 级加速度；故并列报告精确 McNemar（仅作次要参考） |
| 预注册 | 冻结发生在看结果之前 | 无法阻止事后"解释"；靠偏差记录约束，不做无证据的合规断言 |
| 盲评 | 去标识足够彻底、评分者不知假设 | 产物本身可能泄露风格；只能降低不能消除偏差 |

---

## 7. 预算会计

**计入范围（全量）**：planner、worker、verifier/reviewer、learning（候选生成、检索、评价）、benchmark judge、图编译若走模型、以及宿主的隐式请求。

| 项目 | 规则 |
|---|---|
| 计量口径 | 以每次 provider HTTP 响应的 `usage` 为准；prompt 拆 `uncached` / `cached` 分别计价；`reasoning_tokens` 已含于 completion，**不得重复计入 output** |
| 缓存 token | 按 cache 单价计费，不按未缓存价，也不计为零 |
| 重试与失败 | 每次真实请求全额计入（失败/取消也计，未知则保留预留） |
| 隐式请求 | title/summary、auto-compact、cache warming：能关则关并记录；关不掉则计入并单列 |
| usage 缺失 | **不得按零回收**；保留预留，run 标 `usage_incomplete` |
| 缺失阈值 | 确认集中 `usage_incomplete` 的 run 占比 > 5% → 整体判 `inconclusive` |
| 成本来源分级 | `measured`（provider usage × 冻结价表）/ `estimate` / `unknown`；不把 API 估价冒充账单 |
| 预留口径 | 发请求前预留，完整 usage 后结算；未知花费不释放 |
| 总账 | 父/子共享；跨 session 汇入同一 `MODEL-BUDGET.json`，不重置 |

当前状态：**开发期调用无美元上限**（deepseek/gpt，用户 2026-10-01 明确），但**受控试验（L4）的付费调用至今没有任何授权额度**。`execution/MODEL-BUDGET.json` 里的 0.50 USD 是 2026-10-01 的**探针测试额度**，与上述两者都不是同一件事（详见 PREREGISTRATION §3）。

因此：试验额度属于 **请求**而非已有授权（默认 T2 ≈**943 USD**，备选设计见 OPEN-QUESTIONS §1.1）。在获授权前，L4 只能交付 `exploratory`/`inconclusive`，且**不得以“预算不足”为由缩小成功标准**。

---

## 8. 停止规则与判定

样本量与边界见 METRICS §4。**判定是一条有序函数（METRICS §5.2 是权威全文）**，优先级由代码顺序给出，不得自创第二套：

```text
judge(cell, look):
  L0  cell_status ∈ {capability_absent, not_yet_comparable} → blocked
  L1  usage_incomplete_ratio > 5% 或 发现污染/泄露      → inconclusive(degraded-data)
  L2  look == FUTILITY_LOOK(N/2) → CP<0.20 ? inconclusive(futility) : continue
      look ∉ {FUTILITY_LOOK, CONFIRMATORY_LOOK}       → exploratory_only
  L3  look == CONFIRMATORY_LOOK(N):
        n < n_planned                               → exploratory_only
        n01+n10 < 25                                → inconclusive(discordance-floor)
        Z_MVE ≥  c                                  → positive
        Z_MVE ≤ -c                                  → negative
        else                                        → inconclusive(ci-spans-mve)
```

| 要点 | 修正的 v2 缺陷 |
|---|---|
| **L1 先于 L3** | v2 的 `negative` 无完整性条件，可在 20% usage 缺失/有污染时给出“无收益”这一确认性结论 |
| **`positive` 显式要求 `n ≥ n_planned`** | v2 的 `positive` 没有此条，与“`exploratory` = 任何 n<计划 n”重叠 |
| **`exploratory_only` 只指“非预注册的提前结束”** | v2 “任何 n<计划 n”会把**预注册中期疗效停止**也归为 exploratory，与自己设计的中期看冲突 |
| **中期不再产出疗效结论** | v3 取消疗效中期看，仅留 futility-only（`CP<0.20`），从根上消除重叠 |

**停止规则（v3）**：唯一确认看 `N=160`，边界 `c = 1.960`（双侧 α=0.05）；futility 看在 `N/2=80`，只看条件功效（METRICS §7.6 冻结公式），是**不消耗 α 的停止**，但**消耗功效**（整体功效 `B−A` 93.0%、`C−B` 79.8%，见 METRICS §4.4）。v2 的 OBF 两看（`c₁=2.772`/`c₂=1.979`）**已取消**（中期不一致对 E=22.4，`P(≥25)=29.6%`）；v1 的 2.012 亦已作废。

**不得做的事**：不放宽 MVE；不因 n 不足而少报失败样本；不把单次 scenario 成功当作收益；不因"代码写完/节点全绿"宣称目标达成。

---

## 9. 不可比与能力缺失

| 情形 | 记录方式（证据面） | 结论（判定面） | 禁止 |
|---|---|---|---|
| 宿主缺 capabilities（如 usage、cancel、recovery） | HostManifest 标 `absent`/`unknown`，带失败路径 | 缺项影响合同则 `blocked` | 把“未验证”写成“已成立” |
| 某臂需要的工具/权限在宿主不存在 | cell 标 `capability_absent` | 固定 `blocked` | 悄悄降级 A，或删减测试来“拉平” |
| 三臂 thinking payload 在**同一宿主内**无法逐字节一致 | cell 标 `capability_absent`，记录三臂实际 payload | 固定 `blocked` | 为凑一致而修改任一臂 payload，或降级为“照跑、事后解释” |
| 供应商取消计费未知 | 保留预留，标 `unknown`，不归零 | 不改变判定 | 把 abort 当免费 |
| 宿主间实现差异 | 允许（实现可不同） | 不改变判定 | 把一个宿主的条件不足改写成“第二阶段接入” |

### 9.1 单一判定映射（不得二选一）

`capability_absent` 与 `blocked` **不是二选一**，而是同一次判定的两个面：

- **证据面**：cell/证据记录用 `capability_absent`（写清缺什么、失败路径、证据等级）。
- **判定面**：该宿主的 verdict **唯一固定为 `blocked`**。映射 `capability_absent ⇒ blocked` 是恒等式，不存在“或记 capability_absent”的替代。

**thinking payload 的具体规则（v2 修正作用域）**：规则**只在宿主内部**成立——同一宿主上 A/B/C 三臂对同一任务必须发送逐字节相同的 thinking payload，这是可做到且必须做到的。**跨宿主**不要求一致：不同宿主的 payload 差异如实记录 `reasoning_effective`，**不构成 `blocked` 理由**（跨宿主本就不做合并统计，PER HOST 分别判定）。v1 把“某宿主做不到”与“另一臂只能发开关”混写成跨宿主约束，作用域错乱，已改。

**pi 实测事实（必须遵守）**：Pi `0.87.1` 的 `high` 实际只发送 `thinking.type=enabled` + `reasoning_effort=high`，MiMo 官方仅文档化 thinking 开关，服务端是否存在独立 high 档位**未证实**（HostManifest `reasoningHighGuarantee: partial`）。因此本试验的结论对象是“**thinking enabled 且 reasoning_effort=high 的 payload**”，不是“high 档位”；宿主内三臂 payload 逐字节相同使该未知不影响臂间比较。**R11（人审）裁决为 `payload-only`**：`ModelRequirement.reasoningGuarantee = payload-only`，任务与比较双方固定 payload，服务端不明如实披露。

---

## 10. 可复现性与冻结

- 固定并记录：`provider/model-id`、宿主版本、kernel commit、工具版本、语料 manifest hash、拆分 hash、价格表 hash、种子（任务顺序、臂随机化、采样）、`temperature`（显式写死，不用默认）。
- 每个 run 产出：完整 usage、wall-clock、退出状态、产物 digest、实际 diff、`DecisionRecord`、包络命中情况。
- 分析脚本在 `T0` 前写好并哈希；`T0` 后不改脚本，除非写偏差记录。
- 数据、私有测试、终审集不入公开仓库；只提交协议、脚本、manifest 与聚合结果。

---

## 11. 与 ADR / 节点合同的对应

| 要求 | 本协议落点 |
|---|---|
| 普通任务完成 ≠ 能力改善（ADR-0005） | §1 两条合同分离；§5 唯一裁决入口 |
| 受控收益 A/B/C、资源匹配、盲测、区间（ADR-0008） | §2 三臂；§3 包络；§4 盲评；§6 统计 |
| 预算计入 planner/worker/reviewer/学习/评测 | §3.1、§7 |
| 阈值在结果前审定 | §6 冻结 + PREREGISTRATION |
| 不足证据可 inconclusive | §8 |
| 双宿主都需通过 | §6 |
| 终审集不用于优化 | §4、SCENARIOS §4 |
