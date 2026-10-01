# 重构图人审说明

日期：2026-10-01。图：`evofence-harness-kernel`。**设计待审、实施未开始、收益未验证**。

## 1. 当前交付

本轮已完成源码取证、10个关键问题的交互澄清、Graph Engineering 架构提案和 super-plumber 图设计。用户确认了产品方向，尚未审批图中的实现方案和ADR。

图有五个阶段、40个工作流节点、9个context、10个proposed ADR。所有工作流节点保持pending、attempts为0、没有执行者认领。图级approve凭据尚未写入。验收校验结果见 [DESIGN-CHECKS.json](DESIGN-CHECKS.json)。

## 2. 推荐审阅顺序

1. [ARCHITECTURE.md](ARCHITECTURE.md)：先读产品目标、真实限制、Graph Engineering模型、宿主分工、演化与验收。
2. SP Web UI：在工作流/领域/叠加三个透镜中查看节点、context、ADR、契约边、输入输出与门禁。
3. [CONTRACTS.md](CONTRACTS.md)：审查图修订、循环、authority/usage、并发writer、恢复、晋升/激活状态。
4. [ROADMAP.md](ROADMAP.md)：确认L1研究计划能解决真实未知，L2-L5的实施路径完整且没有悄悄缩小双宿主目标。
5. [adr/](adr/)：逐项裁决10个proposed ADR。`DECISIONS.md`只列已形成决议，当前为空是正确状态，不代表ADR缺失。

全图Mermaid见 [topology.mmd](topology.mmd)。分段图为 [L1-L2](topology-L1-L2.mmd)、[L3](topology-L3.mmd)、[L4-L5](topology-L4-L5.mmd)；分段只帮助阅读，完整跨层依赖以全图为准。

## 3. 需要人审的具体取舍

| 提案 | 推荐结论与代价 | 审查重点 |
|---|---|---|
| ADR-0001 宿主内嵌和子图委托 | host执行、kernel决策；需维护lifecycle与delegation adapter | 是否真能在已有会话中工作，谁拥有claim/权限根 |
| ADR-0002 动态图与有界loop | 约束动态图＋模板，single loop合法；增加编译/修订复杂度 | agent自主性是否足够，repair是否可停止 |
| ADR-0003 权限与能力协商 | requirements＋verified manifest替代品牌名单；需probe能力 | 是否把声明当观测，是否增加无价值阻拦 |
| ADR-0004 journal/outbox | 新事件真相源与reconcile；存储和恢复合同更复杂 | unknown外部动作是否被盲重试，native依赖是否隔离 |
| ADR-0005 四类判定 | 完成/验证/晋升/激活分开；状态与binding更多 | 普通任务能否完成，资格是否真正被生产路径消费 |
| ADR-0006 双宿主准入 | 语义相同、实现不同；两线都需真实场景证据 | 是否将一个宿主降为只读或延后首发 |
| ADR-0007 资产scope和来源 | 版本/适用条件/来源/撤销；增加检索资格管理 | 是否有跨任务价值，是否污染全局Skills或终审数据 |
| ADR-0008 受控收益 | A/B/C、完整总成本、盲测/消融/区间 | 是否只是多花资源，失败样本是否被保留 |
| ADR-0009 轻量分层 | TS单仓＋ports/exports隔离，不先拆大量npm包 | core是否可无Git/CLI/SQLite/SP使用 |
| ADR-0010 breaking与保留 | 旧数据只读，新namespace；需要升级指南 | 是否暗中覆写旧ledger/历史graph或夸大兼容 |

这些ADR尚未accept。图审阅可以提出修改、接受部分方案或仅批准L1研究；不必一次认可尚无证据的后续实施细节。

## 4. 关键未知与毕业条件

