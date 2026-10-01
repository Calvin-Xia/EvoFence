# SDK、观测与规划互操作（ctx_surface）

提供轻量 SDK、CLI 诊断/任务入口、宿主 UI 审阅视图、机器导出与 super-plumber 可选转换。只调用内核应用服务，不复制门禁、状态机或宿主执行逻辑。

## 术语表

- **ReviewView**: 从同一持久状态派生的人审/观测投影，包含 pending 与未知状态。
- **SPBridge**: super-plumber 的可选导入导出桥；无法映射的语义明确报损失，不悄悄执行。
- **PackageBoundary**: 按稳定 API 与依赖隔离划分的发布边界；首次实现不要求拆成独立 npm 包。

> 本文由 `graph export` 从 context 顶点 ctx_surface 生成（节点即文档，图是真相源）。
