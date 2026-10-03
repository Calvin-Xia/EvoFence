# 会话与效果编排（ctx_runtime）

协调会话、事件归约、outbox、宿主结果归并、取消和崩溃恢复；调用图、授权和评价服务。通过 ports 执行副作用；不拥有宿主权限根，不用日志重放重新执行外部动作。

## 术语表

- **SessionEpoch**: 一次恢复后的执行世代；隔离旧 worker 回包。
- **EffectReceipt**: 宿主报告的操作实际状态、产物、用量与异常；不以请求发送成功冒充执行成功。
- **Reconciliation**: 对未知外部动作核实实际结果后再继续；不得默认重复执行。

> 本文由 `graph export` 从 context 顶点 ctx_runtime 生成（节点即文档，图是真相源）。
