# Context Map

> 本仓库有 4 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_budget（预算判定域） | 负责 token 与 USD 预算的记账口径、阈值终止语义与用量完整性判定；不负责 agent 进程编排与适配器 argv 构造，不负责账本事件写入实现（由 c | 2 | contexts/ctx_budget.md |
| ctx_cli（命令面域） | 负责 CLI 命令清单（src/lib/cli/catalog.ts 单一 manifest）、子命令 handler、help 与 --json 与退出码契约 | 2 | contexts/ctx_cli.md |
| ctx_config（配置契约域） | 负责四类 YAML 文档的 schema、校验、加载与配置面文档的单一真相；不负责预算运行时判定（由 ctx_budget 判定），不负责命令面输出形状（由 c | 2 | contexts/ctx_config.md |
| ctx_ledger（账本完整性域） | 负责 sha256 哈希链配方、事件读写、导出 bundle 形态与完整性校验；不负责命令面输出形状（由 ctx_cli 呈现），不负责预算判定（由 ctx_b | 2 | contexts/ctx_ledger.md |
