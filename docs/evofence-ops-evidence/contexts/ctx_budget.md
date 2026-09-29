# 预算判定域（ctx_budget）

负责 token 与 USD 预算的记账口径、阈值终止语义与用量完整性判定；不负责 agent 进程编排与适配器 argv 构造，不负责账本事件写入实现（由 ctx_ledger 落链），不负责配置文档契约的定义（由 ctx_config 提供）。

## 术语表

- **事后累计**: 在 agent 已完成的 turn、step 或消息边界累加用量，达到阈值时终止进程树并跳过评估；它不是请求前的硬上限。Avoid: 硬上限、预扣预算
- **用量完整性**: 只有适配器报告了完整的 token 与成本数值时才允许计入；缺失、不完整或被截断一律 fail closed。Avoid: 估算值、补零、尽力统计

> 本文由 `graph export` 从 context 顶点 ctx_budget 生成（节点即文档，图是真相源）。
