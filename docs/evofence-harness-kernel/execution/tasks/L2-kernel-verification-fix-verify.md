# l2_kernel_verification 独立复核简报（首轮 review，含 I01 修复复验）

> 图：`evofence-harness-kernel` · 节点 `l2_kernel_verification`（type=gate，L2 收口门） · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点任何写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。你只读源码/测试/证据；唯一允许写的文件是最终 dossier。

## 0. 背景

- 节点合同见 `docs/evofence-harness-kernel/execution/tasks/L2-kernel-verification-brief.md`；执行由 codex lane 完成并交付 `verification/kernel/**`。
- 执行期发现并修复了一处冻结边界 drift：`src/runtime/session/**` 曾直接 import `src/storage/**`（14 条引用/9 文件），违反 OWNERSHIP.md 冻结 JSON I01/R1（core 闭包 = protocol/kernel/runtime）。orchestrator 裁决为行为不变的纯搬迁：`src/storage/{contracts,identity,projection,outbox}.ts` → `src/kernel/store/**`，`src/storage/artifacts/**` → `src/kernel/artifacts/**`；storage 只留 backend 并改为从 kernel 导入；runtime 与 5 个 artifact 测试只改 import 来源。
- 集成提交：`4734088`（相对基线 `aca2883`）。前一轮 verify 的原始证据保留在 `verification/kernel/evidence/pre-fix/**`。

## 1. 必须独立核验的断言（不采信作者自报）

| # | 断言 | 独立检验方式（建议） |
|---|---|---|
| 1 | 修复是**行为不变的搬迁**：非 import 内容逐字节未变 | 用 `git show aca2883:src/storage/artifacts/<f>` 与 `src/kernel/artifacts/<f>` 对比，**排除 import 行后逐字节相同**；对 `contracts/identity/projection/outbox` 同法。抽样覆盖 12 个移动模块 + 19 个修改文件（修改文件应只有 import 行差异） |
| 2 | `src/storage/index.ts` 公共导出面不变 | 对比基线 HEAD 与修复后 `dist/storage/index.js` 的导出名集合（或 `node -e` 动态 import 后对 keys 排序 diff） |
| 3 | I01 静态审计真实通过 | 重跑 `node verification/kernel/static-audit.mjs`（exit 0、0 violations）；检查其 allowlist 确实读自 `spec/contracts/OWNERSHIP.md` 冻结 JSON（未加宽）；**自建负控**：临时在 `src/runtime/session/types.ts` 加一条 `import { storeOk } from '../../storage/index.js'` → 审计必须变失败 → 恢复后通过 |
| 4 | cp1/cp2 轨迹与修复前逐字节一致 | 对比 `evidence/repeatability.json` 与 `evidence/pre-fix/repeatability.json`（12 对 sha256 应相同）；重跑 `node verification/kernel/run.mjs`（build + 两次运行）确认 `cp1=passed cp2=passed cp3=passed errors=17 staticViolations=0` |
| 5 | 门禁与测试 | `npm run build/typecheck/src:policy/dep:check` 全 0；`npm test` 814/814/0（本次 build 的 dist） |
| 6 | 错误矩阵与冻结码 | `verification/kernel/ERROR-MATRIX.md` 的 17 条实际码全部 ∈ `src/protocol/errors` 的冻结 ERROR_CODES；抽查 2-3 条按命令复现 |
| 7 | 变异证据非伪造 | 抽查 `run-mutations.mjs` 至少 1 个变异：按 `evidence/mutations/*.txt` 与 `mutations.mjs` 复跑一次（变异只在 module-loader 内存态 / dist，不得改磁盘源码）；确认红→复原→绿与记录一致 |
| 8 | cp3 语义 | 冻结要求是「唯一判定入口且无影子判定」：抽查 `verification/kernel/static-audit.mjs` 的 single-decision 规则与 DRIFT.md 的 wiring 清单是否与源码相符（policy/graph/scheduler/facts 入口） |
| 9 | 证据包自洽 | `REPORT.md`/`DRIFT.md`/`MIGRATION.md` 与实际提交一致；`evidence/gates/source-preservation.json` 的源码冻结证明有效（src/** 前后哈希） |

## 2. 输出（dossier 唯一写入）

写入 `docs/evofence-harness-kernel/execution/reviews/l2_kernel_verification-review.md`：

```
# l2_kernel_verification 独立交叉复核（review-1）
日期 / 复核者（pane）：
复核对象：commit 4734088 相对 aca2883（含 I01 搬迁与 verification/kernel 证据包）
结论：可接受 / 需修订（blocker/major/minor/nit 计数）
逐条：上表 1-9 的判定 + 实测证据（命令、输出摘要、负控结果）
未证明项与保留意见（如实）：
收工一致性：git status 干净（仅本 dossier）、测试与审计复核数字
```

最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不要写 `.graph`、不 commit、不改 lane、不改冻结区；负控如需改源码必须复原（用 `git cat-file blob` 还原，勿用 `git checkout --`，见 CRLF 提示）。
- 只跑本次 build 的 `dist/`；不跑无关全量套件（npm test 一次即可，命中 flake 时以「基线同失败 + 单独跑绿」为据）。
- 结论以实测为准；证据不足时如实「需修订」，不得替作者补证。
