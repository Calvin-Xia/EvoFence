# 账本完整性域（ctx_ledger）

负责 sha256 哈希链配方、事件读写、导出 bundle 形态与完整性校验；不负责命令面输出形状（由 ctx_cli 呈现），不负责预算判定（由 ctx_budget 判定），不负责配置解析（由 ctx_config 提供）。

## 术语表

- **哈希链配方**: sha256(stableStringify({seq, created_at, event_type, run_id, payload_json, previous_hash})) 这一冻结的摘要配方，seq 为 1 时 previous_hash 取零值。Avoid: 第二套摘要、重新序列化负载
- **导出 bundle**: ledger export 产出的 JSON 文档，含 schema_version、integrity、active_generation、generations 与全部事件行（每行含 event_hash 与 previous_hash）。Avoid: 数据库备份、库文件副本

> 本文由 `graph export` 从 context 顶点 ctx_ledger 生成（节点即文档，图是真相源）。
