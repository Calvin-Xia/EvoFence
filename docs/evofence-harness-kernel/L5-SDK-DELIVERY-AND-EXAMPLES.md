# L5 SDK 交付与嵌入样例（r2）

> **本文件是 tracked 产品文档**（用户裁决 2026-10-03，方案 C）：从 `docs/evofence-harness-kernel/execution/` 移出，随 PR / 发布交付。`test/l5-sdk-surface.test.js` 直接读取并校验本文件，所以它**必须在干净检出中存在**——**不得**再移回 gitignore 的 `execution/**`，也不得让任何 CI 会跑到的测试依赖被 gitignore 的路径（该缺陷曾让 6a0cc14 在 CI 上 8/8 全红：干净检出里文档不存在，`readFileSync` ENOENT）。
>
> **口径**：L5 的**产品面文档**（本文档、`L5-CLI-OBSERVABILITY-VIEWS.md`）tracked；其余过程记录（brief、dossier、evidence、日志）保持本地于 `execution/**`。新增任何要进产品面的文档需单独裁决，不得默认搬入。

lane: `l5-sdk`；分支 `refactor/hk-l5-sdk`；基线 `6283ca3330b279f080b3c7c8412b4b8728eb07dc`；证据级别 `native-fixture`。

本轮按 `L5-public_sdk-brief-r2.md` 收窄：发布现有生产 `SessionService` 的 typed subpaths 与纯 barrel，三种 HostPort 使用同一公开 core 入口完成非代码图任务。`createKernel(ports): KernelService` 留作规范 finding，本节点不实现该接口；首轮的同名别名与相应红断言已移除。既有 core guard 只做手动诊断，不进入 check、npm test 或 CI；39 条 I08 保留为发现，不改既有生产代码或 guard。

本 lane 最终结论：**cp1 passed / cp2 passed / cp3 passed**（按 r2）；五项门禁全绿，阻塞无。该结论不表示既有 guard 的39条发现已修复，也不表示未来 KernelService 或集成点合并后复跑已完成。

**集成点复跑（本文件转为 tracked 后由 orchestrator 在 `C:/Users/Calvin-Xia/.codex/worktrees/72a4/EvoFence` 实测，2026-10-03）**：`build` / `typecheck` / `src:policy` / `dep:check` 均 exit 0；全量 `node --test` = **1312 tests / 1309 pass / 0 fail / 3 skipped**（3 条 skip 为 DSH 原生包缺失的 provider-live 场景，属既有测试面）；`node verification/kernel/static-audit.mjs` = `passed`，**90 modules / 371 entries / 0 violations**。差别说明：集成点比本 lane 多发现 `experiments/capability/check.test.mjs` 的 20 例（L4 试验产物，未跟踪、不进 PR 面），故 1292 → 1312；下文 §门禁表中标注「lane 环境」的数字来自本 lane，集成点数字以本段为准。

## 导入面与职责

`types` 指向同次构建的 .d.ts，`default` 指向对应 ESM .js；`./core` 与 `./runtime` 共享入口。域 namespace 保留现有合同，避免同名导出冲突。

| subpath | import 语句 | 职责 |
|---|---|---|
| `.` | `import * as legacy from 'evofence';` | 既有 Git/CLI/ledger facade，保留原实现和依赖。 |
| `./core` | `import { createSessionService as createCoreSession, hostPort } from 'evofence/core';` | 现有生产会话服务及纯域 namespace；构造不调用端口。 |
| `./protocol` | `import { decode, DEFS } from 'evofence/protocol';` | 冻结 wire schema、codec、版本与错误封套。 |
| `./kernel` | `import { graph, policy, evaluation, store } from 'evofence/kernel';` | 图、权限预算、调度、store ports、工件准入与评价纯规则。 |
| `./runtime` | `import { createSessionService, session, workspace } from 'evofence/runtime';` | 会话、HostPort 与 workspace 规则，无默认 backend。 |
| `./hosts/pi` | `import { bindPiSession, PI_VERSION } from 'evofence/hosts/pi';` | 接收已有 Pi 原生 session 与 hooks 的 binding。 |
| `./hosts/dsh` | `import { createDshBinding } from 'evofence/hosts/dsh';` | 接收 DSH 原生 composition 的 binding。 |
| `./storage/memory` | `import { createMemoryEventStore, createMemoryArtifactStore } from 'evofence/storage/memory';` | 显式选用的内存 reference stores，不承诺磁盘耐久性。 |

