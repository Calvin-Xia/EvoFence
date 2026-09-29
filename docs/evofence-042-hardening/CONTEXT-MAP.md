# Context Map

> 本仓库有 3 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_cli（命令面域） | 负责 CLI 命令清单这一唯一 manifest、子命令处理器、帮助文本、JSON 输出与退出码契约，含本轮的报告格式选项、预检修复选项与预算外推视图；不负责宿 | 2 | contexts/ctx_cli.md |
| ctx_config（配置契约域） | 负责四类 .evofence YAML 文档的 schema、字段装配、校验与加载，配置面文档的单一真相，以及能力键的定性与值域校验；不负责能力判定在运行期的执 | 2 | contexts/ctx_config.md |
| ctx_host（宿主适配域） | 负责 5 个 agent 宿主的 plugin 与 extension 入口、三处路由入口（两个 marketplace 与项目级 pi 入口）、这些入口对 C | 2 | contexts/ctx_host.md |
