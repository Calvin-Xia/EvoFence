# SESSION-001：Pi 原生能力探针完成

当前 S01：`01a0f63f-ecf9-7dd3-8e86-5a110c35d712`。前序 S00：`01a0f605-610d-7c30-bc1a-fb28a5b61f9a`。**已按用户要求暂停；S02 未创建，也未启动。** 当前停在 **L1**，Pi 探针已完成。下文后继步骤仅作为用户恢复后或转交其他 harness 的参考，不授权自动恢复。**跨 L 时必须新建对话，不能 fork**。

## 授权与约束的最新变化

用户直接授权完整重构、串行新 session 接力、每 session handoff、默认不用子代理；每个新对话 `gpt-6.1-sol / xhigh`。额外 API 模型 `xiaomi/mimo-v2.6-flash high`，所有 session 合计 `$0.50`。

本 session 用户追加：**“跨L阶段时不要直接fork对话，而是新开对话！”**。已更新 `SESSION-PROTOCOL.md` 和 registry 的 `sessionCreationPolicy`。忽略旧 handoff 中对所有后继一律 fork 的表述；跨 L 要新建、显式交付已完成阶段的文档/决策/图/预算，并先核验工作目录和写权限。同 L 可以 fork 保留历史。

当前为独立串行对话，不是子代理；S01 未开启子代理。后继无需向 S00 发消息，继续下一份 handoff 链即可。

## 工作区和已完成节点

工作区仍是 `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence`。HEAD `d47f88367564e65db026b43b4b1e4fd83f06a4b7`，detached HEAD，尚无新 commit。`git diff --name-only` 为空；`git status --short` 为 `?? docs/evofence-harness-kernel/` 和 `?? scripts/probes/`。源码尚未进入 L2 重写；已实际交付可复现宿主探针，不只是计划。

`l1_review` 和 `l1_pi_probe` 已 passed。Pi 节点 cp1/cp2/cp3 全 passed，有真实 report、先 verdict 后 passed。其余 38 个 workflow pending，没有 running/blocked/failed claim；10 个 ADR 仍 proposed。ready_eligible 为 `l1_dsh_probe`、`l1_graph_contract`、`l1_eval_protocol`。API freeze 等待它们全部完成。

SP 结构 validate 0 error（保留设计 fog），doctor 0 error/0 warning，docs check 21 文件无漂移；四份 Mermaid 均经 CLI 重新导出。证据 `SESSION-001-CHECKS.json`、`probes/pi/README.md`、`probes/pi/HOST-MANIFEST.json`、`VERSION-PIN.json`、`offline-trace.json`、`live-trace.json`。

## Pi 研究结论与实际命令

固定 Pi `0.87.1`，关键 SDK/provider/types 文件有 SHA256。当前版使用 ModelRuntime；ModelRegistry 是兼容 facade，不能套用旧的 constructor(authStorage,modelsPath) 示例。原生 extension hooks 包括 context、tool_call/tool_result、appendEntry、before_provider_request、agent_end 和 agent_settled。

已运行，退出码均为 0：

```powershell
node scripts/probes/pi-native-probe.mjs
node scripts/probes/pi-native-probe.mjs --live
node --check scripts/probes/pi-native-probe.mjs
node --check scripts/probes/pi-probe-support.mjs
node .graph/design-tools/record-pi-probe.mjs
node .graph/design-tools/refresh-kernel-exports.mjs
```

`record-pi-probe.mjs` 是一次性 report/verdict/pass 记录工具，节点已 passed 后不要重跑。`refresh-kernel-exports.mjs` 可用于执行期同步导出，既不回置节点也不改旧历史 graph。

离线通过 16 项：真实 native SDK 接 deterministic 本地 HTTP SSE fixture，核验同 session、保留宿主 AGENTS/skill/read tool、context 注入、工具前拒绝且 execute 未发生、tool_result、appendEntry、high payload、reasoning pass-through、usage、等待异步 agent_end 后 settled、disk restore、child session 隔离、abort/idle、HTTP disconnect、无 extension error。

实跑通过 13 项适用检查：同一 SDK session 调 Xiaomi，两 HTTP200 请求，先执行 echo tool 再回答；宿主上下文/skills/tools 保留，节点 context 注入，两个 raw usage 与 native assistant receipts 一一对应，session JSONL 恢复及 child session 创建验证通过。拒绝/abort 行为由离线 fixture 验证，不冒充 vendor cancellation 实跑。

Pi native `high` 实际发送 `thinking.type=enabled` 和 `reasoning_effort=high`。MiMo 官方只文档化 thinking 开关；HTTP200 不证明服务端独立 high 档位，manifest 标记 partial。保持用户所选 model/high，不静默替换或以参数被接受夸大保证。

ModelRuntime/extension 已提供原生当前会话接入入口，不需要 evofence 子 CLI。child SDK sessions 可创建并隔离 transcript，没有假定内置 team graph board。EvoFence 仍需实现子图 grant/budget/claims、join、父子取消、资源 lease/fencing、持久 journal/outbox/reconcile 和资产激活。宿主 custom entries 和 transcript reopen 不能代替这些机制。尚未验证用户实际 TUI 与所有第三方 extensions 共存、双宿主长程任务或能力收益。

