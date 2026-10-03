# L5 CLI 与宿主只读观测视图

> **本文件是 tracked 产品文档**（与 `L5-SDK-DELIVERY-AND-EXAMPLES.md` 同一口径，2026-10-03）：它描述 CLI 的公开输出面（七类字段 → 来源 → 命令 → 真实输出摘录），`test/l5-cli-views.test.js` 直接读取并重放其中的 `cli-recipe` 代码块，因此它**必须在干净检出中存在**——**不得**移回 gitignore 的 `execution/**`。
> 操作规则：L5 的**产品面文档**（SDK 交付文档、CLI 视图目录）tracked；其余过程记录（brief、dossier、evidence、日志）保持本地于 `execution/**`。新增任何要进产品面的文档需单独裁决，不得默认搬入。

lane：`l5-cli-obs`；基线：`6a0cc14`（已含 `l5_public_sdk`）。证据种类：**native-fixture**。

唯一入口登记在 `src/lib/cli/catalog.ts`：

`evofence session view <export> [--format <text|json|sarif|junit>] [--include-private] [--json]`

`--json` 成功时 stdout 只有视图 JSON。读取/用法失败时 stdout 为空，stderr 为单个 `{"error":{"code","message"}}`，退出 1；成功读取退出 0。查询退出 0 只表示读取成功，不把内部失败、unknown 或 inconclusive 改成任务成功。

`src/lib/report/kernel-view.ts::readKernelView` 是唯一投影。CLI 从显式 `evofence.review-export/1` JSON 恢复 memory journal，经 `createSessionService().open()/read()` 读取；Pi、DSH 的 `readSessionReview` 是同一函数的重导出。两处 binding 未改。`handlers/index.ts` 只增加这一条命令注册；它是新增命令必需的接线。

| 字段 | 真相来源 | 命令 |
| --- | --- | --- |
| `graph`, `revision`, `epoch` | 已 pin 的 SessionSeed GraphRef、SessionService.read journal 投影；graph 与 journal revision 分开 | `session view review.json --json` |
| `frontier.ready/blocked/unknown` | runtime `factsFor`、kernel scheduler `computeFrontier`；分类只在共用投影分组 | 同上 |
| `usage` | runtime BudgetLedger、kernel `budgetSnapshot`、已应用 Receipt.usage；保留预留/结算、未结身份及 estimate/invoice 区别 | 同上 |
| `requiredBranches` | GraphSpec.join.requiredBranches 与所有 attempt 终态；失败/取消不删 | 同上 |
| `effects.unknown/nextEffects` | 同一次 runtime read 的 unknownEffectIds/intents；intended 不声称已执行 | 同上 |
| `assets` | 调用方提供的 owning registry snapshot、`qualification` 查询、sourceTraces/版本/依赖/history；缺 context 显式 gap | 同上 |
| `waitingHuman` | journal 当前 waiting 与尚未结束的 human 节点 | 同上 |
| `decisions`, `gaps` | DecisionRecord.outcome/reasons；DecisionRecord 或 reasons 缺失时显示 gap，不补默认原因 | 同上 |

`frontier` 描述 scheduler 的 readiness 查询，不赋予 runtime dispatch 权限；暂停/取消仍保留在 `dispatchMode` / `cancellation` 中。fixture 的节点状态与 DecisionRecord 是固定合成证据，不能作为 provider 执行或能力收益证明。

CLI 源码断言解析 TypeScript AST，整个 `src/lib/cli/**` 的完整状态分类字符串字面量出现 0 次；TypeScript `unknown` 类型、说明性注释和既有错误消息不是分类规则。复制 `if (value === 'unknown') return 'failed'` 真实变异会使断言失败。

公开视图只选取结构化概要；不导出原始 effect payload、evaluator identity/version、artifact bytes/location、private artifact id。`--include-private` 仅显式增加证据引用元数据，仍不读取或复述 secret 内容；feedbackVisibility=private 的原因始终 withheld。凭据形状或敏感标记在公开字符串中成为 `[redacted]`。text 保留完整 JSON 字段；SARIF `runs[0].properties.review` 和 JUnit `system-out` 都载同一概要，JUnit unknown/取消/未终态记 skipped，不计通过。

导出 JSON 的必需顶层字段为 `version`, `seed`, `session`, `artifacts`, `registry`, `assetContext`, `decisionLinks`, `at`。`seed.graph` 是原 GraphSpec，其他字段是 SessionSeed 原值；`session` 是 EventStore.exportSession，`artifacts` 是 `{ref,bytes}` 数组。registry 与资格 context 必须由各自 owning service 提供；此传输格式仅作离线诊断，不赋予执行/恢复/晋升资格。CLI 不发现 cwd 祖先、全局配置、provider 或凭据。边界拒绝额外键、非法 wire schema、journal sequence 缺口、graph pin/内容摘要漂移。

