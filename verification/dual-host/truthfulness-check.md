# 真实性核验 — `l3_dual_host_gate`

> 问题：两场景的"任务真实完成"是否有**独立可核对**的原生 trace + 测试/门禁结果，而不是只引用它们自己的 REPORT。
> 方法：本包**只读**地复算哈希、事件序列、时间窗与账目，并在本地**0 付费**复跑两份聚焦测试与四项门禁的判断依据。完整机器输出：`evidence/independent-checks.json`（26/26 通过）。

## 1. 独立复算总表（26 项，全通过）

| # | 检查 | 结果 |
|---|---|---|
| 1-3 | 冻结合同内容未改写：LF 归一 `9c6c5680…`；`HEAD` blob == 冻结 blob `9239ee1a…`；`ccb4536..HEAD` 对合同 diff 为空 | PASS |
| 4-5 | 两宿主 scratch 5/5 文件 sha256 == 各自 `artifact-hashes.json`；scratch HEAD 分别为 `5ec65f1` / `b574b1c` | PASS |
| 6-8 | scratch 确为真实源码改动（各 5 文件，含 `src/lib/cli/**` 与 `test/**`）；DSH staged diff `5 files, 489 insertions(+), 8 deletions(-)` | PASS |
| 9-10 | 负控锚点：Pi `58a3ecf9…`（原始）→`9f393944…`（变异）；DSH `f19f2429…`→`30c250f9…`；原始 hash 均等于 artifact-hashes 的 `handlers/ledger.ts` | PASS |
| 11 | Pi trace：attempt-2 `provider-dispatch=54`、`child-created=5`、`integration-write=5`；stage 序列 inspect/decompose→interruption→parallel→integrate→fresh-verify→repair→finish→quality-repair→quality-final | PASS |
| 12 | Pi 两 author child provider 窗口重叠 **58,489 ms**（从 trace dispatch/settled 复算；audit 用子会话窗口 58,491 ms，1 ms 口径差） | PASS |
| 13 | Pi 同会话恢复：abort 前 79,067 B 前缀 sha256 `e7e3a14c…` 等于 recovery prefixHash；文件现 245,403 B（追加）；nonce 在 transcript 内 | PASS |
| 14 | Pi 中断诚实：cancel `native-ack`，被中断 receipt `status=unknown` + `EFK_USAGE_CONFLICT`，未翻绿 | PASS |
| 15 | DSH trace：`provider-dispatch=75`、`child-created=4`、`integration-write=5` | PASS |
| 16 | DSH 两 worker provider 窗口重叠 **49,627 ms**（MODEL-BUDGET 复算，与 audit 一致） | PASS |
| 17 | DSH 同会话恢复：取消前 39 事件（header 之后）`JSON.stringify` sha256 `d7d75e13…` == `interruption.beforeHash`；文件 177 行追加 | PASS |
| 18 | Pi 账目：84 requests / 2,047,716 tokens / $0.24026418；`scenarioTotals` 吻合；legacy 2 行保留 | PASS |
| 19 | DSH 账目：75 requests / 1,684,159 tokens / $0.14603358；4 条 raw-unknown 保留 `originalOutcome` 未归零 | PASS |
| 20 | DSH 75 行参考价**公式独立复算 0 处不符** | PASS |
| 21 | Pi finish 聚焦两轮 code 0（pass 7/7）+ 四门禁 `check-5/8/9/10` 全 code 0 | PASS |
| 22 | DSH finish 聚焦 code 0（pass 4/4）+ 四门禁 `check-3/6/7/8` 全 code 0；故障 verify `check-2` 保留 red | PASS |
| 23 | DSH 裁决诚实：`completion.nodeStates.verify=failed`；`final-board.json` kernelClaims=0 / modelRequests=0 | PASS |
| 24 | Pi 负结果保留：attempt-1 kernel journal + 3 个 failure 文件在册 | PASS |
| 25 | 能力矩阵转录：DSH 28 键 / PI 14 键与探针清单逐键一致；Pi session lane 2 处收窄 | PASS |
| 26 | 两宿主生产 HostPort 实现文件存在；两 lane commit 面仅 `scenarios/**` | PASS |

## 2. 原生 trace 独立核对（不只信 REPORT）

