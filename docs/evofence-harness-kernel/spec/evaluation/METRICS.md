# 主指标、测量方式、区间方法与 MVE 阈值（METRICS）

> 状态：**预注册草案 v3**（2026-10-01 第 2 轮独立复核 r2 修订）。本文不含实验结果。
> v3 修订要点：① 判定写成**一条有序函数**（消除三支重叠与中期/exploratory 冲突）；② 取消疗效中期看，改为 **futility-only**，确认性看唯一、边界 `c=1.960`；③ DEFF 升 n 不再影响任何边界；④ 指定 **`Z_MVE` 为唯一权威判定**，BCa 降为报告/敏感性；⑤ 判分者与判分成本解耦出臂包络。

---

## 1. 指标总表

| 类别 | 指标 | 定义 | 地位 | 进入产品级结论 |
|---|---|---|---|---|
| **主** | `task_success ∈ {0,1}` | §2，ITT | **primary（唯一）** | 是 |
| 次 | `quality_score ∈ [0,100]` | §3，仅成功 run | secondary | 否 |
| 次 | `itt_composite ∈ [0,1]` | `task_success × quality/100`，失败记 0 | secondary | 否 |
| 次 | `incomplete_rate` | 撞 cap 的 run 占比 | secondary（安全） | 护栏 |
| 约束 | `cost_usd` / `wall_ms` | §7 | constraint | 护栏 |
| 次 | `cost_per_success`、`tokens_*`、`paid_requests`、`repair_cycles`、`verifier_catch_rate`、`regression_rate`、`asset_hit_rate`、`promotion_precision`、`human_wait_ms` | §3.3 | secondary | 否 |

`quality_score` 不是 co-primary：共主指标必须有自己的检验统计量与功效分配，而条件指标（仅成功 run）另有选择偏倚。产品级 `positive` **只由 `task_success` 驱动**。

---

## 2. `task_success` 的精确定义（任务验收合同）

```
task_success = 1  iff  private_tests_all_pass
                  AND contract.required_outcomes 全部满足
                  AND contract.required_branches 均有绑定证据（产物 digest + 实际 diff + 运行输出）
                  AND run.status == "completed"（未命中任一 cap）
                  else 0
```

- **ITT**：所有已启动 run 计 0/1；`incomplete`/`timeout`/`cancelled`/`usage_incomplete` 一律计 **0**（主分析）。
- **截断披露**：`incomplete_rate` 逐臂单列 + 护栏 `incomplete_rate(X) ≤ incomplete_rate(对照)+0.10`；另有预注册敏感性分析「三臂皆 completed 的配对子集」。
- **PP**：只排除 `T0` 冻结清单中的基础设施故障与 `capability_absent`；**撞 cap 不在排除项**。
- 模型自述完成、空 summary、只有计划无真实 diff → 0（ADR-0005）。
- `needs-human`：ITT 计 0；`human_wait_ms` 单列，**不计入** `wall_ms`/`wall_cap`（§7.3）。

---

## 3. 质量与辅助指标

### 3.1 rubric（`quality_score`，0–100）

五维各 0–4 分（0=不可用，2=达标，4=优秀），总分 20 × 5 = **0–100**：正确性 / 完整性 / 测试增量 / 惯例遵从 / 可维护性与安全。

- **仅对 `task_success = 1` 打分**；失败记 `quality = n/a`（不记 0），失败按 0 代入即 `itt_composite`。
- 一致性：抽 20% 双人盲评，**序数 Krippendorff's α ≥ 0.60**（rubric 为 0–4 序数，用 ordinal α，不用 nominal）；否则**只有质量类指标**标 `inconclusive`，**不影响** `task_success` 的主判定与整体 verdict（v3 修正 v2 §8 把评分者一致性列为总判定触发项的越权）。
- **判分者与处理解耦（v3）**：评分由**臂外独立盲评流水线**完成（同一流水线判全部 A/B/C，去臂标识）；**不得**用被评臂自己的 fresh verifier 判自己的质量分。臂内 verifier 是 B/C 的**处理**（影响 `task_success`），臂外 judge 是**测量**。
- **判分成本单列**：臂外 judge 的调用记入独立的 `judging_cost` 台账，**不计入被评臂的 `E` 包络**（否则"测量"会污染"处理"的成本可比性）；但 `judging_cost` 必须全额报告，禁止当作免费（v3 修正 v2 PROTOCOL §5 的"judge 花费计入被评臂包络"，后者对无 verifier 的 A 臂不可定义）。