## 全局费用账

累计已结算 USD 参考估计：`0.00198217`；预留：`0`；未知费用：`false`；余额：`0.49801783`。两请求均完整结算。以 `MODEL-BUDGET.json` 实际值优先，不能重置。

第一次：prompt `13,615`，completion `60`（reasoning `37`），约 `$0.0019229`。第二次：prompt `13,684`（cached `13,568`），completion `18`（reasoning `14`），约 `$0.0000592704`。Pi usage.input 是未缓存输入，因此第二次 `116 + 13,568 = 13,684`；reasoning 已含在 output，不能再次加钱。

已核对官方 [USD 参考价格](https://mimo.mi.com/docs/en-US/price/pay-as-you-go)：input `$0.14/M`、cached `$0.0028/M`、output `$0.28/M`。账单本身/计费币种未查询，不能把参考估计冒充实际 invoice。

当前 probe 对每个实际 HTTP request 先预留 `$0.16`，覆盖整模型 context 窗口与限定 `4,096` 输出的 USD 上界；最多两次实际请求。SDK retry、auto compaction、cache warming 禁用，缺 usage 保留预留并阻止继续付费。helper 是 S01 Pi 探针工具，不是未来 kernel budget 实现；后继若复用需正确标记新 session/host、统一全局账，不把 DSH 请求记为 S01 Pi。不得再次执行 --live 只是为了重复检查文档或已通过结论。

## 新增/变化文件和后台状态

- `scripts/probes/pi-native-probe.mjs`：native SDK 离线/实跑 conformance 探针。
- `scripts/probes/pi-probe-support.mjs`：版本/模型解析、内存 auth、安全隔离与付费预算记录。实跑后加强 high 参数守卫，当前实际 payload 正好包含该值；没有因此额外调用付费模型。
- `docs/evofence-harness-kernel/probes/pi/`：5 份能力/版本/轨迹资料，真实 provider usage 已保留，不含 key/header/prompt/thinking。
- `execution/SESSION-001-CHECKS.json`、本 handoff；更新 protocol、template、registry、MODEL-BUDGET；生成 views 由 graph export 更新。
- `.graph/design-tools/record-pi-probe.mjs`（一次性）、`refresh-kernel-exports.mjs`（安全重导）；原始图状态、events、snapshots 经 SP 操作。
- `.graph/execution-private/pi-s01/`：本次新建的 agent/workspace/skill fixture/JSONL，没有 auth.json/key 副本，gitignored。原用户/global Skills 和配置只读。

live exec session `78480` 已完成，fixture HTTP server 已关闭；没有残留 probe 进程。图 UI 原后台 session `20950` 仍是前序提供的 `http://localhost:8934/?graph=evofence-harness-kernel`，不要重复占用端口。未发 tag/npm publish，未运行产品测试（产品源未改）。Git 元数据此前权限限制仍需在实际 commit 时走正式处理，不能绕锁。

## 恢复后接手者的第一动作和完成条件

1. 读本 handoff、最新 protocol/registry/预算；核验 `graph next` 与 cwd，更新 S02 active。先认领 `l1_dsh_probe`，读管辖 ADR 和完整节点，不重做 Pi 付费 smoke。
2. 本机已发现 `dsh.ps1`（全局 npm）；尚未读取其实际版本或启动。现 integration package 只读 ledger tools，peer/engines 固定 `@deepseek-ai/dsh-tools` / dsh `0.1.7-rc.1`。查实际安装版本、SDK/extension/team/lifecycle/cancel/usage/recovery 的真实能力，先 Context7 再以固定版本源码和 executable probe 为准。
3. 交付 DSH 版本能力矩阵与真实探针，明确原生 team board/ownership与 kernel graph 分工。模型实跑仍使用用户模型/high与共享 `$0.50`，不静默改 DeepSeek 模型或让 OpenCode 取代 DSH。
4. 继续 graph contract、eval protocol 和 API freeze；根据证据定案差异并调整提案。缺现成功能时实现适配路径，不能悄悄缩为只读插件。A/B/C 评价保持资源匹配、冻结分区、完整成本与负结果；用具体样本/预算判断收益证明是否足够，不预先断言 `$0.50` 必然不足。
5. 同 L1 可连续做或再 fork，但进入 L2 前必须写阶段 handoff并用 create_thread 新建，显式 `gpt-6.1-sol / xhigh`、核验源/目标目录状态。继续执行，直到完整交付准备最终人审或出现需真人解决的具体阻塞；不虚假 pass，发布仍未授权。

用户本次指令："感觉做完这个可以先停一下了，我可能会拿到其他herdr去用其他模型了你这边有点慢了😭"。S01 完成当前探针与交接收尾后停止，不创建后继，不继续 DSH、协议冻结或 L2 实现。接手者先读本 handoff 与 `PAUSED.md`，确认用户已恢复执行及其模型选择，再推进上述步骤。
