# Pi session binding (L3)

目标固定为 `@earendil-works/pi-coding-agent` **0.87.1**。该层在 core 闭包之外；没有隐式 SDK/backend、包发现、凭据读取、CLI 子进程、session 创建/销毁或 tools/skills 重置。

宿主在 extension factory 内调用 `bindPiSession(pi, options)`，传入已由宿主创建的持久 `AgentSession` getter、真实包版本、kernel/native session IDs 和显式的 context/tool/usage 端口。宿主 `bindExtensions` 发出的 `session_start` 激活绑定；`binding.host` 可直接作为 `SessionPorts.host` 注入 `createSessionService`。后台 `service.step()` 由宿主在 extension hook 返回之后的 SDK/command 安全点调用，不能在 awaited `agent_end`/`agent_settled` 中等待新的 loop。绑定不会替宿主调度第二个 agent loop。

`options.prompt` 解析获准 effect 输入；`options.context` 解析已授权 artifact refs、核实 `maxTokens` 并返回有限消息 packet。context hook 只追加 packet，保留宿主消息顺序。`toolGate` 接收同一 AuthorizedEffect 和原始 callId/name/input，拒绝转成原生 `block`；`toolResult` 返回原始结果（含 isError/usage）给注入观察者。普通宿主工具调用不受该 lane 的 gate 影响；这不是 OS sandbox。direct host.tool、fresh child/delegate、asset activation 和 timer.wait 在该 session lane 明确拒绝，分别留给后续 operation/child/activation 实现。

请求身份是 `pi:<native session>:<effect>:request:<ordinal>`，每次 `before_provider_request` 对应一个 assistant receipt。同 ID 同内容只记录一次，冲突停止 kernel 进展。`HostPort.usage` 返回这些逐请求记录；`Receipt.usage` 按 invocation 合并为 **effect.reservationRef** 对应的唯一记录，适配冻结的 SessionPorts 单 invocation 预留接口。合并 source 保持 `host-normalized`（全 synthetic 则保持 synthetic），原逐请求 records 保存在 custom entry 的 `requestUsage`，不将归一化结果升级为 provider raw。reasoning 是 output 子集，cached input 单列；缺失 telemetry/SDK error-abort 的全零占位保持 null/incomplete，保留预留。SDK cost 是估价且向上取整 micro-USD；invoice 未查询，始终 null。

`agent_end` 可被宿主追加工作/重试/compaction 后继续；只有 `agent_settled` 和 SDK `waitForIdle` 都结束才形成当前 invocation 回执。调用期间 `active` 锁防止重入/并行 prompt，准备 context/prompt 期间也重新核实真实 idle。未知/异常/卸载回执不能确认晋升。cancel 只 abort 绑定自身的已派发且被点名 invocation，SDK abort/settled/idle 的确认不证明供应商取消计费。

custom entry `evofence.kernel.pi.v1` 持久化 binding/dispatch/receipt 关联。重新装载只能读取并 reconcile 已有回执；dispatch 没有真实终态即 unknown，不盲重派。它是宿主侧观察证据，kernel journal/outbox 仍是唯一真相源。恢复器不会从 transcript 签发 DecisionRecord。冻结 runtime 当前生成 `binding.hostSessionId=null`；该绑定以显式 kernel/native ID 的 custom entry 表和 hostInvocationId 关联，原 effect/receipt binding 不被改写；显式非 null 的外来 native ID 会拒绝。

卸载只注销自身 handlers/清空 packet，不调用宿主 abort/dispose，也不删 transcript/资源。宿主 switch/shutdown 后该 binding 失效，替换 AgentSession 需重新创建 binding。异常由 `options.fault` 显式上报并锁住 kernel 进展，宿主普通工作保留。

本 lane 的现有验证等级及版本阻塞见 [VERSION-DIFFERENCES.md](VERSION-DIFFERENCES.md) 和 `evidence/`。fixture reopen 不是 native disk crash 恢复；历史 L1 native/provider 轨迹不等于本绑定的真实宿主证明。
