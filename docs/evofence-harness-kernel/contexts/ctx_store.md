# 持久状态与产物（ctx_store）

为事件日志、版本化投影、outbox、资产与不可变证据提供端口和独立实现；控制并发提交、校验与导入边界。持久状态是真相源，索引/图视图是派生物；不把旧审计 ledger 宣称为恢复日志。

## 术语表

- **Journal**: 带 revision/sequence/idempotency 的新版执行事件真相源。
- **ArtifactRef**: 包含不可变身份、摘要、生产者、版本与可访问范围的产物引用。
- **LegacyBundle**: 旧版 ledger 的只读证据包；不自动变成新版可激活能力。

> 本文由 `graph export` 从 context 顶点 ctx_store 生成（节点即文档，图是真相源）。
