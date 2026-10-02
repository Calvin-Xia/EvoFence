# Pi provider-live 长程场景

本 lane 引用 orchestrator 的 **FROZEN v1** `../TASK-CONTRACT.md`；该文件不在 lane 基线中，实际只读路径见 `config.json`，SHA-256 固定为 `9c6c5680b5bb5954f299617070e234230379a0014e01c88021202e051b00b979`。没有复制或改写合同。

任务是给 scratch 中的 `ledger show` 添加经校验的 `--limit <N>`。两宿主使用相同的 scratch 基线、正整数/显式失败/缺省兼容要求、阶段、验收门禁和证据口径。这里选择具体子命令以及十进制安全整数语法，是冻结合同允许的有界任务实例。不会据本场景声明能力收益。

## 驱动

- `prepare.mjs`：本地 `git clone --local --no-hardlinks`、固定 commit、junction；拒绝覆盖已有 scratch。
- `run.mjs`：既有持久父 session → inspect/decompose → 原生 abort → 重开同 session → kernel GraphPatch → 并行原生 SDK children → CAS 集成 → 独立红测 → repair → 新独立 verifier 的两轮测试及四门禁。
- `native.mjs`：Pi **0.99.2**、`deepseek/deepseek-flash` **high**、真实 API transport、逐请求预留/原始 usage/本机价格参考记账。只从既有认证存储内存读取授权 provider 的凭据；不持久化或打印凭据。
- `graph.mjs`：生产 `compileGraph/applyGraphPatch/planRound/createSessionService`；独立资源 claim、journal/outbox、真实 receipt 和 stage evidence 经生产判定入口推进。并行派发是宿主执行端对已提交 kernel claims 的消费，未修改 core 的顺序 dispatch。
- `task-tools.mjs`：有界源码读取、独立 worker bundle、原始 byte-hash CAS 集成、固定检查命令、abort 检查点和 byte restore。工具权限有界，但不是 OS sandbox。
- `audit.mjs`：Codex 执行者独立复核 raw trace、请求/receipt、同 session、实际文件和检查退出码，并运行字面 `npm run` 四门禁。
- `quality.mjs`：主闭环之后，在同一父 session 修正独立代码复核发现的冗余校验；新 native child 对最终字节再跑两轮测试和四门禁。
- `finalize.mjs`：审计通过后汇总全部尝试的成本、保留主闭环结果 snapshot，写入最终结果和递归哈希索引；不发模型请求。

在 lane 先 `npm run build`，再 `node scenarios/pi/prepare.mjs`（已有 scratch 不再执行），然后依次运行 `run.mjs`、`quality.mjs`、`audit.mjs`、`finalize.mjs`（路径均为 `scenarios/pi/`）。本次成功产物使用 `--new-attempt=2`；此参数必须传给四条命令，保证读到同一套证据。已有产物、trace、账本不会覆盖；完整复跑需先保留本次目录并使用干净 scratch / 独立 scenario 副本及配置。`--resume-after-recovery` 只允许从已取证的恢复点续跑、且未建立 kernel journal；`--resume-after-workers` 从已保存的真实 worker 回执/journal/原 grant 续跑，不重发已完成 child；这些入口仍要求 scratch 未集成、原 digest 一致。未知 integration 不经这些入口重放。

首个传输字节界 196,608 小于连续父会话实际需要，导致 HTTP 派发前退出且原 kernel invocation 保持 unknown；失败不覆盖。修正为显式 524,288 UTF-8 bytes 保守 request token 界，本机模型 contextWindow=1,000,000；父共享池的累计 policy 和历史 requests 原样保留。第二尝试是独立重跑，其内部 abort/reopen 使用同一个父 session，不能用两次尝试之间的切换冒充恢复。

生成的 `evidence/`、`runtime/`、`MODEL-BUDGET.json` 保留本地且 gitignore。后者保留原累计账本的历史 requests 并追加 scenario rows；legacy MiMo 的 $0.50 限额保留作历史字段，此次用户明确批准的 scenario 使用 `limitUsd:null`，没有重置历史记账。外网仅实际模型 API；关闭目录联网、自动重试、压缩和 cache warming。价格来源为本机固定 provider 模型目录，成本注明参考非账单，未联网核价或查询账单。

## 证据入口

完整结果见 `REPORT.md` 与 `evidence/attempt-2/index.json`；成功原始 `evidence/attempt-2/trace.jsonl`、原生 session JSONL、`MODEL-BUDGET.json`、`kernel-journal.json`、共享 `evidence/request-pool.json`、worker bundles、scratch patch 和检查 stdout/stderr 均按阶段保留。第一尝试在 `evidence/` 根及 `runtime/` 根，负结果不删除。

## 宿主能力与适配层

| 同语义义务 | Pi 的原生能力 | 本场景/适配层实现 | DSH 对应实现（静态对照，非其本轮实跑证明） |
|---|---|---|---|
| 父会话连续 | 持久 AgentSession/SessionManager、原始 transcript | 在已存在 session 绑定，原生重开同 id、nonce 回忆、字节前缀核对 | NativeAgent/session projections；控制/恢复绑定 |
| 多 agent | 原生 SDK 创建多个独立 AgentSession；Pi 没有 native team board | 已交付 bindPiDelegation/ChildExecutor；显式工厂、两个 disjoint kernel claims 并发消费 | 原生 TeamService/agent identity；delegation binding 映射 team 和 board 权限 |
| 动态图和 single writer | 不由 Pi 原生提供 EvoFence 图判定 | kernel GraphPatch、resource leases、独立 bundles、唯一 CAS integration writer | 同一 kernel 语义；DSH board 是映射对象，不能取得第二写入所有权 |
| fresh verify | 独立 session 的工具调用与真实进程输出 | 新 child 只读 source、运行实际 CLI tests/gates；作者 session ids 排除 | fresh/continuable native team child 和验证工具 |
| abort/恢复 | 原生 abort、idle/settled、磁盘 reopen | 只取消 owned parent invocation；同 id 续接、旧 dispatch 不重放 | controls/delegation 对已拥有 native agent 的 cancel/reconcile |
| 请求开销 | provider SSE usage + SDK 归一化 usage | transport pool逐请求记账 + kernel单invocation回执，两者分别保留并对齐 | DSH usage/session data 经对应端口映射；不能静态推定它已完整 |

本场景不延后 Pi 首发，也不以缺少 team board 推定没有子会话协作。供应商取消计费、OS sandbox、非合作进程 kill 的恢复、DSH 本轮结果、受控能力收益与真实账单均不在本次已证明范围。