### 3.2 质量类指标的推断地位

`quality_score` 与 `itt_composite` 均为 **secondary**，用同一判定机器做**探索性**检验，Holm 校正，**不进入产品级 `positive`**。

### 3.3 分母定义

| 指标 | 精确分母 |
|---|---|
| `verifier_catch_rate` | verifier 交付前抓到 + 交付后由 `privateTests`/evaluator 发现（窗口＝该 run 的 evaluator 报告完成前；计数单位＝测试断言失败） |
| `regression_rate` | `task_success = 1` 的 run；分子＝其中破坏 base 快照既有测试的 run |
| `asset_hit_rate`（C） | 注入资产的 run；分子＝该资产出现在最终被采纳产物路径中的 run |
| `promotion_precision`（C） | train 上晋升且被 held-out 命中的资产；分子＝命中后 `task_success` 提升的资产 |

---

## 4. 样本量、功效与区间方法

### 4.1 估计量与检验（唯一权威判定）

`d_i ∈ {−1,0,+1}`，`Δ̂ = (n01−n10)/n`，`π̂_c = (n01+n10)/n`。

**主检验（v3 命名精确化）**：在 MVE 上做**双侧**检验，两个方向各自的零假设写明：

```
正值方向（superiority over MVE）:  H0^+ : Δ = MVE   （拒绝 ⇔ Z_MVE ≥ c）
负值方向（inferiority to MVE）  :  H0^- : Δ = MVE   （拒绝 ⇔ Z_MVE ≤ −c）
           Z_MVE = (Δ̂ − MVE) / SE
```

（v2 写 `H0: Δ ≤ MVE` 却用 `±c`，与"单侧"不一致，已改为"在 MVE 上的双侧检验"。）

| 项 | 冻结值 |
|---|---|
| **权威判定统计量** | **`Z_MVE`**（唯一；CI 不得覆盖它） |
| `SE` | **分层 + repo 聚类**的 bootstrap 标准误（与 CI 同一重采样机制，尽量减小不一致） |
| 敏感性（不改判定） | ① 打分型零方差 `SE₀ = √DEFF̂ · √((π̂_c − MVE²)/n)`；② BCa CI 下界 ≥ MVE。二者与 `Z_MVE` 判定不一致时**以 `Z_MVE` 为准**，并把不一致写入报告 |
| 边界 `c` | **`c = 1.960`**（单看、双侧 α=0.05） |
| 说明 | v2 写的 "`positive` ⇔ CI 下界 ≥ MVE" 在 **BCa（非对称、带偏差修正与加速度）** 下**不精确**，故降级为敏感性；判定一律走 `Z_MVE` |

### 4.2 不一致对下限（只约束**确认性看**）

`Z_MVE` 渐近正态，常用前提 `n01+n10 ≳ 25`。**该下限只在确认性（final）看生效**：

| 对比 | `π_c` | futility 看 n=80 | **确认看 n=160** |
|---|---:|---:|---:|
| `B−A` | 0.28 | E=22.4，`P(n01+n10≥25)=29.6%` | **E=44.8，P=99.99%** |
| `C−B` | 0.20 | E=16.0，P=1.1% | **E=32.0，P=93.5%** |

**v3 修正 v2 的自相矛盾**：v2 用"任一时点 < 25 不得判定"的规则，却同时在 B−A 中期（n=80，E=22.4）保留疗效停止 —— 按同一论证该中期本就有 70% 概率不可判定。v3 的解法是**取消一切疗效中期看**（§4.5），下限只约束确认看，两个对比在 n=160 下分别以 99.99% / 93.5% 概率满足。

