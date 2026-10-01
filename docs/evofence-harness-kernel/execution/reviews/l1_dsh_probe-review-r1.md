# 独立交叉复核：l1_dsh_probe（第 1 轮）

> 复核者：独立 pi pane `review-2`（同一 worktree、只读、非作者）。
> 复核对象：`scripts/probes/dsh-native-probe.mjs`、`scripts/probes/dsh-probe-support.mjs`、`docs/evofence-harness-kernel/probes/dsh/` 五份产物。
> 本文件是**评审记录**，不是被审产物。

---

## 复核回合 1

结论: 需修订（blocker 1）

---

**[BLOCKER] METRICS.md §5.1/§5.2 + PROTOCOL.md §8 — `positive` 只要求"点估计 ≥ MVE"，从未对 MVE 做检验；而 `negative` 却用"CI 上界 < MVE"。同一份证据在一个方向上被当判据、另一个方向上被明文弃用。**

- 原文（PROTOCOL §6 表）："配对 bootstrap BCa…**且 CI 不用于跨越 MVE 的精确判定**"；原文（METRICS §5.2）："`positive` … `Z ≥ 边界` **AND `Δ̂ ≥ MVE`**"；"`negative` iff 最终时 `Δ̂` 的 95% CI 上界 < MVE"。即：宣称收益 ≥ MVE 只用点估计，否认收益才用区间下/上界——方向性双标。
- 复算：设真值 `Δ=0.10`（低于 MVE 0.15）、`π_d=0.28`、`n=100`。`E[n01−n10]=nΔ=10`，`Var(n01−n10)=n(π_d−Δ²)=100×0.27=27`，`sd=5.196`。`P(Δ̂≥0.15)=P(n01−n10≥15)=P(Z≥(15−10)/5.196)=P(Z≥0.962)=0.168`，而此时 `Z=15/√(n01+n10)≈15/√28=2.835 ≥ 2.012` 必然满足。也就是约 **1/6 的概率**把真实 0.10 的效果报成"确认性 Δ≥MVE"。这不是 α=0.05 的确认性规则。
- 建议：把主检验零假设改为 `H0: Δ ≤ MVE`（移位零假设 / 需要 CI 下界 ≥ MVE），并统一口径——`positive` 用"下界 ≥ MVE"、`negative` 用"上界 < MVE"；若坚持"MVE 是产品判断不做推断宣称"，必须在 §5.1 明写该宣称不含推断效力。

---

**[MAJOR] METRICS.md §4.2/§4.5（+ PROTOCOL.md §8）— 终看边界 2.012 不是 OBF 边界，是"α 相减"的独立近似；由此"两看仅增约 4% n"也是其产物。**

- 原文：§4.2 "O'Brien–Fleming 两看设计相对单看约增加 4% 的 n（终看边界 2.012 而非 1.96）"，两看为 t=0.5/1.0。
- 复算（数值积分，`corr=1/√2`）：中期 `α(0.5)=2(1−Φ(1.95996/√0.5))=2(1−Φ(2.77181))=0.005575` → 2.771 ✓（这一步正确）。但 `c2=2.012` 等于 `Φ⁻¹(1−(0.05−0.005575)/2)=2.0118`，即默认两次看的拒绝概率可加。实际联合概率 `P(|Z1|≥c1)+P(|Z1|<c1,|Z2|≥c2)=0.04654 < 0.05`。解 `总 α=0.05` 得 `c2=1.9793`；原始 OBF 形状 `C√k` 解得 `(2.7965, 1.9774)`。即 **正确 OBF 终看边界 ≈ 1.977–1.979，不是 2.012**。
- 进一步：以 2.012 求 80% 功效需 `n=100.8`（对单看 97.67，膨胀 3.2%）；改用 1.979 只需 `n=98.5`（膨胀 0.85%）。所以"约 4%"是把边界取大的自然后果，不是 OBF 的性质；且文档的 79%/59% 功效正是用 2.012 算出的（见"确认无误"条 3），一旦改成正确边界，整套功效/样本量数字都要重算。
- 建议：用 Lan-DeMets OBF 花费函数 + 联立分布数值求解边界，并据此重算 §4.2/§4.3（注意 2.012 偏保守，不造成 I 类错误，但结论数字与"OBF"命名不符）。

**[MAJOR] METRICS.md §4.1 + PROTOCOL.md §6 — McNemar 的前提与聚类问题未写：Z 需要不一致对足够多、任务对相互独立。**

