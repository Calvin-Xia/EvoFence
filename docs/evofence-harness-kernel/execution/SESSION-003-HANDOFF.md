# SESSION-003 handoff：L2 进行中（首节点待放行，wave-2 四线并行）

- **当前 session**：S03，threadId `01a0f6fe-7f5c-7c1e-9d0a-2f4b6c8e1a37`（pi，orchestrator）
  （threadId 以本会话 pi session 文件名为准：`~/.pi/agent/sessions/--C--Users-Calvin-Xia-EvoFence--/` 下最新一条）
- **前序**：S02 `01a0f6da-465e-725d-9993-3eaa0b4adca1`（handoff 见 `SESSION-002-HANDOFF.md`）
- **后继**：未创建
- **阶段**：L2 进行中。`l1_replan` 人审门已通过（用户确认），L2 入口节点已产出、复核完成、**待放行**；wave-2 四线已在工作但**尚未认领**。

## 工作区与 git

- 主 worktree（**集成点**）：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`，HEAD `d47f0ca`
- **lane worktree（4 条，并行）**：`C:\Users\Calvin-Xia\EvoFence-wt\harness-kernel\{store,graph,policy,hostport}`，分支 `refactor/hk-<-lane>`，均基线 `d47f0ca`
  - 每条 lane 的 `node_modules` 是**指向主 worktree 的 junction**（不要各自 `npm ci`）
  - lane 内**没有 `.graph/`**（gitignore）→ **lane agent 物理上写不了图状态**（已验证：lane 内 `graph status` 直接报"无 graph.yaml"）
- 保护路径：`src/lib/**`、`src/cli.ts`、`src/index.ts`、`test-e2e/**`、`integrations/**`、`templates/**` **全程零改动**（各 lane 有自查命令）

## 本 session 真实完成

1. **L1 收口与人审**（承 S02 末尾）：`l1_replan` cp1/cp2 由我执行、**cp3 由用户真人确认**；8 份 ADR 采纳、2 份保留 proposed；雾区 **amend 未清空**；`l4_capability_trial` 与 `l3_dsh_session` 各追加 DoD。提交 `a4d04d5`。
2. **L2 首节点 `l2_public_contracts` 产出**：`src/protocol/**`（14 文件 / 1726–2268 行）+ 3 份平铺测试 + `scripts/check-core-imports.mjs`（I01–I08 guard）+ `test/protocol-guard/**`。提交 `d47f0ca`。
3. **两个环境阻塞的发现与修复**（见下"环境事故"）。
4. **wave-2 四线并行启动**（store / graph / policy / hostport），见下。

## graph 状态

`graph status --graph evofence-harness-kernel --oneline` → `7/40 passed (18%)｜ready 0｜running 1｜failed 0｜blocked 0`

| 节点 | 状态 | 说明 |
|---|---|---|
| L1 全部 7 个 | passed | `l1_review`/`l1_pi_probe`/`l1_dsh_probe`/`l1_graph_contract`/`l1_eval_protocol`/`l1_api_freeze`/`l1_replan` |
| `l2_public_contracts` | **running**（claimed by S02） | 产物已交付、独立复核已完成（协议层**可接受**；guard **需修订 0 blocker + 2 MAJOR**），**修复进行中，修完再放行** |
| `l2_state_store` / `l2_graph_model` / `l2_policy` / `l2_host_port` | **pending（未认领）** | ⚠️ **但工作已在进行**（4 条 lane 各自 worktree）。图因 `l2_public_contracts` 未 passed 而拒绝 ready（依赖门禁正确生效）。**修完父节点后必须立刻认领这 4 个** |

**ADR**：`adr_0002/0003/0005/0006/0007/0008/0009/0010` **accepted**；`adr_0001`、`adr_0004` **仍 proposed**（含运行承诺，待 L2 核验）。
**雾区**：`dual-host-runtime-and-uplift` 已 amend（L1 段毕业；剩余 DSH 运行期保证 / 两宿主证据不对称 / 收益零数据）；**未 graduate-fog**。

## 环境事故与已修复项（重要，会影响复现）

| # | 事故 | 处理 |
|---|---|---|
| E1 | **S02 误用 MCP `graph_update_graph`**，其工具面根在主 checkout（`.graph/active` = `evofence-042-hardening`），把本图雾区文本写进了 **042 图** | 已用 `graph graduate-fog --graph evofence-042-hardening` 清除并留 `fog_graduated` + `graph_amended` 审计事件；042 图 `validate` 回到 **0 错误 0 警告**。**本图一切图级写入只走 worktree 内 CLI + `--graph`** |
| E2 | **本 worktree 从 S01 起就没有 `node_modules`** → `npm test` 一直因 `better-sqlite3` 缺失而挂（S01 未跑产品测试所以未暴露） | `npm ci`（43 包，2 秒）修复 |
| E3 | **仓库 devDep `typescript` 是 7.0.2（Go 重写版），没有任何编译器 API**（`Object.keys` 只有 `version`/`versionMajorMinor`）→ 任何 AST 工具都无法用它 | 新增 **dev-only 别名** `"typescript6": "npm:typescript@^6.0.3"`（6.0.3，完整 API） |
| E4 | **E3 的别名抢占了 `node_modules/.bin/tsc`** → `npm run build`/`typecheck` 静默变成用 6.0.3 编译（产品声明的是 7.0.2） | 已把 `package.json` 的 `build`/`typecheck` 改为显式 `node node_modules/typescript/bin/tsc`，实测锁回 **7.0.2**。**注意 `npx tsc` 仍会解析到 6.0.3**（别名占 bin），要看产品编译器请走 `npm run build -- --version` |
| E5 | **`node --test` 在本仓库不下钻 `test/` 子目录** → 放进 `test/protocol/` 的测试**不会被 `npm test` 跑到**（等于没进门禁） | 协议层测试已改为**平铺** `test/protocol-*.test.js`；wave-2 简报已把"必须平铺"写成硬约束 |
| E6 | **全量 `npm test` 在当前高负载下 flake** | 两次运行失败点不同：一次 `test/unit-worktree-cleanup.test.js:213`（`git update-ref refs/evofence/generations/…` exit 1），一次 `process runner stops when a streamed output callback reports a budget trigger` + 跑 127 秒的 `one evolution … can be rolled back`。**孤立跑 `unit-worktree-cleanup` 是 6/6 通过**。判断：遗留 0.4.2 套件在"6 agent + 4 条 lane 同压一个 git 仓库"下的时序/资源 flake，**非协议层缺陷**。**未定论**：需在**编队空闲**时复跑一次全量拿干净基线；若仍失败，再查是否与多 worktree 的 `refs/evofence/generations/*` 冲突有关 |

## 用量

- pi pane 自报：`verify-main` 累计约 **$2+**（跨 L1/L2 多轮）、`review-1`/`review-2` 各约 **$0.8–1.0**、4 条 wave-2 lane **运行中**（各自仪表显示中）。
- codex：`codex-1`（L1+guard 首版）与 `codex-2`（guard 重做，38 分钟）走 5h 限额；期间 `codex-1` 有 5h 限额触顶记录。
- `MODEL-BUDGET.json` **仍未改**（那 $0.50 是 S01 的探针额度，本轮开发由用户明确"无上限"，**勿记入该账本**）。

## herdr 编队（会话结束即消失，仅供理解上下文）

| pane | 名字 | 角色 | 状态 |
|---|---|---|---|
| `wG:p2` | — | orchestrator（本会话） | working |
| `wG:p3` | — | codex-1（L1 用；已停止） | idle |
| `wG:p4` | `verify-main` | `l2_public_contracts` 作者（跨 L1/L2 复用，**欠佳**） | 正在修协议层 MINOR |
| `wG:p5` | `review-1` | 独立复核（协议层 / 图语义 / eval / HOST-MAPPING 历史） | idle |
| `wG:p6` | `review-2` | 独立复核（guard / OWNERSHIP / DSH 探针历史） | idle |
| `wG:p7` | — | **codex-2（L2 专用新会话）** | 正在修 guard MAJOR |
| `wG:p8`–`wG:pB` | `l2-store`/`l2-graph`/`l2-policy`/`l2-hostport` | wave-2 四条 lane | working |

**后台**：`graph serve` @ `http://localhost:8934/?graph=evofence-harness-kernel`（挂在会话后台终端，**会话结束会死**）。

## 未完成/待办（下一 session 的第一动作）

1. **等两个修复回来**：`verify-main`（协议层 3 MINOR + 2 NIT）与 `codex2`（guard 2 MAJOR：**I08 的 `Object.assign`/`push` 逃逸**、README 不实陈述；另 `declare module` 盲区、ps1 改写已跟踪文件的 NIT）。
2. **修完后放行 `l2_public_contracts`**：`sp.mjs checkpoint` ×3 → `graph verdict --verdict passed` → `graph update-status -s passed` → **立刻认领 wave-2 四节点**（`graph update-status -s ready` 然后 `sp.mjs claim`）——**图现在会因为父节点未 passed 而拒绝 ready，这是正确行为，不要用 `--force`**。
3. **合并 4 条 lane**：各 lane 完成后（它们各自 `npm test` 绿），由 orchestrator 把 `refactor/hk-<-lane>` 的产物并入 `refactor/harness-kernel`（各 lane 只写自己的 `src/<subtree>/**` + `test/l2-<-lane>-*.test.js`，路径不重叠，合并无冲突），然后在**主 worktree** 跑一次完整 `npm run check` + `npm test`（**并在编队空闲时复测 E6 的 flake**）。
4. **wave-3**：`l2_artifact_port`（← `l2_state_store`）、`l2_scheduler`（← graph+policy+store）→ `l2_runtime` → `l2_kernel_verification`。
5. `graph export --docs --graph evofence-harness-kernel` 后 `--check`，再 commit。

### ⚠️ 并发调度的教训（本 session 犯过，别重犯）

- **跨 L 必须换新会话/新 pane**：我在 L1→L2 时复用了 L1 的 codex 与 pi pane，被用户指出。S02 的 `verify-main` 现在还兼着 L2 作者，上下文已混。
- **不要开了 pane 闲着**：我开了 4 条 lane 却因为"等父节点提交"让它们空转，被用户指出。**判据**：只要产物路径不重叠且依赖在**实质**上已满足（`src/protocol` 已提交），就先派活、后补图上的 claim，不要让图的形式门禁空转人力。
- **`herdr agent wait` 有竞态**：向已 settled 的 pane 投递消息后立即 `wait` 会**立即返回**（看似完成）。正确做法：先轮询到 `working`（或会话文件回合数增加），再 `wait`。
- **投递 ≠ 消费**：`herdr_message_agent` 只保证写进 pane，不保证 agent 已开始跑。

## 未证明项（如实保留）

- L2 才刚起步：内核只有**协议层**有实现；`src/kernel`、`src/runtime`、`src/storage` 均由 wave-2 在建，**均未通过任何复核**。
- 收益零数据；两宿主证据强度不对称（Pi 2 次真实付费请求 / DSH 0 次）；DSH 13 项 capability 仍 `unknown`。
- I01–I08 的 guard 有**已知盲区**（I04/I05 best-effort；I08 的 `Object.assign`/集合方法逃逸修复中）。
- 全量 `npm test` 的干净基线**尚未取得**（E6）。
