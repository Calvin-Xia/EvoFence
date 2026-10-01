# 独立交叉复核：l1_eval_protocol（第 2 轮及收口）

> 复核者：独立 pi pane `review-1`（同一 worktree、只读、非作者）。
> 第 1 轮记录见 `l1_eval_protocol-review-r1.md`（复核者 review-2）。
> 本文件收录第 2 轮（针对修订后版本）、窄范围收口复核及其结论。

---

## 复核回合 10

已通读五份产物、r1 复核记录、节点合同、ADR-0005/0008、probes/pi 事实，并独立复算了 B 轴要求的全部数字（脚本见下）。

```
结论: 需修订（blocker 小 1）

[BLOCKER] METRICS.md §5.2 / §8（+ PROTOCOL.md §8）— 确认性判定三支与 §8 的「其它一切」列表**未定义优先级、互相重叠**，且与协议自己设计的中期疗效停止直接冲突。
  (i) `positive` 的规则里**没有**“n ≥ 计划 n”这一条，而 §8 又写「`exploratory only`＝任何 n < 计划 n 的结果」。于是 B−A 中期（n=80 < 160）若 `n01+n10≥25` 且 `Z_MVE≥c₁`，按 §5.2 是 `positive`、按 §8 是 `exploratory`——同一结果两个结论。而 §4.5/§8 明确设计了“B−A 中期通过 → C−B 再测”，说明中期本就想产出确认性 positive；这条 `exploratory` 规则把这套 OBF 中期停止**整体作废**。两处必须二选一。
  (ii) `negative` 只要求 `Z_MVE≤−c` 与 `n01+n10≥25`，**没有** usage/pollution 完整性条件；而 §8 的 `inconclusive` 列表把“`usage_incomplete>5%`、发现泄露/污染”列为其触发项。于是“Z≤−c 且数据 20% usage 缺失/有污染”同时满足 `negative` 与 `inconclusive`。一个确认性 negative（“无收益”）不允许在降解数据上给出。
  — 为什么错：这是一份要在看结果前冻结、`T0` 后只能走偏差记录的**预注册**；“三支穷尽且互斥”是它自己的承诺（PREREG §2 并列 `positive/negative` 规则 + §5.3 词表），但规则集不是有序 if/elif，实现者必须自行发明优先级——这正是预注册要禁止的。
  — 建议：把判定写成一条**有序**函数并写死优先级（先 `n<计划 n ∧ 非计划内中期边界 → exploratory`；再 usage/pollution 完整性 → inconclusive；再 `positive`/`negative`），或显式说明“计划内中期边界穿越算确认性、`exploratory` 只用于非边界性提前结束”。

[MAJOR] METRICS.md §4.2 — 不一致对下限 25 与自己保留的 B−A 中期 n=80 冲突（E=22.4 < 25）。
  §4.2 写“**任一时点** `n01+n10<25` → 不得给 `positive`/`negative`，只能 inconclusive 或继续”，并**用期望值**论证“‘中期 C−B 的 16.0 预期’触发该规则，故 C−B 不做中期”。但同一张表里 B−A 中期 `E[n01+n10]=80×0.28=22.4 < 25`——按同一期望值论证，B−A 中期同样“预期不可判定”，§8 却仍保留“中期分析仅在 B−A 做”并给出 `c₁=2.772`。要么 B−A 中期也撤掉，要么承认该中期在期望上多半无法触发疗效停止（`P(n01+n10≥25)≈0.29`），并把 `c₁` 降级为 futility-only。当前写法自相矛盾。
  建议：中期 n 抬到 ≥ ceil(25/0.28)=90，或明确写“B−A 中期只做无效性（CP<0.20）不报疗效”。

[MAJOR] METRICS.md §4.5 / SCENARIOS.md §3.1 / OPEN-QUESTIONS.md Q16 — DEFF>1.25 的“预授权升 n”缺少边界与中期信息分数的重算规则，且 ρ̂ 在“每 family 1 实例”的首选设计下不可识别。
  §4.5 让持有 family 贡献 `m>1` 时 `n→⌈160×DEFF⌉`，但不说明：n 改了之后**中期看怎么放**（仍是 80 ⇒ `t₁=80/N<0.5`）与 **OBF 边界怎么重算**。OBF 的 α 只由信息分数 `t` 决定；若中期仍固定在 80 而 N 变大，用为 `t=0.5` 算出的 `c₁=2.772` 会在更早的 look 上**多花 α**（`α*(80/N) < α*(0.5)`），破坏 α=0.05。此外 §3.1 的首选是“held-out 每 family 1 实例”，此时**没有 family 内配对**，`ρ̂`/`DEFF` 在 pilot（同样是 held-out 20、同样 1 实例/family）上不可估计，Q16 的“pilot 估 ρ̂”没有数据可依。
  建议：写明“升 n 后中期 = N/2，并按 Lan-DeMets 重算 c₁/c₂（记录，不算偏差）”，或在 1 实例/family 下把 DEFF 分支标注为“仅在被迫 m>1 时启用，ρ̂ 由带 family 重复的 pilot 子集估”。

[MAJOR] METRICS.md §4.1/§4.4/§5.2 — “`Z_MVE ≥ c_k` ⇔ `CI 下界 ≥ MVE`”在 BCa 下**不精确**，主判定到底走哪一个没定。
  §4.1 用 `SE` 定义 `Z_MVE`，§4.5 规定区间是 **BCa** bootstrap（自带偏差修正与加速度，**非对称**）。对称正态区间才有 `CI_下界 = Δ̂ − c·SE`，于是 `CI_下界≥MVE ⇔ Z_MVE≥c`；BCa 区间不等于该式，二者可给出不同判定（离散数据 + `n01+n10` 只到 25 时会显现）。§5.2 的确定规则用 `Z_MVE≥c_look`，而 §6/§8 又写“`positive` ⇔ CI 下界 ≥ MVE”。**必须指定唯一权威规则**（建议：判定一律用 `Z_MVE≥c_k`，BCa CI 只作报告；或判定用 BCa 下界并说明 α 为近似）。

[MINOR] METRICS §4.5 — “经典 OBF 形状解 `(2.7965, 1.9774)` 与本章差值 < 0.02”：我复算形状解 = `(2.79651, 1.97743)` 正确，但 `c₁` 差 `2.7965−2.772=0.0245 > 0.02`。应改为 `< 0.03` 或只说 `c₂` 差。
[MINOR] METRICS §4.5 / PROTOCOL §6 — C−B **不做中期**却用终看边界 `c₂=1.979`（一个 deux-look 的第二看边界）。单看 0.05 的正确边界是 1.96（n=157）；用 1.979 偏保守但把“各自 α 由两看花完”这句套到只做单看的 C−B 上不成立。建议：C−B 用单看边界并在 §4.3 注明。
[MINOR] METRICS §4.3/§4.4 — 功效/n 公式用 `Var=π_c/n`，而备择下 `Var(Δ̂)=(π_c−Δ²)/n`；对 B−A(Δ=0.30,π_c=0.28)、C−B(Δ=0.20,π_c=0.20) 这是**保守**（我复算真实功效约 99.1%/88.2%，文档 94.6%/80.2%）。非错误，但应在正文注明“保守近似”。
[MINOR] METRICS §3.1/§5 vs §8 — §3.1“评分者 α<0.60 → 质量指标 inconclusive（不影响 task_success 主判定）”，但 §8 把“评分者一致性 < 0.60”列入总判定的 `inconclusive` 触发项。两处口径不一。
[MINOR] METRICS §3.1 / PROTOCOL §5 — `quality_score` 的判分者：B/C 用**自己臂内的 fresh verifier**判自己，且 A 臂没有 verifier 节点、其判分者未定义；判分花费是否计入 A 的包络也未写。质量是 secondary，但这是处理/测量混淆。
[MINOR] SCENARIOS §5 / Q2 — 未要求“参考解必须通过全部 `privateTests`”作为语料验收；若私有测试有误，三臂会同时失败、得到假 negative。建议加一条前置校验。
[MINOR] SCENARIOS §4.1 — `leak_probe=not-applicable` 的实例经“两人独立签署”可进 held-out，但此时它的 `leak_risk` 字段取值（unknown? reviewed?）未定义，后续 §4 表与 manifest 无落点。
[MINOR] METRICS §7.4 / OPEN-QUESTIONS §1.1 — P1 描述为“去掉 5 个消融，final 减半”，但其估算 692 = `(753.8−200.5)×1.25`（**只去掉消融、未减半 final**）；若同时 final 减半应为 ≈662。描述与数字不一致。
[MINOR] OPEN-QUESTIONS §4 — “是否要求两个宿主的 positive 必须同层…”“偏差记录的审批粒度…”两条**重复出现**，宜去重。
[MINOR] PREREG §4 — 表头写“用于追踪本轮**首稿**”，但四个 hash/行数与当前 v2 文件逐一匹配（我重算过），措辞应改为“本轮 v2 草案”。
[MINOR] METRICS §4.1 — 写 `H0: Δ ≤ MVE` 却用双侧 `±c` 边界；负向分支实际检验的是反向零假设 `Δ ≥ MVE`（等价于在 MVE 上做双侧检验）。命名不精确，建议写成 `H0: Δ = MVE`（双侧）或显式说明两分支各自的零假设。
[MINOR] METRICS §3.1 — Krippendorff's α 未指明是 nominal 还是 ordinal（rubric 五维 0–4 是序数），影响 0.60 门槛的判定。
[NIT] METRICS §7.2 与 PROTOCOL §3.1 的“并发预留上限”列（=request_cap）与“并行不豁免”的关系：request_cap=20（S1）对含 planning+6 worker+verifier+repair 的 B/C 是否过紧，只能靠 Q17 事后观测；建议在 §3.1 注明这是假设上限、pilot 需核。
[NIT] SCENARIOS §7 F3 — “B 必跑”已修（v1 的 MINOR 已闭合），此处仅确认。

已核对但确认无误的点:
1. **B① 边界复算**：`c₁=2.772` 给 `2(1−Φ(2.772))=0.0055713`（文档 0.005573，舍入）；在 `corr=1/√2` 的两看联立分布下数值积分得 `c₂=1.979 ⇒ 总 α=0.05003`（精确解 1.97930），而 `c₂=2.012 ⇒ 0.04653`（确为偏保守）。经典 OBF 形状解 `(2.79651, 1.97743)` 与文档一致。**修订的核心数值成立。**
2. **B② 功效与 MDE**：`n=π_c(c₂+z₀.₈)²/m²` 复算 B−A 99.0、C−B 159.1 → 160；功效表逐格复现（B−A 0.30→94.6%、C−B 0.20→80.2%、MVE 处 2.4% 等）；`n=160` 下 80% 功效的 MDE 为 B−A Δ≈0.268、C−B Δ≈0.200（文档 Δ_alt=2×MVE=0.30/0.20 高于此，故 94.6%/80.2% 自洽）。
3. **B③ reserve 与包络**：`60,000×0.14e-6+4,096×0.28e-6=0.00954688≈0.009547`；`20/40/80×reserve = 0.1909376 / 0.3818752 / 0.7637504`，逐字段四舍五入等于 0.1909/0.3819/0.7638；预算均值 `0.4×0.1909+0.35×0.3819+0.25×0.7638=0.400975`、小计 753.8、含应急 25% = 942.3 ≈ 943，全部复算一致。
4. **`usd_cap=request_cap×reserve` 与 `settled+outstanding≤usd_cap` 等价**：在“单请求成本≤reserve”与“总请求数≤request_cap”下二者同解（第 k+1 次请求的两条检查都化为 `k+1≤request_cap`），故“usd_cap 永不阻塞合法请求数”成立。
5. **PREREG §4 的 hash/行数**：我重算四个文件 sha256（`1a805ca5…`/`5c27cc0a…`/`20fd73a4…`/`aa28bc69…`）与行数 219/132/290/70，与当前 v2 文件**逐一匹配**（只有“首稿”措辞过时）。
6. **r1 的 BLOCKER 与 7 条 MAJOR 均已落地**（不是复述 r1）：移位零假设 + `CI 双向`统一（BLOCKER 修掉）；2.012→1.979（已验算）；不一致对下限 + family 聚类 + DEFF；包络 reserve 重算自洽；泄露度量可执行化（tokenizer/归一化/LCS/参考补丁来源/`not-applicable`）；CONTRACTS §8 / ARCHITECTURE §11 漂移登记为 Q19；BCa 细节（分层重采样、0.5 并列修正、family jackknife）；标题改“同包络”+ 新增 `B−parallel` 消融；`quality_score` 降为 secondary + `itt_composite`；ITT 截断敏感性分析。v1 的预算算术与 pilot 规模二义也已修正。
7. **轴 D 你点名的五个洞已在 OPEN-QUESTIONS 覆盖**：判分模型选择偏倚=Q14、私有测试作者同源=Q15、撞 cap 截断偏倚=Q17、分析脚本独立复算=Q18、pilot 校准 π_c 太粗=Q5（并写明 95% CI 0.14–0.56、正式 n 由 `Δ_alt=2×MVE` 定而非 pilot 点估计）。唯一未覆盖的新洞见上（参考解须过私有测试、A 臂判分者定义、DEFF 边界重算、BCa/Z 等价）。
```

