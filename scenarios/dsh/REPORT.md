# l3-dsh-scenario 执行结果

lane: **l3-dsh-scenario**。cp1 / cp2 / cp3：**passed / passed / passed**（lane 自证与独立审计；图裁决仍由 orchestrator 负责）。证据等级：**provider-live**。DSH **0.2.0-rc.2**，原保存模型绑定 **deepseek-official/deepseek-flash / high**。没有修改图、lane commit、merge 或 publish。

## 冻结任务、授权与实际产物

冻结合同只读引用 `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence/scenarios/TASK-CONTRACT.md`，SHA-256 **9c6c5680b5bb5954f299617070e234230379a0014e01c88021202e051b00b979**；运行前后相同，与 Pi 同一份 FROZEN v1。scratch 按派单基线 **b574b1c35b8cd4af31d22df51fe00270afffa4ad** 创建（合同允许派单指定 commit），使用本地 `git clone --local --no-hardlinks` 与依赖 junction。Pi 使用的基线为 `5ec65f1`，本轮没有把基线差异藏成完全相同的试验环境。

实际任务：`ledger show [run-id] [--limit <N>] [--json]`。N 必须为正十进制安全整数，非法值显式 exit 1；缺省保持全事件数组，先过滤 run-id，再取前 N 个 chronological events，支持 `--limit=N`。修改 catalog、context validator、ledger handler 三个源码文件；新增平铺 `test/ledger-limit-scenario.test.js` 和 `docs/cli-limit-scenario.md`。测试通过真实 Node CLI subprocess 与真实 SQLite Ledger，覆盖默认行为、合法值、边界、非法矩阵、缺失参数、过滤顺序和不创建缺失 ledger。

scratch：`C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/scenario-dsh-scratch`。完整 patch：`evidence/scratch.patch`；最终文件字节哈希：`evidence/artifact-hashes.json`。5 个任务文件在 scratch index 暂存以生成完整 patch，**scratch 没有 commit**。diff 为 **489 insertions / 8 deletions**，5 files；task source 不在 lane。

用户在本会话明确允许向 `https://api.deepseek.com` 发送有界 CLI/ledger/测试源码和任务提示，见 `evidence/egress-authorization.json`。第一次启动在外传审批处拒绝，未发请求；随后用户明确授权。第一次运行的读工具范围过宽，读取了部分历史文档；恢复这段上下文又被自动审批拒绝，未发新增请求。保留这次失败和成本，后续新建受限会话，**没有重传被拒绝的旧上下文，也没有把新建会话冒充恢复**。任务工具没有网络、shell、安装、凭据读写入口；凭据只在内存通过既有 DSH credential parser 读取并用于原生 API 认证。

## checkpoint 与九阶段证据

路径均相对 `scenarios/dsh/`。原始事件总序列：`evidence/trace.jsonl`；真实原生持久 JSONL：`runtime/sessions/<project>/<session-id>/session.v4.jsonl`。

