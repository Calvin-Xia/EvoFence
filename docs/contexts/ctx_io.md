# 配置与对外产物域（ctx_io）

负责配置与对外产物表面：config 格式与解析、CLI 命令面、报告/状态/审计视图、共享类型契约层、构建产物（dist 与类型声明）、文档发布面，以及这些表面的测试与验收证据汇总；不负责门禁判定逻辑（ctx_gate）、执行编排（ctx_exec）、账本内核（ctx_ledger）与集成适配（ctx_ext）。

## 术语表

- **命令面**: CLI 暴露的子命令与 flag 集合及其退出码、--json 输出契约的总称。Avoid: 命令实现
- **类型契约层**: 零运行时依赖的共享类型定义层，位于模块依赖方向最底层，各领域模块单向向下依赖它。Avoid: 公共工具类
- **对外产物**: 发布给消费方的构建产物与元数据：dist 下的 ESM JS 与 d.ts、package.json 的 bin/exports/types/files 指向。Avoid: 源码发布
- **dry-run 彩排**: npm pack 与 npm publish 的 dry-run 执行，只留证不产生真实发布与 tag

> 本文由 `graph export` 从 context 顶点 ctx_io 生成（节点即文档，图是真相源）。
