# EvoFence 串行执行与接力协议

本协议依据设计交付后的直接用户指令，适用于 `evofence-harness-kernel` 的完整重构执行。执行范围覆盖研究、协议定案、内核、双宿主接入、长期演化与交付验证；收益结论必须由真实证据支持。

## 授权与会话设置

来源对话：`01a0f605-610d-7c30-bc1a-fb28a5b61f9a`，标题 `规划 EvoFence 完整架构重构`。

用户原文：

> 允许你新开对话进行完整执行。每一个新开对话都需要承接上一个session的内容，并交付handoff到下一个session。新开对话非万不得已不开子代理，依然使用gpt-6.1-sol xhigh

随后用户指定模型试验：

> 你可以启动pi或者opencode吗？如果可以xiaomi/mimo-v2.6-flash high，0.50usd

用户在 S01 进一步指定：

> 跨L阶段时不要直接fork对话，而是新开对话！

每个后继 Codex 对话使用 `gpt-6.1-sol`、`xhigh`。同一 L 内可通过 `fork_thread` 的 `same-directory` 继承上一对话历史和本 worktree，再用 `send_message_to_thread` 显式传入上述 model/thinking 启动。跨 L（L1→L2、L2→L3 等）必须使用 `create_thread` 新建无继承历史的对话，显式传入 model/thinking，并在初始 prompt 中交付阶段 handoff、产品决策、原始图、预算和下一阶段任务。不得在跨 L 时用 fork 冒充新建。默认不使用子代理，也不并行启动执行对话。原始用户指令已授权串行后继创建及交接，不需每次再问。

跨 L 的新对话没有继承历史：启动时用 `read_thread` 核对原授权对话 `01a0f605-610d-7c30-bc1a-fb28a5b61f9a` 的真人完整执行/串行接力授权，以及 S01 `01a0f63f-ecf9-7dd3-8e86-5a110c35d712` 的真人跨 L 新建要求。文件和 agent 启动消息用于定位，不凭它们自行扩大授权或将 agent 消息冒充真人授权。

当前工作目录为 `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence`。跨 L 新建前调用 `list_projects`，使用返回的 EvoFence projectId。新鲜的 project/local 对话可能落到主 checkout，不能假定它继承当前 worktree；初始 prompt 必须写明实际源目录与 handoff 路径，后继核验 cwd、writable roots、Git 基线和全部未提交产物之后才修改。如果需要迁移目录，先安全交接原始 `.graph`、全部实现文件、未提交改动、预算和 Git 状态，核对目标已有改动并保留；不能只迁移导出文档、覆盖用户工作或绕过 sandbox。未获得当前目录写入条件时先完成读取/迁移准备，按正式平台路径处理具体权限。

## 编码风格约束（用户直接指令，2026-10-01）

**禁止防御性编程。此约束适用于所有 harness，对 `gpt` 系模型（codex / gpt-6.1-sol xhigh）为**硬性要求**。**

禁的是**冗余、多余、无条件覆盖自身不变量的防御**，不是禁止必要的输入校验：

| 禁止 | 说明 |
|---|---|
| 不可能状态的守卫 | 已被类型系统/前置校验/图校验保证的状态，不再写 `if (!x) return` |
| 吞错 | 空 `catch`、`catch` 后静默继续、把错误转成默认值 |
| 双保险 | 同一不变量在调用方与被调方各查一次；上层查过的下层再查 |
| 惩罚式回退 | 为“万一”写完整降级路径，而该路径从未被设计、也无测试 |
| 无依据的默认值 | 把缺失当成 0/空/默认，而不是让缺失显式失败 |
| 防御性断言堆叠 | 同一函数内多道 `assert`/`Expect` 重复确认同一个前提 |

**明确不在禁止范围内（本产品有意设计的失败闭合，不得被当作“防御性编程”删掉）**：