脚本要点（只读复核，未改任何文件、未动 `.graph/`、无 git 写操作）：用 `math.erf` 实现 Φ，对 `Z1|Z2=z ~ N(ρz,1−ρ²)`、`ρ=1/√2` 做 3×10⁵ 点梯形积分求联立 α，并二分求解 `c₂`、OBF 形状常数、`n`、功效与 MDE；reserve/usd_cap/预算用直算。第 3 项（DEFF 升 n 的边界重算）与第 1 项（判定三支优先级）是本轮最值得先定的两处——它们直接决定“中期结果算不算确认性”与“升 n 后 α 是否仍是 0.05”。

---

## 复核回合 11

Let me verify the revised `l1_eval_protocol` artifacts (v3) and independently recompute the α argument and futility rule.

---

## 复核回合 12

Let me numerically verify the α argument, the futility stop rate, and its effect on realized power.

---

## 复核回合 13

结论: 可接受

关键验证（供记录）：
- **α**：取消疗效中期后，`{positive} ⊆ {到达确认看} ∩ {Z_final ≥ 1.96}`，futility 只删路径不产生宣称 ⇒ `P(positive | Δ=MVE) = P(Z_mid ≥ 0.791, Z_final ≥ 1.96)` 数值复算 ≈ **2.2% ≤ 2.5%**（单侧），双侧 ≤ 0.05；加 futility 不改变上界（它只会减少 positive）。作者的 α 论证成立。
- **futility**：`CP = 1 − Φ(c − √2·Z_mid)`（§7.6 代入 §4.4、N=160）；`CP<0.20 ⇔ Z_mid<0.7908`。**Δ=MVE 下停试概率 78.5%**（该点确认功效本就 2.5%，停掉合理）；设计备择下停试 **4.1%(B−A)/11.3%(C−B)**，故**整体功效 92.5%/77.0%**（文档 94.8%/80.7% 是"到达确认看"的单看条件功效）。futility 只给 `inconclusive(futility)`、不报疗效。
- **有序函数**四情形代入：confirmatory+Z≥c→L3 `positive`；confirmatory+Z≤−c→L3 `negative`；futility 停→L2 `inconclusive(futility)`；usage 20% 但 Z 显著→L1 `inconclusive(degraded-data)`。逐支首命中，穷尽且互斥，无"同一结果两结论"。
- **repo 口径**：METRICS §4.1/§4.4/§4.5、PROTOCOL §6、SCENARIOS §3.1/§5、PREREG §2 已全部改为 repo；"每 repo 1 实例 ⇒ DEFF≡1" 在"仓库不相交 + held-out 1 实例/repo"下确为构造结果。