| 阶段 / checkpoint | 实际行为与独立复核锚点 |
|---|---|
| cp1 / inspect | `evidence/preflight.json`、`model-binding.json`；真实 `source-read` 事件读取已有 CLI 与 ledger 测试。`inspection-plan.json` 包含真实 file:line anchors |
| decompose | `inspection-plan.json`；目录所有权为 logic `src/lib/cli/**` 与 tests `test/**` / `docs/**`，由有限工具明确实施。模型计划文本中的旧测试文件名被更精确的 child prompt / 工具 allowlist 收窄为新平铺 scenario 文件；实际写入按 allowlist，未改原 `test/ledger.test.js` |
| parallel | 原生 TeamService.spawnTeammate + installed in-process spawn provider；logic **e4ef9bb5-771e-45c6-b200-e10ad5a0427b**，tests **239cd8e7-0654-425f-ab0f-40b635a779eb**。真实 provider 执行窗口重叠 **49,627 ms**，且存在同时在途的模型 HTTP 请求；`invocation-logic.json` / `invocation-tests.json` 与原生 session JSONL |
| interruption | 父 session **dsh-scenario-9c1c6eb8-d95e-4b5c-9198-767660e0cf20** 调用 native **Agent.cancel({kind:'user'})**；native `turn/end.reason.kind=aborted`，见 `interruption.json` 和 `native-cancel-ack` |
| resume | 同一父 ID 通过 **AgentRegistry.resume** 重新加载真实 JSONL；原事件前缀 JSON bytes 的 SHA-256 保持一致，模型从保留上下文回忆原 nonce。`same-session-recovery` 与 `interruption.json`；不是新 session 的替代测试 |
| integrate / shared conflict | 两个 worker 都触达 **docs/cli-limit-scenario.md**，提交不同 full-content 提案。worker 不写 scratch；唯一父 integration writer 在 `proposal_read` 后显式调用 `resolve_shared_conflict`，记录双方内容 / session ID / hashes、取舍依据与合并 hash，再按原 byte-hash CAS 写入。`shared-file-conflict.json` + 5 个 `integration-write` 事件；没有静默覆盖 |
| fresh verify / negative control | 独立 verifier **2e163ed0-3cc5-49f1-960b-372ff149305e**；将真实 handler 的 `context.stdout(jsonDocument(...))` 变为 `context.stdout(jsonDocument([]))`。`negative-control.json` + `check-2.json`：4 红 / 0 绿。其中默认全量与合法 limit 两例因注入变异红（期望 seq 数组，实际 []）；另外两例暴露测试作者的真实断言语法错误（`'object' !== true`），没有把它们归因于注入 |
| repair | 同一父 writer 调用 `repair_restore`，handler 恢复至原 SHA-256 **f19f24294c7bc0fbfe34e09c7b98dc2c7b6d63883b0618104bd5419914011900**，逐字节一致；另通过 `repair_test` 修复错误的 expected 参数，保留全部 CLI 行为用例 / 非法矩阵正文。`test-quality-repair.json` 与原始修复事件；独立 audit 确认测试正文 byte-identical，没有降低验收 |
| finish / cp3 | 新独立 verifier **c0d9c16d-e64e-49cb-a48d-8560afad8c13**：`check-4.json` / `check-5.json` 两轮 **4/4**，`check-3/6/7/8.json` 为字面 npm build/typecheck/src:policy/dep:check，均 0。`audit.json` 校验原生身份、并行、前缀、冲突、原字节恢复、实际请求、测试与最终 hashes；`lane-gate-*.json` 是 lane 四门禁，均 0 |

生产 GraphPatch/planRound/session service 负责真实任务图、父 claim、lease、outbox 和评价；`dynamic-graph.json` / `kernel-journal.json` 可独立复核。最终 logic / tests / integrate / repair / finish 为 **succeeded**，故障 verify 保留 **failed**，未把红例涂绿。宿主 board 不负责派发，模型也没有 board 调度工具。`final-board.json` 通过原生 TeamService release 清理已结束 claim 的投影，**kernel claims=0、native owners=0**，该清理 **0 个模型请求**。

## 用量与开销

**75 条真实模型 HTTP 请求，1,684,159 tokens，参考成本 $0.14603358（参考非账单）**，包含首次失败、全部恢复/工具错误及最终复验；没有重置账本。逐条 provider/model/thinking、出站 effort、原始 usage、native normalized usage、cost 均在本 lane `MODEL-BUDGET.json` 与 `evidence/dsh-http-*.json`，实际请求的生产 budget reservations / settlements 在 `evidence/request-pool.json`。无美元硬上限；160 为有界请求停止条件。

**71 条有 provider 原始 usage 捕获；最早 dsh-http-1/3/5/6 的 raw provider 捕获 unknown，但同一次请求的真实 native assistant receipt 含完整 normalized usage。** 这 4 条按既有 receipt 核实和结算，保留 `reconciliation.originalOutcome`，未填造 raw frames 或将未知按 0。全部 75 条的 accounted token/cost telemetry 完整，实际 request pool 未结算预留为 0；供应商发票均 unknown。reasoning tokens 未作为额外 tokens 重复累加；没有独立的 reasoning-token 明细证据。

