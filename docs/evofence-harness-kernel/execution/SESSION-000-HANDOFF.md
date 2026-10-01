# SESSION-000：设计交付到完整执行

前序/授权来源对话：`01a0f605-610d-7c30-bc1a-fb28a5b61f9a`（规划 EvoFence 完整架构重构）。后继对话与当前 owner 见 `sessions.json`。后继编号 S01，必须先读本文件和 `SESSION-PROTOCOL.md`。

## 已完成与当前事实

完整设计已交付：40 个工作流节点、9 个领域 context、10 个 proposed ADR、130 条边；五阶段 L1-L5。设计结构和 doctor 检查通过，保留真实 fog。设计快照 `DESIGN-CHECKS.json` 和 `graph-review.zip` 不再代表执行实时状态。

用户已直接授权完整执行、串行新对话接力、逐 session handoff、默认不用子代理。新 Codex 对话固定 `gpt-6.1-sol / xhigh`。本 session 建立授权、接力与共享预算记录，并通过 SP 记录初始批准及 `l1_review`；实际状态以 `SESSION-000-CHECKS.json` 和图读取结果为准，不据此将余下节点或 ADR 自动通过。

工作区 `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence`，初始 HEAD `d47f88367564e65db026b43b4b1e4fd83f06a4b7`；只新增设计/执行资料，尚未修改产品源码、运行产品测试或发起付费请求。branch、批准时源文件哈希与实际检查见 `AUTHORIZATION.json` 和检查报告。

Pi `0.87.1` 与 OpenCode `1.18.32` 均已实际运行版本/CLI help。Pi 的全局目录因 sandbox 对 trust.json.lock 的写入限制启动失败；设置 `PI_CODING_AGENT_DIR` 到 `.graph/execution-private/pi-agent` 后 help 成功，不需要改全局配置。

本机 `~/.pi/agent/models-store.json` 中存在 `xiaomi/mimo-v2.6-flash`：openai-completions、reasoning=true；本机 Xiaomi 认证条目存在。缓存里的价格/模型上限是探针线索，尚未核对官方当前定价、high 的真实 payload、服务连通性或实际用量。隔离的空 Pi 目录没有认证，因此其 list-models 显示 no models，并不证明本机 provider 不支持该模型。原凭据保持原地、未打印、未复制。可用 SDK 的 `AuthStorage.inMemory` 安全注入已有认证（先查本机 types/API）；不要把凭据放进 CLI 参数/工作区。

用户获准模型试验 `xiaomi/mimo-v2.6-flash high`，额外 API 累计上限 `0.50 USD`。S00 实際付费请求为零，全部额度待使用；不包含对能力收益的承诺。OpenCode 不替代双宿主产品要求。

## 必須承接的架构选择

用户确认：能力演化内核；长程编码结合多 agent；允许全面 breaking；策略/经验/代码/技能/工具候选；DSH 和 Pi 同等首发；宿主执行、内核决策且可委托子图；授权内自动执行与验证晋升；双宿主实用闭环和受控能力收益；任务驱动动态子图＋可复用模板。

先看 `ARCHITECTURE.md`、`CONTRACTS.md`、`ROADMAP.md`、`SOURCES.md`。两宿主以同一 HostPort 合同接入原生持续会话；任务完成、候选评价、长期晋升、宿主激活分离。动态修订具有 typed contracts、required fan-in、bounded loops、资源 leases/fencing、共享预算与 journal/outbox/reconcile。核心可独立导入，不强依赖 CLI/Git/native SQLite/SP。

当前代码已存在库 export，主要限制是整体流程仍绑 Git/worktree/子 CLI、串行迭代和 scalar objective。`src/lib/gate/index.ts` 的纯 gate reference 标明 NOT WIRED，不能将它当现有生产路径。DSH 当前两个只读 ledger tools，Pi 当前 CLI 隔离会话不等于宿主内核接入。已有 audit/hash chain 不等于 durable workflow/replay。非 gate/仅验证权限配置必须如实说明实际信号边界。

受控评价 A=原 harness、B=图无学习、C=图＋学习，计入全部开销，冻结 train/dev/held-out/final 和主指标/停止规则，按各宿主评价。0.50 USD 若不足预注册试验，只能得到受限证据；不要借完整执行授权捏造显著收益或最终人审。

## S01 具体任务

1. 核验本协议、共享预算、当前 Git/graph 和 S00 批准记录；读取 `graph next`，先核对 l1_review 真实完成。
2. 顺序推进 `l1_dsh_probe`、`l1_pi_probe`、`l1_graph_contract`、`l1_eval_protocol`，再 `l1_api_freeze` 和研究毕业。每个节点单独 claim/checkpoint/report/verdict，不并行写共享状态。
3. 先从本机安装和官方资料固定宿主目标版本，查真实 SDK/lifecycle/团队或 child/authority/usage/cancel/recovery 能力。使用 Context7 查当前文档，再用锁定版本源和可复现探针核实；模拟接口不能冒充真实宿主。
4. 实際启动 Pi 的获准模型最小探针时，先核验 high 和定价/用量及可约束总成本，统一预算预留/结算。若 API 路径尚不满足预算保证，先完成无需付费的协议、宿主探针与实现任务，不空等。
5. 研究可能修订 L2-L5 的细节，用 graph CLI 改图和 ADR 并同步文档。执行授权已更新原设计“仅建图”的边界；在既定目标内自主决策，不因旧停止文字重复请求开始。新的重大取舍、预算扩大和真实最终人审仍据实际事实处理。
6. 完成一段可验证产物后写 `SESSION-001-HANDOFF.md`，同目录 fork S02 并以指定模型启动；接力直至整体实现/验证准备最终验收。上下文不足时也要实際交接，不能仅承诺下次继续。

## 环境与保留事项

原始图 `.graph/evofence-harness-kernel/` 被 gitignore。`.graph` 有三个旧图参考副本用于维持多图 export 边界，309 个文件在设计时已核对原样。主 checkout 历史图/active 未改；不要覆盖它们。

SP 1.0.0，全局 CLI 与 sp.mjs 路径见协议；原始图 UI `http://localhost:8934/?graph=evofence-harness-kernel`，后台 exec session `20950`。本 session 新建 `.graph/execution-private/pi-agent`（无凭据）；交接时记录，勿误提交。

此前 `git restore` 的 index.lock 权限阻塞来自受限元数据目录；用正规审批处理后续实际 commit 需要，不绕过 Git。设计阶段一次 export 误触根历史导出已完整恢复，当前历史文件无 tracked diff。不要重跑旧设计恢复/归一化脚本。

全局 Skills、旧数据、凭据及发布边界见协议。后继启动前 S00 停止共享修改；S01 启动状态记入 sessions registry。本文件是设计后的接力记录，不替代原始图和新 build/真实试验结果。
