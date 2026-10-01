# l2_scheduler 修复后独立复验简报（review-fix-verify）

> 图：`evofence-harness-kernel` · 节点 `l2_scheduler` · 你的角色：**独立复验者**（新 pane、未参与本节点任何写作）
> 你的 cwd 是集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。你**只读**源码与测试；唯一允许写的文件是最终 dossier。

## 0. 背景

- 首轮独立复核：`docs/evofence-harness-kernel/execution/reviews/l2_scheduler-review.md`，结论 **需修订（1 blocker / 1 major / 5 minor / 4 nit）**；已由 codex lane（`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\scheduler`，分支 `refactor/hk-scheduler`）修复后并入集成。
- 集成基线（修复前）：commit `0df8be3`；修复 diff = 合并提交与 `0df8be3` 对 `src/kernel/scheduler/**` + `test/l2-scheduler-*` 的差异。

## 1. 必须逐条核验的修复点

| # | 首轮缺陷 | 修复验收标准 |
|---|---|---|
| B1（blocker） | 无资源节点的死 claim 没有任何活性信号：claim 不持 lease ⇒ `progress` 永远 `dispatchable`/0 stall，DoD② 被构造性证伪（P3） | 「claim 存在但该 (nodeId, attemptOrdinal, epoch) 无 live lease」成为独立 stall 类别：`progress` 报 `stalled` + 明确 reason/blockedBy；有可失败用例；复刻 P3 场景（无资源节点、worker 消失、now 远大于 claim 时间）必须报 stall 而非 dispatchable |
| M1（major） | 过期 claim 无法回收：无导出函数可删 claim；`dispatchRound` 把尸体计入并发上限（P2/P4） | 导出显式 reclaim/expire 路径：只回收无 live lease 的 claim，**绝不回收活 lease**，typed 结果；`dispatchRound`/并发上限对「claim 无 live lease」不再计为 in-flight。用例：活 lease 不可回收、死 claim 可回收且并发额度释放 |
| m1 | `grantLease` 用编译期错误码 `EFK_GRAPH_RESOURCE_CONFLICT`（retry=never） | 换更合适码或如实在代码/文档注明语义（需可查的最终口径） |
| m2 | `claimNode` 唯一键实为 `nodeId`，与注释/CONTRACTS §5.1 的 `(nodeId, attemptOrdinal, epoch)` 不符 | 修代码或修注释使其一致，并新增/更新用例固定该口径 |
| m3 | `dispatchRound` 与 `progress` 的 in-flight 两套口径 | 统一为同一谓词/分类（如 `liveAttemptClaims(state, now)`）；P4 场景两端结论一致 |
| m4 | 同 nodeId 重复 claim 的 stall 分类依赖数组顺序（P7） | 排序或键化，保证确定性；P7 反序输入结论一致 |
| m5 | join 的 `unknown` 分支被归类为 `waiting-on-live-upstream` | 与 `stateStall` 的 reconcile 语义一致（或写明不一致的理由） |
| n1–n4 | `declarationsOf` fail-open / 死代码 `??` / `facts.branches ?? new Map()` / `advanceFairness` 无界累积 | 记录最终处置（修/留+理由） |

## 2. 方法与硬性门禁（不采信作者自报）

1. **sha256 双份**：lane ⇔ 集成副本逐文件比对；差异逐个归因。
2. **门禁**：`npm run build`；`node --test test/l2-scheduler-*`（fixture 一并命中，口径 ≥23 项）与 `node --test test/l2-scheduler-*.test.js`（命名用例口径）；`npm run typecheck`、`npm run src:policy`、`npm run dep:check`。
3. **独立负控**（至少 B1/M1/m4 各一）：变异 → 精确变红 → 复原 → 复绿；记录变异点与用例名。
4. **自建探针**：复刻首轮 P2/P3/P4/P7，并加：活 lease 节点在 reclaim 入口下的行为（必须拒绝或 no-op，typed 结果）；回收后同节点新 attempt 可被派发；回收不改变无关 state（`Object.is` 级恒等检查）。
5. 任何对 `src/`、`test/` 的变异必须复原，收工 `git status --porcelain` / `git diff` 对这两处为空。

## 3. 输出（dossier 唯一写入）

写入 `docs/evofence-harness-kernel/execution/reviews/l2_scheduler-review-fix-verify.md`：

```
# l2_scheduler 修复复验（review-fix-verify）
日期 / 复核者（pane）：
修复提交（SHA）：
结论：接受 / 需修订（blocker/major/minor 计数）
逐条：B1 / M1 / m1–m5 / n1–n4 的判定 + 实测证据（命令、输出摘要、用例名、sha256 结果）
负控表：变异点 → 变红用例名 → 复原
未证明项与保留意见：
收工一致性：lane vs 集成 sha256、git 状态
```

## 4. 纪律

- 不写 `.graph`、不 commit、不改 lane、不跑全量 `npm test`。
- 只读复核 + 本 dossier 一个文件；测试跑本次 build 的 `dist/`（ADR-0004）。
- 修复未到位就如实「需修订」，不因作者自报而放行。