| 未知 | 对架构的影响 | 研究/验证节点 | 达成条件 |
|---|---|---|---|
| DSH必要API/版本是否完整 | lifecycle、team authority、usage/cancel/recovery adapter | l1_dsh_probe | 固定版本能力矩阵与失败/恢复轨迹，不仅文档截图 |
| Pi必要API/版本是否完整 | extension安全点、SDK child、idle、usage/cancel/recovery | l1_pi_probe | 同一HostPort所需语义可复现，不假定原生team board |
| 图与host的共享权威是否可实现 | claims、resource leases、取消、未知effects | l1_graph_contract + l2_kernel_verification | 状态和writer合同明确，并有并发/崩溃/迟到回包证据 |
| 评价标准及可辨收益 | 是否能够判断重构成功，所需样本与预算 | l1_eval_protocol | 预注册主指标、阈值、数据拆分、对照、预算、停止规则，经人审冻结 |
| 图和长期演化是否提高能力 | 产品主线是否成立，哪些机制值得保留 | l4_capability_trial | 双宿主未见任务受控证据达标；负结果或inconclusive不冒充成功 |

`program`是诚实表达这些未知。L1结束可将fog修订为尚未解决的收益未知，并审核可信实现计划；不能用研究票passed清空全部fog。总体收益在L4才能判断。后续节点是完整条件性图景，当前未承诺未知结果。

## 5. 后续实施的验收场景

| 场景 | 必须看到的实际行为 | 不足以替代的材料 |
|---|---|---|
| DSH长程协作 | 现有session内拆图、多个agent、整合、独立验证、修复、中断恢复、真实产物 | Cordis安装成功、只读tools或子CLI跑通 |
| Pi长程协作 | 保留现有context/资源，用child loops完成同等合同与恢复 | 被关闭session的CLI adapter或fixture |
| 学习与撤销 | A任务经验→独立验证→晋升→B未见任务使用→退化→撤销→C基础执行 | 把一次成功摘要写进提示词 |
| 并发与取消 | 同资源单writer、完整fan-in、父子取消、迟到回包fencing | 仅日志出现“parallel” |
| 恢复 | 崩溃后重建状态，核实unknown effect，不重复真实副作用 | audit hash chain验证成功 |
| 受控收益 | A原harness/B图/C图+学习，资源匹配、held-out、消融、区间与全部费用 | 更多功能、节点全passed或单次任务成功 |

## 6. 已否决历史设计的回应

已只读查看主checkout的三个历史graph和软删节点。发现两类历史拒绝理由：

- 粗粒度“实现/验证/文档/交付”节点被拆细：新图给两宿主分别拆session/delegation/scenario，又分别列协议、存储、图、调度、policy、runtime、评价、资产与晋升。每节点有具体产物、DoD、检查点和建议独占模块，不复用笼统“全部重构”任务。
- `l2_cfg_deadkeys`的checks与已定非破坏方案不一致：新图明确允许breaking，但原数据保留；历史死键清理方案不被复制。后续L1决定改变时要改plan/DoD/checkpoints/ADR和消费合同，而不是保留失效checklist。

旧图与导出视图均保留原样；本worktree另建新图，没有覆写主checkout的active或nodes。

## 7. 验证范围与审阅后行动

本轮验证的是graph结构、设计质量、导出一致性、状态与交付边界。没有运行产品测试、调用模型、做收益试验或实施重构，因此不能宣称新runtime已可用。

你可以审阅后指出需要调整的节点/ADR/边界，也可以先批准L1研究计划。取得具体批准后才写相应`graph approve`凭据；设计批准本身不会自动开始执行。后续实施须明确“开始执行”及范围；模型探针/真实场景还需其实际模型与资源预算。

审核 gate 来自本轮用户“做到图设计结束并交由人审即可”，并与使用的 plumber-design 技能一致：**“用户批准之前绝不进入执行阶段”**。本轮停在完整可审阅结果是任务边界，不是省略实施步骤。

## 8. 图资料携带

`.graph/`是项目既有gitignore规则。可读导出在本目录，原始图在worktree的`.graph/evofence-harness-kernel/`；[graph-review.zip](graph-review.zip)携带该图YAML、事件和必要workspace schema，便于人审/恢复规划状态。它不含产品ledger、私有holdout或凭据，也不作为runtime配置。

审阅入口命令（在本worktree执行）：

```powershell
graph get-node --id l1_review --graph evofence-harness-kernel
graph get-node --id adr_0002 --graph evofence-harness-kernel
graph validate --graph evofence-harness-kernel --json
graph export --docs --check --graph evofence-harness-kernel
graph serve --no-open --port 8934
```

正在运行serve时无需重复启动。Web UI是观测与人审入口，不赋予自动实施权限。