- 原文：§4.1 "检验统计量用 McNemar 的 `Z=(n01−n10)/√(n01+n10)`"；PROTOCOL §6 "按场景层分层"；METRICS §4.4 又称"分层…事后分析标 exploratory"。主分析到底池化还是分层没写。
- 复算/事实：`Z` 是渐近正态，常用前提 `n01+n10 ≳ 25`。本设计 `E[n01+n10]=nπ_d`：B−A = 28（尚可），**C−B = 20（偏低）**，中期 C−B 仅 10 —— 在该处用 OBF 正态边界不可靠。更严重的是 SCENARIOS §3.1 只保证"任务家族不相交"（不跨分区），**未保证 held-out 内每个 family/repo 只有一个实例**；同族实例相关会使 `Var(n01−n10)` 被低估、I 类错误膨胀。文档全文无一字提聚类/设计效应/有效样本量。
- 建议：预注册"不一致对下限（如 <25 换精确/置换检验）"、在 family 层做聚类 bootstrap 或报设计效应、并明写主分析是池化还是分层（若分层则 bootstrap 必须分层重采样）。

**[MAJOR] PROTOCOL.md §3.1 + probes/pi/README.md（+ execution/MODEL-BUDGET.json）— 包络与预留自相矛盾：S1 只能容纳约 1 个并发预留，与 B/C 的并行 worker + request_cap 冲突。**

- 原文：§3.1 "S1 restricted | 0.15 USD … request_cap 40"；"`reserve = max_context_tokens × p_uncached + max_output_tokens × p_output`；…发请求前预留，完整 usage 后结算"。
- 复算（用 probe 冻结价 0.14/M 未缓存、0.28/M 输出，窗口 1,048,576）：`reserve = 1,048,576×0.14/1e6 + 4096×0.28/1e6 = 0.1468006 + 0.0011469 = 0.14795 USD`，即 S1 `usd_cap=0.15` 的 **98.6%**。B/C 定义含 1 planner + 1–6 并行 worker + verifier；并发请求需要并发预留，按"发请求前预留"语义 S1 无法同时预留两个请求，`request_cap=40` 与"并行不豁免"不可实现（除非把 cap 检查改成结算额——文档没写）。S3 同理：1.00 USD / 160 请求 = 0.00625 USD/请求 ≈ 44.6k 未缓存 token，长上下文任务会先撞 usd_cap。
- 建议：冻结"cap 用结算额还是预定额校验"与并发预留规则，或按最坏预留重算 S1/S2/S3 的 usd_cap。

**[MAJOR] SCENARIOS.md §4 + PROTOCOL.md §4 — 决定实例能否进 held-out 的 `token 重叠 ≥ 0.80` 没有可执行定义（算法、参考补丁来源、探测模型全缺）。**

- 原文：SCENARIOS §4 "冷启动仅给 `requirement` 文本，不给仓库；若模型能复现参考补丁关键 hunk 的 token 重叠 ≥ **0.80**，判 `leak_risk=high`"。
- 问题：(a) "token 重叠"是 LCS？n-gram 覆盖率？用哪个 tokenizer？(b) "关键 hunk"与"参考补丁"从哪来——SCENARIOS §5 只列了 `privateTests`，未列 reference patch，而 §5.1 允许"手工构造的行为级任务"，那类任务可能根本没有参考补丁；(c) 探测用什么模型/temperature/ pass@k？文档只承认阈值是"启发式"（§4 局限），未承认算法本身未定义。这是"预注册却靠运行时再定"的典型。
- 建议：冻结重叠度量（含 tokenizer/归一化）、参考补丁的产出流程与缺失时的替代规则、探测模型与重复次数。

**[MAJOR] 与同轮既有文档冲突：CONTRACTS.md §8 与 ARCHITECTURE.md §11 仍写"阈值/样本量未决定、不得无数据编数值"，与本 spec 的 n=100/π_d=0.28 直接对立。**

