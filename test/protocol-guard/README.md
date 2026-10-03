# I01–I08 core guard（L2 cp2）

交付文件仅在 `scripts/check-core-imports.mjs` 和 `test/protocol-guard/**`。规则依据为 [OWNERSHIP.md §1–2](../../docs/evofence-harness-kernel/spec/contracts/OWNERSHIP.md) 的模块矩阵、I01–I08 表及其后的 best-effort 说明；factory/port 形态依据 [INTERFACES.md §3](../../docs/evofence-harness-kernel/spec/contracts/INTERFACES.md)。I01–I08 实际位于 OWNERSHIP 的 §2。

复用半成品的 AST、realpath、ESM 闭包比较与子进程 spy 框架。它们与规格相符；问题集中在 parser 选择和若干漏检，重写整套没有必要。本次删除全局 `--compiler` / `EVOFENCE_GUARD_COMPILER` 逃生门，统一使用项目依赖 `typescript6`（本次 lockfile/install 的实际版本 6.0.3）。guard 不调用 TS7 不存在的 JS Compiler API。原先仅安装 alias 不能保证产品 tsc 仍指向 TS7，实际 `.bin/tsc` 曾被 typescript6 占用。

补强了构建产物的 AST 检查、scope/shorthand/解构判定、helper 间的词法 port 传递、模块捕获与替换 port、非 JSON 探针结果的显式拒绝，以及合法跨 core 模块 symlink 的真实路径解析。为 guard 新增项目内 dev-only devDep 别名 `typescript6`（`npm:typescript@^6.0.3`）；产品编译器仍由 `typescript@^7.0.2` 承担，`build`/`typecheck` 已由 orchestrator 改为显式 `node node_modules/typescript/bin/tsc` 路径以免被别名抢 bin；未改产品源码、未提交发布。本轮 Agent 没有再次修改 package.json 或安装包。

## 调用

从仓库根目录执行：

```powershell
node --check scripts/check-core-imports.mjs
node --check test/protocol-guard/guard.test.mjs
node --test test/protocol-guard/guard.test.mjs
node scripts/check-core-imports.mjs --root protocol=src/protocol --project tsconfig.json
& ./test/protocol-guard/verify-native-protocol.ps1
```

最后一条在本目录 `.work/native-*` 中复制 protocol，使用项目已安装的 TS7 CLI 和继承自仓库的 tsconfig 编译，再将实际 JS 产物交给 guard。只写测试目录，不写原始 src、产品 dist 或 tsconfig；检查清理目标 realpath 后只移除本次创建的临时目录。**该脚本会再生成 [EVIDENCE-PROTOCOL.txt](EVIDENCE-PROTOCOL.txt)（本地保留、未跟踪，见根 `.gitignore`），失败时也会写入；它不是仓库只读验证。** 此文件是脚本的明确输出；源码、产品 dist 和产品配置保持只读。

guard 支持重复 `--root protocol|kernel|runtime=directory`；省略 root 时要求三个 `src/` 根全部存在。允许指定当前已实现的子集，JSON 总结会列出实际 `modules`，子集通过不能作为完整 core 结论。每个根必须有唯一 ESM index；缺失、重叠、语法无效、目标无法解析均失败。

`--project tsconfig.json` 提供 TypeScript module resolution 配置。`--built module=directory` 必须覆盖全部声明根，逐文件保留 ESM 输出映射；缺产物、不支持的映射或额外闭包目标都失败。不给 built 时检查源码及 TS6 的内存 ESM emit；只有提供 built 才检查实际构建产物。

`--probes file.json` 的输入形态：

```json
{"version":1,"cases":[{"module":"kernel","export":"reduce","args":[{"count":0},{"value":1}]}]}
```

版本、字段、模块与 args 形态都校验；未知字段拒绝。入口导出的函数名匹配 `/(^reduce|reducer|negotiate)/i` 时必须有同名 case；其他纯函数可以显式添加 case。runtime 必须导出有词法 Ports 参数的 `createKernel`。不自动编造业务输入。

通过退出 0，规则违反或边界输入错误退出 1。stderr 诊断为 `[Ixx/CODE]` 或 `[INPUT/ERROR]`；stdout 包含 parser、运行计数和 JSON 总结。本工具沿用仓库检查脚本的 0/1 约定，不属于产品 CLI 的输出合同。

