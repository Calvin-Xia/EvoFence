# l2_guard 修复复验（review-2，独立实测）

日期：2026-10-01 · 复验者：review pane · 位置：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`（未提交改动）

## 结论：可接受

上轮 2 MAJOR + 2 MINOR + 1 NIT 全部落地并经**独立复现**验证：`Object.assign`/`push` 逃逸与 `Date.prototype.constructor` 绕过均已修复；README 的编译器接线与 I02/IP 覆盖表述已改为与脚本行为一致；两个 MINOR/NIT 已按"收窄文档范围 + 明确记录排除项"处理。仅剩 2 条 nit（README 悬空引用、`.bin/tsc` 别名仍占位）。

> **复验前提提醒**：任务称"该 pane 已死"，但工作区在我复核期间仍在被写入——`EVIDENCE-REVIEW.txt` 在 23:03 为 **0 字节**、23:06:37 才变成 83218 字节；`README.md` 23:05:58、`verify-native-protocol.ps1` 23:07:18 才最终成形。本报告结论绑定下列**已验证修订**（sha256 前 12 位）：
> `check-core-imports.mjs f6fe4be61383`、`fixtures.json 8e2942a296f9`、`guard.test.mjs b930421f400e`、`README.md c073720bf74e`、`verify-native-protocol.ps1 e32e11b35378`、`EVIDENCE-REVIEW.txt c251e5a3181f`。

---

## 1. I08 `Object.assign` / 容器变异逃逸（原 MAJOR）— 已修 ✅

修前反例（`EVIDENCE-REVIEW-BEFORE.txt`）为 exit 0；我用**自建夹具**重跑（`/tmp/guardlab/run.mjs`，与作者夹具无关）：

```
F-objassign-capture    exit=1 [I08/PORT_CONTAINER_CAPTURE] … injected port escapes into module-scoped storage through Object.assign
G-array-push-capture   exit=1 [I08/PORT_CONTAINER_CAPTURE] … through box.push
H-map-set-capture      exit=1 [I08/PORT_CONTAINER_CAPTURE] … through box.set
I-reflect-set-capture  exit=1 [I08/PORT_CONTAINER_CAPTURE] … through Reflect.set
J-bind-mutator         exit=1 [I08/PORT_CONTAINER_CAPTURE] … through box.push.bind(box)
M-returned-container   exit=1 [I08/PORT_CAPTURE] … module-scoped storage   （helper 返回模块容器）
```

**正向/误报控制**（必须仍然绿，否则是过度拦截）：

```
L-instance-container-positive  exit=0   （模块里 new Box(); b.host=port）
S-local-map-set                exit=0   （函数内 const m=new Map(); m.set('k',port)）
P-nonport-push                 exit=0   （模块数组 push 非 port 值）
Q-freeze-nonport               exit=0   （模块 Object.freeze({a:1})）
R-defineProperty-nonport       exit=0   （模块 Object.defineProperty(box,'a',{value:1})）
```

真实 protocol 无回归：`node scripts/check-core-imports.mjs --root protocol=src/protocol --project tsconfig.json` → **exit 0**（files:14，violations:0）。

实现核对：新增 `moduleStorage()`（沿别名/helper 返回值/参数判定"是否模块级存储目标"）与 `capturesPortByMutation()`（`Object.assign/defineProperty/defineProperties`、`Reflect.set`、`push/set/add/unshift/splice`，含 `.bind` 形态），替换原先只认直接 `=` 的 `PORT_CAPTURE`；新码 `PORT_CONTAINER_CAPTURE` 只覆盖 call 形态，`PORT_CAPTURE` 覆盖赋值形态，不引入第二个错误物。

## 2. `Date.prototype['con'+'structor']`（修者自查发现）— 已修 ✅

```
K-date-prototype-ctor  exit=1 [I07/PROBE_EXECUTION] <probe>: ambient call new Date
                              [I07/OBSERVABLE_CALL] <probe>: new Date
