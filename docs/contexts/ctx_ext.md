# 集成与扩展消费域（ctx_ext）

负责集成与扩展消费面：integrations 下各适配器、仓库自带的 pi 扩展加载面与 herdr 派单执行面（pane 与 worktree 的对应关系）；不负责 CLI 命令面与 config 格式的定义（由 ctx_io 契约输出）、领域模块内部实现（ctx_gate、ctx_exec、ctx_ledger）。

## 术语表

- **集成消费方**: 按契约调用 EvoFence CLI 与加载扩展的外部适配面，含 integrations 下各目录与仓库自带的 pi 扩展。Avoid: 内部模块
- **派单**: 把节点任务交给执行 agent 的调度动作，要求 pane 与节点 claim_by 一一对应、并发执行 agent 数 ≤4、并行写操作在各自 worktree 内进行
- **白名单模型**: 派单允许使用的执行模型集合：deepseek/deepseek-flash 与 xiaomi/mimo-v2.6-pro 两个 high 档。Avoid: 任意模型

> 本文由 `graph export` 从 context 顶点 ctx_ext 生成（节点即文档，图是真相源）。
