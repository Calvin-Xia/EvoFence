# Pi 版本/证据差异表

目标：**0.87.1**。2026-10-02 本机全局 `@earendil-works/pi-coding-agent` 为 **0.99.2**。用户确认没有 0.87.1 可运行包、不授权 install，要求保持 `blocked-on-version`，继续版本无关 cp2/cp3 与门禁。未修改 pin、未升级合同、未在 0.99.2 启用绑定。

| 行为 | 固定版 0.87.1 声明/历史实测 | 本 lane 实现与当前验证 | 当前本机 0.99.2 |
|---|---|---|---|
| 持久原生 session (P1) | L1 provider-live 两请求同 session；默认 SessionManager 持久化 | getter 注入既有 session，强制 native ID/持久路径；fixture 验证，无新 session/CLI | 包元数据已核实；版本门禁拒绝，DoD① **blocked/unknown** |
| 生命周期 start/shutdown | extension `session_start` / `session_shutdown`；没有假定名为 session_end 的事件 | start 读回 custom entries，shutdown/switch 失效；fixture | 未在该版运行绑定；替换 session 重新绑定的语义不跨版本假定 |
| context/tools/skills (P2) | L1 provider-live 的 controlled AGENTS/skill/read 保留 | 只追加有限 packet，普通 host tools 保留；fixture | 未验证用户 TUI/第三方 extensions/skills 共存 |
| tool_call/tool_result (P3/P4) | L1 拒绝门禁是 native-fixture；result 有 provider-live | 原 callId/name/input/isError/usage 传给注入端口；block 拒绝、异常锁住 kernel；fixture | 未作该版 native tool 执行 |
| appendEntry/session identity (P7/P9) | L1 native-disk reopen 恢复 custom entry 与同 ID | v1 entry 关联 kernel/native IDs，保留 dispatch/receipt/逐请求 usage；fixture reopen | **未**重跑本绑定的 native-disk reopen；custom entry 非 kernel journal |
| usage (P5) | L1 provider raw 与 SDK receipt 一致，SDK input 为 uncached，reasoning 属于 output | 每 transport request 去重；每 invocation 汇总到 reservation；缺 meter 和 SDK 全零 error/abort 保留 unknown；fixture | 当前新 provider requests **0**，usage **null**，成本估价 **null** |
| agent_end (P17) | awaited end 后仍可 retry/compaction/queued continuation | 不置 idle、不返回完成；源码变异改为早 settlement 会变红 | 当前版具体后处理未由 lane 进程核验 |
| agent_settled / waitForIdle (P17) | 0.87.1 声明：settled 无 outcome 字段；历史实测 awaited end 后 settled | settled + SDK waitForIdle 双条件；active 锁拒绝重入；fixture | 不假定事件新增字段；固定版本门禁阻止套用 |
| abort (P6) | SDK abort 返回 Promise 且等待 idle；extension ctx.abort 是 void；L1 本地 HTTP fixture 断连 | 调 SDK session.abort，只取消本 binding 已派发且被点名的 invocation；未确认仍 unknown；fixture | 供应商取消计费仍 unknown，未将 signal/断连当作免费 |
| child/native board (P8/P12) | L1 独立 SDK child identity，无 paid child；Pi 无原生 team board | 当前 lane 拒绝 fresh/delegate/activation 等未接线操作；观察 boardOwners=[] | 未验证 child cascade 或外部 effect exactly-once |
| unload/exception | SDK dispose 归宿主且使旧 context 失效 | 只卸载自身 hooks，保留 host work/transcript；异常上报并停止 kernel，fixture | 当前版 dispose 实跑未执行 |

固定版文档通过 Context7 `/earendil-works/pi/v0.87.1` 获取，但部分检索片段来自 main，因此 API 细节再与固定 tag 的 [types.ts](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/extensions/types.ts)、[agent-session.ts](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/agent-session.ts)、[SDK 文档](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/sdk.md) 核对。当前本机关键文件哈希与 L1 pin 的对照见 [native-version-block.json](evidence/native-version-block.json)。历史 L1 轨迹只作合同参考，未升级为本 lane 的新 native/provider 证据。

复现版本阻塞：读取 `%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent/package.json`，得到 `0.99.2`；`bindPiSession` 必须返回 `EFK_SOURCE_PIN_DRIFT`，不注册 hook。具体独立 Node 预检命令、exit=1、stdout 与零请求记录在上述 JSON。版本政策未裁决前，cp1 和真实 DoD①不能 passed。

门禁证据：[gates.json](evidence/gates.json)。真实源码变异→编译→红→原字节恢复→编译→绿：[negative-controls.json](evidence/negative-controls.json)。fixture tests 不证明真实供应商调用、用户正在运行的 TUI、磁盘断电恢复或能力收益。
