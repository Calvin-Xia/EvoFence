# L2-PROTOCOL-NOTES — `l2_public_contracts`

节点：`l2_public_contracts`（`ctx_contract`）· 管辖 ADR：`adr_0009`（accepted）
上游冻结源：`spec/contracts/`（`l1-freeze.2`，`schemaVersion 1.1.0`）· 真人裁决：`execution/L1-REPLAN-DECISION.md`

本文件是 cp3 产物：决定 A/B 的理由、I01–I08 的落实方式、以及给下游 8 个 L2 节点的消费合同。

---

## 1. 决定 A —— 物理落点：`src/protocol/`

**选择 (a) `src/protocol/`。** 理由：

1. `OWNERSHIP.md §1` 的 `packages/protocol` 是**逻辑槽位名**，原文即写明"命名为未来模块/导出槽位，不表示本节点创建了文件、package exports 或发布包"。落 `src/protocol/` 不违反它。
2. 本仓库是**单包**：`tsc` 以 `rootDir: src` 编译，`exports` 只暴露根 `dist/index.js`。放 `packages/protocol/` 需要自建 tsconfig/测试接线，且**不会**被 `npm run check` 覆盖——那等于把协议层的验收移出项目门禁，与 `adr_0009`"轻量分层、可独立导入"的**可验证**意图相反。
3. 代价已接受：与旧 0.4.2 的 `src/lib/**` 暂时共存。本节点**未**修改 `src/lib/**`、`src/cli.ts`、`src/index.ts`、`integrations/`、`package.json`。

**那条会失败的检查**：协议层的测试从**本次 build 的 `dist`** 导入（`../dist/protocol/index.js`，ADR-0004 的既有约定）。若有人把协议层搬到 `src/` 之外，`tsc` 不再产出 `dist/protocol/*`，`node --test` 里这三份测试立刻以 `ERR_MODULE_NOT_FOUND` 失败——落点被门禁钉死，不需要额外断言。
（`npm run src:policy` 另行限制 `src/**/*.ts` 每文件 ≤ 350 行：本节点最大文件 254 行。）

## 2. 决定 B —— schema 单向真相源：构建期转录 + 逐字段断言

**选择"从冻结文档转录一次 + 测试逐字段断言"**（即简报的第二个选项，把"生成"这件事做成一次性转录 + 持续可证伪的断言）。理由与做法：

- `src/protocol/objects/{core,policy,graph,runtime,evaluation,assets}.ts` 把 `SCHEMAS.md` §1 `$defs` 的 **75 个定义整体转录**为 `as const satisfies DefsSchema` 的字面量（6 个分组，最大 226 行）。`DefsSchema`（`defs.ts`）只声明冻结文档**实际用到**的 23 个关键字，任何多写/少写关键字的字段表都过不了 `tsc`。
- 类型不第二次手写：`types.ts` 的 `Wire<S>` / `Decoded<K>` 从这些表**机械推导**出全部 wire 类型（含 `LoopSpec` 四个可选 bound 的"非 required 即可选"），所以"类型"和"编解码器接受什么"在同一个源上，不存在第二处漂移点。
- `errors.ts` 的 58 码与纠错类别同样从 `ERRORS.md` 转录一次，`RETRY_POLICY` 以 `ErrorCode` 为键——**新增一个码不配纠错类别无法编译**。

**那条会失败的检查**：`test/protocol-schema-drift.test.js` 从磁盘重新解析 `SCHEMAS.md` 的 `$defs` 块与 `ERRORS.md`，逐条比对：