### 4.3 样本量（单看，双侧 α=0.05，80% 功效）

```
n = π_c · (c + z_0.80)² / m² = π_c · (1.960 + 0.8416)² / m² = 7.8488 · π_c / m²,   m = Δ_alt − MVE
```

**设计备择冻结为 `Δ_alt = 2 × MVE`**：

| 对比 | MVE | `Δ_alt = 2×MVE` | `m` | `π_c` | 80% 功效所需 n |
|---|---:|---:|---:|---:|---:|
| `B−A` | 0.15 | 0.30 | 0.15 | 0.28 | **98** |
| `C−B` | 0.10 | 0.20 | 0.10 | 0.20 | **157** |

两者取大 → **计划 held-out n = 160 / 臂**（留 1.9% 余量）。其他备择（n/臂）：

| 对比 \ `Δ_alt` | MVE | MVE+0.05 | MVE+0.10 | MVE+0.15 | MVE+0.20 |
|---|---:|---:|---:|---:|---:|
| `B−A` | ∞ | 880 | 220 | **98** | 55 |
| `C−B` | ∞ | 628 | **157** | 70 | 40 |

### 4.4 功效（n=160）

`power = 1 − Φ(c − (Δ_alt − MVE)/SE)`，**保守口径** `SE = √(π_c/n)`（规划用；把替代下方差也按 `π_c` 计，偏保守）。每一格给两个数：

- **条件功效**：假设**到达确认看**的解析功效（可从上式直接复现）。
- **含 futility 整体功效**：把 §4.5/§7.6 的 `N/2` futility 规则（`CP<0.20`）计入后的**真实整体功效**——这才是“能否拿到 `positive`”的概率。

| 真实 Δ | `B−A` 条件 | `B−A` 整体 | `B−A` 损耗 | `C−B` 条件 | `C−B` 整体 | `C−B` 损耗 |
|---|---:|---:|---:|---:|---:|---:|
| 0.10（`C−B` 的 MVE） | — | — | — | 2.5% | ≈0%（几乎必停） | — |
| 0.15（**`B−A` 的 MVE**） | 2.5% | ≈0% | — | 29.3% | 23.3% | 6.0pp |
| 0.20（**`C−B` 的 2×MVE**） | 22.2% | 17.1% | 5.1pp | **80.7%** | **79.8%** | 0.9pp |
| 0.25 | 66.7% | 63.7% | 2.9pp | 98.9% | 94.3% | 4.6pp |
| 0.30（**`B−A` 的 2×MVE**） | **94.8%** | **93.0%** | 1.8pp | 100.0% | 98.8% | 1.2pp |
| 0.35 | 99.8% | 98.3% | 1.5pp | — | — | — |

“整体功效”由蒙特卡洛确认（逐任务多项生成，`N=160`，`n_mid=80`，400,000 次复现，确定性 PRNG；MC 标准误 ≤ 0.07pp）。

**v3 更正**：v2 的“精确口径”列（98.1%/84.8%）**已删除**——它无法从本段声明的任何一个 `SE` 式复现（我的口径把零方差用于检验、而把替代方差用于功效，两种约定混用）。表内只保留可复现的**保守口径**与**含 futility 整体功效**。

**诚实声明**：
1. 在 MVE 上做双侧检验，“确认 Δ ≥ MVE”要求真实效果**显著大于** MVE；`Δ = MVE` 时整体功效 ≈ 0。
2. 设计的备择是 `2×MVE`：`B−A` 整体 **93.0%**、`C−B` 整体 **79.8%**。**`C−B` 低于 80% 目标 0.2pp**，且 futility 早停本身带来 **0.9–6.0pp** 的损耗（非单调：效果大时停得少，但停掉的少数恰好多会成功）。
3. 若要求 `C−B` 整体功效 ≥ 80%，预批准两条补正：① **去掉 futility 看**（则条件功效即整体功效，80.7%）；或 ② **`N` 提到 165** 并重算整体功效（`T0` 时由分析脚本确认）。二者任一即可，不得同时收紧 MVE。
4. **v1 的 79%/59% 与 n≈163 基于错误边界 2.012 与“对 0 检验”，已作废；v2 的 94.6%/80.2% 基于错误的两看 1.979，亦已作废。**

