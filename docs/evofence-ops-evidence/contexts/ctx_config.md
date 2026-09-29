# 配置契约域（ctx_config）

负责四类 YAML 文档的 schema、校验、加载与配置面文档的单一真相；不负责预算运行时判定（由 ctx_budget 判定），不负责命令面输出形状（由 ctx_cli 呈现），不负责账本读写（由 ctx_ledger 负责）。

## 术语表

- **配置面**: 四类 YAML 文档的 required 路径全集、代码默认值集合与文档失败码的合集，是文档与 schema 必须一致的那个对象。Avoid: 文档口径、人工维护清单
- **fail-closed 校验**: 未知字段与缺失必填一律拒绝，且只有两个字段有代码默认值。Avoid: 静默忽略未知字段、隐式补默认值

> 本文由 `graph export` 从 context 顶点 ctx_config 生成（节点即文档，图是真相源）。