core 闭包只含 protocol/kernel/runtime；memory stores 与 host binding 从各自 subpath 消费。`files`、`version`、旧 root 和既有生产模块未改。安装依赖/发布打包划分由 release lane 核验。

## 三种宿主的共同生产调用

复制下面完整片段到安装本包的项目，保存为 `sdk-example.mjs`。PowerShell 分别运行 `$env:SDK_HOST='pi'; node sdk-example.mjs`、`$env:SDK_HOST='dsh'; node sdk-example.mjs`、`$env:SDK_HOST='fake'; node sdk-example.mjs`。

Pi/DSH 使用显式注入的 fixture HostPort；generic fake 消费实际 `hostPort.createFakeHost` 实现。三者通过 `evofence/core` 的 `createSessionService` 调用真实生产 create/step/read/evaluate 路径，runtime 对权限、预算、回执与评价绑定做实际判断并写 journal。没有复制 SessionService 或替换其实现。EvaluatorPort 是本非代码任务的 byte-comparison fixture，宿主与评测观测不属于 provider-live。

输入是生成内存 Note 工件的单节点图；workspaceRef/actualDiffRef 均 null，代码任务无需进入此路径。相同 seed/ports 字段/服务方法适用于三种 HostPort。SHA-256 在应用层显式注入；fixture usage 是已知 synthetic 0，缺失用量不补零。返回实际 `CommandOutcome`，`DecisionRecord` 从 journal 的 decision.recorded 工件引用读取；不宣称具有未来 CommandResult 返回面。

