# Context Map

> 本仓库有 9 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_contract（协议与任务合同） | 定义版本化 TaskContract、GraphSpec、HostManifest、Command/Event/Effect、评价合同与资产标识。只定义语义与兼 | 3 | contexts/ctx_contract.md |
| ctx_eval（任务验证与能力评价） | 分别判断普通任务完成、候选有效性、长期能力收益和退化；消费独立 evaluator 的证据与多指标合同。控制 held-out 数据和可反馈信息，输出唯一 De | 3 | contexts/ctx_eval.md |
| ctx_graph（图编译与协作调度） | 将动态 GraphSpec 编译为合法执行计划；管理依赖、路由、图修订、租约、冲突资源、完整 fan-in 与有界修复。只产出调度决策；不直接启停 agent  | 3 | contexts/ctx_graph.md |
| ctx_host（DSH 与 Pi 宿主适配） | 将两宿主生命周期、上下文、原生执行、委派、usage 与取消映射为统一 ports；在版本固定的宿主上验证能力。主路径使用原生会话，工具/模型由宿主执行；CLI | 3 | contexts/ctx_host.md |
| ctx_learning（经验与能力演化） | 从 trace 提炼候选，管理模板、策略、经验、技能和工具资产的检索、验证、晋升、激活与撤销。资产默认限项目/宿主/任务类型；不写既有全局 Skills，不训练 | 3 | contexts/ctx_learning.md |
| ctx_policy（授权与资源） | 依据宿主授予权限、可观测性、预算预留与风险决定允许、等待授权、拒绝或降级；记录证据可信度。业务策略可配置；不可把请求声明当成实际执行监测或自动扩大宿主权限。 | 3 | contexts/ctx_policy.md |
| ctx_runtime（会话与效果编排） | 协调会话、事件归约、outbox、宿主结果归并、取消和崩溃恢复；调用图、授权和评价服务。通过 ports 执行副作用；不拥有宿主权限根，不用日志重放重新执行外部 | 3 | contexts/ctx_runtime.md |
| ctx_store（持久状态与产物） | 为事件日志、版本化投影、outbox、资产与不可变证据提供端口和独立实现；控制并发提交、校验与导入边界。持久状态是真相源，索引/图视图是派生物；不把旧审计 le | 3 | contexts/ctx_store.md |
| ctx_surface（SDK、观测与规划互操作） | 提供轻量 SDK、CLI 诊断/任务入口、宿主 UI 审阅视图、机器导出与 super-plumber 可选转换。只调用内核应用服务，不复制门禁、状态机或宿主执 | 3 | contexts/ctx_surface.md |
