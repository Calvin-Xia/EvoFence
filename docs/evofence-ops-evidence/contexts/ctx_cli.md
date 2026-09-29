# 命令面域（ctx_cli）

负责 CLI 命令清单（src/lib/cli/catalog.ts 单一 manifest）、子命令 handler、help 与 --json 与退出码契约，以及每个命令的输入输出形状；不负责判定逻辑本身（预算判定由 ctx_budget 提供，配置校验与文档契约由 ctx_config 提供），不负责账本链校验实现（由 ctx_ledger 提供）。

## 术语表

- **命令面契约**: 一个子命令在 catalog manifest 中声明的 usage、flags、positionals、exits 与 smoke invocation 的合集，是 CLI 表面与帮助文本的唯一真相。Avoid: 手写帮助、第二份命令清单
- **只读预检**: 不改变仓库与账本状态的诊断性命令；其结论必须来自既有判定函数的调用，而不是重新实现一套规则。Avoid: 体检脚本自带规则、会写状态的诊断

> 本文由 `graph export` 从 context 顶点 ctx_cli 生成（节点即文档，图是真相源）。
