# l3_workspace_txn 独立复核简报（review-1）

> 图：`evofence-harness-kernel` · 节点 `l3_workspace_txn` · 你的角色：**独立复核者**（新 tab、新 pane，未参与本节点写作）
> cwd = 集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`。只读复核；唯一写入是最终 dossier。

## 0. 复核对象

- 集成提交：orchestrator 派单时给出（lane `refactor/hk-l3-workspace` 的产物并入后的 commit；基线 `8bffca8`）。
- 交付面（预期）：`WorkspacePort` 端口/纯规则（core 内，如 `src/runtime/workspace/**`）+ 真实 fs/Git adapter（core 外，如 `src/workspace/**`）+ `test/l3-workspace-*.test.js`。
- lane 作者工作区（仅 sha256 比对）：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\l3-workspace`。
- 节点合同：plan = 共享只读 base、隔离/受锁 write scopes、patch/artifact stage、**唯一 integration writer**、base 绑定应用；Git 是一种 adapter；候选资产先 staged、不自动改全局 Skills。DoD① 并发 patch 冲突**明确返回 rebase/replan**、不盲合并；DoD② application journal/host receipts 与实际文件状态可 reconcile、**worktree 不被宣称 OS sandbox**。cp1 provider/base/scope、cp2 integration writer/冲突、cp3 原子应用/撤销/恢复。
- 简报：`docs/evofence-harness-kernel/execution/tasks/L3-workspace-txn-brief.md`；管辖 ADR：`adr_0001`、`adr_0004`。

## 1. 必须独立核验的断言

| # | 断言 | 检验方式 |
|---|---|---|
| 1 | base/scope：共享只读 base 有 revision/digest 绑定；base 不匹配的 patch 被拒（typed）；写 scope 隔离/受锁 | 读源码 + 自建探针（错误 base 应用） |
| 2 | 非 Git 抽象：策略/经验图资产不需要 Git 也能走同一 provider（或明确的范围声明） | 读接口与用例；确认不是 Git 专用接口冒充通用 |
| 3 | DoD①：并发 patch 冲突 → 显式 **rebase/replan**（带冲突文件与两侧 base），不盲合并 | 自建真实并发场景（临时目录两个 patcher）；复刻作者冲突用例 |
| 4 | 唯一 integration writer：提交串行且可证伪（并发下只有一个 writer 生效） | 读实现 + 真实并发探针 |
| 5 | 候选 staged：不直接改全局 Skills / 既有资产 | grep + 探针（候选路径不落在全局目录） |
| 6 | DoD②：原子应用/撤销/恢复；journal/receipts 与实际文件状态可 reconcile（崩溃/中断后 unknown 不盲重放）；撤销恢复前状态 | 真实 fs 崩溃注入（中途崩溃/部分写失败）+ 撤销用例 |
| 7 | **非 OS sandbox 声明**：代码/文档/回执不得宣称 worktree = OS sandbox（R7/A14） | grep 文档与注释；检查回执措辞 |
| 8 | core 未被污染：`src/{protocol,kernel,runtime}/**` 无 `node:fs`/`child_process`/git/网络；`static-audit` exit 0、0 violations | 重跑 static-audit + grep |
| 9 | 门禁 | build/typecheck/src:policy/dep:check=0；`node --test test/l3-workspace-*.test.js` 两次；真实 fs/Git 证据在临时目录可复跑 |
| 10 | 证据诚实 | 未证明项（跨机器并发、OS 隔离、非 Git adapter 覆盖度等）如实；变异负控（绕过冲突判定、信任旧回执、宣称 sandbox）0→1→0 可复现 |

## 2. 输出（dossier 唯一写入）

`docs/evofence-harness-kernel/execution/reviews/l3_workspace_txn-review.md`，格式同前几份复验 dossier（复核对象/结论/逐条证据/未证明项/收工一致性；结论 = 可接受或需修订 + 计数）。
最后回复一行结论（可接受/需修订 + 计数 + 关键证据）。

## 3. 纪律

- 不写 `.graph`、不 commit、不改 lane；变异/负控只在 `dist/` 或临时副本，复原用 `git cat-file blob`（CRLF 陷阱）。
- 只跑本次 build 的 `dist/`；结论以实测为准；真实 fs 操作限于系统临时目录。
