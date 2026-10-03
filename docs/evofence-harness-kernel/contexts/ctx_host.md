# DSH 与 Pi 宿主适配（ctx_host）

将两宿主生命周期、上下文、原生执行、委派、usage 与取消映射为统一 ports；在版本固定的宿主上验证能力。主路径使用原生会话，工具/模型由宿主执行；CLI 不兜底冒充原生集成。

## 术语表

- **DelegationGrant**: 宿主显式授权内核调度一个子图的范围、期限、深度和并发上限。
- **CapabilityMatrix**: 每个宿主对事件、执行、取消和恢复的 verified/partial/absent/unknown 矩阵。
- **HostReceipt**: 归一化且保存原始来源关联的宿主反馈。

> 本文由 `graph export` 从 context 顶点 ctx_host 生成（节点即文档，图是真相源）。