```js sdk-example
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSessionService, hostPort } from 'evofence/core';
import { graph, policy, store } from 'evofence/kernel';
import { DEFS, decode, CURRENT_SCHEMA_VERSION, RUNTIME_NAMESPACE } from 'evofence/protocol';
import { createMemoryEventStore, createMemoryArtifactStore } from 'evofence/storage/memory';

const hostKind = process.env.SDK_HOST;
assert.ok(['pi', 'dsh', 'fake'].includes(hostKind));
const protocol = { namespace: RUNTIME_NAMESPACE, schemaVersion: CURRENT_SCHEMA_VERSION };
const digest = { digest: bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
const clock = { now: () => 1000 };
const actor = (actorId, kind) => ({ actorId, kind, identityRef: null });
const kernelActor = actor('kernel', 'kernel');
const issuer = actor('sdk-evaluator', 'evaluator');
const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const artifacts = createMemoryArtifactStore({ digest });
const schema = name => ({ name, version: CURRENT_SCHEMA_VERSION,
  digest: digest.digest(store.canonical(DEFS[name] ?? { name })) });
function put(id, name, object, binding = null, producer = kernelActor) {
  const bytes = store.canonical(object);
  const ref = { protocol, id, digest: digest.digest(bytes), producer, binding,
    schema: schema(name), location: `fixture:${id}`, visibility: 'internal',
    expiresAt: null, partition: 'not-evaluation' };
  value(artifacts.put(ref, bytes));
  return ref;
}
const taskRef = { taskId: 'sdk-note', version: 1, digest: digest.digest('produce a non-code note') };
const node = { nodeId: 'note', kind: 'agent', inputRefs: [], outputSchemas: [schema('Note')], loop: null, subgraph: null,
  contextPlan: { inputRefs: [], maxTokens: 128, preserveHostResources: true, isolation: 'current' },
  toolRequirements: [], modelRequirements: { providerModel: null, reasoningRequested: null,
    reasoningGuarantee: 'payload-only', payloadRef: null }, resources: { exclusive: [], shared: [] },
  termination: { maxAttempts: 1, maxActiveWallMs: 5000, cancelMode: 'stop-and-confirm',
    unknownPolicy: 'reconcile', excludeHumanWait: true }, terminal: true, requiredBranches: [] };
const spec = { protocol, graphId: 'sdk-graph', revision: 1, taskContractRef: taskRef, nodes: [node],
  typedEdges: [], requiredJoins: [], resourcePolicy: [], abandonedBranches: [],
  graphLimits: { maxNodes: 1, maxConcurrentAgents: 1, maxDepth: 1, maxAttempts: 1 } };
const compiled = graph.compileGraph(spec);
assert.equal(compiled.ok, true, JSON.stringify(compiled.error));
const budget = { poolId: 'sdk-pool', category: 'development', authorizationRef: null, maxRequests: 1,
  maxInputTokens: 128, maxOutputTokens: 128, maxUsdMicros: 100, maxWallMs: 5000,
  maxConcurrentRequests: 1, priceRef: put('synthetic-price', 'PriceTable', { synthetic: true }),
  missingUsagePolicy: 'retain-reservation' };
const scope = { workspaceRef: null, readResources: [], writeResources: [], artifactScopes: [], trustDomain: 'same-user' };
const rootGrant = { grantId: 'sdk-root', rootAuthorityRef: 'sdk-root', parentGrantRef: null,
  actor: actor('fixture-user', 'human'), sessionId: 'sdk-session', nodeIds: ['note'], scope,
  capabilities: ['host.agent'], maxDelegationDepth: 1, expiresAt: 10000,
  revocationEpoch: 0, approvalRef: null };
const grant = { grantId: 'sdk-grant', rootAuthorityRef: rootGrant.grantId, scope, budget,
  issuedEpoch: 1, expiresAt: 10000, remainingDepth: 1, maxConcurrency: 1, revocationEpoch: 0, revoked: false };
const seed = { sessionId: rootGrant.sessionId, graph: compiled.graph,
  graphRef: { graphId: spec.graphId, revision: 1, digest: digest.digest(store.canonical(spec)) },
  policy: budget, reservePerRequest: 100, grants: [grant], operations: { note: { kind: 'host.agent',
    inputRefs: [], payload: { context: node.contextPlan, toolName: null, argumentsRef: null,
      graphRef: null, targetIds: [], assetRef: null, previousSnapshot: null, deliveryGuarantee: 'none' } } } };
const strength = { status: 'partial', coverage: [], evidenceRefs: [] };
const script = { usage: {}, artifacts: {} };
const usageFor = effect => [{ requestId: effect.reservationRef, source: 'synthetic', inputUncached: 0,
  cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0,
  estimatedUsdMicros: 0, invoiceUsdMicros: null, complete: true, evidenceRefs: [] }];
function prepare(effect) {
  script.usage[effect.effectId] = usageFor(effect);
  script.artifacts[effect.effectId] = [put('note-product', 'Note', { text: 'SDK non-code note' }, effect.binding)];
}
function fixturePort(host) {
  const unsupported = () => Promise.resolve(store.storeFail('EFK_CAPABILITY_UNSUPPORTED', 'outside this fixture scenario'));
  return {
    observe: async () => store.storeOk({ host, idle: true, capabilities: hostPort.PI_CAPABILITIES,
      cancellation: strength, recovery: strength, isolation: strength, boardOwners: [] }),
    execute: async authorized => {
      const effect = authorized.effect;
      prepare(effect);
      return store.storeOk({ protocol, receiptId: `receipt:${effect.effectId}`, effectId: effect.effectId,
        hostInvocationId: `fixture:${effect.effectId}`, binding: effect.binding, status: 'completed',
        artifactRefs: script.artifacts[effect.effectId], usage: script.usage[effect.effectId],
        observability: ['native-fixture'], error: null });
    }, cancel: unsupported, reconcile: unsupported, context: unsupported, usage: unsupported,
  };
}
const fake = hostPort.createFakeHost({ host: 'generic-fake', clock, capabilities: hostPort.PI_CAPABILITIES,
  cancellation: strength, recovery: strength, isolation: strength, script });
const suppliedHost = hostKind === 'fake' ? { ...fake, execute: async authorized => {
  prepare(authorized.effect); return fake.execute(authorized);
} } : fixturePort(`${hostKind}-fixture`);
let hostCalls = 0;
const host = { ...suppliedHost, execute: async authorized => { hostCalls++; return suppliedHost.execute(authorized); } };
const evaluator = { issuer, evaluateTask: async (_seed, state, receipt) => {
  const product = JSON.parse(value(artifacts.get(receipt.artifactRefs[0])));
  const passed = product.text === 'SDK non-code note';
  const receiptRef = state.events.find(e => e.type === 'receipt.applied'
    && e.payload.objectRef.id === receipt.receiptId).payload.objectRef;
  const report = { contractRef: taskRef, binding: receipt.binding, privateTestsPassed: passed,
    requiredOutcomesMet: passed, branchReport: [], artifactRefs: receipt.artifactRefs,
    actualDiffRef: null, runStatus: 'completed', usageComplete: true, privacyChecked: true };
  const taskEvidenceRef = put('note-evidence', 'TaskEvidenceReport', report, receipt.binding, issuer);
  return store.storeOk(value(decode('DecisionRecord', { protocol, decisionId: 'note-decision', kind: 'task',
    inputs: [receiptRef], contractRef: taskRef, taskEvidenceRef, evaluationReceiptRef: null,
    activationReceiptRef: null, evaluatorVersion: 'fixture/1', evaluationProtocolRef: null,
    outcome: passed ? 'completed' : 'failed', reasons: ['fixture-byte-comparison'], evidenceRefs: [taskEvidenceRef],
    feedbackVisibility: 'internal', issuer, capabilityJudgement: null })));
} };
const ports = { store: createMemoryEventStore({ digest }), artifacts, host, clock, digest, evaluator,
  policy: { inspect: (_seed, n, _binding, at) => ({
    policy: { policyId: 'sdk-policy', evolutionMode: 'optional', evolutionCapabilities: [],
      requireTrustDomain: 'same-user', requireCompleteUsage: true },
    authority: policy.deriveAuthority({ now: at, revokedEpoch: 0, root: rootGrant, parent: rootGrant,
      task: scope, node: { nodeId: n.nodeId, scope, capabilities: ['host.agent'] } }),
    negotiation: store.storeOk({ status: 'executable', taskDigest: taskRef.digest, manifestDigest: taskRef.digest,
      satisfied: [], gaps: [], selectedAlternatives: [], approvalRefs: [] }),
  }), resume: () => store.storeOk(undefined) },
  leaseTtlMs: 5000, effectTtlMs: 5000, maxConcurrentAgents: 1, depth: 0, maxDepth: 1 };
const service = createSessionService(ports);
value(service.create({ ...seed, epoch: 1, protocol }));
const step = value(await service.step(seed.sessionId));
assert.equal(step.dispatchAttempted.length, 1);
assert.equal(value(service.read(seed.sessionId)).nodeStates.at(-1).state, 'verifying');
const effectId = step.dispatchAttempted[0];
const commandOutcome = value(await service.evaluate(seed.sessionId, effectId));
const state = value(service.read(seed.sessionId));
const decisionRef = state.events.find(e => e.type === 'decision.recorded').payload.objectRef;
const decision = value(decode('DecisionRecord', JSON.parse(value(artifacts.get(decisionRef)))));
assert.equal(state.nodeStates.at(-1).state, 'succeeded');
console.log(JSON.stringify({ hostKind, evidenceKind: 'native-fixture', returnType: 'CommandOutcome',
  commandOutcome, decisionRefSource: 'journal.decision.recorded', decisionRef,
  decision, nodeState: state.nodeStates.at(-1).state, hostCalls,
  methods: Object.keys(service).sort(), portFields: Object.keys(ports).sort() }));
```