| 断言 | 失败即意味着 |
|---|---|
| `compare(frozen, DEFS)` 为空 | 定义集/任一字段/任一类型与冻结文档不一致 |
| `Object.keys(DEFS).length === 75`；63 对象 / 427 字段 / 423 必填 | 加/删/改字段 |
| 每对象的属性集、required 集、每字段类型表达式逐一相等 | 改名、必填变化、类型变化 |
| `usedKeywords === ASSERTION_KEYWORDS ∪ ANNOTATION_KEYWORDS` | 冻结文档引入新关键字而编解码器没实现（不会静默降级为 `unknown`） |
| `ERROR_CODES` 与 `ErrorCode.enum`、`ERRORS.md` 三方相等；纠错类别逐码相等 | 错误码漂移 |
| `SUPPORTED_SCHEMA_VERSIONS === $defs...enum`；`CURRENT_SCHEMA_VERSION === $id` 尾段 | 版本面漂移 |
| **negative control**：注入一个字段 / 删除一个定义后，比较器必须报出差异 | 证明比较器**可证伪**，不是同义反复 |

最后一条是给"检查本身是否有效"的检查：它先篡改一份内存副本，再断言比较器**确实**报错。

**这条检查已被 wired 进仓库门禁**（`npm test` = `npm run build && node --test`，**无参数、无 glob**）：门禁输出里能查到上述 26 条断言（逐条标题比对 26/26）。**增量证据**（不依赖任何 grep 技巧）：把三份测试文件移出仓库后跑 `node --test` → `tests 397`，移回 → `tests 423`，差值 **26** 就是本节点的断言数。

反向证据也在**字面 `npm test`（无参数）**上实测过：用一个仓库外的预载模块（`NODE_OPTIONS=--import /<tmp>/zzz-drift-patch.mjs`，在 build **之后**、测试文件 **之前** 篡改 `dist/protocol/objects/index.js` 导出的 `DEFS`，插入 `TaskContract.properties.zzzInjected`）让交付的表与冻结文档不一致，`npm test` → **exit 1 / tests 423 / pass 419 / fail 4**，变红的正好是三条字段级断言 + 文件内 negative control，指名 `definition TaskContract differs from docs/evofence-harness-kernel/spec/contracts/SCHEMAS.md`；预载拿掉后同一命令回到 423/423。篡改只存在于子进程内存里，仓库零改动，所以不存在“恢复”这一步。

> 判断某个测试是否进了门禁，**不要 grep 文件名**：`node --test` 的 spec 报告对**通过**的用例只打印标题，文件路径只在失败时出现（`grep -c "codec.test"` 无论跑没跑都是 0）。用 `ℹ tests` 总数差值，或 `node --test --test-reporter=tap`。另：`node --test test/protocol/`（传目录）不会展开目录，它把该目录当成单个测试文件 → `tests 1 / fail 1`。

> 注：`test/**` **不在** `tsc` 的 `include`（`src/**/*.ts`）也不在 `npm run src:policy` 的扫描范围里，所以测试文件必须被 `node --test` 的默认发现规则认到，且名字与本仓库既有约定一致：**平铺在 `test/*.test.js`**（既有 20+ 份测试全部如此，`test/` 下没有子目录放测试）。写成 `*.test.ts` 在 Node 22.13（`package.json` 声明的最低版本）上要么不被发现、要么需要 `--experimental-strip-types`——那是把门禁的可发现性押在运行时版本上。

## 3. cp2 —— I01–I08 的落实方式与实测

`src/protocol/` 的静态导入闭包**只有相对路径**，且**不出本目录**（14 个说明符全部是 `./` 或 `../defs.js`，`objects/index.ts` 转发六个分组文件）。逐条：

| 规则 | 要求 | 落实方式 | 实测 |
|---|---|---|---|
| I01/I02 | 闭包内零 bare specifier、零 node builtin（含 `node:*` 与别名） | 只用相对导入；`ids.ts` 用正则而非 `node:crypto`；无 `path`/`fs` 需求 | `grep` 全部说明符 → 全部相对；非相对说明符 `(none)`；`node:` `(none)` |
| I03 | 无动态 `import()`/`require`/`eval`/`Function` | 无 | `(none)` |
| I04 | 顶层无 I/O、无副作用 | 模块顶层只有 `const` 声明与函数定义；无 `readFile`/`writeFile`/`fetch`/`process.`/`console.` | `(none)` |
| I05/I06 | 无默认 backend、无隐式单例、不重导外部 | 导出物全是冻结常量与纯函数，无 `let`/`var` 模块级可变状态，无惰性缓存 | `^(export )?(let\|var)` → `(none)` |
| I07 | Clock/随机/摘要显式注入 | 本层不取时间、不取随机、不算摘要（`Instant` 是注入 Clock 的产物，`Digest` 是注入 DigestPort 的产物） | `Date`/`Math.random`/`node:crypto` → `(none)` |
| I08 | reducer 只接收确定值 | 本层无 reducer；`decode` 是纯函数（输入 → 结果，无 I/O） | — |

