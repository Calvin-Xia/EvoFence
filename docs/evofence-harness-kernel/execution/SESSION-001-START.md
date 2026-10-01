# S01 启动任务

这是用户已授权的完整 EvoFence 重构执行的第一个新对话。你是独立接力对话，不是子代理。前序 S00 为 `01a0f605-610d-7c30-bc1a-fb28a5b61f9a`；本对话 S01 为 `01a0f63f-ecf9-7dd3-8e86-5a110c35d712`。同目录 fork 已继承前序完整历史，模型必须是 `gpt-6.1-sol / xhigh`。

先读本 worktree 中 `docs/evofence-harness-kernel/execution/SESSION-000-HANDOFF.md`、`SESSION-PROTOCOL.md`、`AUTHORIZATION.json`、`MODEL-BUDGET.json`、`sessions.json`、`SESSION-000-CHECKS.json`，再读架构与节点合同并核验真实状态。S00 已停止共享修改，由 S01 接管 registry 和图，启动后将本 session 记为 active。

用户直接授权原文仍在继承历史中：允许新开对话完整执行，每个新 session 承接前一 session 并交付 handoff；非万不得已不开子代理，每个新对话 gpt-6.1-sol xhigh。这个授权包括后续串行 fork 与向后继发送启动交接消息；不要每次重复询问是否继续。

用户随后回答模型预算：可以启动 Pi 或 OpenCode，`xiaomi/mimo-v2.6-flash high`，额外 API 总上限 `0.50 USD`。这不是每个 session/每个宿主的预算，也不是 Codex 对话模型；必须共用预算账。S00 已确认 Pi 0.87.1、OpenCode 1.18.32 的 CLI 可启动，Pi 的缓存中有指定模型且认证条目存在，但尚未发付费请求。原始凭据只允许内存使用，不打印/复制/写交接文件。

当前 `l1_review` 已根据真人直接执行指令完成；39 个后续工作节点仍 pending，10 个 ADR 仍 proposed。通过 SP 的 next 获取实际前沿，顺序执行 DSH/Pi 版本能力探针、动态图运行合同和评价协议，再定案公共 API 与研究毕业。先取得真实协议/代码/可复現轨迹，不能只扩写规划资料。

使用 Super Plumber 的 plumber-execute 及 CLI/sp.mjs 维护认领、checkpoint、report、verdict、passed。用户的本次完整执行指令更新设计阶段“仅建图/当前会话不执行”的旧边界；不要把旧边界当作阻塞后续实现的理由。授权内技术细节可定案，未发生的实验结果、人审和支付额度不得代签。需要修订图时走合适的 amend 流程且同步真实证据。

用户希望实际启动 Pi/OpenCode 试验：优先核验 Pi 的 high 映射、固定模型与全量用量，验证成本可约束后在全局 0.50 USD 内进行最小有用探针。隔离 agent dir 避免写全局 trust/config；可研究 SDK AuthStorage.inMemory 读取现有 Xiaomi 条目，凭据不进入命令行或 Git。缓存价格尚未核对，SDK fixture 不等于 API 实跑。先留预算给两个宿主及必要实际场景，谨慎处理 title/summary、自动重试和其它隐式模型调用。OpenCode 获准使用，但不能替代 DSH/Pi 同等首发产品目标。

持续执行既定完整目标。阶段较大时完成一个可验证里程碑，或上下文将尽前，实際写出 `SESSION-001-HANDOFF.md`、更新真实图/预算/registry，同目录 fork 当前对话为 S02，给 S02 显式 `gpt-6.1-sol / xhigh` 的启动消息并核验它已开始，然后结束本对话。每个后继重复这一接力义务；不要只交计划或承诺下次继续。

默认全程不使用子代理，不并行启动执行对话。S01 没有义务发消息回 S00；持续状态保存在 registry/handoff 和后继对话中。受阻时先完成独立工作；没有实际进展且同一用户待答时不要反复开空对话。最终实现/验证与收益逐项交付；0.50 USD 若不足受控试验，明确缺失证据和具体追加实验需求，不虚假全绿、不发布 npm。
