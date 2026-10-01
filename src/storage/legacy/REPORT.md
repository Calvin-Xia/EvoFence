# l5-legacy lane 完成回报

lane: l5-legacy

cp1: passed — `exportLegacy` 冻结 6 种输入：SQLite ledger v2、bundle v1、四类旧 YAML；未知版本返回 `EFK_PROTOCOL_UNSUPPORTED`，损坏/未知结构拒绝。`cp1 SQLite and bundle exports are stable and preserve raw payloads and recorded hashes`、`DoD1 unknown SQLite version is explicitly refused with no source writes` 通过。SQLite 仅打开私有临时 snapshot；不重算或改写旧 chain。

cp2: passed — 显式导入到 `evofence.legacy-source/1@1.0.0`，每条记录带原文件 digest/locator/格式、导入时间、导入器版本、historical-source 和 executable=false。六种格式分别导入、原源文件不存在后的离线读取、同输入重复导入、冲突拒绝均通过；重复导入保留首次时间。真实子进程在 fsync 后、发布前以 73 终止，仅留下一个 pending 文件；显式重试 imported，后续 duplicate，source/dist 摘要不变。

cp3: passed — 临时原件与其副本的 digest 前后相等，且副本目录无额外 sidecar；逐条原始 hash/payload 保持。breaking 对照和升级指南在 [README.md](README.md)，42 个对应组覆盖 17 个旧命令、共用 flags、四类 YAML 全部顶层字段组与 ledger 边界。实际 runtime codec、session 创建边界与 registry staging 拒绝历史归档，stores/registry 无状态变化。

门禁: build exit 0；typecheck exit 0；src:policy exit 0（240 TS、0 JS、最大 350 行）；dep:check exit 0（240 modules、927 edges、0 cycles）；两次 lane test 均 23 tests / 23 pass / 0 fail / 0 skipped / 0 cancelled；static-audit exit 0、0 violations（88 modules / 358 edges）。测试名称和负控结果两次一致。

未证明项: 无 marker 的 v1 不提供兼容读取；旧 GUI/外部 exporter/importer 完整覆盖未证明；旧 chain 密码学认证未做；断电、远程文件系统持久性和跨用户恶意竞态隔离未证明；没有新宿主激活或能力收益测量。这里只交付历史来源边界，不声称新版执行/晋升资格。

阻塞: 无。未发现需要修改冻结合同的 drift。分支 `refactor/hk-l5-legacy`、HEAD `d2e311df7b7fbf18c28c7c849126d3be3bd6f1cb`；9 个新 TS 模块、4 个新 lane test 文件，最大 lane 文件 179 行；tracked content 对基线无差异。没有 commit/install/.graph 操作或 core 改动，未读取或写入真实旧 ledger/config 状态。图 checkpoint/verdict/status 留给 orchestrator。

## DoD 真实负控

每个变异只通过子进程 loader 修改内存中的本次 build 模块；负控的源文件和 SQLite 都在测试新建的 temp 目录。没有变异写回 dist 或用户状态。

| DoD | 变异 | green exit/pass/fail | red exit/pass/fail | restored exit/pass/fail |
| --- | --- | --- | --- | --- |
| ① | 删除 SQLite 版本拒绝，实际接受 schema 999 | 0 / 1 / 0 | 1 / 0 / 1 | 0 / 1 / 0 |
| ① | 导出后实际回写临时副本，digest 改变 | 0 / 1 / 0 | 1 / 0 / 1 | 0 / 1 / 0 |
| ② | 把历史导入 record.executable 改为 true | 0 / 1 / 0 | 1 / 0 / 1 | 0 / 1 / 0 |
| ② | 删除 breaking 中 cli:doctor 项 | 0 / 1 / 0 | 1 / 0 / 1 | 0 / 1 / 0 |

## 可复查证据

- [summary.json](evidence/summary.json)：全部门禁、两次同名/同结果检查、原件前后摘要、实际终止恢复、输入格式和未证明项。
- [negative-controls.json](evidence/negative-controls.json)：真实变异位置与 green/red/restored 数字。
- [test-run-1.stdout.txt](evidence/test-run-1.stdout.txt)、[test-run-2.stdout.txt](evidence/test-run-2.stdout.txt)：完整 TAP，包括红例 AssertionError 和恢复后绿例；对应 stderr 文件均为空。
- [static-audit.json](evidence/static-audit.json)：完整 AST audit，violations=[]；未修改规则/allowlist。
- [scope.json](evidence/scope.json)：基线、分支、tracked diff、9 TS/4 tests 的 SHA-256 与行数；仅允许落点出现 untracked 产物。
- `evidence/{build,typecheck,src-policy,dep-check}.{stdout,stderr}.txt`：四项实际命令输出，stderr 均为空。

复验命令（在本 lane 执行，不 install）：

```powershell
npm run build
npm run typecheck
npm run src:policy
npm run dep:check
node --test --test-reporter=tap test/l5-legacy-*.test.js
node --test --test-reporter=tap test/l5-legacy-*.test.js
node verification/kernel/static-audit.mjs
```

只读格式/API 与 breaking 文档归档于 `src/storage/legacy/`。`evidence/` 包含本次临时夹具和静态检查结果，无真实 ledger/config、credentials 或 private holdout 原件。