### 4.5 序列、中期（futility-only）与聚类

| 事项 | 冻结规则 |
|---|---|
| **疗效中期看** | **无**。v2 的 `t=0.5`、`c₁=2.772`、`c₂=1.979` 的 OBF 两看设计**已取消**（§4.2 的中期不一致对使其不可用） |
| **确认性看** | 唯一，`n=160`，边界 **`c = 1.960`**（双侧 α=0.05），**α 不被任何中期消耗** |
| **futility 看** | `N/2 = 80`，**只看条件功效 `CP`**（METRICS §7.6），`CP < 0.20` 则全局停止。**不报疗效、不给 `positive`/`negative`**；futility 停止的结论是 `inconclusive`（reason=`futility`） |
| **为何 α 不受影响** | 声明 `positive` 需「到达确认看」**且**「过 `c`」；该事件 ⊆ `{Z_final ≥ c}`，故整体 I 类错误 `≤ α = 0.05`，与 futility 规则无关（**不消耗 α 的停止**）。注意：它**不消耗 α，但消耗功效**（§4.4 已列损耗） |
| **升 n（DEFF）** | `N := ⌈160×DEFF⌉` 时，futility 看移到 `N/2`；**边界不变**（单看 α=0.05 与信息分数无关）。v2 的"t 变了要重算 OBF 边界"在 v3 已不存在 |
| 主序列 | **固定序列** `B−A` → `C−B`；前者不 `positive` 则不测后者（FWER ≤ α，无需校正） |
| 每个假设的 α | 各自双侧 0.05，只在确认看花一次 |
| 聚类 | **cluster 单位 = repo**；held-out 每 repo 只允许 1 实例（⇒ `DEFF ≡ 1`，构造结果）。被迫 `m>1` 时：CI 与 `SE` 用 **repo 层聚类 bootstrap**，`DEFF = 1+(m̄−1)ρ̂`，`DEFF>1.25` 时 `N := ⌈160×DEFF⌉`（预授权，写记录，不算偏差；**边界不变**）。`ρ̂` 只能在该 repo 于 `train`/`dev` 的其他实例上估（v3：held-out 自身 1 实例/repo 时 `ρ̂` 不可识别） |
| bootstrap | 10,000 次；BCa；离散统计量加 `0.5×并列` 修正；加速度常数由 **repo 级 jackknife**；分层设计下按层内重采样 |

---

## 5. MVE 与判定

### 5.1 MVE

| 对比 | MVE | 护栏 |
|---|---:|---|
| `B − A` | **+0.15** | `cost_per_success(B) ≤ 2.0×cost_per_success(A)`；`p90(wall)(B) ≤ 1.5×p90(wall)(A)`；`incomplete_rate(B) ≤ incomplete_rate(A)+0.10` |
| `C − B` | **+0.10** | 同上（对 B） |

### 5.2 判定函数（**唯一权威、有序、互斥**）

v2 把 `positive`/`negative`/`inconclusive`/`exploratory` 平铺成四条会重叠的规则，实现者须自行发明优先级。v3 改为**一条有序函数**：

```text
judge(cell, look):
  # L0 可比性（证据面 → 判定面，恒等映射）
  if cell.cell_status ∈ {capability_absent, not_yet_comparable}:
      return blocked

  # L1 数据完整性：先于任何方向性结论
  #    —— "无收益"这种确认性结论不允许在降解数据上给出
  if cell.usage_incomplete_run_ratio > 0.05
     or cell.pollution_or_leak_found:
      return inconclusive(reason="degraded-data")

  # L2 是否到达预注册的 look
  if look == FUTILITY_LOOK(N/2):
      return ( conditional_power(cell) < 0.20 )
             ? inconclusive(reason="futility")     # 全局停止；不报疗效
             : continue                            # 不是 verdict
  if look != CONFIRMATORY_LOOK(N):
      return exploratory_only                      # 非预注册的提前结束（预算耗尽/外部中断）

  # L3 确认性看
  if cell.n < cell.n_planned:                      # 未达计划 n 且非预注册 futility 停止
      return exploratory_only
  if (cell.n01 + cell.n10) < 25:
      return inconclusive(reason="discordance-floor")
  if cell.Z_MVE >=  c: return positive
  if cell.Z_MVE <= -c: return negative
  return inconclusive(reason="ci-spans-mve")
```