`test/l5-sdk-surface.test.js` 提取并原样执行片段，三次分别注入 pi/dsh/fake。每次在 os.tmpdir() 下新建空目录，前后均为空；PATH 仅指向该空目录。测试 preload 只把实际 package exports 映射为已构建文件，并 trap child_process 的 exec/execFile/spawn/fork 及同步变体，零调用才允许 exit 0；样例没有 CLI/Git 仓库或网络依赖。测试启动 Node 子进程是验收执行器，不是宿主样例启动 CLI。

## 当前核验记录

环境：Node v24.12.0，npm 11.17.0；以下实际命令均在本 lane 执行。cp1 的 guard 差异是 r2 指定的手动诊断证据，不作为通过全部 I01–I08 的声明。

| 检查 | 实际命令 | 实测结果 |
|---|---|---|
| SDK 分片 | `node --test test/l5-sdk-*.test.js` | exit 0；13 tests / 13 pass / 0 fail / 0 skip。 |
| SQLite 隔离、构造零 I/O | `node --test --test-name-pattern='public core import leaves SQLite' test/l5-sdk-surface.test.js` | exit 0；SQLite module graph/cache/native load 全0；portCalls=0；实际生产 service 在加载记录中。 |
| Pi fixture | `node --test --test-name-pattern='cp2: pi fixture' test/l5-sdk-surface.test.js` | exit 0；revision=6；decision=completed；nodeState=succeeded；hostCalls=1；CLI调用0；前后目录为空。 |
| DSH fixture | `node --test --test-name-pattern='cp2: dsh fixture' test/l5-sdk-surface.test.js` | 同上，host=dsh。 |
| generic fake | `node --test --test-name-pattern='cp2: fake fixture' test/l5-sdk-surface.test.js` | 同上，host=fake；真实 createFakeHost.execute。 |
| build | `npm run build` | exit 0；dist/kernel/index.js、dist/runtime/index.js 及全部声明存在。 |
| typecheck | `npm run typecheck` | exit 0。 |
| source policy | `npm run src:policy` | exit 0；295 TypeScript files；最大350行；0 JavaScript。 |
| dependency check | `npm run dep:check` | exit 0；295 modules / 1213 edges / cycles 0。 |
| project gate + 全量 test | `npm run check` | lane 环境：exit 0；真实 npm test 构建后全量1292 tests / 1292 pass / 0 fail / 0 cancelled / 0 skipped。**集成点权威数字见文首「集成点复跑」段（1312 / 1309 pass / 0 fail / 3 skipped）。** |
| static audit | `node verification/kernel/static-audit.mjs` | exit 0；90 modules / 371 entries / 0 violations；未改 frozen allowlist。 |