测试侧：`test/protocol-*.test.js`（平铺，与仓库其他测试同层）只 import `node:test`、`node:assert/strict`、`node:fs`（drift 检查读冻结文档）与 `dist/protocol/index.js`，**不使用任何 TypeScript 编译器 API**（不用 `typescript` 包、不读 `ts.ScriptTarget`），所以在 TS 6/7 上行为一致。

另据 `npm run dep:check`：`modules 121 / edges 433 / cycles 0 / acyclic: true`——协议层未引入环。
**本节点的 cp2 由上述直接检查取证；`OWNERSHIP.md` I01–I08 的 AST guard 属另一个执行者的交付物，本节点未重复实现。**

## 4. 给下游 8 个 L2 节点的消费合同

### 4.1 怎么 import

```ts
// src/** 内（本层是 src 作者面向的模块，不是 dist 消费者）
import { decode, fail, DEFS, type Decoded, type DefName, type ErrorEnvelope } from '../protocol/index.js';
```

```js
// test/protocol-<name>.test.js —— 平铺在 test/ 根，与仓库其他测试同层；从本次 build 的 dist 导入（ADR-0004）
import { decode } from '../../dist/protocol/index.js';
```

测试文件名必须是 `*.test.js`（`npm test` 不带 glob，靠 Node 默认发现规则），且 `npm test` 会先 build，所以 dist 永远是本次 `src/**` 的产物。

**入口只有一个**：`src/protocol/index.ts`。不要深引 `objects/<group>.ts`——分组只是排版，随时可能因为 350 行上限而重排；需要"某个定义"就用 `DEFS[name]` 或 `DefName`。

**当前 `package.json` 未改动**：`src/protocol` 还不是发布面（`exports` 只暴露根 `dist/index.js`）。是否把它加进 `exports` 属 L5 的发布决定，本节点不代决。

### 4.2 稳定面（可作为合同依赖）

| 导出 | 含义 |
|---|---|
| `DEFS` / `DefName` | 冻结字段表与定义名；由 drift 测试钉死在 `SCHEMAS.md` |
| `Decoded<K>` / `Wire<S>` / `ObjectName` / `ScalarName` | 从表推导的 wire 类型 |
| `decode(name, value)` | 唯一的边界校验入口；返回 `Validated<K>` |
| `decodeProtocolVersion` / `decodeRuntimeVersion` | 版本门（未知版本 → `EFK_PROTOCOL_UNSUPPORTED`） |
| `fail(code, message, refs?, visibility?)` / `ErrorEnvelope` / `ErrorCode` / `RETRY_POLICY` / `ERROR_CODES` | 唯一错误封套与纠错类别 |
| `Id` / `Digest` / `ModelId` / `Instant` / `brand` / `asDigest` / `asInstant` | 编译期身份品牌（运行时擦除） |
| `RUNTIME_NAMESPACE` / `ASSET_NAMESPACE` / `CURRENT_SCHEMA_VERSION` / `SUPPORTED_SCHEMA_VERSIONS` / `isSupportedSchemaVersion` / `gateRuntimeVersion` / `offersVersion` | 版本面 |
| `ASSERTION_KEYWORDS` / `ANNOTATION_KEYWORDS` / `Def` / `DefsSchema` | 关键字面（guard 与后续 codec 扩展用） |

