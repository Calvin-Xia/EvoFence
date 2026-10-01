# L3–L4 执行状态与待用户裁决（2026-10-02 早晨）

> 当前：`23/40 passed (57.5%)`。PR #21（draft）CI 全绿；未 merge、未 publish、未打 tag。
> HEAD：分支 `refactor/harness-kernel`（worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，提交见 `git log`）。

## 进度总览（逐节点均有 checkpoint/report/verdict/passed 与独立复核 dossier）

| 阶段 | 状态 | 说明 |
|---|---|---|
| L1（7） | ✅ 7/7 | 双宿主探针、图语义、评测协议、API 冻结、人审 replan |
| L2（9） | ✅ 9/9 | 协议层、存储、图模型、策略、宿主端口、产物端口、调度器、runtime、内核纵向核验（含 I01 边界修复） |
| L3（10） | 4 完成 / 1 部分 / 5 待 | ✅ `l3_context_router`、`l3_task_evaluation`、`l3_workspace_txn`；◐ `l3_pi_session`（cp2/cp3 过；cp1 因 **Pi 版本**阻塞，证据已留）；⏸ `l3_dsh_session`、两个 delegation、两个 scenario、dual-host gate —— **全部等用户裁决** |
| L4（8） | 3/8 | ✅ `l4_asset_registry`、`l4_retrieval`、`l4_evolution_eval`；其余（experience/promotion/regression/learning_scenario/capability_trial）依赖 `l3_dual_host_gate` |
| L5（6） | 1/6 | ✅ `l5_legacy_boundary`；其余（public_sdk/cli_observability/sp_bridge/release_plan）依赖 dual-host gate 与 L4 链；`l5_accept` 为人审门 |

全部改动按节点 commit；`graph validate` 0 error；`graph export --docs --check` 无漂移；`.graph` 只经 CLI 写入。

## 待你裁决（三项，回答一句话即可）

1. **Pi 版本**（`L3-PI-VERSION-DECISION.md`）：pin 0.87.1，本机只有 **0.99.2**、无 0.87.1 副本。
   建议 **A：跟随 0.99.2**（更新 pin + 按 0.99.2 重验版本敏感项）→ 解锁 `l3_pi_session` → `l3_pi_delegation` → `l3_pi_scenario`。
2. **DSH 版本**（`L3-DSH-VERSION-DECISION.md`）：集成钉 0.1.7-rc.1，本机实测 **0.2.0-rc.2**；节点 DoD 明确要求你先裁决。
   建议 **A：跟随升级到 0.2.0-rc.2** → 解锁 `l3_dsh_session` → `l3_dsh_delegation` → `l3_dsh_scenario`。
3. **长程场景的模型/预算/任务来源**（`L3-SCENARIO-BUDGET-DECISION.md`）：两个 scenario 节点要求「模型与预算须另行给定」。
   建议：Pi 用 `deepseek/deepseek-flash` high、DSH 用其配置模型；预算沿用「无美元硬上限、逐请求记账」；任务用 scratch clone + 有界真实任务（同一任务合同对照）。

> 三项齐后：`l3_dsh_scenario`+`l3_pi_scenario` → `l3_dual_host_gate` → L4 余下（experience/promotion/regression/learning_scenario/capability_trial）→ L5（public_sdk/cli_observability/sp_bridge/release_plan）→ `l5_accept` 人审。
> 另：codex 周限额 **21%**（10-04 17:58 重置）；若中途触顶按你的指令停等刷新，不降模型、不用 deepseek 顶替执行。

## 已记录的限制/未证明项（不得当作已达成）

- Pi/DSH 真实宿主闭环与其版本敏感证据（等 1/2 的裁决）；两宿主证据仍不对称。
- 收益结论零数据（`l4_capability_trial` 之前无结论）；`l4_evolution_eval` 未跑真实未见评测。
- 各节点复核 minor/nit（如 `l4_evolution_eval` m1 独立验证器身份边界=单行可修；`l4_retrieval` m1 证据缺 sourceHashes）均已在 dossier 与 execution_report 记录。
- `adr_0001`/`adr_0004` 仍 proposed；雾区 `dual-host-runtime-and-uplift` 不毕业（待 L3/L4 证据）。
