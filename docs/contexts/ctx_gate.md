# 门禁判定域（ctx_gate）

负责 contract、evidence、policy、budget、isolation 各判定面的判定逻辑与 fail-closed 判定语义（输入缺失或不可判即不通过）；不负责执行编排（由 ctx_exec 调用判定并推进运行）、账本记录（判定证据由 ctx_ledger 落链）、配置解析（判定输入由 ctx_io 提供）与集成适配（判定结论经 ctx_io 命令面与 ctx_ext 消费面输出）。

## 术语表

- **门禁判定**: 对一次候选变更给出通过或不通过结论的独立判定单元，覆盖 contract、evidence、policy、budget、isolation 判定面。Avoid: 验收、人工裁决
- **fail-closed**: 判定输入缺失、超时或不可判时一律按不通过处理的语义，禁止默认放行。Avoid: 尽力判定、宽松模式
- **判定输入**: 门禁判定消费的结构化输入，含合约条款、证据引用、策略声明、预算额度与隔离信息

> 本文由 `graph export` 从 context 顶点 ctx_gate 生成（节点即文档，图是真相源）。
