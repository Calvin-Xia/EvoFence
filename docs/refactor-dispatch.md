# EvoFence 0.4.0 重构 · herdr 派单规范

本文件是 `.graph/evofence-ts-refactor` 执行期的派单契约。执行 agent 认领节点前必须先读本文件。

> **修订（fix/r3，复核整改 F5/F6）**：独立交叉复核 `l5_review`（`docs/refactor-final-review.md`）指出本文件滞后于实际执行。本次回填：
> §3 的所有权路径由 L2 的预重构名（`src/ledger/**` 等）改为合并后的实际布局（`src/lib/**`），原表保留为**已过期快照**；
> §4/§5 补登 L3/L4 六个角色与复核角色 `herdr-review2`；
> §6 新增「未指派共享文件必须显式指派」红线；
> §7 新增 L2 四并发波共用测试文件的**违规记录**（如实记录，不粉饰）；
> §8 新增合并前 touched-file 交集检查。
> 下文凡标「L2 阶段快照」的内容均指当时的自述，现状以「最终布局」为准。

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

**补充披露（复核发现，F6 附带）**：编排会话（非派单执行 agent、不持任何节点）实测为 `deepseek/deepseek-flash · thinking=max`，与「thinking 一律 high」有偏离；L2/L3/L4 的 14 个执行会话逐一核对均在白名单内，**无白名单外模型**。该偏离不影响派单执行 agent 的白名单结论，此处如实登记以免台账被读成「全部 high」。

## 2. 并发上限

- 同时写盘（改仓库文件）的执行 pane **≤ 4**。
- 复核 / 只读侦察 pane 不计入 4 个写并发，但总数建议 ≤ 6，避免监督不过来。
- 任一时刻**主 checkout 只允许一个写者**；其余写者必须落在各自的 Git worktree。

## 3. 域 → worktree 映射

`main` = 主 checkout（串行阶段用）；`wt-*` = `git worktree` 独立检出。

### 3.1 最终布局（本节为准）

文件清单取自各分支的 `git diff --name-only <parent> <tip>`，不是规划意图。

| 域 | 归属 | worktree / 分支 | 文件所有权（独占） | 负责节点 |
|---|---|---|---|---|
| base | 先行串行 | `main` | `tsconfig.json`、`package.json`、`src/index.ts`、`src/types/**`、`scripts/**` | l1_base, l2_types |
| ledger | 并行 | `evofence-wt-ledger` / `refactor/ledger` | `src/lib/ledger/**`、`src/lib/audit/**`，及门面 `src/lib/{ledger,audit}.{js,ts}` | l2_ledger |
| gate | 并行 | `evofence-wt-gate` / `refactor/gate` | `src/lib/gate/**`，及门面 `src/lib/{contract,policy,evidence}.{js,ts}` | l2_gate |
| exec | 并行 | `evofence-wt-exec` / `refactor/exec` | `src/lib/exec/**`，及门面 `src/lib/{adapter,runner,git,process}.{js,ts}` | l2_exec |
| io · config | 并行 | `evofence-wt-io` / `refactor/io` | `src/lib/config/**`，及门面 `src/lib/{errors,fs,init,status}.{js,ts}` | l2_config |
| io · report | 并行 | 同上（同 pane 串行认领） | `src/lib/report/**`，及门面 `src/lib/{report,status}.ts` | l2_report |
| io · cli | 并行 | 同上（同 pane 串行认领） | `src/lib/cli/**`、`src/cli.ts`、`src/index.ts` | l2_cli |
| l3 · unit | 并行 | `evofence-wt-unit` / `refactor/l3-unit` | `docs/test-coverage-map.md`、`test/unit-*.test.js` | l3_tests_unit |
| l3 · e2e | 并行 | `evofence-wt-e2e` / `refactor/l3-e2e` | `test-e2e/**`、`package.json`（`test:e2e` 脚本） | l3_tests_e2e |
| l3 · integrations | 并行 | `evofence-wt-integ` / `refactor/l3-integ` | `integrations/**`、`src/lib/pi-tool-strategy*.ts`、`test/integrations.test.js` | l3_integrations |
| l4 · docs | 并行 | `evofence-wt-docs` / `refactor/l4-docs` | `README*`、`AGENTS.md`、`CHANGELOG.md`、`docs/config.md` | l4_docs |
| l4 · ci | 并行 | `evofence-wt-ci` / `refactor/l4-ci` | `.github/workflows/ci.yml` | l4_ci |
| l4 · release | 先行串行（ci 之后） | `evofence-wt-release` / `refactor/l4-release` | `package.json`、`package-lock.json`、`scripts/**`、`integrations/*/*.json`、`.claude-plugin/**`、`.github/workflows/publish.yml`、`test/release.test.js`、`integrations/deepseek-harness/**` | l4_release |
| l5 · 复核 | 只读 | `main`（复核会话 `wA:pK`） | 只写复核报告，不改被复核产物 | l5_review |