- CONTRACTS §8 原文："具体阈值、样本量与模型预算尚未决定，不存在本轮已运行试验。"
- ARCHITECTURE §11 原文："具体样本量由可辨识收益、任务方差和实验预算决定，**不在无数据时编造数值**。"
- 而 SCENARIOS §3 现在正是"以 `π_d=0.28`、`δ=0.15` 反推 n≈98→100"。这两处要么是过时，要么是明确的反对意见，节点 plan 要求"共享 protocol/public 文档改动经各自 owner 合入"——本轮交付没有登记这三处 pending 冲突，等于同一 worktree 内自相矛盾。
- 建议：在本节点 execution_report/OPEN-QUESTIONS 显式登记这三处待 owner 合入的漂移，或说明为何 §11 的告诫被覆盖。

**[MAJOR] METRICS.md §4.1/§5.2（+ PROTOCOL.md §6）— BCa 说明不足，且 CI 的角色前后矛盾。**

- 重采样单位**已写明**且一致（PROTOCOL §6 "按任务实例重采样"、METRICS §4.1 "按任务实例重采样（保持配对）"、PREREG §2 "按任务重采样"）——这点没问题。
- 缺：(a) 分层设计下未说明是否**分层重采样**（不写则 CI 目标是无权的池化差）；(b) 离散统计量（`Δ̂` 是 {−1,0,1} 的均值）下 BCa 的 `z0` 应含 `0.5×并列` 修正、加速度常数来源未写；(c) 一个 CI 两种用法：PROTOCOL §6 说"CI 不用于跨越 MVE 的精确判定"，METRICS §5.2 的 `negative` 又用"CI 上界 < MVE"。
- 建议：写明分层重采样、并列修正、加速度 jackknife 单位；把 CI 的用途统一（与 BLOCKER 一并修）。

**[MAJOR] PROTOCOL.md §2.1/§3/§3.1 — 标题"同成本、同墙钟"名不副实（实为同 cap 非同实际用量），且没有任何消融隔离"并行/fan-out"。**

- §3 原文："要求是**同成本与同墙钟约束**，不是同 token 数。匹配的对象是**每任务每臂的硬包络 E**，而非实际用量"——即同上限，不是同消耗。
- 臂定义（§2）：A = 一个 writer；B/C = 1 planner + 1–6 并行 worker + verifier。同一 `wall_cap` 内 B/C 拿到更多并行算力，而 §2.1 的三个消融（去 verifier / 关检索 / 固定模板）都不覆盖"并行度"。ADR-0008 的核心是"避免把更多 token 和并发当能力提高"，当前设计不隔离开销与并发；OPEN-QUESTIONS §4 只把"去 fan-out"列为**可选**。
- 建议：把"单 worker 图 vs 多 worker 图"作为预注册消融，或在 §3 明写并发视为处理的一部分并给出可解释的边界。

**[MAJOR] METRICS.md §2/§3 — `quality_score` 被标为"co-primary（次级地位）"，但没有任何推断程序，且只在成功样本上有定义。**

- 原文：§1 "主（质量）`quality_score ∈ [0,100]` … **co-primary（次级地位）**"；§3 "仅对 `task_success = 1` 打分；失败 run 记 `quality = n/a`（**不记 0**）"；§5.2 `positive` 只在"质量指标参与时"要求 α≥0.60。
- 问题：共主指标却没有检验统计量/样本量/功效/多重比较分配；只在成功子集上定义 → 后处理选择偏倚（B 成功率更高，则 B 的质量样本构成不同）；`positive` 到底要不要质量改善没写。DoD-2"冻结…质量主指标"因此只冻结了 rubric，没冻结推断。
- 建议：要么降级为 secondary 并写明，要么给出 ITT 版本的复合端点（如 `success×quality`）作为共主指标，并纳入 §4 的检验与 §4.4 的多重比较。

**[MAJOR] METRICS.md §2/§4.5 + PROTOCOL.md §3.1 — ITT 把"撞 cap 的 incomplete"计 0，而撞 cap 概率随臂的请求结构系统不同，且 PP 不排除它。**

- 原文：PROTOCOL §3.1 "命中任一 cap 即终止该 run，状态记为 `incomplete`，在 ITT 分析中计为**失败**"；METRICS §2 "PP（per-protocol）排除'预声明的排除清单'（基础设施故障、`capability_absent`）"。
- 问题：B/C 在每个任务内要多花 planner/verifier/learning 调用，同一 cap 对它们更紧；"撞 cap → 0"就把"预算耗尽"和"答错"混为一谈，形成对处理臂的截断（保守方向，但会压功效、制造假 negative）。PP 只排除基础设施故障，撞 cap 不计入排除清单 → 两种分析里都看不到这个差异。
- 建议：逐臂报告 incomplete 率（作为主安全指标之一），并预注册"三臂皆完成的配对子集"作为敏感性分析。

