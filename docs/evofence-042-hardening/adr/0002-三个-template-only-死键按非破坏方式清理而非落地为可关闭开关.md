# 0002 — 三个 template-only 死键按非破坏方式清理而非落地为可关闭开关

合同模板删除 acceptance.require_proposal、acceptance.require_claims 与 capabilities.shell.mode 三个键；shell.mode 因在开放 map 中从未被声明，连引用一并清空；两个 acceptance 键保留在 schema 作为兼容旧配置的空操作，并改标为无判定消费。提案校验与声明校验在迭代主循环中保持无条件执行。

**Status：** accepted

**Context：** 实测确认 acceptance 是闭合对象，未知子键判 INVALID_CONTRACT，故把两个 acceptance 键从 schema 删除会让全部在 0.4.0 与 0.4.1 上初始化过的旧合同下一次校验即被拒。capabilities 是开放 map，shell.mode 删除不影响旧合同。两个 acceptance 键今天只被类型校验，实际校验无条件执行。

**Considered Options：** A 落地为可关闭开关，语义上名副其实但 false 会跳过提案或声明校验，直接放宽既有门禁；B 保留为死键并登记台账，诚实但保留不生效的配项；C 模板删除加 schema 保留兼容，选中。

**Why：** 贡献须知要求保留合同、证据、预算与隔离门禁。开关的真义是可以关掉，而这三处的关闭方向与门禁方向相反，因此删除比落地安全；同时消除可配但不生效的误导。非破坏是 0.4.2 这类补丁版本的硬约束。

**Consequences：** 合同模板字段数减少，旧配置零破坏。台账不再声明 shell.mode，两个 acceptance 条目的措辞改为兼容保留。代价是 schema 里仍存在两个无判定消费的键——这是为兼容付出的有意代价，须在配置面文档写明，避免下次盘点又把它当新发现的谎言。

> 本文由 `graph export` 从图顶点 adr_0002 生成；改图不改文，重新导出即覆盖。