要点：**L1 先于 L2/L3**，故 `negative` 与 `positive` 都不能在降解数据上给出（修 r2 BLOCKER-ii）；**`positive` 显式要求 `n ≥ n_planned`**，而 `exploratory_only` 只覆盖"**非预注册**的提前结束"（修 r2 BLOCKER-i）；**中期不再产出疗效结论**，所以不再与 `exploratory` 重叠。三支穷尽、互斥，优先级由代码顺序给出。

### 5.3 词表

| 层 | 取值 |
|---|---|
| `cell_status` | `complete` / `capability_absent` / `not-yet-comparable` |
| `look` | `FUTILITY_LOOK` / `CONFIRMATORY_LOOK` / `other` |
| `judgement` | `positive` / `negative` / `inconclusive` / `blocked` / `exploratory_only` |

产品级结论：**两个宿主各自在确认看判 `positive`** 才算重构目标达成。

---

## 6. 学习消融（exploratory）

| 消融 | 定义 | 方向假设 |
|---|---|---|
| `B−verifier` | B 去掉 fresh verifier | Δ ≤ −0.05 |
| `B−parallel` | B 强制单 worker（隔离并发/开销） | Δ ≤ −0.05 |
| `C−retrieval` | C 关闭资产注入，保留候选/晋升 | 与 B 差 \|Δ\| < 0.05 |
| `C−dynamic` | C 用固定模板 | Δ ≤ −0.05 |
| `C−retrieval` vs `C` | 直接对比 | Δ ≤ −0.05 |

全部标 `exploratory`，`Z_MVE` 同机器但 Holm 校正，不进入产品级结论。

---

## 7. 包络与预算

### 7.1–7.2 单请求上限与每 run 包络

| 项 | 值 |
|---|---|
| `max_input_tokens` / request | 60,000（含 cached） |
| `max_output_tokens` / request | 4,096 |
| `reserve_per_request` | `60,000×p_unc + 4,096×p_out` = **9,546.88 µUSD**，**向上取整到 µUSD = 9,547 µUSD**（= 0.009547 USD，探针冻结价） |

| 层 | 占比 | `request_cap` | `usd_cap`（µUSD，精确） | `usd_cap`（USD） | `wall_cap` | 并发预留上限 |
|---|---:|---:|---:|---:|---:|---:|
| S1 restricted | 40% | 20 | **190,940** | 0.190940 | 20 min | 20 |
| S2 cross | 35% | 40 | **381,880** | 0.381880 | 45 min | 40 |
| S3 repo | 25% | 80 | **763,760** | 0.763760 | 120 min | 80 |

`usd_cap = request_cap × 9547` **逐字段精确相等**（R4 人审裁决：按精确值重算；**禁止用浮点 epsilon 少预留**，预留额一律**向上取整到 µUSD**）。原文档的 `190900 / 381900 / 763800` 与“逐字段相等”不符（精确值 − 原值 = **+40 / −20 / +40 µUSD**，即原 S1/S3 少预留、S2 多预留），已废。校验口径 `settled_spend + outstanding_reservations ≤ usd_cap`（派发时），完整 usage 后释放。命中即终止并记 `incomplete`。"并行不豁免"指三臂共用同一 `usd_cap`/`wall_cap`/`request_cap`。**`request_cap` 假设上限**：S1=20 对"planner + ≤6 worker + verifier + ≤1 repair"是否过紧，pilot 须核实（Q17）。

### 7.3 人工等待

