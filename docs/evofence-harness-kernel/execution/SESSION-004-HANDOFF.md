# SESSION-004 handoff：L2 六成已过，三条 codex lane 在跑（artifact 修复 / scheduler 修复 / runtime 实现）

- **当前 session**：S04，threadId `01a0f7f0-a51d-7391-a4f5-33fbc7b9115f`（pi，orchestrator，pane `wG:pC`）
- **前序**：S03（handoff 见 `SESSION-003-HANDOFF.md`；S03 实际是 S02 会话文件的续接，handoff 里写的 threadId `01a0f6fe…` 无法在磁盘上找到，已在 `sessions.json` 注明）
- **后继**：S05（由本 handoff 末尾启动；pi + `/goal-focus`）
- **阶段**：L2 进行中。`graph status --oneline` → **12/40 passed (30%)**；running 2（`l2_artifact_port`、`l2_scheduler`）；其余 L2 节点 `l2_runtime`/`l2_kernel_verification` 仍 pending（依赖未全过）

## 工作区与 git

- 主 worktree（**集成点**）：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`，HEAD `d17cc94`，**工作树干净**（导出视图已重导、`--check` 无漂移）
- lane worktree（全部基线各异，`node_modules` 均为指向主 worktree 的 junction，勿各自 `npm ci`）：
  - `C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\{store,graph,policy,hostport,artifact,scheduler,runtime}`
- 保护路径：`src/lib/**`、`src/cli.ts`、`src/index.ts`、`test-e2e/**`、`integrations/**`、`templates/**` 全程零改动

## 本 session（S04）真实完成

1. **L2 首节点收口**：`l2_public_contracts` 由 S02 死认领 reclaim → S04 重认领 → cp1/cp2/cp3 passed → report（30 artifacts）→ verdict → **passed**。期间：
   - review-1 发现协议层 B1（新版本门误用 runtime 枚举校验资产封套）→ verify-main 修 → rev-protocol 复验 7 探针全过（28/28）
   - review-2 复验 guard 修复（2 MAJOR：Object.assign/push 逃逸）→ 111/111 可接受；commit `5d96a7d`
2. **四条 wave-2 lane 全部合并并逐节点 passed**：
   - `l2_state_store`（`ac530d8` → 复核 2 BLOCKER+2 MAJOR → `df5f23e` → 复验 2 残留 → `2dafafc`（append 预演补 projectOutbox + 边界注释）→ 第三轮复验可接受；46 用例）
   - `l2_policy`（`7521ebc` → 复核 0 blocker/0 major → `4f5037e` 修 3 条 → 独立复验接受；64 用例）
   - `l2_graph_model`（`12ed81b` → 复核 blocker：中途锁定不挡删/改型/替换 data 边 → 本 session 修 `d803b57` → 新 tab 复验可接受；92 断言）
   - `l2_host_port`（`6e79b5e` → 复核 blocker R6 多目标取消硬门 + major baseDigest → lane 修复 `f218b00` → 新 tab 复验可接受；22 用例）
3. **wave-3 两条 lane 产出并合并**：
   - `l2_scheduler`：`0df8be3`（22 用例 + 5 组负控；复核结论**需修订**，见下）
   - `l2_artifact_port`：`0c028bd`（38 用例；复核结论**可接受**，4 minor 待修，见下）
4. **会话/文档**：`sessions.json` 补 S03、立 S04；`graph export --docs` 多次重导无漂移；评审 dossier 全部入库。

## graph 状态（截至 handoff）

| 节点 | 状态 | 说明 |
|---|---|---|
| L1 全部 7 个 | passed | — |
| `l2_public_contracts` | passed | 30 artifacts；B1/guard 修复链闭合 |
| `l2_state_store` | passed | 46 用例；三轮复核链闭合 |
| `l2_policy` | passed | 64 用例；复核+修复复验接受 |
| `l2_graph_model` | passed | 92 断言；blocker 修复已复验 |
| `l2_host_port` | passed | 22 用例；R6/base 修复已复验 |
| `l2_artifact_port` | **running**（claim S04） | 复核可接受（0B/0M/4m/4n）；**codex 正在 lane 修 M1–M4** |
| `l2_scheduler` | **running**（claim S04） | 复核需修订（**1 blocker + 1 major + 5 minor + 4 nit**）；**codex 正在 lane 修** |
| `l2_runtime` | pending | deps（scheduler/host_port/artifact_port）未全 passed；**codex 已在 runtime lane 实现**（见下） |
| `l2_kernel_verification` | pending | deps `l2_runtime` |

**ADR**：`adr_0002/0003/0005/0006/0007/0008/0009/0010` accepted；`adr_0001`、`adr_0004` 仍 proposed。
**雾区**：`dual-host-runtime-and-uplift` 仍为 amend 状态，未 graduate。

## 正在跑的 codex lane（S04 交接时仍 active）

| tab/pane | 名字 | 任务 | 交接动作 |
|---|---|---|---|
| `wG:tH`/`wG:pS` | `l2-runtime-codex` | `l2_runtime` 实现（lane 里已有部分 `src/runtime/session/{types,project}.ts`） | 完成后合并 + 复核 + 认领/通过 `l2_runtime` |
| `wG:tG`/`wG:pT` | `l2-artifact-codex` | 修 artifact 4 minor + nits（review 全文见 `reviews/l2_artifact_port-review.md`） | 完成后合并 + 独立复验 + 通过 `l2_artifact_port` |
| `wG:tI`/`wG:pV` | `l2-scheduler-codex` | 修 scheduler blocker/major/minors（review 全文见 `reviews/l2_scheduler-review.md`） | 完成后合并 + 独立复验 + 通过 `l2_scheduler` |

## 本轮流程决策（用户指令，S05 必须遵守）

1. **执行类任务 → codex CLI**（gpt-6.1-sol xhigh，走用户订阅）；**deepseek/pi 只做核对、复验、review**，避免 API 账单膨胀。
2. **review 类一律开新 tab**（`herdr tab create --workspace wG --cwd <dir> --label …` → `herdr agent start <name> --kind pi --pane <pane> -- --model deepseek/deepseek-flash:high` → `herdr agent prompt …`）；不要复用旧 reviewer pane 的长上下文。已完成确认的 pane 可 `herdr pane close`（会话文件保留）。
3. 主 agent 上下文变长即 handoff（本文件即交接）；后继 pi 要开 `/goal-focus`（斜杠命令必须**单独一条**发出）。
4. 完成后可关闭已确认的 pane；不删除 session 文件。

## 环境事故与已修复项（复现必读）

| # | 事故 | 处理 |
|---|---|---|
| E1 | MCP `graph_*` 工具根在主 checkout（`.graph/active` 不是本图） | **本图一切图级写入只走 worktree 内 CLI**（`--graph evofence-harness-kernel`）+ `sp.mjs`；不要用 MCP 通道 |
| E2 | lane 内无 `.graph` | lane agent 只写代码/测试，图状态由 orchestrator 记录 |
| E3 | `typescript` devDep 是 7.0.2（无 Compiler API） | guard 用 dev-only 别名 `typescript6@6.0.3`；`npm run build/typecheck` 已显式走 `node_modules/typescript/bin/tsc`（7.0.2） |
| E4 | `node --test` 不下钻 `test/` 子目录 | 测试一律平铺 `test/` 根、命名 `<lane>-*.test.js` |
| E5 | 全量 `npm test`/`npm run check` 在并发负载下偶发 wall-clock flake | 既有 `test/runner.test.js`（`one evolution … rolled back`，120s 预算）与 `test/process.test.js` 偶发 `RESOURCE_EXHAUSTED`；单独跑均绿。**判定 flake 时以"基线同失败 + 单独跑绿"为据** |
| E6 | 复核者若在集成 worktree 做变异，会与并发者互相干扰 | 负控优先在 lane 或 `dist/` 上做并复原；若改集成源码，结束时必须 `git diff --stat` 为空 |
| E7 | `graph serve` 后台终端随 session 消亡 | 需要 UI 时在 72a4 worktree 重起 `graph serve --port 8934 --no-open` |

## 用量（至 handoff）

- pi/deepseek 自 09:30 UTC 起全部会话累计 **≈ $4.32**（含 S02/S03 尾段；S04 自身约 $0.6，仍在增长）；明细：S03 期两 pane ~$1.83、wave-2 四 lane ~$1.35、本轮 review/复验 ~$0.5。
- codex 全部走用户订阅（5h 限额），不进美元账。
- `MODEL-BUDGET.json` **未改**（那 $0.50 是 S01 探针额度；本轮由用户明确"无上限"）。

## 下一 session（S05）的第一动作

1. 读 `SESSION-PROTOCOL.md`、本 handoff、`sessions.json`；核验真实状态（`git log/status`、`graph status`、三条 codex lane 的 pane 输出）。
2. **收三条 codex lane**（按完成顺序）：
   - `l2_scheduler`：lane 修复 → 对照 `reviews/l2_scheduler-review.md` 合并到集成 → **新 tab deepseek 复验**（重点：B1 无 lease claim 的 stall 信号、M1 reclaim 路径与并发额度释放）→ 通过
   - `l2_artifact_port`：同上（重点：M1 错误码顺序、M3 越枚举 fail-open、M4 空材料拒绝）→ 通过
   - `l2_runtime`：lane 完成后 merge → 独立复核（新建 review tab，任务模板见 `tasks/L2-wave4-runtime-brief.md`）→ ready/claim → 通过
3. 三个都过之后：`l2_kernel_verification` ready/claim → **codex 执行**（纵向轨迹 + 故障轨迹 + 唯一判定入口），复核后通过 → **L2 收口**。
4. L2 收口后：按 `SESSION-PROTOCOL.md` 处理 L3（跨 L 必须新建对话/新 pane；L3 10 节点，建议沿用"codex 执行 + deepseek 新 tab 复核"的编队），并对 `l2_runtime` 等新通过节点更新导出视图（`graph export --docs` → `--check`）。
5. 需要图 UI 时重起 `graph serve`；需要预算/用量时按上文口径累计，不要重置。

## 已知限制与未证明项（如实，勿抹掉）

- artifact/scheduler 的 4 minor/1 blocker 修复**尚未复验**（交接时 codex 在修）。
- runtime 只有部分实现（codex 在写）；`l2_runtime`/`l2_kernel_verification` 尚无任何证据。
- 全图共性未证明项：DSH 侧 13 项 capability 仍 unknown、两宿主证据不对称、收益零数据、adr_0001/0004 仍 proposed、I04/I05 为静态 best-effort、guard 对反射/间接回调不做完备证明。
- `l2_scheduler` 复核记录：无资源死 claim 需 heartbeat/宿主超时才能根治（lane 只做 stall 信号）；`l2_state_store` 仅内存实现（人审 R2 裁定）；`l2_graph_model` patch 入口 schema 半边未 decode（已登记）。

## 原始图 / 导出视图 / sessions.json 同步

- `.graph/evofence-harness-kernel` 未手改；所有状态经 CLI/sp.mjs。
- 导出视图已重导且 `--check` 无漂移（`d17cc94`）。
- `sessions.json` 已更新 S03/S04；S05 条目由本 handoff 之后的收尾步骤写入。