---

**[MINOR] METRICS.md §4.3 vs PREREGISTRATION.md §2 — 同一目标三个数：`n≈163` / `n=165` / 公式给出的 157。** §4.3 "需 n ≈ 163"、同节末"升级路径是 held-out n = 165"、PREREG §2 "held-out 165"。我复算两看设计下 C−B 达 80% 为 **162.0**（与 163 吻合），而按 §4.2 表公式（单看）为 `7.84888×0.20/0.01=156.98→157`。三处需统一并标注是否含两看膨胀。

**[MINOR] METRICS.md §7 — 预算表算术不一致。** 按配额 40/35/25 与 cap 0.15/0.40/1.00，每任务均值 = `0.4×0.15+0.35×0.40+0.25×1.00 = 0.45`。则 dev 应为 `30×3×0.45=40.5`（写 41.4）、三消融应为 `3×50×0.45=67.5`（写 68.4）、小计 `135+41.4+27+27+68.4=298.8`（写 299.8），而双宿主列 597.6 = 2×298.8 又与写的单宿主小计不符；按 0.45 复核合计应为 ≈742.5，写出 747。

**[MINOR] PREREGISTRATION.md §1/§2 — 自称"没有视情况而定"，但多个关键字段仍是占位。** `temperature`/采样参数只写"显式写死，不用缺省"（无值）；价格表、种子、`corpusManifestHash`、PP 排除清单、分析脚本 hash 全为 T0 占位；节点 plan 要求"固定模型版本"，而 `provider/model-id` 仍是"`<待授权>`（参考…mimo-v2.6-flash）"。作为"草案冻结"可接受，但 PROTOCOL 头部的"所有阈值都是具体数字或判定公式；没有'视情况而定'"这句话不成立。

**[MINOR] SCENARIOS.md §5 vs METRICS.md §7 / OPEN-QUESTIONS.md §1.1 — 两个 pilot 规模并存。** §5 "held-out ≥ 40 / final ≥ 10 / dev ≥ 20 / train ≥ 40" 的最小可行子集，与 P4/T1 的 "held-out n=20" 冲突，未说明二者关系。

**[MINOR] SCENARIOS.md §7 F3 — "在 `final` 上跑 A / C（B 可选，按预算）"。** 终审主对比把 B 设成"按预算"可选项，等于终审阶段"视情况而定"，且 final 上无法隔离学习效应（缺 B 就无法定位 C 相对 B 的增量）。

**[MINOR] METRICS.md §4.5 — 无效性 `CP < 0.20` 的公式未在文档冻结。** 原文"公式由分析脚本实现并哈希"；预注册应把条件功效公式（尤其"未来不一致率＝已观测不一致率"的确切代入）写进正文，否则 futility 边界属"运行时再定"。

**[MINOR] METRICS.md §2 — `needs-human` 计 0 依赖未定的 `run.status` 语义。** §2 "`needs-human` 的 run 在 ITT 中计 0"，而 OPEN-QUESTIONS Q8 仍在问"wall-cap 是否包含 needs-human 等待时间"，两者未闭合。

**[MINOR] METRICS.md §1 — `verifier_catch_rate` 分母无定义。** "抓到的问题数 /（抓到 + 事后发现）"——"事后发现"由谁、在哪个时间窗、以什么为界判定，未写。

**[MINOR] PROTOCOL.md §9.1 — thinking payload 规则的作用域混乱。** 原文要求"**三臂**对同一任务发送**逐字节相同**的 thinking payload。若某**宿主**做不到一致（例：Pi `high` … 而**另一臂**只能发开关）"：A/B/C 三臂都在同一宿主上，payload 天然可一致；而 §6 又写明"每个宿主**分别**判定"、无跨宿主统计。该规则要么空转，要么越权要求跨宿主一致，需重写为"宿主内三臂 payload 一致 + 跨宿主差异如实记录 `reasoning_effective`（不构成 blocked 理由）"。

**[MINOR] PROTOCOL.md §9 vs 判定词表 — `not-yet-comparable` 是新词。** §1/§9 用 DSH 对照臂标 `not-yet-comparable`，但 METRICS §5.2 的判定词表只有 `positive/negative/inconclusive/blocked/exploratory`，该状态无落点。

