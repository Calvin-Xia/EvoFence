# Pi 原生接入探针：0.87.1

日期：2026-10-01。节点 `l1_pi_probe`。本次固定本机 Pi `0.87.1`，执行真实 SDK 会话及原生 extension hooks。版本、关键 SDK/provider 文件 SHA256 与模型目录来源见 [VERSION-PIN.json](VERSION-PIN.json)。这不是已交付的 EvoFence Pi adapter。

16 项离线检查通过；真实 Xiaomi API 的 13 项适用检查通过。真实 API 请求两次，原生会话先调用 `evofence_probe_echo`，再回答，保留同一个 sessionId、宿主上下文/skill/read tool 和节点上下文。没有使用 `evofence run` 或关闭会话的子 CLI。

## 可复现入口

在当前 worktree 根目录运行：

```powershell
node scripts/probes/pi-native-probe.mjs
node scripts/probes/pi-native-probe.mjs --live
```

第二条会使用既有 Xiaomi API-key 凭据并消费共享模型预算，不能作为 CI 的自动检查。默认路径使用本机全局 Pi 包；其它安装位置可设置 `EVOFENCE_PI_PACKAGE_ROOT`。版本变动会拒绝执行，需重新定案和取证。

SDK 的 agentDir、临时宿主 fixture、skill、session JSONL 均在 `.graph/execution-private/pi-s01/`，不修改原 `.pi` 配置、原项目 AGENTS 或已有 Skills。网络模型目录刷新、自动 retry、compaction、cache warming 关闭；凭据只经 `readStoredCredential` 和 `AuthStorage.inMemory` 使用，未复制进工作区或命令行。Context/skills/tools 保留检查使用新建的可控宿主资源；尚未验证用户正在运行的 TUI 和全部第三方扩展共存。

## 能力矩阵

| 语义 | 证据与结论 | 后续适配责任 |
|---|---|---|
| 原生 session lifecycle | 离线与实跑的 `createAgentSession`、`bindExtensions`、subscribe/extension callbacks；两请求同 session | L3 adapter 将 kernel 绑定当前宿主 session，不创建无上下文子 CLI |
| 宿主上下文与 tools/skills | AGENTS marker、可用 skill/read tool 及 `context` 中新增节点 marker 均保留 | 节点 scoped context；不能覆盖整个宿主 prompt 或把基础能力清空 |
| tool authority | `tool_call` 拒绝第二个 fixture tool，execute 计数保持零；tool_result 能观测结果 | 是请求前门禁与结果观测，不是 OS sandbox，也不是对工具内部子操作的完整探测 |
| appendEntry | 原生 custom entry 持久化并在 reopen 后存在 | binding/asset receipt 须 idempotent、可关联 kernel journal；custom entry 不能代替 journal |
| 最终 idle | 异步 agent_end handler 完成后才出现 agent_settled；`waitForIdle` 已实跑 | 0.87.1 使用 settled/idle；agent_end 单独出现不能宣称可释放 writer/lease |
| usage | 两个真实 assistant receipts 与原始 provider SSE usage 一致，包括 cached input/reasoning | SDK input 为未缓存输入，raw prompt_tokens 包含缓存；禁止重复加 reasoning 到 output |
| SDK child sessions | 独立 sessionId、独立 transcript 和同一 modelRuntime 已创建验证，无 child 模型请求 | 没有原生等价 team board；EvoFence 负责子图 grant、budget/claims、父子取消、结果整合和恢复 |
| cancellation | 本地 HTTP fixture 中真实 `session.abort` 中止 native stream，连接断开且 waitForIdle 返回 | 实际供应商取消/中断后的计费未知不能归零；所有工具/子会话协同取消由 adapter 实现 |
| disk restore | 原生 session JSONL reopen 恢复 sessionId、messages 与 custom entry | 只恢复宿主 transcript；不提供未知外部 effect 的 exactly-once 或自动重试授权 |
| 模型配置 high | 实际发送 thinking.enabled 与 reasoning_effort=high，返回 200，Pi session 为 high | MiMo 官方仅文档化 thinking 开关；API 接受字段不证明独立 high 档位。HostManifest 必须标记这一保证为 partial |

机器可读结论见 [HOST-MANIFEST.json](HOST-MANIFEST.json)。原始轨迹：[offline-trace.json](offline-trace.json)、[live-trace.json](live-trace.json)。轨迹不记录完整 prompt、模型 thinking 或认证 headers。

## 费用和上界

两次 raw usage：第一请求 `13,615` prompt、`60` completion（其中 reasoning `37`）；第二请求 `13,684` prompt（cached `13,568`）、`18` completion（reasoning `14`）。Pi 第二请求的 input=`116`、cacheRead=`13,568`，合计等于 provider prompt_tokens。reasoning 已包含在 completion 中。

USD 参考定价为每百万未缓存输入 `$0.14`、缓存输入 `$0.0028`、输出 `$0.28`；依据当日核查的 [MiMo 官方价格表](https://mimo.mi.com/docs/en-US/price/pay-as-you-go)。两次费用分别约 `$0.001922900`、`$0.000059270`，累计约 `$0.001982170`。这是完整 token 用量乘官方 USD 参考价，未读取实际账单；不同计费币种/账单折扣不在本次核验内。

每次派发前预留 `$0.16`，覆盖模型整个 `1,048,576` token 输入窗口和限定 `4,096` 总输出的 USD 参考上界约 `$0.14794752`；完整 usage 后才释放预留。请求缺失 usage 时保留预留并停止该付费路径，不能把失败/abort 当免费。最多两次付费 HTTP 请求，重试与后台 warming 禁用，未请求收费 web search。共享账见 [MODEL-BUDGET.json](../../execution/MODEL-BUDGET.json)，累计上限仍为 `$0.50`。

## 证据边界与定案建议

建议选 Pi `0.87.1` 为本轮首发固定目标，以原生 extension 在当前 session 中绑定 kernel，以 SDK 创建可授权的 child loops。所有调用均由宿主拥有。离线 fixture 已证实取消/idle 事件，实跑已证实 context/tool/usage；必要公共合同可映射。

尚未交付 EvoFence 子图委派、shared grant/预算、leases/fencing、journal/outbox/reconcile 或能力资产激活，也未证明双宿主长程场景、供应商中断计费或能力收益。这些必须由 L2/L3/L4 的实际代码与场景完成；本节点通过不使它们自动成立。

当前官方资料先经 Context7 查询 `/earendil-works/pi/v0.87.1`，并与本机 types/implementation 核对。Context7 部分返回 main 示例，不当作固定版本事实；结论以已哈希的 `0.87.1` 源和执行轨迹为准。资料：[SDK](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/sdk.md)、[Extensions](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/extensions.md)、[MiMo thinking](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/deep-thinking)。