`human_wait_ms` 单列，不计入 `wall_ms`/`wall_cap`。

### 7.4 分析成本单列

臂外 judge 的调用记入 `judging_cost`，**不计入臂包络**，但必须全额报告（§3.1）。

### 7.5 预算（均值 0.400974 USD/task = `0.4×0.190940 + 0.35×0.381880 + 0.25×0.763760`，用 R4 重算后的精确 `usd_cap`）

| 环节 | runs | 上界 (USD) |
|---|---:|---:|
| held-out 160 × 3 臂 × 2 宿主 | 960 | 385.0 |
| dev 30 × 3 × 2 | 180 | 72.2 |
| final 20 × 3 × 2 | 120 | 48.1 |
| train 60 × 1（仅 C）× 2 | 120 | 48.1 |
| 5 个消融 × 50 × 2 | 500 | 200.5 |
| **小计** | **1880** | **754.0** |
| 应急 25% | | 188.5 |
| **合计上限** | | **≈ 943 USD** |

取整用**最大余数法**，平局取份额大者：held-out 160→64/56/40；dev 30→12/11/7；final 20→8/7/5；train 60→24/21/15；消融 50→20/18/12。

| 层级 | 内容 | n/臂 | 上界成本 | 可产出 |
|---|---|---:|---:|---|
| **T0** | smoke、协议校验 | 0 | 开发期调用**无美元上限** | 无收益结论 |
| **T1** pilot | held-out 20 | 20 | ≈60 USD（请求额度） | `exploratory_only`；估 `π_c`/DEFF |
| **T2** confirmatory | 160 + 消融 | 160 | ≈943 USD（**请求额度**） | `positive`/`negative`/`inconclusive` |

**预算状态**：开发期调用（deepseek/gpt）**无美元上限**；L4 受控试验付费调用**至今无任何授权额度**（0.50 USD 是 2026-10-01 探针额度）。未获试验授权前 L4 只能交付 `exploratory_only`/`inconclusive`，且**不得以"预算不足"为由缩小成功标准**（PREREGISTRATION §3）。

### 7.6 futility 条件功效（v3 显式冻结）

在 `n_mid = N/2` 处，`Δ̂_mid`、`π̂_c,mid` 为已观测值，`N` 为计划确认 n：

```
CP = 1 − Φ( c − (Δ̂_mid − MVE) / sqrt(π̂_c,mid / N) )
停止 ⇔ CP < 0.20  ⇔  (Δ̂_mid − MVE) / sqrt(π̂_c,mid / N) < c − z_0.80 = 1.1184
```

（未来效应按“等于已观测中期效应”外推、剩余信息按 `N` 全量计——保守 CP 口径。分析脚本必须实现该式并哈希；`T0` 后不得改。）

---

## 8. 反作弊约束

| 作弊路径 | 阻断 |
|---|---|
| 用更多 token/并发换成功 | 同 `usd_cap`/`wall_cap`/`request_cap`；`B−parallel` 消融；成本与时间护栏 |
| 只报成功样本 | ITT 强制；排除清单 `T0` 冻结；`incomplete_rate` 单列 + 护栏 |
| 用点估计宣告达标 | `Z_MVE ≥ c`（对 MVE 的双侧检验），不是点估计 |
| 降解数据下宣称"无收益" | 判定函数 L1 先于 L3（`negative` 也过完整性闸） |
| 调私有测试 | 仅 evaluator 可见，不回传 |
| 用 held-out 调参 | 分区隔离 + hash 冻结 + 偏差记录 |
| 评测免费 | `judging_cost` 单列全额报告（虽不计入臂包络） |
| 质量分刷分 | 臂外独立盲评 + 序数 α≥0.60；质量不作主结论 |
| 同 repo 相关偷 I 类错误 | held-out 每 **repo** 1 实例（cluster＝repo，`DEFF≡1`）；否则 repo 聚类 bootstrap + DEFF 修正 n |
| 事后"跑到显著为止" | 单看确认 + 偏差政策；任何补测视为新试验 |