**[MINOR] METRICS.md §4.4 — 固定序列与顺序边界的交互未写。** "先测 B−A，仅当其通过才测 C−B；该顺序天然控制族错误率"——固定顺序 + 不回收 α 本身是对的实现，但未写：C−B 是否也有中期看？若 B−A 在中期就判 positive，C−B 在什么信息量、用什么边界测？

**[MINOR] OPEN-QUESTIONS.md — 漏掉明显该问的。** 至少缺：(1) **判分模型的选择偏倚**——fresh verifier 用哪个模型、是否与被测/被注入资产同族（自我偏好），以及除 α 外的 judge 校准；(2) **held-out 私有测试与模板的作者同源冲突**（Q2 只问"谁写谁审"，未点名这会造成系统偏向 B/C）；(3) 上述**聚类/设计效应**；(4) **撞 cap 截断偏倚**；(5) 用 20 任务 pilot **校准 π_d** 太粗——观测 6/20 不一致时 π_d 的 95% CI 约 0.14–0.56，不足以支撑样本量决策（Q5 却说"可校准"）；(6) **分析脚本无人独立复核正确性**（只要求哈希）。

---

**[NIT] PREREGISTRATION.md §7** — 作者署名 "pi pane `verify-main`"，与执行者 S02 / 审查者角色的署名规约不一致，应核对。
**[NIT] METRICS.md §1** — 同一格内"co-primary（次级地位）"自相矛盾。
**[NIT] SCENARIOS.md §3** — "四舍五入到整数"未说明平局取整方向（dev 30 → S2 `10.5` 被记为 10、S3 `7.5` 记为 8）。

---

**已核对但确认无误的点**

1. **两条验收合同确实不同**（回答轴 A）：PROTOCOL §1 表 + METRICS §2 的 `evaluateTask`（绝对、不比 baseline、ADR-0005）与 §3–§5 的 `evaluateCapability`（相对、资源匹配、需 MVE）；`TaskVerdict 永不要求胜过 baseline` 与 adr_0005 的 decision 一致。不是同一套改名。
2. **样本量表逐格复算全对**：`(z+z)²π_d/δ²` 下 0.20/0.28/0.35 × 0.10/0.15/0.20 = 157/70/40/220/**98**/55/275/122/69，与 §4.2 完全一致；`π_d=0.28, δ=0.15 → 97.67` 取整 100 合理。
3. **功效数字独立复现**：用两看 OBF `(c1=2.771, c2=2.012)` 做联立数值积分，`B−A (π_d=0.28, δ=0.15, n=100) → 79.7%`、`C−B (π_d=0.20, δ=0.10) → 59.2%`、`C−B 达 80% 需 n≈162`——与 §4.3 的 79% / 59% / 163 吻合（但见 MAJOR 2：这些数建立在非 OBF 的 c2 上）。
4. **草案哈希与行数自洽**：sha256/行数 `PROTOCOL 211/5a8d097a…`、`SCENARIOS 112/c2949677…`、`METRICS 197/d1021c48…`、`OPEN-QUESTIONS 60/0a55378d…` 与 PREREG §4 完全一致。
5. **与 Pi 探针事实一致**：PROTOCOL §9/§9.1 与 OPEN-QUESTIONS Q9 正确引用 `HOST-MANIFEST.json` 的 `reasoningHighGuarantee: partial`，明确"结论对象是 payload 不是 high 档位"；成本口径（`reasoning` 含于 completion、cache 按缓存价、usage 缺失不归零）与 `probes/pi/README.md`、`execution/MODEL-BUDGET.json`（0.50 USD 探针额度、预留 0.16、window 1,048,576）一致，PREREG §3 的 (a)(b)(c) 三分也正确区分了开发期/试验期/探针额度。

（只读复核：未改任何文件，未动 `.graph/`，未执行 git 写操作；`graph get-node` 为只读查询。）

---

## 复核回合 2

结论: 需修订（blocker 0）

---

**[MAJOR] `docs/evofence-harness-kernel/probes/dsh/VERSION-PIN.json`（`drift`）+ `README.md`「版本漂移」段 — 交付件声称核对了两份 npm 日志的 argv，但 artifact 里的 `evidence` 是空数组，被引日志文件在磁盘上已不存在，而 `note`/`changeTime` 仍是硬编码结论。**