- `package.json` 被两处持有，但**从不同时**：base 在 L2 前串行持有，l4_release 在全部合并后串行持有（`refactor/l4-release` 的 parent 是 `refactor/l4-ci` 的 `5ede0fc`）。这属「显式指派给单一写者 + 串行」，不构成并行共用。
- `docs/refactor-final-review.md`（复核报告）与 `docs/refactor-*.md`（过程记录）不在上表内，属编排/复核独有；执行域不得改。

### 3.2 L2 阶段快照（已过期，仅作历史）

以下为执行当时写下的 L2 规划表；**路径名是预重构方案**，重构落地后实际全部位于 `src/lib/**`（见 §3.1）。保留原文以便复核对照，不要据此派单。

| 域 | 归属 | worktree | 文件所有权（规划名） | 负责节点 |
|---|---|---|---|---|
| base | 串行 | `main` | `tsconfig.json`、`package.json`、`src/index.ts`、`src/types/**`、`scripts/**` | l1_base, l2_types |
| ledger | 并行 | `wt-ledger` | `src/ledger/**`（schema / 哈希链 / 校验 / 审计导出视图） | l2_ledger |
| gate | 并行 | `wt-gate` | `src/gate/**`（contract / policy / evidence / budget） | l2_gate |
| exec | 并行 | `wt-exec` | `src/exec/**`（编排 / adapters / process / git-worktree / 预算记账） | l2_exec |
| io | 并行 | `wt-io` | `src/io/**`（config / cli / report / status / errors / fs） | l2_config, l2_report, l2_cli |

**历史备注**：L2 四域共同基线提交 = `34b193f`（含 TS 基座与共享类型层）；四个域提交的 parent 都是它，属真并发（见 §7 违规记录）。

### 3.3 worktree 生命周期

```bash
git worktree add -b refactor/<域> ../evofence-wt-<域>            # 从 main 的定稿提交拉出
# …域内开发、提交…
git -C ../evofence-wt-<域> status --short                        # 提交前确认无越域文件
git merge --no-ff refactor/<域>                                  # 回到 main 合并（文件域不重叠，预期无冲突）
git worktree remove ../evofence-wt-<域>
```

合并顺序：`ledger` → `gate` → `exec` → `io`（io 的 cli 依赖前三者，最后合以避免反复 rebase）；L3 波 `unit`/`e2e`/`integ`（三者 parent 同为 `588a215`，互不重叠）；L4 波 `docs`/`ci`，随后 `release` 串行。任一步出现冲突 → 停止，不自行强解，执行 §8 检查后上报编排会话裁决。

## 4. claim_by 命名规范

格式：`herdr-<角色>`，角色与域同名，全部小写连字符。

| 角色 | claim_by | 典型 pane | 备注 |
|---|---|---|---|
| 设计 | `herdr-designer` | wA:p3 | |
| 侦察 | `herdr-recon` | wA:p2 | |
| 交叉复核（L1 波） | `herdr-review` | wA:p4 | 一次性复核，非持节点 |
| 基座 | `herdr-base` | 串行，主 checkout | 持 l1_base/l1_dispatch/l2_types |
| 账本域 | `herdr-ledger` | wt-ledger | |
| 门禁域 | `herdr-gate` | wt-gate | |
| 执行域 | `herdr-exec` | wt-exec | |
| IO 域 | `herdr-io` | wt-io | 串行持 l2_config/l2_report/l2_cli |
| 单元测试 | `herdr-unit` | wt-unit | **L3 波补登** |
| 端到端测试 | `herdr-e2e` | wt-e2e | **L3 波补登** |
| 集成/插件 | `herdr-integ` | wt-integ | **L3 波补登** |
| 文档 | `herdr-docs` | wt-docs | **L4 波补登** |
| CI | `herdr-ci` | wt-ci | **L4 波补登** |
| 发布 | `herdr-release` | wt-release | **L4 波补登** |
| 独立复核（L5 波） | `herdr-review2` | wA:pK | **补登**；`herdr-review` 是 L1 波的角色，不复用 |