- **真实 Provider 调用**：Pi 84 条 scenario 行全部 `provider=deepseek/model=deepseek-flash/thinking=high/httpStatus=200/status=settled`，usage 为 provider 原始结构；DSH 75 条全部 `provider=deepseek-official/httpStatus=200/outcome=settled`，其中 71 条含 provider raw frame，4 条 raw-unknown 由真实 native receipt 归一。`native.mjs` 在真实 `fetch` 边界断言 origin 固定为 Provider 域名。场景驱动中 `grep evofence run|fixture|synthetic|stub|mock` = **0 命中**，无替身 HostPort（也不使用 `host-fake.ts`）。
- **真实并行**：两宿主都是 ≥2 个原生子会话，窗口重叠分别为 58,489 ms（Pi，trace 口径）与 49,627 ms（DSH）；Pi 用 SDK child session（`runtime/attempt-2/children/*.jsonl` 真实 JSONL），DSH 用 TeamService `spawnTeammate`（`runtime/sessions/**/session.v4.jsonl` 真实 JSONL）。
- **唯一 writer**：两宿主 `integration-write` 都恰好 5 条、都发生在父 session 的 integrate 阶段；DSH 的同文件冲突由 `resolve_shared_conflict` 显式解决（`trace.jsonl:721`），无静默覆盖。
- **同会话恢复**：两宿主都用**同一路径同一文件**追加前缀哈希比对（见上表 #13/#17），且 recovery nonce 在重启后的上下文里被模型回忆出来——是"同会话续接"，不是新建会话冒充。两宿主都**未**证明 process-kill/crash。
- **裁决不涂绿**：DSH `verify=failed` 保留；Pi 被中断 invocation `unknown` + `EFK_USAGE_CONFLICT` 保留；Pi attempt-1 的 4 个 failure 与 `failed-attempt-scratch.patch` 在册。

## 3. 测试/门禁独立核对（含本地 0 付费复跑）

本包在 scratch 内**亲自复跑**（不新增付费请求）：

- Pi：`node --test test/ledger-limit-scenario.test.js` → `tests 7 / pass 7 / fail 0`（9.2 s）。
- DSH：`node --test test/ledger-limit-scenario.test.js` → `tests 4 / pass 4 / fail 0`（8.8 s）。
- 复跑后两 scratch 的 `git status` 与复跑前逐条一致（5 个任务文件未变），说明复跑幂等、未污染产物。
- 四项门禁（`build/typecheck/src:policy/dep:check`）以两 lane 的 `check-*.json` / `audit-gate-*.json` 为独立依据；`dep:check` 均为 `modules 271 / edges 1073 / cycles 0`（基线 1072，多出 1 条即任务新增的 `EvoFenceError` import 边）。
- 负控红→绿：Pi `check-4` 4 红 3 绿 → 逐字节复原 `handler` → `check-6/7` 7/7 绿；DSH `check-2` 4 红 0 绿 → 复原 → `check-4/5` 4/4 绿。红的来源与"复原"手段在 `admission-matrix.md` §6 与 `gate-verdict.md` §3.3 说明（Pi 的 red 是**注入**的 negative control，合同允许"由注入或自然产生"；DSH 另含测试作者自身的断言语法缺陷，已单独修复，未降低行为验收）。

## 4. 独立复核已被第二双眼确认（并列证据）

两份已通过的独立复核 dossier 与本包结论一致，且各含 0 blocker / 0 major：

- `docs/evofence-harness-kernel/execution/reviews/l3_pi_scenario-review.md`：**可接受**（2 minor / 1 note）；复核者亲手复跑 7/7、四门禁 0、负控 4 红→7 绿、从 patch 在全新克隆重建 7/7。
- `docs/evofence-harness-kernel/execution/reviews/l3_dsh_scenario-review.md`：**可接受**（3 minor / 3 note）；复核者亲手复跑 4/4、四门禁 0、独立复现变异 `30c250f9…`→`f19f2429…`、独立复算前缀哈希 `d7d75e13…`。

## 5. 本包**未**证明（保留 unknown）

- 无法独立抓包或查供应商账单：Provider 域断言、HTTP 200、原始 usage 三者互证，但**不**等于发票；`costInvoice` 两宿主 unknown。
- Pi 的 84 条 / DSH 的 75 条里，DSH 4 条 provider raw 捕获仍 unknown（按 native receipt 结算，已保留原始未知）。
- 生产 DSH `createDshHost`/`createDshDelegationBinding` 在本多请求闭环的 E2E 未证（场景用适配器）。
- process-kill / disk-crash 恢复、供应商取消计费、服务端 high 档位语义、OS sandbox、配对 held-out 能力收益均未证明。