每个公开 subpath 的表内 import 均由子进程实际执行，测试读取 package.json 逐条核对 exports/default/types；现有 SessionPorts/SessionService 与各 host/storage 公开声明也通过 TypeScript 编译。每个非代码样例逐项检查实际 DecisionRecord、succeeded 状态、hostCalls=1，三份的服务方法集合与 ports 字段集合相同。

### 依赖隔离与零 I/O 的运行时证据

隔离测试在全新子进程动态 `import('evofence/core')`，先 trap process.dlopen，再用 module.register 的 load hook 记录实际加载 URL，通过 MessageChannel 取回完整记录；同时用 createRequire 检查 CommonJS require.cache。loader 的 hook 不替代业务模块，所有加载都委托原 Node loader。异步 ESM hook 无法覆盖的 CommonJS 内部 require 由 require.cache 检查补充。

```json
{"nativeLoads":0,"portCalls":0,"sqliteCachedModules":0,"sqliteModuleGraphEntries":0,"productionServiceLoaded":true,"tracedModules":84}
```

该结果不是只查源码 import：模块图中无 better-sqlite3/node:sqlite/.node，cache 中无 better-sqlite3，native trap 未触发；构造时注入的所有函数/构造端口 spy 零调用。随后三份样例调用实际生产服务，取得如下实测 stdout 摘录（完整输出含 CommandOutcome、ArtifactRef、DecisionRecord、methods 与 portFields）：

```json
{"host":"pi","revision":6,"decision":"completed","nodeState":"succeeded","hostCalls":1,"emptyDirectoryAfter":true,"cliCalls":0}
{"host":"dsh","revision":6,"decision":"completed","nodeState":"succeeded","hostCalls":1,"emptyDirectoryAfter":true,"cliCalls":0}
{"host":"fake","revision":6,"decision":"completed","nodeState":"succeeded","hostCalls":1,"emptyDirectoryAfter":true,"cliCalls":0}
```

