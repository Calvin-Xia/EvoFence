# Context Map

> 本仓库有 5 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_exec（执行编排域） | 负责执行编排：候选变更的运行调度、适配器接入、子进程管理、git worktree 隔离与预算记账；不负责门禁判定逻辑（经 ctx_gate 判定入口调用）、账 | 3 | docs/contexts/ctx_exec.md |
| ctx_ext（集成与扩展消费域） | 负责集成与扩展消费面：integrations 下各适配器、仓库自带的 pi 扩展加载面与 herdr 派单执行面（pane 与 worktree 的对应关系） | 3 | docs/contexts/ctx_ext.md |
| ctx_gate（门禁判定域） | 负责 contract、evidence、policy、budget、isolation 各判定面的判定逻辑与 fail-closed 判定语义（输入缺失或不可 | 3 | docs/contexts/ctx_gate.md |
| ctx_io（配置与对外产物域） | 负责配置与对外产物表面：config 格式与解析、CLI 命令面、报告/状态/审计视图、共享类型契约层、构建产物（dist 与类型声明）、文档发布面，以及这些表 | 4 | docs/contexts/ctx_io.md |
| ctx_ledger（审计账本域） | 负责审计账本与哈希链内核：ledger 记录的 schema、sha256 的 prev/hash 链式校验与 fail-closed 校验语义；不负责执行与判 | 3 | docs/contexts/ctx_ledger.md |
