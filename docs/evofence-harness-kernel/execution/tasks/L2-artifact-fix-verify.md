# l2_artifact_port 修复后独立复验简报（review-fix-verify）

> 图：`evofence-harness-kernel` · 节点 `l2_artifact_port` · 你的角色：**独立复验者**（新 pane、未参与本节点任何写作）
> 你的 cwd 是集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。你**只读**源码与测试；唯一允许写的文件是最终 dossier。

## 0. 背景

- 首轮独立复核：`docs/evofence-harness-kernel/execution/reviews/l2_artifact_port-review.md`，结论 **可接受（0 blocker / 0 major / 4 minor / 4 nit）**；M1–M4、N1–N2 已由 codex lane（`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\artifact`，分支 `refactor/hk-artifact`）修复后并入集成。
- 集成基线（修复前）：commit `0c028bd`。**修复 diff = 当前工作树/HEAD 与本节点合并提交对 `src/storage/artifacts/**` + `test/l2-artifact-*.test.js` 的差异**；orchestrator 会把修复提交 SHA 写进本文件名旁（或由你在 `git log` 中找到）。

## 1. 必须逐条核验的修复点

| # | 首轮缺陷 | 修复验收标准 |
|---|---|---|
| M1 | consumer 读路径先取字节后判 binding/schema ⇒ 同一 stale-base 工件按 store 状态返回两个不同错误码（`EFK_ARTIFACT_UNAVAILABLE` vs `EFK_ARTIFACT_BINDING_MISMATCH`） | 顺序改为 `withheldReason → 过期 → producer/schema/binding → store.get`；**A13 不变**：held-out/final 引用的受众拒绝仍必须是 `EFK_PRIVACY_VIOLATION` 且**不触碰 store**（先判隐私再判 binding）；同一 stale-base 工件在「locator 失效」与「字节仍在」两种 store 状态下返回**同一** typed 码；作者套件新增错误码优先级用例 |
| M2 | asset 的 `revokedDependencies` 门排在最后（先读了已作废材料，且码随 store 状态漂移） | 撤销判定提前；被撤销依赖时**不读** material；`EFK_ASSET_QUALIFICATION_INVALID` 稳定（与 store 状态无关）；新增用例 |
| M3 | `visibility`/`partition` 越枚举值时受众表 fail-open（报告路径无 store 兜底） | 采用首轮建议之一：报告入口复用 decode / 显式校验；或把「只接受 codec 解出的 ref」写成硬前提并在报告路径落地（不允许仍留 fail-open 可达路径）。修复须有可失败用例或明确的类型/边界证明；写明所选口径 |
| M4 | `AssetConsumerRequest` 允许 `contentRefs`/`sourceTraces` 同时为空并返回 `ok`+空 evidence | 空材料被拒（类型层非空 tuple / 边界 decode / typed 拒绝三选一）；新增「空材料被拒」用例；非空材料路径不回归 |
| N1 | `checkAvailability` 注释与 `at >= expiresAt` 边界不符 | 注释改为 at-or-after（或等价） |
| N2 | `BindingExpectation` 缺 `sessionId`/`hostSessionId` | 或加入两轴，或在注释写明「session 轴不在本 lane 判定范围」——二选一，需可查 |
| N3/N4 | 拒绝回包带 withheld id；port 从父级 impl barrel 取 `storeOk/storeFail` | 记录最终处置（修/留+理由）即可 |

## 2. 方法与硬性门禁（不采信作者自报）

1. **sha256 双份**：逐文件比对 lane（`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\artifact`）与集成副本；若有差异，逐个说明是遗留还是修复引入。注意 CRLF 陷阱（见首轮复核 §0.1）：不要用 `git checkout -- <file>` 复原变异，用 `git cat-file blob HEAD:<path> > <path>` + `git add`。
2. **门禁**：`npm run build`；`node --test test/l2-artifact-*.test.js`（连跑两次，数字与用例名一致）；`npm run typecheck`、`npm run src:policy`、`npm run dep:check`。
3. **独立负控**（至少覆盖 M1/M2/M4）：在 `dist/`（gitignored）或临时副本上变异 → 记录变红用例名 → 复原 → 复绿；变异必须**精确命中**对应断言。
4. **自建探针**（复刻首轮 P1a/P1b、P2a/P2b、P3、P5，加 M1 的 A13 反例：held-out ref + stale base ⇒ 必须 `EFK_PRIVACY_VIOLATION` 且 store 未被调用）。
5. 若你改动了 `src/`、`test/` 下任何文件做变异，收工必须复原并给出 `git status --porcelain` / `git diff` 对这两处为空。

## 3. 输出（dossier 唯一写入）

写入 `docs/evofence-harness-kernel/execution/reviews/l2_artifact_port-review-fix-verify.md`：

```
# l2_artifact_port 修复复验（review-fix-verify）
日期 / 复核者（pane）：
修复提交（SHA）：
结论：接受 / 需修订（blocker/major/minor 计数）
逐条：M1 … M4 / N1 / N2 的判定 + 实测证据（命令、输出摘要、用例名、sha256 结果）
负控表：变异点 → 变红用例名 → 复原
未证明项与保留意见：
收工一致性：lane vs 集成 sha256、git 状态
```

## 4. 纪律

- 不写 `.graph`、不 commit、不改 lane、不跑全量 `npm test`（除非修复影响到它）。
- 只读复核 + 本 dossier 一个文件；过程用 `npm run build` 的产物 `dist/` 跑测试（ADR-0004）。
- 判定以实测为准：修复未到位就如实「需修订」，不因作者自报而放行。