1. **契约/证据门禁**：`gate/` 下的 contract / evidence / budget / isolation 判定，包括 `init` 与 `status` 的对策文件 fail-closed。
2. **显式的 `unknown` 与 reconcile**：图语义 `§2.2` 与 `CONTRACTS §5` 的未知态、不盲重做、迟到回执只归档——这是安全属性，不是防御。
3. **预算与授权的真预留**：缺 usage 不归零、预留与结算分离。
4. **schema/版本的显式拒绝**：不兼容格式必须报错，不得静默迁移（例：ledger v2 拒绝 recipe）。
5. **边界输入校验**：真实外部输入（命令行 argv、YAML 配置、宿主回执、文件系统）的校验——这是接口边界，不是内部不变量的重复确认。

**判据（写完自问）**：“这段代码去掉后，是否存在一个**真实可达的**输入能让系统静默出错？”若答“否”而仍然保留，即为防御性编程，删。若答“是”，它属于上表 1–5 中的哪一类，对应写注释说明。

**另**：本条不溯及已交付的 L1 产物（它们主要是规格/探针文档）；**从 L2 开始的 `src/`、`packages/` 代码适用**。若发现自己在为“不可能发生”写分支，优先去把不变量变成类型或校验时断言，而不是运行时的堆叠守卫。

---

## 并行 lane 与 worktree 约定（用户直接指令，2026-10-01）

用户要求：“后续简单的修改允许 deepseek 并行，能否实现并行 worktree？”——已采用。

| 位置 | 角色 |
|---|---|
| `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence` | **图真相源 + 集成点 + handoff**。只有 orchestrator 写 `.graph/` |
| `C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/<lane>` | 并行 lane 的独立 checkout（分支 `refactor/hk-<lane>`） |

- `.graph/` 被 gitignore，因此 lane worktree 里**不存在**图，从机制上排除误写。
- lane 之间必须**目录不重叠**；汇合由 orchestrator 做（review 后并入主 worktree，再记图状态）。
- **已实测（2026-10-01，S02）**：从 `refactor/harness-kernel` 建一条 lane worktree 后——① 设计文档（`spec/`、`execution/` handoff）随基线一并到位；② `.graph/` **不存在**；③ 在 lane 内跑 `graph status` 直接失败：`❌ 未找到图（<lane> 无 graph.yaml）`。即 **lane 里的 agent 物理上无法写图状态**，不需靠纪律约束。探针 worktree 已清理（`git worktree remove --force` + `branch -D`）。

**何时用 worktree、何时不用**（本轮实测结论）：

| 情形 | 做法 |
|---|---|
| 多个 lane 改**互不重叠的不同文件**（例：`spec/contracts` 七份分给三个 pane） | **不用** worktree。同目录 + 每文件单 owner + 跳 lane 漂移登记（`OPEN-ITEMS §4`）+ orchestrator 集成收口。本轮 `l1_api_freeze` 就是这么做的，比建/合 worktree 快。 |
| 多个 lane 需要**编译/测试同一套 `dist`**，或会改**同一目录/同一文件** | **必须**用 worktree，否则构建产物与 git index 互相踩。L2 起的 `packages/*` 属此类。 |

**已发现的一个缺点（要记着）**：多 pane 并行时“投递 ≠ 消费”——`herdr_message_agent` 向已 settled 的 pane 投递后，`herdr agent wait <pane>` 会因“本就已 settled”**立即返回**，看起来像已完成。正确做法：先等到 agent 真的进入 `working`（或轮询会话文件的回合数增加），再 `wait`。本轮踩过一次。
- 模型分工：`pi + deepseek/deepseek-flash high` 为**默认写作者**（spec、schema、映射表、脚本、简单修改）；`codex + gpt-6.1-sol xhigh` 仅用于真实宿主探针、内核并发/恢复、跨文档一致性裁定等难/险工作。
- 理由（实测）：`l1_api_freeze` 单个节点让 codex 跑了 **1h19m**，而同类写作任务 pi+deepseek 在 10–20 分钟内完成并同样通过独立复核。