- 实测：交付件 `drift.evidence = []`，但 `drift.note = "Two commands about four seconds apart, latesr then latest…"`、`drift.changeTime = "2026-10-01T10:00:20.719Z"`、`observedExternalChange: true`；README 写"两份 npm 日志的已知 argv 行经只读选择器核对：…`@latesr` / …`@latest`"。
- 实测磁盘：`~/AppData/Local/npm-cache/_logs/` 里**没有** `2026-10-01T10_00_16_268Z-debug-0.log` 与 `…10_00_20_719Z-debug-0.log`（npm `logs-max:10`，19:02–19:13 的 11 条日志已把它们轮转掉）；现存最早为 `2026-10-01T10_02_24_074Z-*`（内容是 `npm view pi-goal-x version`，与 DSH 无关）。
- 为什么是错的：`provenance()`（`scripts/probes/dsh-probe-support.mjs`）只用 `fs.existsSync` 决定 `evidence`，文件不存在就 `continue`；但 `note`/`changeTime` 是**常量字符串**，不随 `evidence` 是否为空变化。于是交付件一边说 `evidence: []`（没有证据），一边用断言语气给出日志内容；README 把无 artifact 支撑的叙述写成已核对。这正是 DoD"未知项不填 verified"所禁止的形态（版本漂移属"版本"证据面）。
- 建议：`note`/`changeTime` 条件化（`evidence.length===0` 时降为 `unverified`/`null`），README 改为如实记"日志已轮转、本 artifact 不含该证据"，或把这 2 份日志在读取时复制进探针 lane 再落盘，使证据可复现。

**[MAJOR] `README.md` 能力表 vs `HOST-MANIFEST.json.capabilities` — 人类矩阵的 `partial` 行在机器矩阵里根本没有条目，两侧状态词表也不一致。**

- 实测：README 有 "advisory write scopes / grant | **partial**"、"team wait / interrupt | **partial**"、"用户 Skills/全部插件共存 | unverified"；`HOST-MANIFEST.json` 的 `capabilities` 只有 24 项，词表实测为 `{verified, unverified, unknown}`（无 `partial`），**没有** grant/write-scope、team wait/interrupt、skills 三项条目——write-scope 的缺口只藏在 `nativeTeamGraphBoard.limitation: "Write scopes advisory; not kernel lease/fencing"` 里，team wait/interrupt 在 JSON 中完全不存在。
- 为什么是错的：adr_0006 要求"相同语义 contract suite，差异通过 manifest 解释"；只读 JSON 的消费方（`l1_api_freeze`、task requirements）会看不到"grant 强制未验证""team wait/interrupt 未验证"，即把 README 明写的部分未知在机器层丢掉了。
- 建议：为 grant/write-scope enforcement、team wait/interrupt、skills/plugin coexistence 各建显式 `unverified` 条目，并统一 `partial` 的语义（或用 `partial` 作为第四种状态）。

**[MAJOR] `HOST-MANIFEST.json` / `VERSION-PIN.json` 与 Pi 侧不同构，缺少共享状态词表 —— 两个 manifest 无法逐字段比较。**

- 实测：
  - Pi 状态词表 `{absent, partial, unknown, verified}`；DSH `{unknown, unverified, verified}`。
  - Pi top keys 无 `status`/`homeObservation`；DSH 额外有这两个。
  - Pi-only 能力：`sdkChildSessionIsolation`、`sessionCustomEntries`；DSH-only 11 项。
  - VERSION-PIN 仅共享 `version`、`files`；Pi = `providerModel/selectedModel/catalogSource/pricingSource/price/thinkingSource`，DSH = `observedVersion/pinSatisfied/packageRoot/nodeVersion/platform/arch/cli/packages/drift/integrationGap/recordedAt`。
  - `model` 字段语义不同（Pi=`xiaomi/mimo-v2.6-flash` 真实模型；DSH=`offline-probe/deterministic-fixture` fixture 标签）。
- 为什么是错的：探针范围的差异可以解释，但**状态枚举**不同意味着一个统一消费者无法判断"DSH 的 unverified"对应 Pi 的 `absent` 还是 `partial`，削弱 adr_0006 的 parity 可测性。
- 建议：抽出两边共用的最小键集与状态枚举（如 `verified/partial/unverified/unknown/absent` 五值），host-specific 内容放独立子对象。

**[MINOR] 6 个已执行的通过检查没有进入机器矩阵（orphan）——`DoD：「逐能力证据」在 JSON 层不完整。`**