纪律：
- 认领只走 `graph` CLI / MCP `graph_*` / `sp.mjs`，`claim_by` 必须能对上本表；新增角色需先在本表登记（`herdr-unit/e2e/integ/docs/ci/release` 与 `herdr-review2` 就是事后补登，登记滞后已由复核实证）。
- 一个节点只能有一个 `claim_by`；重复认领失败即换节点，不重试同一节点。
- pane ↔ agent ↔ 节点三方对应关系记在 §5 的活动台账里。

## 5. 活动台账（执行期实时更新）

> `pane` 列的证据强度不同：`wA:pK` 来自复核会话自身的 `HERDR_PANE_ID`；其余 pane id 是**台账自述**，在 `~/.pi/agent/sessions/**/2026-09-27*.jsonl` 中无痕，**不可独立复核**。
> 可独立复核的是 `claim_by` ↔ 会话 `cwd` ↔ `git worktree` 三方对应（复核人已逐个核对），以及分支/提交。

### 已完成 / 已归档

| pane | agent 名 | 模型（自报） | claim_by | 节点 | 状态 |
|---|---|---|---|---|---|
| wA:p2 | recon | deepseek/deepseek-flash · high | herdr-recon | l1_recon | passed（归档 tab） |
| wA:p3 | designer | xiaomi/mimo-v2.6-pro · high | herdr-designer | l1_design | passed（归档 tab） |
| wA:p6 | base | deepseek/deepseek-flash · high | herdr-base | l1_base, l1_dispatch, l2_types | passed（归档 tab） |
| wA:p4 | recon-review | deepseek/deepseek-flash · high | herdr-review | （L1 交叉复核，非节点） | 已交付，pane 已关闭 |

### L2 并行波（4 并发，各在自己的 worktree）

| pane | agent 名 | 模型（启动参数） | claim_by | 节点 | worktree / 分支 | 提交 |
|---|---|---|---|---|---|---|
| wA:p8 | wt-ledger | deepseek/deepseek-flash --thinking high | herdr-ledger | l2_ledger | `C:\Users\Calvin-Xia\evofence-wt-ledger` / refactor/ledger | `235020f` |
| wA:p9 | wt-gate | deepseek/deepseek-flash --thinking high | herdr-gate | l2_gate | `C:\Users\Calvin-Xia\evofence-wt-gate` / refactor/gate | `a3392fc` |
| wA:pA | wt-exec | deepseek/deepseek-flash --thinking high | herdr-exec | l2_exec | `C:\Users\Calvin-Xia\evofence-wt-exec` / refactor/exec | `31db3cf` |
| wA:pB | wt-io | deepseek/deepseek-flash --thinking high | herdr-io | l2_config, l2_report, l2_cli | `C:\Users\Calvin-Xia\evofence-wt-io` / refactor/io | `03096f2`, `248ffc9`, `588a215` |

峰值并发写者 = 4（≤4 上限）。主检出（`main`）在并行波期间只有编排会话在做状态流转，无执行 agent 直接写入。
worktree 基线提交 = `34b193f`（L2 四域共同祖先，含 TS 基座与共享类型层）。**四域并发共用测试文件，已记违规（§7）。**

### L3 并行波（3 并发，parent 同为 `588a215`）

| pane | 会话 cwd（独立取证） | 模型（独立取证） | claim_by | 节点 | worktree / 分支 | 提交 |
|---|---|---|---|---|---|---|
| 未留痕 | `evofence-wt-unit`（起始 2026-09-27T07:53:22.894Z） | deepseek/deepseek-flash · high | herdr-unit | l3_tests_unit | `evofence-wt-unit` / refactor/l3-unit | `c10c3e6` |
| 未留痕 | `evofence-wt-e2e`（起始 2026-09-27T07:53:22.959Z） | deepseek/deepseek-flash · high | herdr-e2e | l3_tests_e2e | `evofence-wt-e2e` / refactor/l3-e2e | `8a0aa65` |
| 未留痕 | `evofence-wt-integ`（起始 2026-09-27T07:53:33.206Z） | deepseek/deepseek-flash · high | herdr-integ | l3_integrations | `evofence-wt-integ` / refactor/l3-integ | `2537050` |