---

## 产品目标与授权边界

- 能力演化内核嵌入 harness；动态、有约束的 agent 子图与可复用模板支持长程编码和协作。
- DSH 与 Pi 同等首发，宿主执行、内核决策，可显式委托子图。OpenCode 是获准使用的探针/模型入口，不自动取代 DSH 或 Pi 的产品目标。
- 策略、经验、代码/技能/工具候选经过验证后晋升；不以架构规模、插件安装或全绿图替代受控能力收益。
- 用户允许全面重构及 breaking change。普通技术选型、修复、验证与既定目标内的图修订继续自主推进，不因设计阶段“仅建图”的旧文字重复请求开始实施。
- 将新的执行授权通过 graph CLI 更新入口和相关旧计划。当前授权不是对未来未知结果的验收，不得代签尚未发生的人审或捏造 ADR 接受记录。需新权限、改变已确认目标、扩大付费预算或最终真人裁决时，只提出具体待决事项并继续独立工作。
- 旧 ledger/config/历史 graph 保留原样；新数据使用独立版本/命名空间。已有用户/全局 Skills 只读，新候选在项目内暂存。发布、release tag、npm publish 另需明确授权。

## 全局模型试验预算

获准模型是 `xiaomi/mimo-v2.6-flash`，reasoning `high`；可通过 Pi 或 OpenCode 启动。Codex 接力对话的模型设置是另一项设置。不得静默换模型、降低 reasoning、换收费 provider 或把 OpenCode 成功当作双宿主接入完成。

`0.50 USD` 是本次全部额外 API 模型试验累计上限，含启动探针、失败/重试、planner、worker、verifier、学习、评价及宿主额外后台模型调用。所有 session 共用 `MODEL-BUDGET.json`，每次请求前记录预留，完整 usage 后结算；未知花费不能按零回收。定价须核对官方/实际 provider，缓存目录的价格只是线索；token/时间限制不能伪称美元硬上限。

先验证 `high` 的实际参数映射、输入/输出上限、自动重试、额外 title/summary 请求和用量来源。能量化请求上界且剩余额度足够时才发请求；用量缺失或无法限制隐式请求时暂停该付费路径，继续不依赖它的实现与验证。凭据只能内存读取或使用已有认证接口，不打印、不放进命令行、不复制进仓库/交接/日志。

预算可能只足够探针和有限 smoke。若不能支持预注册样本量，如实交付可运行实现与受限证据，并将受控收益标为未完成/inconclusive；不得缩小成功标准或凭小样本宣称提升。需要追加预算时列出具体实验设计和额度再请求。

## 每个 session 的执行方式

1. 先读上一份 `SESSION-NNN-HANDOFF.md`、本协议、`sessions.json`、`MODEL-BUDGET.json`，再核验真实 Git/文件/graph 状态。历史资料用于定位，实际状态优先。
2. 明确本 session 的连续节点和可验证产物，按依赖从 `graph next --graph evofence-harness-kernel` 获取入口。eligible 先置 ready，再以唯一 `claim_by` 认领；读 plan、DoD、governing ADR 与合法转换。
3. 使用 Super Plumber `plumber-execute`。逐 checkpoint 汇报，真实 execution_report，先 verdict 再 passed。图状态经 CLI/MCP/`sp.mjs`，不手改 YAML，不使用 `--force`，不跨过未完成依赖。
4. 在授权内持续完成工作；测试按变更运行，代码测试必须来自本次 build 的 dist。不要增加只镜像实现的测试或无关治理产物。
5. 原生宿主场景和受控试验分别记证据等级。模型 smoke、fixture、模拟 port、静态文档核对均有价值，但不能冒充真实长程闭环或收益。
6. 同时只有当前 session 修改共享源码和原始图。前序交接后停止修改；如极端必要使用子代理，明确独立范围、原因和收口，并在下一次接力前全部结束。

## 接力时机与完整交接

