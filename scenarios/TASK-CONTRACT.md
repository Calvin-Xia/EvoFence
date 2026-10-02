# Frozen task contract v1 — dual-host long-horizon scenario

> 状态：**FROZEN v1**（orchestrator 冻结；`l3_pi_scenario` 与 `l3_dsh_scenario` **必须使用同一份合同**，不得各自改写口径）。
> 目的：用**同一语义**的真实任务对照两个宿主（Pi / DSH），比较的是宿主能力与适配层实现，不是任务难度。
> 冻结依据：用户裁决（2026-10-02）——Pi 用 `deepseek/deepseek-flash` high；DSH 用其配置模型；**无美元硬上限、逐请求记账**；任务 = scratch clone + 有界真实任务。

## 1. 任务（两宿主完全相同）

1. **scratch**：以集成 worktree 的图基线 commit `5ec65f1`（或派单时 orchestrator 指定的 commit）做**本地**克隆到仓库之外：
   - `git clone --local --no-hardlinks <integ-worktree> <scratch-dir>`（**无网络**）；
   - `<scratch-dir>` 位于 `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\scenario-<host>-scratch`（**不在任何 git worktree 内**）；
   - `node_modules` 用 junction 指向集成 worktree 的 `node_modules`，**不 `npm install`**。
2. **有界真实任务**：在 scratch 内实现一个**明确定义、可验证**的小功能：为既有 CLI 子命令新增一个经校验的 `--limit <N>` 选项（`N` 为正整数），要求：
   - 落在**互不重叠**的 ≥3 个文件/目录（例：catalog 声明、argv 解析/校验、handler 行为、文档行）；
   - 至少 3 个聚焦测试用例（合法值 / 非法值拒绝 / 边界值），测试文件平铺命名 `-scenario`；
   - `--limit` 缺省不得改变既有行为；非法值必须**显式失败**（非静默默认）。
3. **禁止**：改 core 契约（`src/protocol`、`src/kernel`、`src/runtime` 的接口）、`npm install`、网络、`.graph`、commit 到仓库（scratch 内可自由 commit）。

## 2. 必须经历的阶段（两宿主同一语义）

| 阶段 | 要求 |
|---|---|
| inspect | 先读真实代码，给出受影响面清单（文件 + 行锚） |
| decompose | 拆成 **≥2 个可并行**的工作单元，且**目录不重叠**（单写入者约束） |
| parallel workers | 至少 2 个**原生子会话/子代理**并行执行（宿主原生机制；不得用顺序伪并行） |
| integrate | **唯一 integration writer** 合并，冲突显式处理（不静默覆盖） |
| fresh verify | **独立**验证者（与被改代码作者不同的 session/child）复跑聚焦测试与门禁 |
| repair | 至少修复 1 个**真实**失败（由注入或自然产生），记录红→绿 |
| finish | 最终 `node --test <聚焦测试>` 两轮全绿 + 四项门禁 `build/typecheck/src:policy/dep:check` 全 0 |
| interruption（可恢复中断） | **一次**中断并恢复：同一 session 继续（不新建冒充），恢复后上下文与产物连续。Pi 额外覆盖 abort 路径 |

> 说明：**不要求**跑仓库全量测试（1096 例；当前分支尚有与本任务无关的红例，正由 hygiene lane 修复）。聚焦测试 + 四项门禁即为本合同的 verify 口径。

## 3. 预算与记账

- **无美元硬上限**；但**逐请求记账**：每条模型请求记录 provider/model/thinking、tokens、参考成本，写入 `MODEL-BUDGET.json`（追加，不重置）。
- 报告必须给出：请求条数、总 tokens、参考成本估算（注明"参考非账单"），以及无法归零的未知项。

## 4. 交付物（每宿主各一份）

- `scenarios/<host>/` 下的驱动脚本与配置（可复跑）；
- **原始 trace**：子会话/child 创建-结果-取消-恢复事件序列（含 session identity）；
- **任务产物**：scratch 内的 diff/patch + 聚焦测试结果 ×2 + 四项门禁结果；
- **质量与成本报告**：阶段证据、负结果、unknown、实际用量；
- **差异说明**：宿主原生能力 vs 适配层实现；两宿主功能差异须**显式解释**，不得以"某宿主没有"草率带过。

## 5. 证据分级与诚实性

- 分级标注：provider-live / native-fixture / unknown。**fixture 或模拟不得冒充真实闭环**。
- 负结果、未证明项、未达成的收益如实写入报告；不缩小成功标准、不以小样本宣称提升。
- 凭据不打印、不入库。

## 6. 变更控制

本文件冻结后，任何口径变更必须由 orchestrator 显式修订（改版本号 + 记录理由），并**重跑**受影响的宿主，不得只改一侧。