参考价格采用与冻结 Pi 场景相同的本地固定 tariff：uncached input $0.30/M、output $1.20/M、cache read $0.006/M。未联网刷新价格或访问账单，不能称为实时价格或发票。分角色：parent 20 条/$0.055687176、logic 5/$0.024475956、tests 17/$0.020033916、verifier 28/$0.019558524；恢复角色登记缺失期间另 5 条/$0.026278008，session ID 明确为父会话，原行缺失的 role 不被改写为原始事实。

模型请求从首次 dispatch 到最后 settlement 跨 **1,176,470 ms（19 分 36 秒，含驱动修复、等待）**；原始检查进程累计 **18,218 ms**，见各 check 文件。Codex 使用订阅；本 lane 没有其逐请求 tokens/费用遥测，保留 **unknown**。

## 负结果、宿主差异与未证明项

第一次会话因旁路 response.clone 采集在原生流结束取消后失效，保留 unknown 预留并触发请求并发门禁；修复为在原生消费路径旁采集 SSE usage，并用真实旧 receipt 核实历史请求。随后后台 child-settled 通知被错误地阻断了正在授权中的父 turn；恢复时另有角色登记遗漏和 seed 恢复核对问题。全部 fatal 事件原样保留。两个已完成 worker 没有重跑；原 integrate claim、第二父 session 与提案连续，先确认 scratch 无写入，再继续。原授权 seed 的恢复仅在匹配已提交的不可变 digest 后准入（`recovered-grant.json`），不伪造新 grant。最后只读汇总的 nodeStates 访问形式错误在真正 finish succeeded 后发生；通过 `finalize.mjs` 从已完成 journal 收口，**没有额外 paid 重跑**。

Pi 原生能力是 SDK AgentSession/session JSONL/abort；DSH 此处原生能力为 Cordis agent-loop、AgentRegistry、TeamService、continuable in-process spawn、原生 DeepSeekAdapter 与真实 JSONL persistence。有限任务工具、唯一 writer、kernel HostPort 场景接线和逐请求 meter 属场景适配层。**没有使用 synthetic adapter、fixture endpoint、替身 Agent 或 evofence run。** 不是完整 desktop/web profile 启动，也没有接管用户正在使用的会话。

`src/hosts/dsh/**` 的最小接线 diff **0**。本场景直接将已提交 kernel claims 接到原生 DSH；**没有声称生产 createDshBinding/createDshDelegationBinding 在这个多请求工具闭环中得到 E2E 验证**（已有生产 binding 的单请求 effect 边界没有改写）。子图 reference 提供有限任务上下文，native child 内部 inspect/implement 工具循环未创建第二 kernel session/scheduler。记录的是原生宿主与场景接线的实用闭环。

取消证据为 native cancel + 同 session disk reopen，**不是 process-kill / crash 恢复**；供应商取消计费、服务器 high 档位语义、OS sandbox、发票、完整生产 adapter E2E、修复后整套驱动从零单命令 paid 重跑、配对 held-out 能力收益均未证明。依 ADR-0005/0008，仅声明本任务与场景通过，不声明收益、晋升或激活。

首次独立 audit 时集成点干净；收尾某次复查曾看到外部 staged 的 L4/L5/hygiene 文件，audit 明确拒绝 cp3 干净条件，没有清理或写集成点。最后一次独立 audit 已再次观察 **clean**。本 lane 未污染集成树。当前阻塞：**无**。

## lane diff

仅新增 `scenarios/dsh/**`；驱动、配置、审计和 REPORT/HANDOFF 可交接。`evidence/`、`runtime/`、`MODEL-BUDGET.json` 由 lane `.gitignore` 保留本地，不进入 Git。冻结合同、`src/{protocol,kernel,runtime}/**`、`src/hosts/dsh/**`、`.graph` 均未改；scenarios 下没有任何 `*.test.js`，不会污染默认测试发现；未跑仓库全量测试（不属于冻结 verify 口径）。
