# l3-pi-scenario 执行结果

lane: **l3-pi-scenario**。cp1 / cp2 / cp3：**passed / passed / passed**（lane 自证与独立审计结果，orchestrator 仍负责图裁决；没有写图或提交）。成功路径为 **attempt 2，provider-live**。Pi 0.99.2，`deepseek/deepseek-flash` high。

## 冻结合同与任务

只读引用 `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence/scenarios/TASK-CONTRACT.md`，SHA-256 `9c6c5680b5bb5954f299617070e234230379a0014e01c88021202e051b00b979`；运行前后相同。scratch 本地 clone 使用 `--local --no-hardlinks`，固定 `5ec65f13424da1105e8e19dd8ded78b7b77da6a0`，node_modules junction；没有 npm install 或源码仓库联网。

任务产物在 `C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-pi-scratch`：`ledger show [run-id] [--limit <N>] [--json]`，正十进制安全整数，非法值显式 exit 1；缺省保持原事件数组；先 run-id 过滤，再取前 N 个 chronological events。修改 catalog、context validator、ledger handler 三个 source 文件；另交付平铺 `test/ledger-limit-scenario.test.js` 和 `docs/cli-limit-scenario.md`。7 个 real CLI subprocess 用例覆盖合法/非法/边界/缺省/两种 flag 形式/过滤顺序/read-only 行为，无实现 helper 作为 oracle。

与 DSH 的语义相同：同一冻结合同、基线、真实功能验收、disjoint workers、唯一 writer、独立 fresh verify、真实失败修复、同 session 中断恢复及同一成本口径；具体宿主差异在 README 对照表中明确列出。DSH 本轮实跑结果由其 lane 提供，本 lane 不推定它通过。

## checkpoint 与阶段锚点

| 项 | 结果与原始依据（路径相对 scenarios/pi） |
|---|---|
| cp1 / inspect | `evidence/attempt-2/preflight.json`、`inspection-plan.json`；父 session 真实 source_read 与 file:line anchors |
| decompose / 动态图 | `evidence/attempt-2/dynamic-graph.json`：生产 GraphPatch revision 1→2，加入 logic/tests/integrate/verify/repair/finish；scope、资源、CAS 均由真实 kernel 验证 |
| parallel / child loops | 两个原生 Pi SDK child IDs：logic `01a0fb70-66f0-7410-8561-928f98d4c3f1`，tests `01a0fb70-66f1-7410-8561-929074f683bb`；每个同 child 2 次 bounded operation（inspect→implement）；provider 执行窗口重叠 **58,491 ms**，不是顺序伪并行 |
| integrate | `proposals/{logic,tests}/bundle.json`、trace 的 5 个 integration-write；disjoint 所有权，原 byte-hash CAS 先全量校验再唯一父写入，未发生冲突或覆盖 |
| fresh verify / negative control | `check-4.json`：替换 ledger show stdout 为 `jsonDocument([])` 后，独立 verifier `01a0fb72-0264-7410-8561-92934b288b6e` 跑真实测试，4 例红 / 3 例绿；失败用例是 (1)缺省全量、(2)合法 limit 2、(3)边界 limit、(6)过滤顺序；原失败输出完整保留 |
| repair | `negative-control.json` + trace `repair-restored`：同父 session 诊断真实红例后恢复原始 bytes，handler SHA-256 恢复一致；测试没有改写。kernel 的 verify 保持 failed、repair succeeded，失败没有涂绿 |
| finish | 独立 verifier `01a0fb72-628b-7410-8561-9294ef7c4ce7`：`check-6.json`/`check-7.json` 两轮 7/7，`check-5/8/9/10.json` build/typecheck/src:policy/dep:check 全 0；kernel finish succeeded |
| cp2 / abort 与恢复 | 父 session **`01a0fb70-04e7-7410-8561-928d781401af`**；`abort.json` 为 owned target 的 native-ack、idle；同一个 session file reopen，原 nonce CONTINUITY 回忆正确，transcript 前缀 byte hash 保持一致。`trace.jsonl` 有创建、结果、abort、reopen、continuity 原始序列 |
| 编码约束收口 | Codex 独立发现数字校验存在冗余 BigInt/长度/Number 守卫；`quality-repair.json` 记录同父 session 简化为必要的 decimal/positive/safe 外部输入校验。新独立 verifier `01a0fb77-83c7-7407-a132-a6cb86ad4ba8` 在最终代码上再次两轮 7/7 和四门禁全 0，见 `check-11` 至 `check-16.json` |
| cp3 独立复核 | `audit.json` 校对每个 provider raw usage / SDK normalized usage / shared pool owner、child identity、真实并行、恢复前缀、原始红例、最终文件哈希；`audit-gate-*.json` 记录字面 `npm run build/typecheck/src:policy/dep:check` 全 0 |

