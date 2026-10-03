# EvoFence 重构图审阅入口

现状（2026-10-03）：图 `evofence-harness-kernel` 40/40 passed，`l5_accept` 由真人裁决收口；受控收益结论仍为 **inconclusive**。执行进度以图和 [execution/sessions.json](execution/sessions.json)（本地保留、未跟踪）为准。

[CONTRACTS.md](CONTRACTS.md)、`spec/**` 与 [SOURCES.md](SOURCES.md) 保留 2026-10-01 设计交付时逐 lane 的状态口径（「提案 / 待 `l1_replan` 人审 / 未实现」），属设计期快照，不代表现状。

本目录的 [topology.mmd](topology.mmd) 与 `topology-L*.mmd` 同为 2026-10-01 设计交付时的拓扑导出，节点与 ADR 的状态着色停留在设计期，未随执行重新导出；现役拓扑以图为准。

执行入口：[接力协议](execution/SESSION-PROTOCOL.md)、[设计到执行 handoff](execution/SESSION-000-HANDOFF.md)、[授权记录](execution/AUTHORIZATION.json)；[SESSION-001-HANDOFF.md](execution/SESSION-001-HANDOFF.md)、[PAUSED.md](execution/PAUSED.md) 与[当前完整交接包](execution/execution-handoff.zip)保留 S01 设计阶段的暂停交接，属历史记录。`REVIEW.md`、`DESIGN-CHECKS.json` 和 `graph-review.zip` 保留设计交付时的快照（本地保留、未跟踪，见 `.gitignore`），不表示当前执行状态。

目标：从Git/worktree/子CLI串行候选控制器，重设为DSH与Pi同等首发的能力演化内核。采用任务驱动的动态agent子图与已验证模板，结合长程编码、多agent协作和跨任务学习；宿主执行，内核决策，在授权内自主验证与晋升。

| 资料 | 用途 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 产品目标、现状取证、整体架构、运行图与演化闭环 |
| [CONTRACTS.md](CONTRACTS.md) | 协议、状态、并发、恢复、授权预算和资产资格草案 |
| `REVIEW.md`（本地保留、未跟踪，见 `.gitignore`） | 具体人审取舍、未知毕业条件、验收和后续边界 |
| [ROADMAP.md](ROADMAP.md) | 五阶段40个实施节点及前置和建议所有权 |
| [CONTEXT-MAP.md](CONTEXT-MAP.md) | SP生成的9个领域边界索引 |
| [adr/](adr/) | SP生成的10项ADR（状态见DECISIONS.md与图） |
| [topology.mmd](topology.mmd) | SP在2026-10-01导出的完整拓扑（状态着色为设计期） |
| `DESIGN-CHECKS.json`（本地保留、未跟踪，见 `.gitignore`） | 设计交付时的结构/质量/漂移/状态快照 |
| `graph-review.zip`（本地保留、未跟踪，见 `.gitignore`） | 设计交付时的原始图快照，执行期状态见当前交接包 |
| [SOURCES.md](SOURCES.md) | 本机/官方资料、版本和证据范围 |

图真相源：工作区 `.graph/evofence-harness-kernel/`（gitignored，不随仓库分发；本目录的导出视图才是入库的可读记录）。节点按真实产物、检查点与裁决推进；ADR 逐项依据研究定案。图结构检查通过只能证明设计可审阅，不能证明接入或能力收益已成立。

用户允许 breaking change 与完整重构实施；历史数据、已有全局 Skills 和发布边界仍按接力协议保留。额外模型试验已指定 `xiaomi/mimo-v2.6-flash high`，累计预算 `0.50 USD`，不得每个 session 重置预算。