## 模块边界与闭包

| 来源 | 允许真实目标 |
|---|---|
| protocol | protocol |
| kernel | protocol、kernel |
| runtime | protocol、kernel、runtime |

所有声明根的 TS/JS/JSON 文件均作为种子，严格程度高于只检查 index 的可达文件。AST 收集 import/export、type-only、import type expression、reference 指令；TypeScript resolver 求目标，再用 realpath 确认实际 module 并按矩阵检查。barrel 不能隐藏 host/root；symlink/junction 不能改变目标所有权。指向允许 core module 的合法 junction 有源码和实际 build 正例，逃出闭包的 junction 有反例。

I06 对每个文件比较源码运行期边、内存 emit 和供应的 build 的目标集合，并比较运行期 export 签名。整句 `import type` / `export type` 擦除；在 verbatimModuleSyntax 下，inline `import {type T}` / `export {type T}` 的空运行期边仍保留，正例覆盖该区别。protocol 内 JSON 可作为纯数据模块，资源正例也覆盖实际 build。供应的 JS 还会重新绑定 scope 并检查 loader、ambient 和 port 规则，防止只保持 export 图却在未执行函数中加入 require/eval。

I02 的检查对象限于 **import/export/引用 specifier**。`declare module "node:fs"` 和 `declare module "*"` 的声明名称不属于该检查对象；两个 `I02-ambient-*-declaration` 向量实测退出 0，明确记录排除项。声明内若存在真正的 bare import/type reference，仍会被拒绝。

## I01–I08 的反例及真实输出

本轮最终测试输出为 [EVIDENCE-REVIEW.txt](EVIDENCE-REVIEW.txt)，初版历史输出为 [EVIDENCE.txt](EVIDENCE.txt)（本目录 `EVIDENCE*.txt` 均为本地保留的运行产物，未跟踪、不进 PR）。本轮输出包括每个向量的退出码、诊断和 stdout。以下摘录保留真实 code/message，省略临时绝对路径。表中反例全部退出 **1**。

| 判据 | 实现 | 对应最小反例 | 实测诊断 |
|---|---|---|---|
| I01 | AST + TypeScript resolution + realpath；每条边按 §1 矩阵检查，包含 type-only / barrel / junction | `I01-kernel-host-barrel`：kernel barrel export host/pi | `[I01/FORBIDDEN_EDGE] disallowed real import target: ...host/pi/index.ts` |
| I02 | 所有 import/export/引用 specifier 中的非相对目标均拒绝；bare package、builtin 无前缀别名、路径 alias、绝对路径不能洗白 | `I02-builtin`：`import type ... from 'node:fs'` | `[I02/NON_RELATIVE_IMPORT] bare/builtin/alias/absolute specifier forbidden: node:fs` |
| I03 | 拒绝动态 import、import-equals、require/createRequire/eval/Function 的直接与别名引用，以及可识别 constructor 反射；不执行未知加载目标 | `I03-require-alias`：`const load=require` | `[I03/CODE_ALIAS] code-loading alias/reference forbidden: require` |
| I04 | 用 checker 区分词法绑定与 ambient；检查字面量成员、单层 initializer/解构别名、shorthand、import.meta、类型查询捕获 | `I04-global-literal`：`globalThis['fetch']` | `[I04/AMBIENT_MEMBER] ambient member/one-layer alias forbidden: globalThis.fetch` |
| I05 | 按执行时机检查顶层/类静态字段和静态块；调用/构造须为识别出的纯初始化，函数体不误作 import 时执行 | `I05-top-io`：顶层 `store.read()` | `[I05/TOP_CALL_UNPROVEN] top-level/static call is not a recognized pure initializer: store.read` |
| I06 | 比较源码/emit/build 的运行期边与 exports；重新扫描供应 build 的 AST；root/CLI 不得进入声明闭包 | `I06-built-drift`：build runtime export 实际存在的 package root，root 导入 CLI | `[I06/EMIT_UNRESOLVED] unresolved emitted import: ../../index.js` |
| I07 | 子进程 VM 导入入口；调用 createKernel 时所有 port 都有 spy；显式纯 case 两次独立输入、结果逐字比较，并拒绝突变和非 JSON 数据 | `I07-factory-spy`：构造时 `ports.Clock['n'+'ow']()` | `[I07/OBSERVABLE_CALL] ports.Clock.now` |
| I08 | 参数/解构默认值、??/||/条件 fallback、port 替换、module 直接写入及已识别容器 API 捕获、隐式 global、具体 port 类均检查；按真实词法绑定追踪 helper 参数/返回值及对象/闭包内句柄 | `I08-fallback`：`ports.HostPort ?? defaultHost` | `[I08/PORT_FALLBACK] injected capability cannot fall back to a default backend` |

