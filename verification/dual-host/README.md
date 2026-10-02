# `l3_dual_host_gate` — 双宿主实用闭环准入包

> 节点：`.graph/evofence-harness-kernel` · `l3_dual_host_gate`（type=gate，level 3，context `ctx_eval`）。
> 角色：gate 裁决包制作者（执行/裁决材料），产物目录 `verification/dual-host/**`。**未 commit、未改 `.graph`、未改 `scenarios/**` / `src/**` / `probes/**` / `spec/**`。**
> 管辖 ADR：`adr_0005`、`adr_0006`、`adr_0008`；`adr_0008` 明确**本轮不声明收益**。
> 付费模型请求：**0**（本包全部结论来自已产出的本地证据 + 本地复跑，不发任何模型/Provider 请求）。

## 1. 本包回答什么

| 问题 | 文档 |
|---|---|
| 两宿主在生命周期 / 权限 / 预算 / 上下文 / 恢复 五维上各是什么语义，差异是什么 | [`admission-matrix.md`](./admission-matrix.md) / [`admission-matrix.json`](./admission-matrix.json) |
| 两宿主对 `observe/execute/cancel/reconcile/context/usage` 的实现与 `capabilities` 是否一致 | [`hostport-conformance.md`](./hostport-conformance.md) |
| "任务真实完成"是否有独立可核对的原生 trace + 测试/门禁，而非只引用 REPORT | [`truthfulness-check.md`](./truthfulness-check.md) / [`evidence/independent-checks.json`](./evidence/independent-checks.json) |
| 是否存在"仅能读 ledger"的宿主（DoD②） | [`dod2-determination.md`](./dod2-determination.md) |
| 阶段裁决 + 限制报告 | [`gate-verdict.md`](./gate-verdict.md) |
| 如何在 0 付费下重建结论 | [`reproduce.md`](./reproduce.md) |

## 2. 判定摘要（一句话）

- **cp1 合同比较**：**通过**。两宿主引用**同一份** FROZEN v1 合同（内容 sha256 `9c6c5680…b00b979`，见 §3 的口径说明），且都在该合同语义下跑完；差异集中在宿主原生机制与适配层，不在任务口径。
- **cp2 真实任务与恢复证据复核**：**通过**。两名宿主均为 provider-live、≥2 原生子会话真实并行、唯一 integration writer、同会话中断→恢复、fresh verify 独立、负控红→复原转绿、finish 两轮聚焦测试 + 四项门禁全 0。本包独立复算了哈希、时间窗、前缀哈希、账目与门禁，并本地复跑了两份聚焦测试（0 付费）。
- **cp3 阶段裁决与限制**：**判通过（准入成立，仅证明可用）**，不声明任何能力收益（`adr_0008`）。限制报告见 `gate-verdict.md` §3。
- **DoD①**：两宿主**均**通过合同与实际任务闭环 → 满足。
- **DoD②**：**不存在**仅能读 ledger 的宿主；两宿主产物都是 scratch 内真实源码改动 + 真实测试/门禁 → 不触发否决，判定为满足。

## 3. 冻结合同口径（必须显式说明，否则易被误读）

- 场景运行时的合同字节：**sha256 `9c6c5680b5bb5954f299617070e234230379a0014e01c88021202e051b00b979`**（LF 行尾）。两宿主的 `preflight.json` / `config.json` / `completion.json` 都记录此值。
- 集成 worktree 的当前工作区文件因本机 `core.autocrlf=true` 是 **CRLF**，裸字节 sha256 为 `762c495c…`；**LF 归一后**仍为 `9c6c5680…`。
- 冻结 commit `4a250e4` 的 git blob 与当前 `HEAD` 的 blob **同一个对象** `9239ee1a…`；`ccb4536..HEAD`（脱敏提交 `503eafa`）对 `scenarios/TASK-CONTRACT.md` 的 diff 为**空**。
- **后记（2026-10-02，用户裁决）**：`scenarios/**` 已退出 PR、仅本地保留（根 `.gitignore`）。此后 `HEAD:scenarios/**` 核对不再适用；冻结合同以 commit `4a250e4` 的 blob `9239ee1a…` 为准。`scripts/independent-checks.mjs` 的 `contract.head-blob-equals-frozen` / `contract.not-touched-by-head-commit` 两条断言只适用于精简前的窗口（本包记录的是 gate 时点事实），对此后 HEAD 重跑会如实报失败而非静默通过。
- 因此结论是"合同内容自冻结起未被改写"，而不是"字节在磁盘上任意时刻都等于 9c6c5680"。独立复算见 `evidence/independent-checks.json` 的 `contract.*`。

## 4. 证据等级（`scenarios/TASK-CONTRACT.md` §5）

- 两个场景均为 **provider-live**（真实 Provider HTTP 200 + 原始 usage）。
- 核心 HostPort 能力矩阵转录自 **native-fixture / provider-live / native-disk / static / not-run** 探针清单（见 `hostport-conformance.md` §3）；本包不把 fixture 升级为 provider-live，也不把未知写成 false。
- HOST-MAPPING 与 ADR 中仍有 `proposed` / `unknown` 项；本包不改变其状态。

## 5. 明确不做

- 不声明收益 / 晋升 / 激活（`adr_0005`、`adr_0008`）；不给任何"Pi 优于 DSH"或反向结论。
- 不重跑 provider-live 场景，不新增付费请求；不联网核价、不查发票。
- 不修改已 passed 节点的产物，不写 `.graph/**`，不 commit / install / publish。
