# 审计账本域（ctx_ledger）

负责审计账本与哈希链内核：ledger 记录的 schema、sha256 的 prev/hash 链式校验与 fail-closed 校验语义；不负责执行与判定逻辑（记录内容由 ctx_exec 与 ctx_gate 产生）、对外视图渲染（读取接口由 ctx_io 视图层消费）与配置解析（配置格式属 ctx_io）。旧版本账本读取按显式不兼容处理，不提供迁移。

## 术语表

- **哈希链**: 账本记录以 sha256 按 prev 与 hash 串联的链式结构，任一记录被改动都会导致校验失败。Avoid: 校验和列表
- **账本记录**: 账本中的一条不可变条目，含载荷与链式校验字段，schema 随 ledger v2 破坏性调整
- **不兼容读取**: 遇到旧版本账本格式时显式报错并拒绝继续，不做静默转换。Avoid: 自动迁移、兼容模式

> 本文由 `graph export` 从 context 顶点 ctx_ledger 生成（节点即文档，图是真相源）。