### 本轮真实负控与复原

本轮三个控制均保存原文件 Buffer，在 finally 写回原 bytes、核 SHA-256，并复跑同一个命令；不是只用 grep 或期望值替换。

1. **SQLite 包导入**：在授权新增的 kernel barrel 临时增加 `export {default as sdkSqliteMutation} from 'better-sqlite3'`（附无类型声明的 @ts-expect-error），运行 `node node_modules/typescript/bin/tsc` 后复跑 SQLite 隔离测试。没有打开数据库，仍被 `SQLite package entered require.cache` 精确拒绝。这证明检测并不只依赖 dlopen。source 复原后重新构建并复绿，barrel SHA-256 为 `52ee98f372f272fa180505e5f31884c5ddfc2556635d21bda843f433c0299af1`。
2. **不存在的文档 subpath**：把表内 core import 临时改成 `evofence/core/kernel`，复跑 `node --test --test-name-pattern='documentation imports exactly' test/l5-sdk-surface.test.js`，必须因不存在的 subpath 与 exports 不一致而失败，随后字节复原并复绿。
3. **旧 facade**：把可执行片段的工厂 import/调用临时改为旧 root 的 `runEvolution({cwd:process.cwd(),adapter:'pi'})`，复跑 Pi 样例。旧路径尝试 child_process，被样例的零 CLI 约束精确拒绝；复原后生产 SessionService 路径恢复成功。另有保留的 standalone 旧 runner 负控在空目录实际复现 Git repository 错误。

```text
SQLite-module green: exit=0
SQLite-module red: exit=1; imported CJS package detected without opening a database
SQLite-module restored: exit=0
document-subpath green: exit=0
document-subpath red: exit=1; nonexistent subpath
document-subpath restored: exit=0
legacy-example green: exit=0
legacy-example red: exit=1; legacy path attempted child_process; sample requires zero CLI calls
legacy-example restored: exit=0
```

文档在两轮变异前后 SHA-256 均为 `31446591a1b2cd634746aa34c568d5550748df369054249a20f994542ef59dd4`；本节补记发生在复原之后。首轮的 native constructor 变异也已做0→1→0，精确触发 native addon loaded；r2 增加了只导入包的更早检测。

## 既有发现（本节点不修）

### 诊断 guard 的前后对照

手动运行 `node scripts/check-core-imports.mjs`；它的 exit 1 按 r2 不阻塞 cp1/check。首轮在该 lane 实测补 barrel 前为 `2 x I01/ENTRY_REQUIRED`（88 files）；补后入口违规为 `0 x I01`，继续分析既有代码时暴露 `39 x I08`（90 files）。原 guard 的 lexical-port-flow-and-defaults 静态传播按 r2 作为 best-effort 发现口径保留；输出标签本身仍为 lexical-port-flow-and-defaults。guard 在 source 阶段退出，没有因此证明完整 I06/I07。

本轮为前后对照暂时移走两个本 lane 新建 barrel 的内容、运行原 guard，随后 finally 按原 Buffer 写回并核 hash；之后再跑完整 guard。没有改其他源码或 guard。输出如下：

```text
before: files=88 stage=roots exit=1 violations=2; I01/ENTRY_REQUIRED x2
after:  files=90 stage=source exit=1 violations=39; I01 x0 / I08 x39
I08/PORT_PARAMETER_DEFAULT x5
I08/PORT_CONDITIONAL_DEFAULT x8
I08/PORT_REPLACEMENT x13
I08/PORT_FALLBACK x13
```

实际 stdout/stderr 归并为以下13个文件；r2 文本对位置的简写不能替代真实输出：