```

修法：VM trap 里补 `NativeDate.prototype.constructor = globalThis.Date`，使 `Date.prototype.constructor` 指回被 Proxy 包裹的 `globalThis.Date`，`construct` trap 生效。对应向量 `I07-Date-prototype-constructor`（rule=I07, exp=1, blind=I04）已入 fixtures。

## 3. `declare module` 的处理方式 — 与文档一致 ✅

我的原始用例（`protocol/index.d.ts` 写 `declare module "node:fs"`，或 `declare module "*"`）仍 **exit 0**，但现在：

- fixtures 新增 `I02-ambient-node-declaration|exp=0`、`I02-ambient-wildcard-declaration|exp=0` —— 作为**显式排除项**登记，而非静默漏检；
- README 第 49 行明写："I02 的检查对象限于 **import/export/引用 specifier**；`declare module "node:fs"`/`declare module "*"` 的声明名称不属于该检查对象；两个 `I02-ambient-*-declaration` 向量实测退出 0，明确记录排除项。声明内若存在真正的 bare import/type reference，仍会被拒绝。"

即采用"收窄文档范围 + 绿色夹具明确记录未拒绝"，不再宣称全覆盖。与脚本行为一致 ✅。

## 4. README「不实陈述」MAJOR — 已解决 ✅（逐句核）

| README 现行表述 | 实测 | 判定 |
|---|---|---|
| 第 5 行"原先仅安装 alias 不能保证产品 tsc 仍指向 TS7，实际 `.bin/tsc` 曾被 typescript6 占用" | `grep node_modules/.bin/tsc` → `typescript6/bin/tsc` | ✅ 如实 |
| 第 7 行"为 guard 新增 devDep 别名 typescript6；产品编译器仍由 typescript@^7.0.2 承担，build/typecheck 已由 orchestrator 改为显式 `node node_modules/typescript/bin/tsc`；本轮 Agent 没有再次修改 package.json" | `git diff HEAD -- package.json`：`"build": "node node_modules/typescript/bin/tsc"`、`"typecheck": "node node_modules/typescript/bin/tsc --noEmit"`；`npm run build --silent -- --version` → **Version 7.0.2** | ✅ 上一轮错误的"没有改 package.json"已被改正并注明归属 |
| 第 25 行"不给 built 时检查源码及 TS6 的内存 ESM emit；只有提供 built 才检查实际构建产物" | `coverage.I06` 字段确实在两种模式间切换 | ✅ |
| 第 60/61 行 I04/I05 覆盖面措辞（字面量成员/单层别名/顶层与静态块；不含常量折叠） | 与 `I04-computed-unexecuted-blind`、`I05-callback-blind-runtime-red` 的实测一致 | ✅ 未夸大 |
| 第 72/74/76/78 行盲区段 | 新增盲区均已如实登记：`I03-computed-constructor-unexecuted-blind(exp=0)`、`I03-computed-constructor-probed(exp=1)`、`I07-finite-two-runs-blind(exp=0)`、`I08-returned-wrapper-container-blind(exp=0)`，并在正文解释 | ✅ |
| 第 53/94 行指向 `EVIDENCE-REVIEW.txt` | 该文件实测 `ℹ tests 111 / pass 111 / fail 0`，与我独立跑出的数字一致 | ✅ |

## 5. 原 MINOR/NIT 逐条

| 原条目 | 处置 | 实测 |
|---|---|---|
| MINOR-3 `declare module` 未扫描而 I02 声称"所有 bare specifier" | **已修**（收窄 + 记录排除项） | 见 §3 |
| MINOR-4 README"没有改 package.json" | **已修**（第 7 行改正，注明 devDep 与 orchestrator 的 script pin） | 见 §4 |
| NIT-5 `verify-native-protocol.ps1` 覆盖已跟踪 `EVIDENCE-PROTOCOL.txt` | **已处理**：保留再生成行为，但脚本头部+行内注释与 README 第 21 行均明示"会再生成已跟踪证据文件、失败时也写；不是仓库只读验证" | `EVIDENCE-PROTOCOL.txt` @15:07:21Z 含 `native compiler 7.0.2`、guard --built exit 0、missing-root exit 1(ENOENT)、empty-root exit 1(`files:0`/`[I01/ENTRY_REQUIRED]`) |

## 6. 回归复跑

```
$ node --test test/protocol-guard/guard.test.mjs
ℹ tests 111   ℹ pass 111   ℹ fail 0        exit 0    (~179s, 独立复跑)
```

与 `EVIDENCE-REVIEW.txt` 的 `tests 111 / pass 111 / fail 0` 一致（该文件在我本轮开始时为 0 字节，属半写状态，现已完整）。我另跑的 14 条原有 8 规则反例/正例对照（`clean3`/`i01-direction`/`i01-fixed`/`i02`/`i03`/`i04`/`i05`/`i07-spy`/`i08`/`i08-fixed` 等）全部保持预期：基线绿、反例红、合规变体绿，无回归。未跑全量 `npm test`（按要求；且既有 `test/runner.test.js` 墙钟 flake 与本项无关）。

---

## 剩余 nit（不阻塞）

- **nit-A（README 悬空引用）**：第 86 行"本轮回归数字及逐条核查见下方 **review-2 修订记录**"，但 README 的标题列表（第 1/9/37/51/70/82/115 行）里**没有**该小节；全文唯一回归数字是"初版回归为 81 tests"。建议补一节写明当前 `107 向量 / 111 tests`（或把该句改成直接引用 `EVIDENCE-REVIEW.txt`）。
- **nit-B（别名仍占 `tsc` bin）**：`npm run build`/`typecheck` 已用显式路径指向 TS7（✅），但 `node_modules/.bin/tsc` 仍由 `typescript6` 占用——直接 `npx tsc --version` → **6.0.3**。任何不走 npm script 的 `tsc` 调用（编辑器/手工/其它脚本）仍会拿到 TS6。README 已在第 5 行披露；若要根治需给别名换 bin 名或 `overrides`/`npm:` 之外的工具链方案，属后续项。
- **nit-C（工作区未冻结）**：复核期间 `EVIDENCE-REVIEW.txt`/`README.md`/`ps1` 仍在被写（见文首提示）。本报告结论绑定上文 sha256；若后续再改动需重新复验。
