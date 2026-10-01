# SESSION-005 handoff：L2 全节点收口（9/9，含 I01 边界修复）→ L3 双宿主入口

- **当前 session**：S05，threadId `01a0f820-780b-73d6-9700-64caf5cd1bf4`（pi orchestrator，pane `wG:pX`；cwd 主 checkout `C:/Users/Calvin-Xia/EvoFence`，所有 graph/git/npm 以绝对路径在集成 worktree 执行）
- **前序**：S04（`SESSION-004-HANDOFF.md`）
- **后继**：S06（L3）。用户 2026-10-02 指令：herdr 编队接力不变；orchestrator 上下文 <700k 可继续本会话，>700k 换新 pi agent 接手（写 handoff → 新 tab `/goal-focus`）
- **阶段**：L2 完成（预期 16/40 passed = L1 7 + L2 9），进入 L3 准备
- **工作区**：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`，HEAD `4734088`（L2 收口代码与证据）+ 本 handoff/dossier 的 docs 收尾 commit（`git log` 顶部），工作树干净

## 本 session（S05）真实完成

| 节点 | 结果 | 集成 commit | 证据 |
|---|---|---|---|
| `l2_artifact_port` | 修复 M1–M4/N1–N3 后 passed | `2bbbe30`（基线 0c028bd） | 首轮复核 0B/0M/4m/4n → lane 修复 50 用例 + 10 轮变异；复验（pane `wG:pY`）接受 0B/0M/0m；dossier `reviews/l2_artifact_port-review-fix-verify.md` |
| `l2_scheduler` | 修复 B1/M1/m1–m5/n1–n4 后 passed | `8db1718`（基线 0df8be3） | 首轮 1B/1M/5m/4n → lane 修复 38 命名/39 含 fixture + 17 轮变异，新增 `activity.ts`+`reclaimExpiredClaims`；复验（`wG:pZ`）接受 0B/0M/0m；dossier `reviews/l2_scheduler-review-fix-verify.md` |
| `l2_runtime` | 实现后 passed | `90e589f` | 10 源文件 933 行 + 31 用例；DoD1/DoD2 变异证据；lane 全量 774/774；复核（`wG:p0`）可接受 0B/0M/**2m/2n**（step 空转写事件、重复 pause 非对称；L3 轮询循环再定）；dossier `reviews/l2_runtime-review.md` |
| `l2_kernel_verification` | **gate**：cp1/cp2 证据 + cp3 发现 I01 drift → orchestrator 裁决纯搬迁修复 → cp1/cp2/cp3 全过并通过独立复核 | `4734088`（基线 aca2883） | `verification/kernel/**`：static-audit 0 violations；12 轨迹×2 逐字节一致（与 `evidence/pre-fix/**` 摘要相同）；17 条错误矩阵（码全 ∈ 冻结 ERROR_CODES）；7 组变异红→绿；门禁 814/814；独立复核（`wG:p12`）可接受 0B/0M/1m；dossier `reviews/l2_kernel_verification-review.md` |

**I01 边界修复（本 session 关键事件）**：`src/runtime/session/**` 曾 import `src/storage/**`（14 条/9 文件），违反冻结 OWNERSHIP.md I01/R1（core 闭包=protocol/kernel/runtime）。orchestrator 裁决为行为不变搬迁：`src/storage/{contracts,identity,projection,outbox}.ts` → `src/kernel/store/**`，`src/storage/artifacts/**` → `src/kernel/artifacts/**`；storage 只留 backend，改为 storage→kernel 导入；`storage/index.ts` 公共导出面不变；runtime + 5 个 artifact 测试只改 import 来源。`l2_artifact_port` 的 execution_report artifacts 已更新为迁后路径并加注（结论不变）；`l2_runtime` 路径未变。

## graph 状态（handoff 时）

- `graph status --oneline` → **16/40 passed (40%)**；ready/running/failed/blocked 均 0；`graph validate` 0 error（1 warning）。
- 导出视图：`graph export --docs` 每次 pass 后重导，`--check` 无漂移（21 文件）。
- ADR：`adr_0002/0003/0005/0006/0007/0008/0009/0010` accepted；`adr_0001`、`adr_0004` 仍 proposed（待 L3/人审，不代签）。
- 雾区 `dual-host-runtime-and-uplift` 仍为 amend 状态：L2 段已用真实注错核验并发/租约/fencing/outbox/reconcile；DSH 13 项 unknown、两宿主证据不对称、收益零数据仍待 L3/L4。

## 用户授权与纪律（本轮有效）

- **2026-10-02 睡前指令**：允许 commit；允许 push/PR 并等 CI；**不允许 merge**。不 publish、不打 tag（延续）。
- 路由：执行类（源码修改、真实宿主探针）→ codex CLI（gpt-6.1-sol xhigh）；review/复验 → 每节点新 tab pi+deepseek-flash high；已完成确认的 pane 关闭（会话文件保留）。
- 单写入者：orchestrator 是唯一 `.graph` 写入者；同一时刻只有一个源码写入者；lane worktree 用于并行写。
- 状态流转只走 `graph` CLI / `sp.mjs` /（本图）worktree 内 CLI，禁止手改 YAML、禁止 `--force`；先 verdict 后 passed；claim 唯一。
- 证据分级与防御性编程禁令（`SESSION-PROTOCOL.md`）不变；测试跑本次 build 的 dist。

## 用量账（从 `~/.pi/agent/sessions/**` 逐请求统计，不重置）

- **S05 小计 ≈ $0.72**：orchestrator `01a0f820` $0.4416(191 req) + artifact 复验 `01a0f82b` $0.0803 + scheduler 复验 `01a0f833` $0.0787 + runtime 复核 `01a0f84a` $0.1186。
- 近 5h 窗口（S02 尾段→S05，两个 sessions 目录 21 个文件）合计 ≈ **$8.32**（含 S03/S04 期 lane 与 reviewer）。
- codex 全部走用户订阅（5h 限额，pane 显示 12–23% 剩余、约 23:52 重置）；不进美元账。
- `MODEL-BUDGET.json` 未改（$0.50 是 S01 探针额度；本轮由用户明确无上限）。

## 环境事故与操作要点（复现必读）

| # | 事项 | 处理 |
|---|---|---|
| E1 | MCP `graph_*` 根在主 checkout | 本图一切图写入只走 worktree 内 CLI（`--graph evofence-harness-kernel`）+ `sp.mjs` |
| E2 | lane 内无 `.graph` | lane agent 只写代码/测试；图状态由 orchestrator 记录 |
| E3 | `typescript` devDep 7.0.2 无 Compiler API | guard/audit 用 dev-only 别名 `typescript6@6.0.3` |
| E4 | `node --test` 不下钻 `test/` 子目录 | 测试平铺 `test/` 根 |
| E5 | 全量 `npm test` 在并发负载下偶发 wall-clock flake | 判定以「基线同失败 + 单独跑绿」为据（本 session 全量 814/814 两次均绿） |
| E6 | CRLF（`core.autocrlf=true`）：`git checkout -- <file>` 会把 LF 重写为 CRLF | 变异复原用 `git cat-file blob HEAD:<path>`；sha256 比对注意行尾 |
| E7 | `graph serve` 随 session 消亡 | 已在 8934 重开（后台 `bt-10`，`graph serve --port 8934 --no-open`，cwd=集成 worktree） |
| E8 | `herdr agent wait` 的 `--timeout` 上限约 3.6e6 ms；cmd.exe 后台不支持 `;` 链式 | 用 `&&` 或不链式；等待 pane settled 用 wait + 轮询结合 |
| E9 | codex 5h 限额 | 观察到 pane 提示 12–23% 剩余；必要时等重置或换窗口执行非 codex 工作 |

## 正在跑/待办（handoff 时）

- 无运行中的 lane；review pane `wG:p12` 已完成并关闭（见 dossier）。
- **PR 计划**：按用户授权 push `refactor/harness-kernel` 到 origin 并开 PR（不 merge），等 CI；结果记入后续 handoff/最终材料。
- 已关闭 pane：`wG:pC`(S04) `wG:pT/pV/pS`(codex lane) `wG:pY/pZ/p0/p12`(review) `wG:p11`(kernel-verify codex)。

## 下一 session（S06，L3）第一动作

1. 读本 handoff、`SESSION-PROTOCOL.md`、`sessions.json`、`verification/kernel/REPORT.md`；核验 HEAD、`graph status`、PR/CI 状态与工作树干净。
2. **L3 入口**（`l2_kernel_verification` pass 后全部 eligible）：`l3_pi_session`、`l3_dsh_session`、`l3_context_router`、`l3_workspace_txn`、`l3_task_evaluation`。依赖链随后解锁 `l3_*_delegation` → `l3_dsh_scenario`/`l3_pi_scenario` → `l3_dual_host_gate`。
3. 路由建议（沿用并已在 sessions.json 记录）：真实宿主接入（DSH 0.2.0-rc.2 / Pi extension，`probes/{dsh,pi}/VERSION-PIN.json`）→ codex lane，真机探针为主；`l3_context_router`/`l3_task_evaluation`/`l3_workspace_txn` 判定与协议骨架 → codex 或 pi 起草；每节点完成后开新 pi+deepseek tab 复验，再 checkpoint/report/verdict/passed。
4. **真实长程场景（`l3_dsh_scenario`/`l3_pi_scenario`）**需真实模型与真实用量：模型与预算口径需用户确认（节点合同明确「模型与预算须另行给定并计入真实用量」）；不要用 fixture/插件启动冒充。
5. 跨 L 交接：写 `SESSION-006` 条目（predecessor=S05、phase=L3）；若换新 pi orchestrator，附 `/goal-focus` 与 handoff 路径。
6. 保持：`.graph` 只经 CLI/MCP/sp.mjs；导出视图重导；fog 不毕业（`dual-host-runtime-and-uplift` 待 L3/L4 证据）；ADR 不代签。

## 已知限制与未证明项（如实，勿抹）

- DSH 侧 13 项能力 unknown（父子/工具取消、磁盘恢复、OS 隔离、外部效果核实、供应商计费取消、team message delivery）；DSH 侧真实付费请求仍为 0（L1 结论）。
- 两宿主证据不对称；收益零数据（`l4_capability_trial` 之前无结论）。
- `adr_0001`/`adr_0004` 仍 proposed；I04/I05 为静态 best-effort；guard 对反射/间接回调不做完备证明（kernel-verify 未证明项同样记录）。
- `l2_artifact_port`：真实报告渲染器与 workspace/evaluator/asset 适配器未接线；S17 资格完整性归 L4；N4 nit 保留。
- `l2_scheduler`：`reclaimExpiredClaims` 的下游调用边界未写入合同（L3 接入时补跨 lane 用例）；同 nodeId 多 claim 口径为刻意设计。
- `l2_runtime`：2 minor（step 空转写事件、重复 pause 非对称）+2 nit；内存 store/fake host/fixture evaluator，未证磁盘耐久与 OS 崩溃恢复、真实宿主闭环；未接发布根入口/CLI。
- 全图：单写入者纪律下多窗并行的 lane 边界需在 L3 继续显式声明；产物发布（tag/publish）未授权。
