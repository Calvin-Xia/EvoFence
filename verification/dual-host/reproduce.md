# 可复跑说明 — 仅用本地证据、0 付费重建本包结论

> 本包的所有数字都可由本地已产出的证据重建，**不发任何模型/Provider 请求**（`paidModelRequests: 0`）。
> 需要哪些本地资源、按什么顺序跑、每个结果对应本包哪条结论，见下。

## 0. 前置资源（缺一不可，均在集成 worktree 之外）

| 资源 | 路径 | 用途 |
|---|---|---|
| 集成 worktree | `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence` | 合同、`src/**`、探针清单、两份 review dossier、本包 |
| Pi lane worktree | `C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-pi-scenario` | Pi 原始证据（gitignored，本地保留） |
| DSH lane worktree | `C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-dsh-scenario` | DSH 原始证据（gitignored，本地保留） |
| Pi scratch | `C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-pi-scratch` | 5 个任务文件 + 聚焦测试 |
| DSH scratch | `C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-dsh-scratch` | 5 个任务文件 + 聚焦测试 |

> 若 `scenarios/TASK-CONTRACT.md` 的裸字节 sha256 不是 `9c6c5680…`，先做 LF 归一再比较（本机 `core.autocrlf=true`）；见 `README.md` §3。

## 1. 一条命令重建 26 项独立复算

```bash
cd C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence
node verification/dual-host/scripts/independent-checks.mjs
```

- 只读；读写范围：读上表资源，写 `verification/dual-host/evidence/independent-checks.json`。
- 期望输出：`{ "total": 26, "passed": 26, "failed": [] }`，并逐条打印。
- 若任何一项 FAIL，先核对是否本机行尾/路径/HEAD 变了；对应关系：`contract.*`→冻结合同；`*.artifact-hashes`→任务产物；`scratch.*`→任务真实性；`*.negative-control`→负控锚点；`pi./dsh.trace.*`→原生 trace 与并行；`*.same-session-recovery`→恢复；`*.cost-*`→账目；`*.focused-and-gates`→测试/门禁；`hostport.*`→能力矩阵。

## 2. 本地复跑聚焦测试（0 付费，可选但推荐）

```bash
cd C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-pi-scratch
node --test test/ledger-limit-scenario.test.js     # 期望 tests 7 / pass 7 / fail 0
git status --porcelain                              # 期望仍是 5 个任务文件

cd C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-dsh-scratch
node --test test/ledger-limit-scenario.test.js     # 期望 tests 4 / pass 4 / fail 0
git status --porcelain                              # 期望仍是 5 个任务文件
```

- 测试走真实 CLI 子进程（`dist/cli.js`），不是实现 helper 当 oracle。
- 复跑不改变 scratch 的 5 个任务文件；若 `git status` 变了，先停手检查（不应发生）。

## 3. 复核者自己重算关键锚点（不跑脚本也能做）

```bash
# 冻结合同（LF 归一）
node -e "const fs=require('fs');const b=fs.readFileSync('scenarios/TASK-CONTRACT.md');console.log(require('crypto').createHash('sha256').update(b.toString('utf8').replace(/\r\n/g,'\n'),'utf8').digest('hex'))"
git rev-parse HEAD:scenarios/TASK-CONTRACT.md      # 应等于 9239ee1a…
git rev-parse 4a250e4:scenarios/TASK-CONTRACT.md   # 应等于同一个 blob

# 任务产物字节
# 分别对 scenario-pi-scratch / scenario-dsh-scratch 的 5 文件算 sha256，
# 与 scenarios/<host>/evidence/**/artifact-hashes.json 对比（Pi 是数组，DSH 是对象）。

# Pi 同会话恢复前缀
#   sha256(file[0:79067]) 应等于 abort.json.beforeReopenSha256 = e7e3a14c…
# DSH 取消前前缀
#   sha256(JSON.stringify(events[0..38] after the header)) 应等于 interruption.beforeHash = d7d75e13…

# 账目
#   MODEL-BUDGET.json 的 scenario 行求和；DSH 逐行按 (inputUncached+cacheWrite)*0.30 + output*1.20 + cacheRead*0.006 复算参考价
```

## 4. 重跑 lane 自带的 0 付费审计（更强，但注意 cwd）

```bash
cd C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-dsh-scenario
node scenarios/dsh/audit.mjs --evidence-only
# 期望 passed:true / cp1-cp3 passed / overlapMs:49627 / requests:75 / tokens:1684159
# 注意：必须从 lane worktree 运行（io.mjs 以脚本位置推断 lane）；从集成 worktree 会因 lane-ownership 断言失败

cd C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l3-pi-scenario
node scenarios/pi/audit.mjs --new-attempt=2
# 期望 audit 通过；该入口只读现存证据，不发模型请求
```

## 5. 你能与不能重建的东西

- **能**：合同内容一致性、两宿主任务产物字节、原生 trace 的事件序列/身份/时间窗、同会话恢复前缀哈希、账目合计与参考价公式、聚焦测试绿、四门禁 code、负控哈希与红→绿。
- **不能**：真实 Provider 网络与发票（无抓包/无账单）；供应商取消计费；服务端 high 档位语义；OS sandbox；process-kill 恢复；生产 DSH binding 的多请求 E2E；配对 held-out 能力收益（本轮本就不声明）。
- **不要**：为了"复现"而重跑 provider-live 场景（会产生付费请求，违反本 gate 的 0 付费约束；合同也要求不得只改一侧）。
