# Pi 0.87.1 → 0.99.2 版本与证据差异

当前目标固定为 **@earendil-works/pi-coding-agent@0.99.2**，依据用户裁决 A（SESSION-006-HANDOFF §1、repin brief）。本机 pi --version、包元数据及关键文件哈希均已核实。VERSION-PIN.json 保留完整 0.87.1 pin 到 history[0].pin；L1 HOST-MANIFEST/live-trace/offline-trace/README 原样保留，均为 **0.87.1 历史证据**。

模型选择单独依据 [SESSION-006-HANDOFF §1.3](../../../docs/evofence-harness-kernel/execution/SESSION-006-HANDOFF.md)：用户已裁决本轮 Pi 使用 `deepseek/deepseek-flash` high、无美元硬上限且逐请求记账。本机 Xiaomi/MiMo 与 DeepSeek 均可选，此次切换来自本轮场景选择。历史 MiMo 模型与 $0.50 累计预算保留；SDK 版本重定与模型选择是两项分别记录的决定。本次 FIX1 只补说明，VERSION-PIN.json 未再修改。

| 接口 | 0.87.1 历史声明/实测 | 0.99.2 实际包与本 lane 结论 |
|---|---|---|
| session_start / session_shutdown | start/readback、shutdown 后 context 失效 | start reason 为 startup/reload/new/resume/fork；shutdown 为 quit/reload/new/resume/fork；原生 ID/file 保留。真实 resume 使用同一个已存在的 disk session；用户 TUI 切换共存未测 |
| agent_end | awaited end 后仍可能 retry/compaction/续跑；0.87.1 tag 已有 agent_before_settle | 仍是中间事件。_runAgentPrompt 先处理 post-agent work，再执行 agent_before_settle boundary（本轮新增实测覆盖，非该事件首次引入）；continue:true 可触发下一请求。native-fixture 两次 agent_end、三次 transport request、一个最终 receipt |
| agent_settled / idle | settled 无 outcome 字段；idle 后可派发 | AgentSettledEvent 仍仅有 type。在 awaited settled handlers 前 SDK 将 _isAgentRunActive=false，所以 SDK isIdle 可先为 true；binding active 锁仍拒绝重入。等待外部 session.prompt 返回与 waitForIdle 后才发 receipt |
| abort | SDK session.abort():Promise<void>；ctx.abort 为 void | SDK 设置 abort-requested，取消 retry/compaction/branch summary/agent，等待 idle；该版包含 boundary-abort 协调。真实本地 HTTP hold 被 native abort 断开；native-ack 不证明供应商计费，receipt usage incomplete/null |
| tools | 原始 callId/name/input/result；block 阻断 | 新增可选 parentToolCallId，结构类型补齐该字段及 tool_result structuredContent（原事件直接转交，无字段丢弃）。tool_call input 可由 extension 就地修改，SDK 不重验后续改动，第三方共存边界未证明；不声称 OS 隔离 |
| on / appendEntry | unregister function / void append | 本机 types/loader 确认 on 返回注销函数，appendEntry 仍 void。实际 custom binding/dispatch/receipt 在 JSONL reopen 后读回，同 ID |
| usage | SDK input 是 uncached，reasoning 包含在 output，成本为估价 | 两条真实 DeepSeek raw SSE 与 SDK input/cache/output/total 一致。invocation 合并到唯一 reservation，逐请求记录保留。零填充 error/abort 仍 unknown，不释放为免费 |
| child/board/reasoning | L1 child 与 MiMo payload 证据 | 不移植历史保证：local PI_SESSION_CAPABILITIES 将 child identity 与 server reasoning guarantee 标为 unknown；delegate/fresh/activation 明确拒绝。core 历史矩阵未修改 |