- 实测：39 checks 中 33 个被 `capabilities[].checks` 引用，孤儿为 `reasoningParameterFixture, contiguousSessionOrder, leadMembership, teamWaitCancellation, teamIdleStatusVocabulary, memoryPersistenceLogMatches`；反向检查"矩阵引用但未执行"为 0。
- 其中 `teamWaitCancellation` / `teamIdleStatusVocabulary` 恰是 README "team wait / interrupt partial" 的证据，却无处可查（与上一条同源）。
- 建议：补 `teamWaitAndInterrupt` 等条目，或明确说明哪些检查只作诊断不升级为能力证据。

**[MINOR] 边界声明与机器字段不符：README「用户 home/config/.env/认证文件不读取」与 `isolation.userConfigRead:false` / `homeObservation.userFilesRead:false`，但探测确实读了用户 home 下的文件与目录。**

- 实测：`provenance()` 读 `~/AppData/Local/npm-cache/_logs/*.log`（用户 home 下文件）；`inspectHome()` 对 `C:\Users\Calvin-Xia\.dsh` 做 `fs.existsSync`，该目录实测存在且含 `.credentials.yaml`（924 B）；此外它 `import` 并调用第三方 `resolveDshHome()`，故 `credentialsRead:false` 是探针**意图**声明，而非对被执行函数内部行为的验证。
- README 正文确实描述了读 npm 日志，但机器字段没有对应项，且那句"home 不读取"是过度概括。
- 建议：加 `npmLogsRead:true`、`homeDirStatOnly:true` 字段，并把该句改为可核对的精确边界。

**[MINOR] `live-trace.json` 是 252 B 的 not-run 拒绝记录，却被列进 `HOST-MANIFEST.evidenceFiles`（Pi 侧同名文件是 6.2 KB 真实 live 证据）。**

- 实测：DSH live-trace keys `status/reason/paidRequests/credentialsRead/budgetMutated/recordedAt`，`status:"not-run"`；Pi live-trace keys `mode/checks/trace/payloads/rawRequests/receipts/errors/evidence/limitations/piVersion`（真实证据）。
- 内容诚实（明确"未发付费请求"），但"evidenceFiles 里叫 live-trace 的东西其实是空壳"会被误读为两边都有 live 证据。
- 建议：改名 `live-trace.not-run.json`，或在 HOST-MANIFEST 里给它加 `evidenceLevel:"not-run"`。

**[MINOR] 40 条静态声明里 3 条 `lines: []`（符号在对应 d.ts 中未命中），与 README「静态声明清单附有 package/version/file/行号」不符。**

- 实测：`@deepseek-ai/dsh-agent lib/types/index.d.ts "withInitiator("`、`@deepseek-ai/dsh-tools lib/types/index.d.ts "addExecutionGuard("`、`@deepseek-ai/dsh-session-projection lib/types/index.d.ts "register("`。全部 `evidenceLevel:"static-declaration-only"`、`runtimeVerified:false`（这点正确）。
- 另：cp1 判定只要求 `declarations.length` 非零，所以"钩子清单"即使大面积失配也会 passed。
- 建议：空行号条目显式标 `symbolNotFound`，cp1 增加"声明清单非空且无空行号"的条件。

**[MINOR] 总状态 `completed-with-limitations` 只由 `checks.teamMessageDurable` 单点决定。**

- 实测（脚本）：`status = errors.length ? 'failed' : checks.teamMessageDurable ? 'passed' : 'completed-with-limitations'`。即无论存在多少 partial/unverified 能力，只要 `teamMessageDurable` 为 false 就恒为同一状态。
- 建议：status 由"未验证/unknown 能力计数"派生或附 `limitations` 摘要，使状态信息量可用。

**[NIT]** `inspectAlternateRoots()`（support 第 ~127 行）已实现但主脚本未 import/调用（死代码，无副作用）。`--live` 与默认路径行为完全相同，用法串只说"不发付费请求"，易被误读为切换 live 模式。offline-trace 内嵌每次运行随机生成的 child sessionId（交付件 `923d962d-…` vs 我复跑 `2b30f3a1-…`），离线证据不可能逐字节复现。

---

**你的实测**

