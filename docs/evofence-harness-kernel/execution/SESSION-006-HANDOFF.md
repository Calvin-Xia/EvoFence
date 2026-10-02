# SESSION-006 handoff：S05 → S06 主 agent 交接（3 项裁决已下，L3 续推）

- **前序**：S05（threadId `01a0f820-780b-73d6-9700-64caf5cd1bf4`，pane `wG:pX`）
- **后继**：S06（新 pi orchestrator；本 handoff 即其入场依据）
- **日期**：2026-10-02 上午。**用户已裁决**（见 §1），S05 依指令把全部注意事项移交 S06。
- **工作区**：集成 worktree `C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`；主 checkout（S05 的 cwd）为 `C:\Users\Calvin-Xia\EvoFence`，**所有 graph/git/npm 命令用绝对路径 cd 到集成 worktree 执行**。

## 1. 用户裁决（2026-10-02，原话摘要）

1. **Pi 版本**：**跟随 0.99.2**（用户提到本机已有 1.0 更新，但明确选择仍按 0.99.2 走；不要用 1.0）。
2. **DSH 版本**：**跟随升级到 0.2.0-rc.2**（更新 `integrations/deepseek-harness` 的 engines/peerDependencies）。
3. **场景**：**按建议走** —— Pi 侧 `deepseek/deepseek-flash` high；DSH 用其配置模型；预算沿用「无美元硬上限、逐请求记账」；任务 = scratch clone + 有界真实任务（同一任务合同对照）。

## 2. 当前真实状态（交接时）

- `graph status --graph evofence-harness-kernel --oneline` → **23/40 passed (57.5%)**；无 ready/running 残留之外：`l3_pi_session` 为 running/claimed-by-S05（cp1 failed=blocked-on-version、cp2/cp3 passed）。validate 0 error；`export --docs --check` 无漂移。
- **已完成（逐节点 checkpoint/report/verdict/passed + 独立复核 dossier）**：
  - L1 7/7；L2 9/9（含 l2_kernel_verification 的 I01 边界修复，commit `4734088`）。
  - L3：`l3_context_router`（`1dcf506`）、`l3_task_evaluation`（`3423ecf`）、`l3_workspace_txn`（`db396b1`）。
  - L4：`l4_asset_registry`（`21d6d06`）、`l4_retrieval`（`8cef8ff`）、`l4_evolution_eval`（`8c6a37d`）。
  - L5：`l5_legacy_boundary`（`c89e62d`）。
  - 文档/状态提交至 HEAD（含 `SESSION-005-HANDOFF.md`、`L3-L4-STATUS.md`、各 verify brief 与 review dossier；`0210467` 及之后）。
- **PR**：#21（draft，base `main`）CI **8/8 全绿**。**允许 push/PR/等 CI；不允许 merge**；不 publish、不打 tag。
- **lane worktrees**（全部含 node_modules junction → 集成 node_modules，**勿 npm install**）：
  `EvoFence-wt/harness-kernel/{l3-pi, l3-router, l3-workspace, l3-eval, l4-assets, l4-retrieval, l4-evo-eval, l5-legacy}`（历史 lane）+ 待建 `l3-pi-b`、`l3-dsh`。
- **pane**：仅 `wG:pX`（S05）与 `bt-10`（`graph serve --port 8934`，cwd=集成 worktree）在运行；其余已关闭。

## 3. 立即动作（按序）

### 3.1 开工检查（5 分钟）
1. 读本 handoff、`docs/evofence-harness-kernel/execution/SESSION-PROTOCOL.md`、`sessions.json`、`L3-L4-STATUS.md`。
2. 核验：HEAD、`graph status`、`git status`（应干净）、`gh pr checks 21`（应 8/8）。
3. 收编 `l3_pi_session`：它由 S05 认领（stale）。`graph reclaim -i l3_pi_session --by S06 --graph evofence-harness-kernel` → `graph update-status -i l3_pi_session -s ready` → `sp.mjs claim l3_pi_session S06`。

### 3.2 Pi 重定版 lane（裁决 1）
- 简报：`docs/evofence-harness-kernel/execution/tasks/L3-pi-session-repin-brief.md`（**0.99.2 适配 + 真实会话证据 + P1–P17 重验/保留 unknown**）。
- 建 lane：`git worktree add "C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-pi-b" -b refactor/hk-l3-pi-b HEAD` → junction node_modules（见 §6.3）→ tab+codex agent（§6.2）→ prompt 指向简报。
- lane 完成后：并入集成（copy `src/hosts/pi/**`、`test/l3-pi-*.test.js`、`probes/pi/VERSION-PIN.json` 与 HOST-MAPPING 版本行）→ build/测试/static-audit → commit → 新 pi+deepseek tab 复验（可复用 `tasks/L3-pi-session-verify` 口径，需新写 verify brief）→ graph 三 checkpoint→report→verdict→passed。

