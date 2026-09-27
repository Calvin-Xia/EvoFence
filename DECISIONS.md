# DECISIONS

> 决议一行索引（由 `graph export` 从图顶点生成）：passed 的 task 节点 + accepted/superseded 的 ADR。
> 图为真相源，本文件是视图；改图不改文，重新导出即覆盖。

| 决议 | id | 标题 | 结论时间 |
|------|----|------|---------|
| ADR · accepted | adr_0001 | ledger schema v2 破坏性变更且不提供迁移 | 2026-09-27T06:23:08.460Z |
| ADR · accepted | adr_0002 | 发行形态：仅发布 dist 构建产物与类型声明 | 2026-09-27T06:23:08.912Z |
| ADR · accepted | adr_0003 | CLI 命令面重设计：命令分组与 --json 契约可破坏性调整 | 2026-09-27T06:23:09.322Z |
| ADR · accepted | adr_0004 | TS 测试执行策略：编译后运行构建产物 | 2026-09-27T06:23:09.804Z |
| ADR · accepted | adr_0005 | 模块依赖方向：类型契约层在最底层，单向依赖无环 | 2026-09-27T06:23:10.279Z |
| task · passed | l1_base | TS 构建基座 | 2026-09-27T06:35:55.990Z |
| task · passed | l1_design | 拓扑定稿与人审通过 | 2026-09-27T06:35:49.428Z |
| task · passed | l1_dispatch | herdr 派单机制就绪 | 2026-09-27T06:48:10.070Z |
| task · passed | l1_recon | 项目识别与实现盘点 | 2026-09-27T06:35:42.216Z |
| task · passed | l2_cli | CLI 命令面重设计 | 2026-09-27T07:52:51.192Z |
| task · passed | l2_config | config v2 校验与 fail-closed | 2026-09-27T07:11:14.784Z |
| task · passed | l2_exec | 执行域模块化 | 2026-09-27T07:11:08.921Z |
| task · passed | l2_gate | 门禁域模块化 | 2026-09-27T07:11:02.559Z |
| task · passed | l2_ledger | ledger v2 schema 与哈希链内核 | 2026-09-27T07:10:56.070Z |
| task · passed | l2_report | 报告/状态/审计视图模块化 | 2026-09-27T07:31:56.775Z |
| task · passed | l2_types | 共享类型契约层 | 2026-09-27T06:45:37.956Z |
| task · passed | l3_integrations | 集成消费方对齐 | 2026-09-27T08:19:15.061Z |
| task · passed | l3_tests_e2e | 端到端 CLI 冒烟与退出码断言 | 2026-09-27T08:25:18.993Z |
| task · passed | l3_tests_unit | 单元测试迁移与补强 | 2026-09-27T08:21:36.894Z |
| task · passed | l4_ci | CI 流水线升级 | 2026-09-27T08:30:40.345Z |
| task · passed | l4_docs | 文档同步与 BREAKING 说明 | 2026-09-27T08:32:48.217Z |
| task · passed | l4_release | 发布流水线就绪与 dry-run 彩排 | 2026-09-27T08:38:55.780Z |
| task · passed | l5_accept | 终局验收收口 | 2026-09-27T09:27:23.325Z |
| task · passed | l5_review | 独立交叉复核 | 2026-09-27T09:25:24.698Z |