完成一个连贯、可验证阶段，或上下文已接近耗尽时，写出 `SESSION-NNN-HANDOFF.md`，更新 `sessions.json` 和预算余额。无需硬将整个阶段塞进一次对话，也不能因阶段较大而只留下一份计划。

handoff 必须写：前后 session 编号/对话 ID、当前 cwd/branch/HEAD/dirty 状态、已完成节点与证据路径、实际运行命令及结果、当前 running/blocked 节点和 claim 所有者、未提交改动/临时产物/后台进程、冻结的协议/ADR、待决项、完整预算与保留额、下一 session 的具体第一动作与验收、原始图/派生视图是否同步。参考 `HANDOFF-TEMPLATE.md`。

交接前让已完成节点得到真实裁决。未完成 running 节点必须明确所有权与续做方式，不留无人负责的 claim；不要 cancel 上游制造虚假可调度性。后继首先核验 claim，使用 SP 支持的 reclaim/重新认领流程，不伪造前序成功。

写完交接后，先判断是否跨 L。同一 L 可同目录 fork；跨 L 必须新建 `create_thread`。设置可辨识的下一 session 标题，更新 `sessions.json` 中 predecessor/successor/currentOwner、phase 与 creationMode，然后发出启动 prompt/message，显式使用 `gpt-6.1-sol / xhigh`。初始消息链接本协议和上一份 handoff，指定后继的编号、阶段、第一动作、工作区核验和延续义务。启动前完成前序所有共享文件写入，避免新旧 session 同时写。

用 `wait_threads` 快照核验后继确实已开始。后继开始后，前序只报告交接结果并结束。若启动失败，记录真实错误，修复/重试，不把仅 fork 的闲置对话称为已执行。不要在没有进展或同一用户待答阻塞时反复新建空 session。

连续接力直到实现/验证交付完成并准备最终人审，或只能由用户/外部状态解决的具体阻塞。部分阻塞不暂停其它可执行节点；最终验收不得虚假 passed。最终交付列出与 graph exit 的逐项对应及尚未证明的收益，不自动发布。

## Super Plumber 与工作区注意事项

图真相源 `.graph/evofence-harness-kernel/`；所有命令显式 `--graph evofence-harness-kernel`。原始图被 gitignore，后继在同一目录可直接读取。设计交付的 `graph-review.zip`、`DESIGN-CHECKS.json` 是冻结快照。

全局 CLI：`C:/Users/Calvin-Xia/AppData/Roaming/npm/node_modules/@lukawi/super-plumber/dist/cli/index.js`。
辅助脚本：同一包 `integrations/src/sp-scripts/sp.mjs`，其中 `checkpoint <node> <cp> <status>` 和 `report <node> <summary> [artifacts.csv] [blockers.csv] [notes]` 提供 CLI 尚无的操作。

JSON 参数用 Node `spawnSync(process.execPath, [cli, ...args])` 保留真实参数，避免 PowerShell 引号转换。Windows shell 中不把 JSON.stringify 当 shell escaping。

`graph export --docs --graph ...` 更新本目录的生成视图，不手改 `CONTEXT-MAP.md`、`DECISIONS.md`、`contexts/`、`adr/`。`.graph` 中已保留三个历史图参考副本，使导出保持多图目录边界；不要删掉这些参考导致导出覆盖根历史文档。

历史 `build-harness-design.mjs`、`normalize-dependencies.mjs`、`restore-export-boundary.mjs`、`finalize-design.mjs` 是设计阶段工具，不要在执行中重跑以回置状态或覆盖产物。

图 UI 正在 `http://localhost:8934/?graph=evofence-harness-kernel`，前序后台 session `20950`，交接时核验，不重复启动同端口。

本工作区 `.git` 元数据写入曾遇到 index.lock 权限限制；文件工作不受此限制。需要 commit 时按平台正式审批路径处理实际权限阻塞，不修改 `.git`、不绕锁、不伪造 SHA；未提交文件仍必须完整交接。