### 3.3 DSH lane（裁决 2）
- 简报：`tasks/L3-dsh-session-brief.md`（**含裁决 A 落地：integrations/deepseek-harness 版本声明升级到 0.2.0-rc.2 + 按实测适配 + 13 项 unknown 如实保留**）。
- 建 lane `l3-dsh`（branch `refactor/hk-l3-dsh`）→ 派 codex → 并入 → 复核 → `l3_dsh_session` passed。
- **注意**：DSH 真实的付费/凭据使用按用户既往口径（凭据不打印、不入库）；未知能力不得升级为已验证。

### 3.4 之后（依赖链）
`l3_pi_delegation` / `l3_dsh_delegation`（各自依赖 session passed）→ `l3_dsh_scenario` / `l3_pi_scenario`（§1.3 的模型/预算/任务口径，同一任务合同，scratch clone）→ `l3_dual_host_gate` → L4 余下（`l4_experience` → `l4_promotion` → `l4_regression_revocation` → `l4_learning_scenario` → `l4_capability_trial`）→ L5（`l5_public_sdk` → `l5_cli_observability` / `l5_sp_bridge` → `l5_release_plan`）→ **`l5_accept` 人审门（只备材料，不代签）**。
每节点沿用既有流程（§4）；委派/场景/门节点可先写简报再派单（参考 `tasks/L3-*.md` 模板与已通过的 verify brief 形态）。

## 4. 节点收口流程（每节点照做）

1. **派单**：worktree + branch（`refactor/hk-<lane>`）+ junction + `herdr tab create` + `herdr agent start <name> --kind codex --pane <pane>` + `herdr agent prompt <name> '<简报路径+要求>'`（长 prompt 见 §6.4）。
2. **认领**：`graph update-status -i <node> -s ready --graph evofence-harness-kernel` → `node <sp.mjs> claim <node> S06 --graph evofence-harness-kernel`。
3. **lane 完成**：读 pane 报告 → `git status` 核验范围（只应显示授权落点）→ copy 到集成（**绝不反向**）→ `npm run build` + 聚焦测试 + `node verification/kernel/static-audit.mjs`（必须 0 violations）→ commit（消息含节点 id 与证据摘要）。
4. **独立复核**：**新 tab + pi + deepseek/deepseek-flash:high**，prompt 指向新写的 verify brief（断言表 + dossier 格式），禁止复用旧 reviewer 上下文。**注意 prompt 可能只被填入不提交**：若 pane 显示 idle 且输入框有 prompt，用 `herdr_send_keys`（agentScope）补 `Enter`。
5. **通过**：`sp.mjs checkpoint <node> cpX passed`（逐条）→ `sp.mjs report <node> '<summary>' '<artifacts.csv>' '' '<notes>'`（artifacts 必须真实存在）→ `graph verdict -i <node> --verdict passed --note '<checkpoint 聚合 + 复核结论 + 残留>'` → `graph update-status -i <node> -s passed`。
6. **收尾**：`graph export --docs` + `--check`（无漂移）→ commit（dossier + 导出视图）→ 关闭已确认 pane（`herdr pane close`，会话文件保留）。

## 5. 路由、纪律与红线

- **执行只用 codex CLI（gpt-6.1-sol xhigh）；复核/复验只用 pi+deepseek 新 tab**。禁止用 deepseek 顶替执行。
- **codex 限额**：周限额 21%（2026-10-04 17:58 重置）+ 5h 窗口。触顶就**停下等刷新**；出现「Switch to gpt-6-luna?」对话框一律选 **2. Keep current model**（用 `herdr_send_keys` `Down`+`Enter`）。
- 单写入者：同一时刻只有一个 agent 写共享源码；lane 之间目录不重叠；orchestrator 是唯一 `.graph` 写入者（只经 `graph` CLI / `sp.mjs`，禁用 MCP graph_*（根在主 checkout）与手改 YAML）。
- 状态流转：eligible → ready → running（唯一 claim）→ 逐 checkpoint → report → verdict → passed；不跨未完成依赖；不 `--force`；不 cancel 上游制造可调度性。
- 证据分级：fixture/离线/模拟 ≠ 真实宿主闭环；unknown 保留为 unknown；负结果与未证明项写入 report/notes 与 dossier。
- 防御性编程禁令、测试用本次 build 的 `dist`、不跑全量 npm test 当复核（聚焦测试 + 必要时一次全量）。
- 不 publish、不打 tag、不 merge PR。push/PR 允许。

## 6. 环境操作要点（踩过的坑）