本机声明源 dist/core/extensions/types.d.ts，实现源 agent-session.js、extensions/loader.js、session-manager.js；SHA256 在新 pin。先查 Context7 /earendil-works/pi，其 main 片段只作定位（无 0.99.2 专用 ID），最终版本事实以哈希固定的本机包及真实轨迹为准。官方固定 tag 对照：[0.87.1 types](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/extensions/types.ts)；0.99.2 源码参照：[extension types](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/src/core/extensions/types.ts)、[agent-session](https://github.com/earendil-works/pi/blob/v0.99.2/packages/coding-agent/src/core/agent-session.ts)。

## 逐项版本重验

| 索引 | 0.99.2 新证据 | 保证范围与未证明项 |
|---|---|---|
| **P1** | **provider-live**：[0992-live-trace.json](evidence/0992-live-trace.json) /checks/existingPersistentSession、/checks/realSessionUnchanged、/trace/6；native ID 01a0fae9-a776-7090-ad53-f4131b60b6b0 | 先用真实 Pi 本地 HTTP fixture 完成宿主 turn 并持久化，重新打开该既有 disk session、加载扩展和真实内核；两条付费请求同 ID。bootstrap 是 native-fixture，kernel smoke 才是 provider-live；当前用户 TUI unknown |
| **P2** | **provider-live**：live 文件 /checks/contextAndResources、/checks/hostResourcesLoaded、/payloads | controlled AGENTS marker、skill 描述、read 工具与 host history 保留；context 只追加 node packet。全部用户 skills/第三方扩展共存 unknown |
| **P3** | **native-fixture**：[0992-native-trace.json](evidence/0992-native-trace.json) /checks/blockedToolNeverExecutes、/toolCalls | 真实 native tool_call 拒绝 denied 工具，execute 计数零；付费路径未派 denied tool，该项 provider-live unknown |
| **P4** | **provider-live**：live 文件 /checks/toolResultObserved、/toolCalls、/toolResults | echo 的 effectId、原生 toolCallId、name、input、isError 对应；完整嵌套工具/任意第三方改写未测 |
| **P9** | **native-disk**（provider-live session 后读回）：live 文件 /checks/diskRestore、/trace/24，native 文件同名检查 | custom binding/dispatch/receipt 与 usage、同 ID、同 receiptId 读回，无追加模型请求。只是 native reopen，非 crash/断电或 kernel durable-store 恢复 |
| **P17** | **provider-live**：live 文件 /checks/noEarlySettlement、/checks/receiptAfterSettlement、/trace/18、/trace/20、/trace/22；**native-fixture**：native 文件 /checks/continuation、/checks/settledReentryRefused、/checks/waitsForAsyncSettledHook、/trace | awaited agent_end 无 receipt；SDK 已 idle 的 settled hook 内仍拒绝 kernel 重入，hook 完成后才返回。新版 boundary continuation 保留 packet 至真正 settled。provider retry/compaction、全部第三方异步 actions unknown |

P5 在 live raw/SDK 用量对应中重验；P6 在 0.99.2 本地 HTTP abort 重验；P7 同 native-disk reopen；P8/P12/P14/P15/P20 不借历史结果升级本轮证据。供应商 abort 计费、server-tier high、delegation、activation、OS sandbox、外部 effect exactly-once、收益均未证明。

## DoD 与真实负对照

**DoD①**：createSessionService 注入 binding.host，实际 step 调用真实 Pi。live 快照 [0992-live-trace.json.kernel.json](evidence/0992-live-trace.json.kernel.json) 中 journal 一个 applied receipt、node 停在 verifying、无 DecisionRecord；fake host executions=0。显式测试 policy/clock/seed 与 in-memory stores 仅提供 smoke 基础设施，没有执行 evaluator；不声称完整任务验收、长程场景或收益。

**DoD②**：live awaited end/settled 顺序，加 native 三请求 continuation、async settled、reentry、unload 和 abort。abort 缺 meter 保留 null/incomplete，确认 stopped 与确认 spend 分开。

实际源码变异、build、真实 0.99.2 子进程变红、原字节恢复、build、真实子进程复绿见 [0992-negative-controls.json](evidence/0992-negative-controls.json)。共四项（DoD① 一项、DoD② 三项）均 red exit=1、green exit=0，SHA256 恢复一致，**native-fixture、零付费请求**；各自记录独立 red/green 文件、断言名及取证时源码哈希：

- DoD①：删除持久路径门禁，让真实 SessionManager.inMemory 错误通过；nativeMemorySessionRefused 断言变红。
- DoD②：在 agent_end 直接持久化 completed receipt；native boundary 续跑前 observer 看见早回执，DoD2 no receipt before native continuation/settlement 断言变红。
- DoD② 重入：删除 execute 的 `!isIdle()` 拒绝门禁；真实 awaited settled handler 尝试第二个 effect，`settledReentryRefused` 断言变红。见 [0992-dod2-reentry-red.json](evidence/0992-dod2-reentry-red.json) 与 [复绿轨迹](evidence/0992-dod2-reentry-green.json)。该变异也产生后续 context/continuation 检查失败，首个失败断言为重入拒绝。
- DoD② context 失效：在 agent_end 设置 `packet = []`；真实 boundary continuation 的第三条请求缺 node context，host context/skill 仍在，`contextAndResources` 断言变红。见 [0992-dod2-context-red.json](evidence/0992-dod2-context-red.json) 与 [复绿轨迹](evidence/0992-dod2-context-green.json)。

FIX1 重跑 [0992-memory-control.json](evidence/0992-memory-control.json)，真实 in-memory session 拒绝检查通过，补入本次实际使用的七个 `sourceHashes`，paidRequests=0。所有变异后 `binding.ts` 原字节均已恢复，SHA256=`401fb5ce46258074d25af30c313f5d95c91395e0c2be2c6031aa738201482672`。

拒绝路径：非 0.99.2 在注册 handler 或触碰 SDK 前返回 EFK_SOURCE_PIN_DRIFT；in-memory/错误 ID 拒绝，busy/reentry 拒绝，未知 dispatch 不盲重派，unknown usage 留预留。没有静默版本降级或无会话替代。

## 用量与复现

真实调用仅 **2** 条，deepseek/deepseek-flash high、thinking enabled、reasoning_effort high、max_tokens=2048；transport/agent retry、compaction、warming 关闭，最多两条请求，raw usage 缺失停止付费路径。参考输入窗口上界每条 $0.3024576；沿用本轮 DeepSeek 无美元硬上限、逐条记账授权。历史 MiMo $0.50 累计账未改变。

| 请求 | prompt | cached | completion（含 reasoning） | reasoning 子集 | total | USD 参考估价 |
|---|---:|---:|---:|---:|---:|---:|
| provider-1 | 10841 | 0 | 59 | 12 | 10900 | 0.003323100 |
| provider-2 | 10916 | 10752 | 104 | 99 | 11020 | 0.000238512 |
| 合计 | 21757 | 10752 | 163 | 111 | 21920 | **0.003561612** |

来源：[DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/)（2026-10-02 核对峰时 USD 输入/缓存/输出 .3/.006/1.2 每百万）。SDK/catalog 使用该参考价，实际非峰时折扣和账单未查询，不作为 invoice。SDK 每 transport cost 上取整 micro-USD 再汇总，与上表有舍入差异。请求前 reserved 与逐条 settled 见 [0992-live-trace.json.usage.json](evidence/0992-live-trace.json.usage.json)。凭据只通过用户既有认证进入内存，未输出/落盘。

~~~powershell
npm run build
node test/l3-pi-native-session.test.js --probe --output=src/hosts/pi/evidence/0992-native-trace.json
node test/l3-pi-negative-controls.test.js --mutate
node --test test/l3-pi-*.test.js
~~~

test/l3-pi-native-session.test.js --probe --live --output=<file> 会消费请求，不能作为自动 CI，也不需为重述证据重跑。live source hashes 保存取证时实现；随后只调整 native 探针的断言位置、abort 搭建、hash 捕获及测试目录布局，未再付费；历史 hash 的 .mjs 路径对应迁移前探针，生产绑定运行逻辑 hash 仍一致，后补的 structuredContent 仅为类型声明及 fixture 字段转交断言。runtime JSONL/controlled resources 保留在证据注明的独立 TEMP 目录，便于审阅，没有复制到 Git。旧 evidence/SUMMARY、gates、native-version-block、negative-controls 保留为前轮历史，当前总结和门禁使用 **0992-** 前缀。

复核 minor-2 保留为明确的可复现性限制：原 provider-live trace 的探针哈希为 `native-session.mjs:74b6780e…` / `native-support.mjs:316a7602…`，当前 `test/l3-pi-*.test.js` harness 无法逐字节复现该历史付费取证。运行绑定哈希不变只支持实现一致，不能消除探针差异；本轮补控及 memory control 使用当前 harness 并记录其实际哈希。历史 live trace 保留原貌，本次追加付费请求为零。