下面的 fixture 命令创建的是合成证据，在 `os.tmpdir()` 建立并清理全部执行目录，无网络、Git、`.evofence` 或仓库外配置依赖：

```powershell
npm run build
node test/l5-cli-fixture.test.js --write-fixture "$env:TEMP/review.json"
node dist/cli.js session view "$env:TEMP/review.json" --json
node --test test/l5-cli-*.test.js
```

以下五条机器可读 recipe 由 `test/l5-cli-views.test.js` 原样复跑，使用同一 fixture 的真实子进程 stdout 核对摘录：

```json cli-recipe
{"args":["session","view","review.json","--json"],"exit":0,"contains":["\"revision\": 7","\"outstandingMicros\": 100","\"settledMicros\": 37","\"outcome\": \"inconclusive\""]}
```

```json cli-recipe
{"args":["session","view","review.json"],"exit":0,"contains":["EvoFence session review","\"requiredBranches\"","\"waitingHuman\"","\"asset-source-revoked\""]}
```

```json cli-recipe
{"args":["session","view","review.json","--format=sarif"],"exit":0,"contains":["\"version\": \"2.1.0\"","\"review\"","\"status\": \"unknown\""]}
```

```json cli-recipe
{"args":["session","view","review.json","--format=junit"],"exit":0,"contains":["failures=\"1\" skipped=\"6\"","<skipped message=\"unknown\"/>","<system-out>"]}
```

```json cli-recipe
{"args":["session","view","review.json","--json","--include-private"],"exit":0,"contains":["\"referencesOnly\": true","\"evidence\"","[redacted]"]}
```

五条真实负控在 `os.tmpdir()` 复制生产模块，变异源码并编译该模块，由独立子进程运行与主验收相同的断言；原实现 0 → 变异 1/AssertionError → 按保存的原字节复原、核对 SHA256 → 恢复 0。分别覆盖复制 CLI 分类、遗漏 unknown effect、unknown 改 succeeded、遗漏 failed 分支、移除 redaction。临时副本不改 lane 的生产源码或共享 dist，全部测试都执行负控，无 skip。

既有负结果如实承接：受控能力收益仍 **inconclusive**；attempt 1 **failed**。`747` / `943` USD 分歧未裁决，预注册设计包络 **938.470100 USD**，不得混同 fixture 的 37/100 micro-USD。`adr_0001` / `adr_0004` 仍 proposed，`dual-host-runtime-and-uplift` 不毕业。此视图不会内置或重新裁决历史结果，只保留输入 DecisionRecord 的原 outcome。

未证明：真实 Pi/DSH UI 面板渲染、真实人机等待项到达、provider-live 视图均 **unknown**。停止/撤销服务没有可用 DecisionRecord 时保留显式 gap，本节点不伪造记录。集成点为只读，完整构建/新测试应由 orchestrator 集成后复跑；lane 结果不能替代该复跑。

## 验证记录

所有日志位于本目录的 `l5-cli-observability-evidence/`。最终 `npm run check` 在 lane 基线 `6a0cc140f081cca1182c5d72d885f05d0abf720b` 上执行，未 commit / push / merge / tag / publish，未安装依赖。

| 检查 | 最终结果 | 原始证据 |
| --- | --- | --- |
| `npm run build` | exit 0；完整 check 与 E2E 也从源码重建 | `build.log`、`check.log`、`test-e2e.log` |
| `npm run typecheck` | exit 0 | `check.log` |
| `npm run src:policy` | exit 0；297 个 TS 文件，最长 350 行，src 中 0 个 JS | `check.log` |
| `npm run dep:check` | exit 0；297 modules / 1235 edges / 0 cycles | `check.log` |
| 新增 `node --test test/l5-cli-*.test.js` | 25/25，fail 0 / skipped 0；含两份无 test 声明的共享 helper 文件 | `l5-tests.log` |
| 既有 CLI manifest/smoke | 13/13，fail 0 / skipped 0 | `cli-surface.log` |
| 既有 report view | 21/21，fail 0 / skipped 0 | `report-view.log` |
| 既有 protocol / L4 revocation privacy | 22/22，fail 0 / skipped 0 | `protocol-privacy.log` |
| legacy checklist、plugin manifest、legacy 真负控与新增套件 | 48/48，fail 0 / skipped 0；日志内嵌的预期红 TAP 不代表外层失败 | `regressions.log` |
| `npm run test:e2e` | 24/24，fail 0 / skipped 0 | `test-e2e.log` |
| `npm run check`（含全部 `npm test`） | exit 0；1317/1317，fail 0 / cancelled 0 / skipped 0 | `check.log` |
| catalog `session view <export> --json` 真实子进程 | exit 0；stderr 0 bytes；graph revision 1 / journal revision 7 / unknown effects 2 | `smoke.log`、`smoke.stdout.json`、`smoke.stderr.txt` |

