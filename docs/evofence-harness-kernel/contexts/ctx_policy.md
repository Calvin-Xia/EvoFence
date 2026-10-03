# 授权与资源（ctx_policy）

依据宿主授予权限、可观测性、预算预留与风险决定允许、等待授权、拒绝或降级；记录证据可信度。业务策略可配置；不可把请求声明当成实际执行监测或自动扩大宿主权限。

## 术语表

- **AuthorityGrant**: 带 actor、资源范围、允许动作、有效期与撤销依据的真实授权。
- **UsageCompleteness**: 用量的来源、覆盖面和完整性；unknown 不等于 zero。
- **Reservation**: 并行与嵌套任务共享总账的预算预留；不得为每个 agent 复制完整预算。

> 本文由 `graph export` 从 context 顶点 ctx_policy 生成（节点即文档，图是真相源）。