其他反例包括 node:child_process / child_process / node:path / node:crypto / node:sqlite / better-sqlite3 / simple-git / super-plumber / 任意 host SDK、动态字面量 import、createRequire、间接 eval、Function、constructor 反射、class static block、build export/loader/ambient 漂移、非确定 reducer、输入突变、Map 结果、未提供 mandatory case、helper fallback/capture、if 替换、默认参数和 implements HostPort 的 backend 类。

`I06-built-drift` 的 root 和 CLI 文件确实存在。它们在声明的 emitted/build 文件映射之外，因此必须在链接/执行前拒绝；CLI 的 fetch 没有执行。

## best-effort 盲区与证据边界

I04 不做常量折叠或完整跨函数纯度推理。`I04-computed-unexecuted-blind` 的未调用函数使用 `Math['ran'+'dom']()`，guard **退出 0**；`I04-cross-function-unexecuted-blind` 也退出 0。它们是有意记录的漏检，不能算安全正例。同一计算属性写法在 `I04-computed-probed` 中显式调用后由 I07 的 Math.random trap 捕获，退出 1；测试同时断言没有 I04 诊断。

I05 的纯初始化白名单不能证明回调、getter 或不透明 helper 的纯度。`I05-callback-blind-runtime-red` 在顶层 `[0].map(hidden)` 的 callback 中使用计算属性 Math.random：**没有 I05 静态诊断**，导入时 I07 真实捕获并退出 1。测试断言这一分类，不能把 runtime 捕获写成 I05 全覆盖。

I07 是已执行 import/factory 和显式输入的有限动态证据，不证明所有输入、所有分支或所有宿主。`I07-finite-two-runs-blind` 的 reducer 前两次返回相同数据、第三次改变结果，本次两次探针退出 0，明确证明该限制。自查发现 Date.prototype.constructor 可绕过旧 Date spy；现已指向同一 trap，`I07-Date-prototype-constructor` 实测退出 1。任意别名命名的 reducer/协商函数不会自动识别，必须显式提供 case。探针只接受有限、无环的 plain JSON 数据：Map/Set/class、getter、隐藏属性、symbol、稀疏数组等不能被 JSON.stringify 静默归并成相同结果。port 句柄的读取/保存于实例闭包允许，调用/构造则计数。VM 超时和禁字符串代码生成用于完成检查，不是 OS sandbox。

I08 已机检的范围是可解析的词法 port 流、显式默认值/替换、模块级符号及词法别名/直接 helper 返回的存储目标、ambient global 和已声明的 backend 类。`Object.assign`、`Object.defineProperty/defineProperties`、`Reflect.set`、`push/set/add/unshift/splice` 的目标归属和 port 实参会检查，包含字面量成员、普通 builtin alias、直接 bind、spread 实参及 helper 传参。已知 `Object.freeze/assign/create`、`Array.from`、`Promise.resolve/all/allSettled` 和构造器的 port 包装也追踪；实例自己的局部容器正例允许。**已实测的剩余 I08 漏检**：`I08-returned-wrapper-container-blind` 中 helper 返回 `{target: box}`，再对 `getBox().target` 使用 Object.assign，退出 0。guard 尚未做返回对象属性与模块对象之间的 heap alias/provenance 分析；这不是 direct Object.assign、直接 helper 返回 box 或直接 bind 的豁免，它们均已有退出 1 的反例。任意 JavaScript 的不透明反射、动态方法选择、多层 bind、间接回调，以及未执行条件分支的完整能力 provenance 尚未证明；需要 kernel/runtime conformance case，不能把本工具的绿色提升为这类路径的完整 effect 证明。I03 可识别 loader 的拒绝同样不等于对需常量折叠的任意反射程序作形式化证明；这类写法与 I04 盲区一并保留。`I03-computed-constructor-unexecuted-blind` 使用函数的计算属性 constructor，未执行时退出 0；提供 probe 后由 VM 的字符串代码生成门禁拒绝，退出 1。