三者的 touched-file 集合互不相交（unit: coverage-map + 两个 `unit-*`；e2e: `package.json` + `test-e2e/**`；integ: `integrations/**` + `src/lib/pi-tool-strategy*` + `test/integrations.test.js`），未再犯 §7 的共用文件问题。

### L4 波（docs/ci 并发 2，release 串行）

| pane | 会话 cwd（独立取证） | 模型（独立取证） | claim_by | 节点 | worktree / 分支 | 提交 |
|---|---|---|---|---|---|---|
| 未留痕 | `evofence-wt-docs`（起始 2026-09-27T08:25:44.420Z） | deepseek/deepseek-flash · high | herdr-docs | l4_docs | `evofence-wt-docs` / refactor/l4-docs | `fef141a` |
| 未留痕 | `evofence-wt-ci`（起始 2026-09-27T08:25:44.435Z） | deepseek/deepseek-flash · high | herdr-ci | l4_ci | `evofence-wt-ci` / refactor/l4-ci | `5ede0fc` |
| 未留痕 | `evofence-wt-release`（起始 2026-09-27T08:30:46.328Z） | deepseek/deepseek-flash · high | herdr-release | l4_release | `evofence-wt-release` / refactor/l4-release | `efb54c9`, `4c4971f` |

docs 与 ci 无文件交集；`release` 的 parent 是 ci 的 `5ede0fc`，属串行，不是并发合并。

### L5 复核波（只读）

| pane | 会话 cwd（独立取证） | 模型（独立取证） | claim_by | 节点 | 输出 |
|---|---|---|---|---|---|
| wA:pK | `EvoFence`（主检出，起始 2026-09-27T08:39:04.495Z） | deepseek/deepseek-flash · high | herdr-review2 | l5_review | `docs/refactor-final-review.md`（只读复核，不写被复核产物） |

### pane id 的获取方式与可复核性

- 复核人会话的 pane id 来自其自身环境变量 `HERDR_PANE_ID=wA:pK`（唯一可自证的 pane id）。
- L2 台账的 pane id（`wA:p8`/`wA:p9`/`wA:pA`/`wA:pB`）与历史 pane 均**无法独立复核**：逐个解析 `~/.pi/agent/sessions/**/2026-09-27*.jsonl` 后，只有本会话（及当前整改会话）出现 `HERDR_PANE_ID`，pane 关闭后其 id 不落任何持久文件。
- 因此**可复核的对应关系以 `claim_by` ↔ session `cwd` ↔ `git worktree` ↔ 分支/提交 为准**；pane id 只作辅助标注。若要让 pane id 可追溯，需要编排会话在 `graph events` 里留痕（例如 `claim` 事件携带 pane id），本次整改未改动 `.graph`。

### pane ↔ 节点 双向唯一性

每个 pane 同一时刻只持有一个 running 节点；每个节点只有一个 claim_by。`herdr-io` 在一个 pane 内串行认领 3 个节点，符合本约束。

## 6. 红线

- 不得用 `force` 绕门禁；MCP 通道本就拒绝。
- 不得手改 `.graph/` YAML 伪造状态。
- 不得 claim 别人的节点（`assigned_to` 非自己即绕行）。
- 不得把 worktree 隔离表述为 OS 沙箱。
- 并行写者不得共用同一文件。
- **归属不明的共享文件必须由派单显式指派给单一写者**（`test/**`、`src/index.ts`、`package.json`、`tsconfig.json` 等）。未被指派的文件，任何并行写者都不得改；确需改动时先在 execution_report 的 blockers 里上报，由编排会话指派后单一写者落地。
- 合并前必须执行 §8 的 touched-file 交集检查；两分支交集非空即**停下人工裁决**，不得靠「hunk 不重叠会自动合并」放行。

## 7. 违规记录 · L2 四并发波共用测试文件（F5）

**结论：派单红线「并行写者不得共用同一文件」在 L2 四并发波被破 6 处。** 本节如实记录，不粉饰。

### 事实

四个域提交的 parent 同为 `34b193f`（真并发），且都改了同一批**未指派归属**的 `test/**` 文件 import 路径：

