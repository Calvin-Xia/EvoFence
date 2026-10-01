# 0002 — 动态 Graph Engineering 与有界 agent loops

建议任务驱动动态图＋验证模板；节点可为 bounded agent/tool/evaluator/code loop。依赖投影无环，repair/fallback/route 独立且有停止条件。

**Status：** accepted

**Context：** 用户将 graph 澄清为 Graph Engineering，选择动态子图＋模板。SP 调度与知识边分离可借鉴。

**Considered Options：** 固定流水线可控但限制探索；完全由 agent 自行协商难恢复；有约束的动态子图增加编译与修订复杂度。

**Why：** 允许长程任务自主拆分又能约束并发、完整 fan-in 与修复。

**Consequences：** graph revision、资源冲突、输入版本和循环预算成为核心合同；小任务可退化为单 loop。

> 本文由 `graph export` 从图顶点 adr_0002 生成；改图不改文，重新导出即覆盖。