- **隔离运行**：把 `dsh-native-probe.mjs`、`dsh-probe-support.mjs`、`integrations/deepseek-harness/package.json` 复制到 `/tmp/dshprobe-672` 后运行（**未在原 worktree 执行**，原 artifact 哈希运行前后不变）。`node scripts/probes/dsh-native-probe.mjs` → **exit 0**，stdout：`status=completed-with-limitations, dshVersion=0.2.0-rc.2, checkpoints cp1/cp2/cp3=passed, 39 checks 中 38 true、唯一 false=teamMessageDurable, fixtureModelCalls=6, paidRequests=0, errors=[]` —— **与作者自报逐字一致**。
- **可复现性（强）**：我复跑产出的 `HOST-MANIFEST.json` 与交付件 **逐字节相同**（sha256 `252000195080997b…`）；`VERSION-PIN.json`/`live-trace.json` 仅 `recordedAt` 不同，`offline-trace.json` 另有一个随机 child `sessionId` 不同。
- **幂等**：连跑两次 stdout 完全相同，输出文件集恒为 4 个 JSON、无累积；隔离副本内除 3 个输入文件外无任何额外文件，`~/.dsh` mtime 保持 Sep 29（无 session log 落盘）。
- **参数**：`--unknown` → `{"error":{"code":"PROBE_USAGE"}}` **exit 1** ✓；`--live` → exit 0 且走离线路径并写 not-run ✓；`--help` → exit 0 ✓；`node --check` 两脚本 **exit 0** ✓。
- **付费路径**：脚本 `globalThis.fetch` 被替换为抛错函数，无 `http.*`/`axios`/provider 调用；唯一子进程是 `spawnSync(node,[<dsh>/lib/bin.js,'--version'])`，env 仅 PATH/TEMP 等非认证字段；`paidRequests:0`、`credentialsRead:false` 与实测吻合。
- **写入边界**：`writeJson` 白名单 4 文件名 + `outputRoot`；无 `.graph/`/`src/`/`test/`/`integrations/`/`package.json` 写入、无 npm install、无 git 命令。原 worktree `git status --short` 运行前后均为 `?? docs/evofence-harness-kernel/`、`?? scripts/probes/`。
- **独立复算**：VERSION-PIN 的 **54 个 SHA256 全部重算通过（54/54，0 mismatch，0 missing）**，`packageRoot` 存在；`integrationGap.sha256` 重算 = `dccfbef95cf236aef219169e59416ff28e705b702f71d4afdb5cfb3f55578295`（与交付件一致）。

**已核对但确认无误的点**

1. 版本固定成立：`observedVersion=0.2.0-rc.2`、`pinSatisfied=true`、16 个 `@deepseek-ai/*` 依赖全部解析为 `0.2.0-rc.2`（packages 版本集合只有单一值），CLI `--version` exit 0 返回 `0.2.0-rc.2`。
2. 检查计数与作者自报一致：39 checks / 38 true / 唯一 false = `teamMessageDurable`；`modelCalls=6`、`paidRequests=0`、`errors=[]`。
3. usage 语义正确（"null 不臆造 0"）：4 条 `assistant/message` 带合成 usage（100/20/5/22/147），2 条 `assistant/attempt`（failure、abort）`usage=null`，`requests` 里 2 条无 `usage` 键。
4. 旧 integration 缺口属实：`engines.dsh=0.1.7-rc.1`、`peerDependencies["@deepseek-ai/dsh-tools"]=0.1.7-rc.1`；VERSION-PIN `compatibleWithDeclaredExactVersions:false`、`runtimeCompatibility:"unverified"`、`mutated:false`。
5. 证据分级分离到位：receipts 标 `native-runtime-with-synthetic-adapter`，declarations 全部 `static-declaration-only` + `runtimeVerified:false`，live-trace 明确 `not-run`；HOST-MANIFEST 未把 `reasoningHighGuarantee`/`osSandbox`/`diskCrashRecovery`/`externalEffectReconciliation`/`parentChildCancellation`/`toolCancellation`/供应商 cost 写成 verified（这些在机器层是 `unverified`/`unknown`）。
6. 全部 artifact grep 无凭据/prompt 泄漏（无 `Bearer`/`sk-`/`apiKey`/`authorization` 等命中），`isolation.teardownCompleted:true`，两次运行都干净退出。

（只读复核：未修改原 worktree 任何文件、未动 `.graph/`、未执行 git 写操作；所有运行都在 `/tmp` 隔离副本内完成。）

---