1. **graph CLI**：一切命令带 `--graph evofence-harness-kernel`；在集成 worktree 内执行。辅助脚本：`node "C:/Users/Calvin-Xia/AppData/Roaming/npm/node_modules/@lukawi/super-plumber/integrations/src/sp-scripts/sp.mjs"`（claim/checkpoint/report/get-node）。
2. **herdr 常用**：
   - 建 tab：`herdr tab create --workspace wG --cwd <dir> --label <label> --no-focus`
   - 起 agent：`herdr agent start <name> --kind codex --pane <pane>`（pi：`-- --model deepseek/deepseek-flash:high`；orchestrator 可用 `:max`）
   - 投递 prompt：`herdr agent prompt <name> '<text>'`；**投递 ≠ 消费**——检查 pane 状态，必要时 `herdr_send_keys`（agentScope）补 `Enter`。
   - 等待：`herdr agent wait <pane> --until idle --until blocked --timeout 3600000`（超时上限约 3.6e6ms；exit 1=超时、agent_not_running=已关闭 pane 的滞后回调，可忽略）。
   - 问答对话框：`herdr_send_keys`（agentScope）`shift+left` 打开问题 UI → `herdr_run_command` 输入答复文本 → `herdr_send_keys` `Enter` 提交。
   - 关闭：`herdr pane close <pane>`（会话文件保留）。
3. **lane worktree + junction**（Windows）：`git worktree add "C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/<lane>" -b refactor/hk-<lane> HEAD`；然后
   `cmd //c "mklink /J C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\<lane>\node_modules C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence\node_modules"`（**路径字面量，别用 bash 变量**）。
4. **cmd.exe 后台**：不支持 `;` 链式命令（用 `&&` 或不链式）；`herdr` 目录名以 `--` 开头时 bash 工具需 `./` 前缀。
5. **CRLF 陷阱**（`core.autocrlf=true`）：变异复原用 `git cat-file blob HEAD:<path> > <path>`，不要 `git checkout --`（会写成 CRLF）。
6. **测试**：`node --test test/<lane>-*.test.js` 平铺命名；fixture 文件用 `-fixtures.test.js` 或独立 `.mjs`；`node --test` 不下钻子目录。
7. **graph serve**：`bt-10` 正在 8934 端口运行（cwd=集成 worktree）；若要重开：`graph serve --port 8934 --no-open`。
8. **提交**：平台偶尔有 index.lock 权限限制，按正式审批路径处理，不绕锁、不伪造 SHA；`git add` 用路径白名单，避免误提交。
9. **git 分支**：lane 产物通常 untracked（lane 里不 commit），并入集成后由 orchestrator commit；L2 的 `finish` 类历史脚本（build-harness-design 等）**不要重跑**。

## 7. 遗留 minor / 未证明项（如实，勿抹）

- `l4_retrieval` m1：`evidence/results.json` 缺 `sourceHashes`（证据完整性缺口，可顺手补）。
- `l4_evolution_eval` m1：独立验证器身份边界（trusted-port 可达、单行可修；非阻断）。
- `l3_pi_session`：真实会话 DoD① 需按 0.99.2 重验（本轮 lane 即做）；0.87.1 时代证据不得平移。
- DSH 侧 13 项 unknown（D10/D13/D14/D15/D16/D18/D19/D20 等）与两宿主证据不对称；收益零数据（`l4_capability_trial` 前无结论）。
- `adr_0001`/`adr_0004` 仍 proposed；雾区 `dual-host-runtime-and-uplift` 不毕业（待 L3/L4 证据）。
- 各 dossier 的 minor/nit 清单（`docs/evofence-harness-kernel/execution/reviews/*.md`）。

## 8. 文件索引

- 协议：`execution/SESSION-PROTOCOL.md`；状态：`execution/sessions.json`；本 handoff：`execution/SESSION-006-HANDOFF.md`。
- 决策：`execution/{L3-PI-VERSION-DECISION,L3-DSH-VERSION-DECISION,L3-SCENARIO-BUDGET-DECISION,L3-L4-STATUS}.md`。
- 简报：`execution/tasks/*.md`（含 L3-pi-session-repin、L3-dsh-session 的现成简报）。
- 复验 dossier：`execution/reviews/*.md`；核验包：`verification/kernel/**`。
- 图导出视图：`docs/evofence-harness-kernel/{CONTEXT-MAP,DECISIONS,contexts/,adr/}`（只经 `graph export --docs` 生成）。

## 9. 用量口径

- pi/deepseek 逐请求成本可从 `~/.pi/agent/sessions/**` 的 jsonl 统计（S05 之前累计约 $8.3 含 S03/S04 尾段；S05 自身约 $0.9）。codex 走用户订阅，不计美元账。
- 长程场景开跑前在报告里给出预计上界，跑完记实际用量。
