# 图编译与协作调度（ctx_graph）

将动态 GraphSpec 编译为合法执行计划；管理依赖、路由、图修订、租约、冲突资源、完整 fan-in 与有界修复。只产出调度决策；不直接启停 agent 或写文件。

## 术语表

- **AgentNode**: 具有输入输出、上下文、资源权限和停止条件的有界 agent loop。
- **GraphRevision**: 原子提交且保留前版的任务图修订；不能修改正在执行的输入或删除失败证据。
- **Lease**: 带 epoch 和 fence token 的资源/节点占用凭据；过期结果不能提交。

> 本文由 `graph export` 从 context 顶点 ctx_graph 生成（节点即文档，图是真相源）。
