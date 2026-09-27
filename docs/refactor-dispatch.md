# EvoFence 0.4.0 重构 · herdr 派单规范

本文件是 `.graph/evofence-ts-refactor` 执行期的派单契约。执行 agent 认领节点前必须先读本文件。

## 1. 模型白名单（硬约束）

只允许两个模型，thinking 一律 `high`：

```bash
pi --model deepseek/deepseek-flash --thinking high
pi --model xiaomi/mimo-v2.6-pro   --thinking high
```

herdr 侧等价调用：

```
herdr_start_agent(agent="pi",
  agentArgs=["--model","deepseek/deepseek-flash","--thinking","high"], ...)
```

**禁止**派发白名单外的模型；派单前必须确认 pane 状态栏显示 `deepseek/deepseek-flash · high` 或 `xiaomi/mimo-v2.6-pro · high`。pane 自报与命令不一致时立即停止并上报。

## 2. 并发上限

- 同时写盘（改仓库文件）的执行 pane **≤ 4**。
- 复核 / 只读侦察 pane 不计入 4 个写并发，但总数建议 ≤ 6，避免监督不过来。
- 任一时刻**主 checkout 只允许一个写者**；其余写者必须落在各自的 Git worktree。

## 3. 域 → worktree 映射

`main` = 主 checkout（串行阶段用）；`wt-*` = `git worktree` 独立检出。

| 域 | 归属 | worktree | 文件所有权（独占） | 负责节点 |
|---|---|---|---|---|
| base | 串行 | `main` | `tsconfig.json`、`package.json`、`src/index.ts`、`src/types/**`、`scripts/**` | l1_base, l2_types |
| ledger | 并行 | `wt-ledger` | `src/ledger/**`（schema / 哈希链 / 校验 / 审计导出视图） | l2_ledger |
| gate | 并行 | `wt-gate` | `src/gate/**`（contract / policy / evidence / budget） | l2_gate |
| exec | 并行 | `wt-exec` | `src/exec/**`（编排 / adapters / process / git-worktree / 预算记账） | l2_exec |
| io | 并行 | `wt-io` | `src/io/**`（config / cli / report / status / errors / fs） | l2_config, l2_report, l2_cli |

**不成文规则**：写者只允许改自己域内的文件。任何跨域改动（例如新增一个共享类型）一律**不直接动手**，改为在 execution_report 的 blockers 里上报，由 base 域统一落地后再合并。

### worktree 生命周期

```bash
git worktree add -b refactor/<域> ../evofence-wt-<域>            # 从 main 的定稿提交拉出
# …域内开发、提交…
git -C ../evofence-wt-<域> status --short                        # 提交前确认无越域文件
git merge --no-ff refactor/<域>                                  # 回到 main 合并（文件域不重叠，预期无冲突）
git worktree remove ../evofence-wt-<域>
```

合并顺序：`ledger` → `gate` → `exec` → `io`（io 的 cli 依赖前三者，最后合以避免反复 rebase）。任一步出现冲突 → 停止，不自行强解，上报由编排会话裁决。

## 4. claim_by 命名规范

格式：`herdr-<角色>`，角色与域同名，全部小写连字符。

| 角色 | claim_by | 典型 pane |
|---|---|---|
| 设计 | `herdr-designer` | wA:p3 |
| 侦察 | `herdr-recon` | wA:p2 |
| 交叉复核 | `herdr-review` | wA:p4 |
| 基座 | `herdr-base` | 串行，主 checkout |
| 账本域 | `herdr-ledger` | wt-ledger |
| 门禁域 | `herdr-gate` | wt-gate |
| 执行域 | `herdr-exec` | wt-exec |
| IO 域 | `herdr-io` | wt-io |

纪律：
- 认领只走 `graph` CLI / MCP `graph_*` / `sp.mjs`，`claim_by` 必须能对上本表；新增角色需先在本表登记。
- 一个节点只能有一个 `claim_by`；重复认领失败即换节点，不重试同一节点。
- pane ↔ agent ↔ 节点三方对应关系记在 §5 的活动台账里。

## 5. 活动台账（执行期实时更新）

| pane | agent 名 | 模型 | claim_by | 当前节点 | 状态 |
|---|---|---|---|---|---|
| wA:p2 | recon | deepseek/deepseek-flash | herdr-recon | l1_recon | idle（产出已交付） |
| wA:p3 | designer | xiaomi/mimo-v2.6-pro | herdr-designer | l1_design | working |
| wA:p4 | recon-review | deepseek/deepseek-flash | herdr-review | （复核，非节点） | done |

## 6. 红线

- 不得用 `force` 绕门禁；MCP 通道本就拒绝。
- 不得手改 `.graph/` YAML 伪造状态。
- 不得 claim 别人的节点（`assigned_to` 非自己即绕行）。
- 不得把 worktree 隔离表述为 OS 沙箱。
- 并行写者不得共用同一文件。
- 出现 stale 认领走 `graph reclaim`，**绝不 cancel** 可回收节点。