| # | 共用文件 | 两侧写者 | 两侧差异 |
|---|---|---|---|
| 1 | `test/ledger.test.js` | `235020f`(ledger) × `03096f2`(io) | 逐字节相同（`git diff` 0 行） |
| 2 | `test/adapter.test.js` | `31db3cf`(exec) × `03096f2`(io) | 逐字节相同（0 行） |
| 3 | `test/git.test.js` | `31db3cf`(exec) × `03096f2`(io) | 逐字节相同（0 行） |
| 4 | `test/process.test.js` | `31db3cf`(exec) × `03096f2`(io) | 逐字节相同（0 行） |
| 5 | `test/runner.test.js` | `31db3cf`(exec) × `03096f2`(io) | 逐字节相同（0 行） |
| 6 | `test/contract-policy.test.js` | `a3392fc`(gate) × `03096f2`(io) | 两侧相差 209 行（gate 新增 8 例，io 只改 import） |

复现命令（在合并后的 `main` 上可跑）：

```bash
git show -s --format='%h parent=%p' 235020f a3392fc 31db3cf 03096f2        # 4 个 parent 都是 34b193f
git diff 235020f:test/ledger.test.js  03096f2:test/ledger.test.js | wc -l  # 0
git diff 31db3cf:test/adapter.test.js 03096f2:test/adapter.test.js | wc -l  # 0
git diff a3392fc:test/contract-policy.test.js 03096f2:test/contract-policy.test.js | wc -l  # 209
```

### 后果

- 第 6 项因两侧 hunk 不重叠被 git **自动合并**：终态 14 例含全部 8 个 gate 用例，本次**侥幸无冲突、无内容丢失**（全库无冲突标记）。
- 但这是概率性放行：同文件不同 hunk 的自动合并一旦语义重叠（例如都改同一断言的上下文），会静默丢改动或产生语义错误的合并结果，且没有测试会察觉。
- 根因：ADR-0004「测试 import 迁到 `dist/**`」是一次跨全域的机械改动，**没有被指派给单一 pane**，io 与 ledger/gate/exec 三个域各做了一遍（`l2_ledger` 的执行报告自述「单 worktree 内曾因未认领的 spec 文件指向 `src/` 而红」正是重复劳动的旁证）。

### 整改

- 红线新增「未指派共享文件必须显式指派给单一写者」（§6），`test/**`、`src/index.ts`、`package.json` 属此列。
- 合并前强制执行 §8 的 touched-file 交集检查；交集非空即停下人工裁决。
- L3 波已按此执行：unit/e2e/integ 三者的 touched-file 集合互不相交（§5）。
- 不修改历史提交；本节保留为过程记录。

## 8. 合并前检查（touched-file 交集）

任何 `git merge` 之前，对「待合并分支两两组合」求 touched-file 交集；**非空即停下人工裁决**。

一行版（人工复制，依赖 bash 的进程替换）：

```bash
A=refactor/gate; B=refactor/io; base=$(git merge-base "$A" "$B")
comm -12 <(git diff --name-only "$base" "$A" | sort) <(git diff --name-only "$base" "$B" | sort)
```

脚本版（≤30 行，供人工复制到临时目录执行；**刻意不放 `scripts/`**，那是 fix-r1 的独占目录）：

```bash
#!/usr/bin/env bash
# 用法: ./touched-overlap.sh <base> <branchA> <branchB> [...]   （退出码 1 = 存在交集）
set -euo pipefail
base="${1:?base branch required}"; shift
[ "$#" -ge 2 ] || { echo "至少两个待合并分支" >&2; exit 2; }
rc=0; files=(); names=()
for b in "$@"; do
  mb="$(git merge-base "$base" "$b")"
  f="/tmp/touched-$(echo "$b" | tr '/' '_')"
  git diff --name-only "$mb" "$b" | sort > "$f"
  files+=("$f"); names+=("$b")
done
for ((i=0; i<${#files[@]}; i++)); do
  for ((j=i+1; j<${#files[@]}; j++)); do
    if comm -12 "${files[$i]}" "${files[$j]}" | grep -q .; then
      echo "红线冲突: ${names[$i]} × ${names[$j]} 共用:"
      comm -12 "${files[$i]}" "${files[$j]}" | sed 's/^/  /'
      rc=1
    fi
  done
done
[ "$rc" -eq 0 ] && echo "OK: 无 touched-file 交集"
exit "$rc"
```

本次整改的分支（`fix/r3`）与并行整改分支（`fix/r1`/`fix/r2`）之间同样适用：三者从同一 `e3f42c3` 拉出，交集检查应在编排会话合并前执行。
