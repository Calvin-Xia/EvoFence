# 0010 — 全面 breaking 与旧数据保留

建议新版协议/config/runtime/assets 独立版本与 namespace；不兼容旧 API可明确移除，旧 ledger/config 只读导出、显式导入为历史来源，不原地覆盖或重写 hash chain。

**Status：** proposed（待裁决）

**Context：** 用户明确允许全面推倒、breaking change；历史图与 source 本轮保持原样。

**Considered Options：** 完全不留升级路径减少工作但丢来源；强制兼容约束新核；只读边界保留原件同时允许重设。

**Why：** 契合当前授权，防止新格式冒充旧格式或旧历史自动成为可用能力。

**Consequences：** 需升级对照和可恢复导入；版本号/tag/npm 发布尚未获授权。

> 本文由 `graph export` 从图顶点 adr_0010 生成；改图不改文，重新导出即覆盖。