`l5-tests.log` 与 `integration-cwd-l5-tests.log` 均逐条记录五个负控：`original=0 mutation=1 restored=0`，并校验保存的原源码字节及 SHA256。没有删断言、放宽既有隐私断言或 skip。最初全门禁的 3 个失败及原输出保存在 `check-initial.log`，最终结果只引用 `check.log`。

为容纳 catalog 的新增 native 命令，只调整三处既有测试的事实假设：CLI smoke 提供真实 export；plugin allowlist 明确共享 Pi/DSH 只读导出；旧数据 checklist 只约束 legacy 命令，并新增双向精确清单匹配以防旧命令被删除或改标。旧 storage/runtime 代码、旧 flags、已有负控及 L4 privacy 断言不变。host index 仅追加同一函数的重导出。`handlers/index.ts` 的两行新增属于新 sibling handler 必需接线。

### 只读集成点的边界

在集成点 cwd 运行绝对路径 lane 测试，结果也是 **25/25，fail 0 / skipped 0**；它仍加载 lane 的 source/dist，证明新测试不依赖 cwd，**不等于集成源码验收**。命令：

```powershell
node --test 'C:/Users/Calvin-Xia/EvoFence-wt/harness-kernel/l5-cli-obs/test/l5-cli-*.test.js'
```

集成点只读的 typecheck / src:policy / dep:check 均 exit 0（295 TS modules / 1213 edges / 0 cycles）；对应 `integration-typecheck.log`、`integration-src-policy.log`、`integration-dep-check.log`。集成 HEAD 在执行期间由其他工作推进至 `a4971ac8b2e8aeeb582a54ecc141ecae354248a7`，这些只读检查针对该 HEAD；本 lane HEAD 未变。集成点 status 保持既有 `?? experiments/`。

真正集成后的 build / 全 suite / E2E 尚未执行，必须由 orchestrator 合入本 lane 后复跑；本任务的“集成点只读”授权不能通过写其 dist 或修改源码来完成这部分。没有据 lane 的绿结果将其标成 passed。

### 上游 export 问题（未修）

真实 `planRound` + memory store 对含 required join 的图可生成 `node.transition` 的 `changedIds=["join","join"]`；wire Event schema 要求 uniqueItems，因此 `decode('Event', event)` 与 CLI 严格导入都得到 `EFK_SCHEMA_INVALID`。原始复现保存在 `upstream-join-export.log`：

```json
{"source":"unmodified runtime planRound + memory store","errors":[{"index":2,"type":"node.transition","changedIds":["join","join"],"code":"EFK_SCHEMA_INVALID"}]}
{"reviewRejectedWith":"EFK_SCHEMA_INVALID","producerSourceUnmodified":true}
```

以下 PowerShell 在 lane cwd 复现 producer/codec 缺口，无源码变异：

```powershell
@'
import { harness, value, node, graph } from './test/l2-runtime-support.test.js';
import { edge } from './test/l2-scheduler-fixtures.mjs';
import { decode } from './dist/protocol/index.js';
const f = harness({ spec: graph({ nodes: [node('branch', { terminal: true }),
  node('join', { kind: 'join', terminal: true, requiredBranches: ['branch'] })],
  requiredJoins: ['join'], typedEdges: [edge('into-join', 'dependency', 'branch', 'join')] }) });
f.planOnly();
const exported = value(f.store.exportSession(f.seed.sessionId));
console.log(JSON.stringify(exported.events.flatMap((event, index) => {
  const result = decode('Event', event);
  return result.ok ? [] : [{ index, type: event.type, changedIds: event.payload.changedIds, code: result.error.code }];
})));
'@ | node --input-type=module
```

本 lane 未修改只读 runtime/kernel，未去重输入或放宽 schema。符合 wire schema 的 export 可读；上述 producer 生成的非法 export 仍被拒绝，需 runtime owning lane 修复。正控 fixture 保留 planner 生成的合法分支事件，另显式构造合法 join transition；不是完整 provider/live 导出证明。

### 文档和证据交接

brief 指定的本文件及 evidence 目录在 Git ignore 下，须由 orchestrator 单独转交，不能仅靠常规 diff/commit 取得。基线 `6a0cc14` 的既有 SDK 测试还引用缺失的 ignored 文档；只读复制 `l5-sdk/docs/evofence-harness-kernel/execution/L5-SDK-DELIVERY-AND-EXAMPLES.md` 到 lane 同路径，两者 SHA256 均为 `9C6AEBEA5402FDC466263D90F831EF3F2D2BE7FD5D447464504554288A6EBE55`，未修改 SDK 测试或产品代码。集成后续 `42dddb2` / `a4971ac` 已由 owning lane 将该依赖迁到 tracked SDK product doc，本 lane 未 cherry-pick 或冒充已含这些提交。

`VALIDATION.json` 保存 lane / integration HEAD、交付文件 SHA256、日志结果及未证明项，便于交接时核对。受控收益仍 inconclusive；宿主 UI、真实人机等待、provider-live 为 unknown；本节点不令雾区毕业。