| 既有源码位置 | I08 数 |
|---|---|
| src/protocol/errors.ts | 1 |
| src/kernel/evaluation/service.ts | 1 |
| src/kernel/graph/predicate.ts | 1 |
| src/kernel/graph/readiness.ts | 2 |
| src/kernel/policy/budget.ts | 1 |
| src/kernel/policy/risk.ts | 1 |
| src/kernel/scheduler/dispatch.ts | 3 |
| src/kernel/scheduler/fairness.ts | 5 |
| src/kernel/store/contracts.ts | 1 |
| src/kernel/store/projection.ts | 5 |
| src/runtime/session/journal.ts | 2 |
| src/runtime/session/project.ts | 8 |
| src/runtime/session/service.ts | 8 |
| 合计 | 39 |

这些位置属于 L2/L3 已 passed 节点的既有代码，不是新 barrel 的实现代码。该检查的 scalar/capability 静态传播发现按 r2 记录，既有语义未被本轮修改；本 lane 不拥有这些模块或 guard，因此不修，不过滤输出、不放宽规则。复现命令仍是 `node scripts/check-core-imports.mjs`。`check:core-imports` 仅保留为可手动调用的 scripts 入口；check/npm test/CI 未调用它。

首轮还用3文件最小 fixture 复现 scalar propagation 发现：`classify(1)` 被接受，而 `classify(ports.limit)`（limit: number）报 `I08/PORT_CONDITIONAL_DEFAULT`。该事实保留为诊断记录；首轮把它写成必须通过的测试超出 r2 范围，现转移到本 finding。原 test/l5-sdk-guard-data.test.js 保留文件，改为仅验证本 lane 的 barrel 形状和 guard 未进入 check/CI，不执行该诊断 guard。不把39条逐条判为误报，不放宽既有 guard 的断言或规则。

### 未来 createKernel / KernelService

`INTERFACES.md §3` 原文：下列是未来导出 evofence/core 的签名合同；当前仓库没有由本节点实现或发布该入口。本次导出的是已存在的 `createSessionService(ports): SessionService`，而不是该未来 factory。首轮 alias 已删除，以下源代码查询须为无匹配：

~~~powershell
rg -n 'createKernel' src
# exit 1, stdout 空；rg 无匹配码，不是执行错误。
~~~

未来服务合同目前未实现，本节点不实现它，也不把它作为 DoD 的红断言。

## 静态边增量与交接边界

冻结 OWNERSHIP allowedEdges 不变。首轮基线 static audit 为88 modules / 358 edges / 0 violations；两个新 barrel 增加2 modules / 13 entries：kernel 对 graph/policy/scheduler/store/artifacts/evaluation 的6条 namespace export；runtime 对 protocol/kernel/host-port/session/workspace 的5条 namespace export，加1条 factory export和1条 type-only export。r2 移除 factory alias 后仍为同一条 re-export 边，完整 audit 实测90 modules / 371 entries / 0 violations，不放宽 frozen 集合。

最终 `git diff --check` exit 0；package.json 对照 HEAD 只改 exports/scripts，files/version 保持原值，check 字符串恢复原值。现有 tracked 生产模块与 guard 均无改动。两个 barrel 仅重导出，两个新增测试文件均小于350行。首轮超范围的红断言按 r2 改为 findings，范围内的 SQLite、零 I/O、三份生产样例、旧 runner、文档 subpath 断言均保留或加强，没有 skip 或放宽这些验收。

- static-audit/README 的旧 limitation `evofence/core package export is not yet present` 已落后于本 lane 导出，按所有权保持只读；本记录仅证明 lane 的实际产物。
- 交付文档按 brief 保持 gitignored；orchestrator 接手时须显式保留此本地文件和可执行片段。集成点只读，没有在该处合并、构建或运行会写入的测试；合并后复跑结果 unknown。
- 真实 DSH/Pi 长程会话内嵌 core、真实宿主 SQLite 按需加载时机、磁盘耐久性和 OS sandbox 均 unknown。未发 provider-live 请求、未产生额外模型费用。没有安装依赖、commit/push/merge/tag/publish、改图、凭据或 .evofence。
- 受控能力收益仍 inconclusive；l4_capability_trial attempt 1 failed，未产生任务级统计收益；747 / 943 USD 并列未裁决；预注册设计包络938.470100 USD。adr_0001/adr_0004 仍 proposed，dual-host-runtime-and-uplift 不毕业。