所有阶段 raw trace：`evidence/attempt-2/trace.jsonl`。原生 JSONL 在 `runtime/attempt-2/{sessions,children}/` 与 `evidence/attempt-2/quality-verifier-session/`，精确文件路径见 `evidence/attempt-2/index.json`。任务 patch 为 `evidence/attempt-2/scratch.patch`；最终 byte hashes 为 `artifact-hashes.json`。

Pi 在真实 Node 宿主进程中以安装的原生 SDK 运行（多个 AgentSession，不是多个 OS 隔离进程）；内核绑定前先经过一次真实普通宿主 turn 建立持久父 session，再 reopen/绑定。没有使用 fixture endpoint、替身 Agent 或 `--no-session` CLI，也没有接管用户其它交互 Pi 会话。abort 的 owned target 得到 native-ack，但被中断的 agent invocation 没有完整终态，原始 receipt 仍为 **unknown**；同 session 恢复后执行新的授权 effect，旧 effect 没有重放。该 outcome unknown 与 provider 原始 usage 完整是两个不同维度。

## 用量与成本

**本 lane 全部尝试合计：84 条真实模型 HTTP 请求，2,047,716 tokens，参考成本 $0.24026418（参考非账单）**。其中输入 1,933,971（cache read 1,620,480），输出 113,745。reasoning 为输出的子集，未重复累加。成功 attempt 2 含质量收口 **54 条**，第一尝试与续跑 **30 条**，都计入累计值。每条请求的 provider/model/thinking、出站参数、HTTP 状态、原始 provider usage、SDK usage、referenceUsd 在 `MODEL-BUDGET.json` 和 shared `evidence/request-pool.json`；84 条均完整 settled，**unknown provider usage/spend = 0 条**。

价格固定于本机模型目录：uncached input $0.30/M、output $1.20/M、cache read $0.006/M。由于冻结网络范围只许可模型 API，没有另行联网核价或查发票；不把该参考成本称为供应商账单。初始计划停止界 160 requests、累计 token policy，参考极端上界约 $12.58，没有美元硬上限。旧 MiMo 2 条历史记录和旧限额字段原样保留，scenario 明确 `limitUsd:null`，账本未重置；这些旧记录不包含在上述本 lane 的 84 条之内。

分角色：parent 30 条/$0.046954884、logic 13/$0.06589998、tests 15/$0.076432404、verifier 20/$0.036317424、quality 3/$0.01005792、quality-verifier 3/$0.004601568。全部 provider 请求从第一次 dispatch 到最终 settlement 跨 **1,591,205 ms（26 分 31 秒，含驱动修复/等待）**；成功 evidence 中记录的检查进程累计 wall 43,651 ms，日志逐条保留。Codex 执行者走用户订阅，本 lane 没有其逐请求 token/费用遥测，保留 **unknown**，不按零美元声称免费。最终汇总 `cost-summary.json`。

## 负结果与未证明项

第一尝试的动态边名错误、等待唤醒轮误判、artifact 恢复的重复引用处理错误、过小传输界退出均保留原 trace / failure files。其 integration 已实际写入、但父 invocation 未完成；生产 binding 与 kernel journal 保持 **unknown**，原预留仍留在第一尝试的 kernel journal，没有改写成功或盲重派。相关副作用先保存 patch/新文件并核验 hash 后，仅复原这 5 个本场景文件，再独立重跑 attempt 2。两次尝试的父 session 不同；每次自己的 abort/恢复均只使用自身同一个父 session，没有跨尝试冒充恢复。Windows CRLF preflight 与 Node 24 spec reporter 审计解析问题也按真实观察修正；这些错误没有发未记账请求。

Pi 原生提供 AgentSession/SDK/session JSONL/abort，子会话工厂、子图编排、shared request meter 和 single writer 为适配层/场景实现；没有 native team board，也没有新增第二 scheduler。生产图判断和 outbox 来自现有 kernel，adapter 消费已提交 claims。中断证据是显式 abort + reopen，**不是 process-kill/crash 恢复**；供应商取消计费、服务端独立 high 档位语义、OS sandbox、账单、DSH 本 lane 实跑和配对 held-out 能力收益未证明。依 ADR-0005/0008，仅声明任务与场景通过，不声明收益、晋升或激活。

## lane diff 与交接边界

lane 仅新增 `scenarios/pi/**`；**`src/hosts/pi/** 最小接线 diff = 0**（已有 leaf exports 足够）。`src/{protocol,kernel,runtime}/**`、冻结合同、`.graph` 和集成 worktree 均未修改；没有 staged 变更、lane commit、release、publish 或 merge。成功 scratch 5 个任务文件和完整证据保留本地。阻塞：**无**。

orchestrator 可据 `HANDOFF.md` 复核和记录图 checkpoint/verdict；本报告不代写图状态。`MODEL-BUDGET.json` 并入时按唯一 request id 追加本 lane 行，不能整文件覆盖其它 lane 或把 inherited legacy totals 当当前全局总额。
