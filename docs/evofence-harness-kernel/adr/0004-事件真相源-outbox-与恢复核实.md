# 0004 — 事件真相源、outbox 与恢复核实

建议新版 journal＋版本投影＋原子 outbox；宿主 effect receipt 幂等，crash 后不确定操作先 reconcile；外部副作用不声称 exactly-once。

**Status：** proposed（待裁决）

**Context：** 现有 ledger 是审计链而内存 RunState 不可恢复；多 agent 需并发与取消。

**Considered Options：** 仅内存简单却丢状态；沿用旧 ledger 会混淆格式/审计/编排；新 namespace 增加存储与迁移边界。

**Why：** 可以恢复长程任务与解释每次决策，避免重放导致重复调用/写入。

**Consequences：** native SQLite 实现可选独立导入；需 CAS/fencing、序列与格式版本。

> 本文由 `graph export` 从图顶点 adr_0004 生成；改图不改文，重新导出即覆盖。
