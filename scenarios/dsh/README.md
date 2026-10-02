# DSH 原生长程任务场景

先读同目录 REPORT.md / HANDOFF.md。此驱动通过**安装的 DSH 0.2.0-rc.2 原生 Cordis/AgentLoop/AgentRegistry/TeamService/DeepSeekAdapter**完成冻结的 CLI `--limit` 任务，不调用 `evofence run`。模型从 `config.modelProfile` 的真实保存 binding 读取并逐字段核对，当前为 `deepseek-official/deepseek-flash high`，不换 provider。

首次在空 evidence、空授权 scratch 中执行：

```powershell
npm run build
node scenarios/dsh/prepare.mjs
node scenarios/dsh/run.mjs --preflight-only
node scenarios/dsh/run.mjs
node scenarios/dsh/finalize.mjs
node scenarios/dsh/settle-board.mjs
node scenarios/dsh/audit.mjs
```

`run.mjs` 发真实模型请求并会修改指定 scratch；调用者必须已授权实际 model API 与有界源码外传，当前会话已有该明确授权。`prepare` 只做本地 clone / checkout / junction，拒绝覆盖已有 scratch。preflight 不发模型请求，但装配真实宿主并读取既有 credential 到内存。没有 npm install，没有仓库联网，也没有全量 npm test。

本次保留证据的只读复核：

```powershell
node scenarios/dsh/audit.mjs --evidence-only
```

这会核对现存真实检查结果和原始宿主/用量/恢复/冲突证据，不发模型请求、不重复门禁；为了完整 patch，scratch 的既定 5 个 task 文件可以再次暂存，但不会 commit。若集成点 dirty，cp3 显式 failed，调用者应交由集成点 owner 收口，不能清理外部工作。

新复跑须先选择**另行授权的未使用 scratch 路径**，更新 config 的 scratch；旧 scratch/evidence/runtime/账本全部保留。给所有命令同一个新 `--evidence-run=<name>`（字母、数字、下划线或短横线），例如：

```powershell
node scenarios/dsh/prepare.mjs --evidence-run=replay_02
node scenarios/dsh/run.mjs --preflight-only --evidence-run=replay_02
node scenarios/dsh/run.mjs --evidence-run=replay_02
node scenarios/dsh/finalize.mjs --evidence-run=replay_02
node scenarios/dsh/settle-board.mjs --evidence-run=replay_02
node scenarios/dsh/audit.mjs --evidence-run=replay_02
```

这将隔离原始 session 与阶段文件，同时**继续追加同一个 MODEL-BUDGET.json**。160 是累计实际请求停止界，不是美元硬上限；不得清空账本绕过界限。修复后的整套从零 replay 尚未实际付费执行，README 命令为可调用入口，不声称已有这项证明。

`--resume-after-workers` 是本次已取证的特定恢复边界：仅用于原来逻辑/tests 已完成、integrate 只有 proposal_read 且 scratch 未写入的情况；核实同父会话、提案、原 kernel seed digest，再继续原 claim，不重跑 workers。它不是通用崩溃重试，不得在已集成或未知副作用场景强用。没有恢复那段被审批拒绝的首次旧上下文入口。

| 能力 | 原生 DSH | 场景接线 / 限制 |
|---|---|---|
| 并行子会话 | TeamService + continuable in-process spawn | 已提交 kernel claims 准入；logic/tests 工具 scope；两个完整 worker 实际并行 |
| 取消与同会话恢复 | Agent.cancel、AgentRegistry.resume、真实 JSONL persistence | nonce 与原事件前缀核验；不是 crash/process-kill |
| board | 原生 TeamService tasks | 只投影 kernel claim，不提供第二 scheduler；终态原生 release |
| 文件冲突 | 两个真实原生 worker 提案 | unique parent writer 显式记录双方、依据和合并；worker 无直接 scratch 写权 |
| 模型与用量 | 原保存 model binding + 原生 DeepSeekAdapter、native usage receipts | HTTP/SSE meter + 生产 request budget pool；参考成本不是账单 |
| 验证 | 新原生 verifier，非任务作者 | 真 CLI subprocess、聚焦 ×2、四门禁；不测全仓库 |
| Pi 对照 | Pi 使用 SDK AgentSession/session JSONL/abort，无 TeamService board | 同一个冻结任务合同；机制、基线、请求资源均显式记录，不推导收益 |

`src/hosts/dsh/**` 接线 diff=0；kernel claim 与场景 HostPort 接到实际 DSH，不声称生产 binding 的多请求 E2E 已通过。trace/runtime/MODEL-BUDGET 由本目录 .gitignore 保留本地，只有驱动/配置/说明可进入后续 lane 集成。任务 `.test.js` 只在 scratch 内。