I06 支持逐文件保留路径的 ESM 构建图及 JSON 资源，不证明函数体语义等价。合并/压缩 bundle、自定义 loader、特殊 asset 映射和真正的 package `evofence/core` export 路由没有验证；未知映射失败，不当通过。实际 build 中的 type 声明语义由 typecheck/cp1 负责。

## 本次实测（2026-10-01）

环境：Windows、Node v24.12.0、AST/内存 emit 使用项目 typescript6 6.0.3，真实复制构建使用项目 TS7 CLI 7.0.2。

本轮回归数字及逐条核查见下方 review-2 修订记录；初版回归为 81 tests。测试 pass 表示实际行为与向量预期相符；不是反例通过 guard。

干净三模块夹具的源码和 build 均退出 0：

```text
I07 evidence: {"imports":3,"factories":1,"deterministicCases":1,"portOrAmbientCalls":0}
```

真实 protocol 的源码/内存 emit 和本次 TS7 实际复制构建均退出 0，14 文件：

```text
I07 evidence: {"imports":1,"factories":0,"deterministicCases":0,"portOrAmbientCalls":0}
```

protocol 不导出 factory/reducer，所以这里的 factory/case 为 0；不能冒充真实 kernel/runtime 已有运行证明。默认三个生产根检查退出 1：src/kernel 缺失。src/runtime 同样未落盘。

| 实测命令 | 退出码 | 证据 |
|---|---|---|
| `node --check scripts/check-core-imports.mjs` | 0 | guard 语法 |
| `node --check test/protocol-guard/guard.test.mjs` | 0 | 测试语法 |
| `node --test test/protocol-guard/guard.test.mjs` | 0 | EVIDENCE-REVIEW.txt，本轮最终结果 |
| `node scripts/check-core-imports.mjs --root protocol=src/protocol --project tsconfig.json` | 0 | 真实 protocol 源码 + 内存 emit |
| `& ./test/protocol-guard/verify-native-protocol.ps1` | 0 | EVIDENCE-PROTOCOL.txt：native build=0，actual-artifact guard=0，预期缺根检查=1 |
| `node scripts/check-core-imports.mjs` | 1 | 缺 src/kernel，ENOENT；没有跳过 |

`npm test` / `npm run check` 没有整体运行：它们会写入授权范围外的产品 dist。本次只编译测试目录中的 protocol 副本，并运行与 `npm test` 同样会发现的 guard 回归文件。完整旧套件、实际 kernel/runtime、全部业务输入及其他 Node/OS 未证明。

夹具以 JSON 字符串保存，不进 src，也不会被 node --test 当作产品模块加载。回归仅在本目录 `.work/run-*` 中实体化 fixture/build/junction，验证清理 realpath 后删除本次临时目录。

## npm run check 接线建议（本轮 Agent 未修改 package.json）

当前可以在 typecheck 后添加 `core:check`：

```text
node scripts/check-core-imports.mjs --root protocol=src/protocol --project tsconfig.json
```

建议顺序：typecheck → core:check → src:policy → dep:check → 已有 npm test。guard.test.mjs 留在原有 node --test 发现范围，无需额外编译 TS 测试。CI 用 npm ci 的项目依赖/lockfile，不需要全局 compiler 或环境变量。

在现有 build 后增加 actual-artifact 检查：

```text
node scripts/check-core-imports.mjs --root protocol=src/protocol --project tsconfig.json --built protocol=dist/protocol
```

kernel/runtime 落盘且有真实、冻结的 reducer/协商 probe 后，改为完整三根（省略 root 即要求三根），加 `--probes <cases.json>`；构建后同时提供 protocol/kernel/runtime 三个 built 根。不要把当前 protocol 子集或内存 emit 的成功命名为完整生产 core 的运行/发布验证。