### 4.3 明确还会变 / 不提供的东西

- **`objects/<group>.ts` 的文件划分**会变（排版问题），`DEFS` 的内容不会。
- **本层不做**：协商算法（属 `l2_policy`）、持久化（`l2_state_store`）、图编译（`l2_graph_model`）、调度（`l2_scheduler`）、reducer 与 outbox（`l2_runtime`）、fake host（`l2_host_port`）、产物读写（`l2_artifact_port`）、纵向核验（`l2_kernel_verification`）。本层只回答"这段字节是不是合法协议对象"。
- **没有根级自动判别**：`$defs` 的 `oneOf` 有 20 个封套，但调用方必须**点名**要解哪个定义（`decode('Command', x)`）。没有"猜封套"的入口，也不该有——猜错会把 `Event` 当成 `Effect` 收下。
- **`decode` 只做语法/形状与冻结约束**：`not`/`if-then`/`anyOf` 之外的语义（例如"这个 `DecisionRecord.kind=activation` 是否真的绑定了实际快照"）属于上层裁决，不在本层重复校验同一个不变量。

## 5. 未证明项与已知环境限制（如实）

1. **`npm test` 环境基线已恢复**：本节点开始时 `node_modules` 为空、121/218 旧用例因 `Cannot find package 'better-sqlite3'` 失败（协议层零依赖，与本节点无关）；后来本工作区完成安装，门禁实测 **`npm test` exit 0 / tests 423 / pass 423 / fail 0**，其中含本节点 26 条协议断言（标题命中 26/26；移出仓库后总数降为 397，差值 26）。未证明的不是这条，而是下面第 2 条。
2. **没有实现证据层面的 conformance**：`SCHEMAS.md §3` 的 S01–S26 语义校验里，本层实现了与**单个对象形状**有关的那些（S01 的部分、S02、S10 的 payload 判定、S22 的确定编码前提、S23 的边字段形状）。跨对象/跨事务的规则（S03–S09、S12、S16–S21、S24–S26 等）需要 EventStore/Effect/Promotion 语义，属 L2 其余节点。
3. **`uniqueItems` 的判等用稳定序列化**（键排序），不是 JSON Schema 的完整 numeric/string 等价语义；冻结文档里 `uniqueItems` 只出现在 `$ref` 对象数组上，两者一致。
4. **`pattern` 每次即时构造 `RegExp`**，未做编译缓存。当前只在 `Id`/`Digest`/`ModelId` 三处触发，属可接受的简单性选择；若 L2 热路径证明有影响再改。
5. **本层未跑任何宿主**：Pi/DSH 的 usage、取消、恢复语义都不在本层范围内。
6. **`SCHEMAS.md` 1.1.0 的资产 namespace 独立**：`AssetProtocolVersion` 仍固定 `evofence.assets/1` + `1.0.0`，本层不为它做版本协商（它不在 runtime 门里）。

## 6. 复现命令

```bash
npm run build            # tsc → dist/（本节点所有测试的前置）
npm test                 # 仓库门禁：build + 裸 node --test（无参数），协议层 26 条断言在其中
node --test              # 只跑测试步骤（不 build）
node --test test/protocol-*.test.js   # 只跑本节点

# negative control（仓库零改动，用仓库外预载在 build 之后篡改内存里的 DEFS）：
#   NODE_OPTIONS="--import file:///<tmp>/zzz-drift-patch.mjs" npm test   → exit 1 / fail 4（drift 断言全红）
#   npm test                                                            → exit 0 / 423 pass
npm run typecheck
npm run src:policy       # src 无 .js、每文件 ≤350 行（test/** 不在扫描范围）
npm run dep:check        # src 无环
```

> 本工作区有多个 pane 并发执行 `npm run build`；`dist/**` 是构建产物、会被随时重生成。任何在 `dist/` 上手工注入的验证必须在**同一条命令里**注入、跑测试、恢复，否则会被并发 build 抹掉（本节点做 negative control 时实测到过这个现象）。