新发现：
- [MINOR] `SCENARIOS.md §3「为什么是 160」` 仍是 v2 口径（`H0: Δ ≤ MVE`、`n = 7.9558·π_c/m²`、99/159），与 METRICS v3 §4.1/§4.3（`H0^±: Δ=MVE`、`7.8488`、98/157）矛盾。n=160 结论不变，属未同步的陈词。
- [MINOR] METRICS §4.4「精确口径」列（B−A 98.1%、C−B 84.8%）无法从其声明的 `SE₀=√((π_c−MVE²)/n)` 复现（我按该式得 96.2%/82.7%；按替代方差 `(π_c−Δ²)/n` 得 99.2%/88.5%）。保守列 94.8%/80.7% 复现无误，故不影响设计。
- [MINOR] `PREREGISTRATION.md §5.2` 配对表字段仍只有 `familyId`，缺 `repoId`；clustering 已改 repo，实现者需要 repo 标识才能做 repo 级 bootstrap/jackknife。
- [MINOR] §4.4 未披露 futility 对**整体**功效的损耗：Δ_alt 下实际 92.5%/77.0%（C−B 低于 80% 目标）。建议把 §4.4 功效标注为"条件于到达确认看"，或补一列"含 futility 的整体功效"。
- [MINOR] `SCENARIOS.md §3.1` 规则 1 的例外（同一 repo 按 commit 切到两个分区）与"仓库不相交"并列，构成 train→held-out 的跨区污染通道（`rho`/DEFF≡1 是分析集内结论，不受影响，但污染面未闭合）。
- [NIT] §4.5 称 futility 为"非约束性停止"，但它确实会终止试验、只是不消耗 α；建议改"不消耗 α 的停止"，以免被读成"仅建议"。
- [NIT] PROTOCOL §5 把臂外 judge 成本移出臂包络，与 r1 MAJOR（judge 花费计入被评臂以消除"评测免费"）方向相反；因声明 judge 对三臂同价且全额报告，可接受，但建议补一句"judge 成本臂间视为同价"以闭合反作弊项。

本轮发现 6 项（均 MINOR/NIT；四项修订 BLOCKER/MAJOR 全部成立，无新 BLOCKER/MAJOR）。

---

