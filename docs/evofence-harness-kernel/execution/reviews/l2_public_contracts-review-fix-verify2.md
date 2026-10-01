# 第二轮修复验收复核：`l2_public_contracts` B1（资产封套版本门用错真相源）

- 复核者：独立复核 pane（`rev-protocol`），非作者；只读 `src/**`，未修改任何源码。
- 位置：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`，HEAD `cf8a240d`。
- 范围：`src/protocol/**`、`test/protocol-codec.test.js`、`execution/L2-PROTOCOL-NOTES.md` 的 B1 部分。
- 未碰、也未以其绿灯为证据：`test/protocol-guard/**`、`scripts/**`；未跑全量 `npm test`。
- 状态说明：任务描述称改动「未提交」，实测**已提交**——B1 修复位于 `HEAD~1` = `5d96a7d`（`review fixes — per-domain version gate …`），工作区 `src/**`、`test/protocol-codec.test.js` 相对 HEAD 干净。本复核针对该已提交状态。

## 结论

**可接受** —— B1 已真正修好。门改为**由被声明属性的 `$ref` 推导真相源**，`AssetRef`/`CapabilityAsset` 的两个合法资产封套正向解码恢复；两域（runtime 用 `ProtocolVersion`、assets 用 `AssetProtocolVersion`）不共用枚举；runtime 三类路径无回归。任务点名的 7 条探针全部符合预期，且经程序化枚举确认「声明了 `protocol` 的定义一律被门校验、不存在静默跳过」。

## 1) 逐项运行期探针（自写脚本 import `dist`，非读注释/报告）

脚本：`%TEMP%/b1verify/probe.mjs`（仓库外，未污染仓库）。实测输出：

| # | 输入 | 期望 | 实测 |
|---|---|---|---|
| (a) | `decode('AssetRef', assets/1 @ 1.0.0)` | OK | **OK** ✅ |
| (b) | AssetRef namespace 换 `evofence.runtime/1` | `EFK_PROTOCOL_UNSUPPORTED`，消息带 `AssetRef.protocol.namespace` | **`EFK_PROTOCOL_UNSUPPORTED :: AssetRef.protocol.namespace: expected "evofence.assets/1", got "evofence.runtime/1"`** ✅ |
| (c) | AssetRef `schemaVersion: '1.1.0'` | `EFK_PROTOCOL_UNSUPPORTED`（assets 域只允许 1.0.0） | **`EFK_PROTOCOL_UNSUPPORTED :: AssetRef.protocol.schemaVersion: expected "1.0.0", got "1.1.0"`** ✅ |
| (d) | AssetRef 缺 `schemaVersion` | `EFK_SCHEMA_INVALID` | **`EFK_SCHEMA_INVALID :: AssetRef.protocol: missing required field "schemaVersion"`** ✅ |
| (e) | `decode('CapabilityAsset', …)` + runtime 版本对 | `EFK_PROTOCOL_UNSUPPORTED` | **`EFK_PROTOCOL_UNSUPPORTED :: CapabilityAsset.protocol.namespace: expected "evofence.assets/1", got "evofence.runtime/1"`** ✅（同定义合法资产对 → **OK**） |
| (f) | `NodeStateEntry` + `protocol` 字段 | `EFK_SCHEMA_INVALID` unknown field（不被门劫持） | **`EFK_SCHEMA_INVALID :: NodeStateEntry: unknown field "protocol"`** ✅ |
| (g) | `decodeProtocolVersion({runtime/1, 1.1.0})` | OK | **OK** ✅ |

补充正向/负向（同批探针）：

- `decode('CapabilityAsset', assets/1 @ 1.0.0 完整合法值)` → **OK** ✅（含内嵌合法 `AssetRef`）
- runtime 无回归：`Command + runtime/1@9.9.9` → `EFK_PROTOCOL_UNSUPPORTED`（消息带 `Command.protocol.schemaVersion`）✅；`ActivationReceipt + assets 对` → `EFK_PROTOCOL_UNSUPPORTED`（运行时封套不得用资产对）✅
- 边界：`AssetRef.protocol = null` → `EFK_SCHEMA_INVALID`（`expected object, got null`）；`protocol` 整体缺失 → `EFK_SCHEMA_INVALID`（`expected object, got undefined`）；`ProtocolVersion 1.0.0` → **OK** ✅

## 2) codec 选源逻辑核对（`src/protocol/codec.ts:231-249`）

```
const declared = (DEFS[name] as Def).properties?.protocol;      // codec.ts:238
if (declared?.$ref !== undefined) {                              // :239
  … versionError(refName(declared.$ref) as DefName, protocol, `${name}.protocol`)  // :242
}
```

- **由 `$ref` 推导，非硬编码**：`grep -n "AssetRef|'asset'|==='Asset" src/protocol/codec.ts` → **无命中**。真相源是 `refName(declared.$ref)`（`#/$defs/X` → `X`），门选择完全跟随冻结文档。
- **不可能静默跳过**：程序化枚举 `DEFS`（仓库外脚本 `enumerate.mjs`）实测——
  - 声明了 `properties.protocol` 的定义 **13 个**；其中 `protocol` 属性**全部**是 `$ref`，**没有任何内联（无 `$ref`）**的情况（`WITHOUT $ref: NONE`）；
  - 13/13 在传非法版本对时都返回 `EFK_PROTOCOL_UNSUPPORTED`（`NOT gated: NONE`），即门对每个声明了 `protocol` 的定义都真实执行；
  - 选源分布：`AssetProtocolVersion` → `AssetRef, CapabilityAsset`（2）；`ProtocolVersion` → `ActivationReceipt, ArtifactRef, HostManifest, DecisionRecord, TaskContract, GraphSpec, GraphPatch, Command, Event, Effect, Receipt`（11）。与上一轮复核统计一致。
  - `versionError` 由 `decodeProtocolVersion` 与 `decode` 共用，两域错误映射（`const`/`enum` 值不符 → `EFK_PROTOCOL_UNSUPPORTED`；缺字段/结构错 → `EFK_SCHEMA_INVALID`）不会漂移。
- 门的触发条件为 `protocol !== undefined`；`protocol` 缺失时不触发、由 `validate` 报缺字段（`EFK_SCHEMA_INVALID`），符合「缺失是形状错误、存量值是协议错误」的划分。

## 3) 门禁命令实测

| 命令 | 结果 |
|---|---|
| `npm run build` | **exit 0** ✅ |
| `node node_modules/typescript/bin/tsc --noEmit` | **exit 0** ✅ |
| `node --test test/protocol-codec.test.js test/protocol-ids-version-errors.test.js test/protocol-schema-drift.test.js` | **tests 28 / pass 28 / fail 0**（codec 14 + ids/version/errors 6 + schema-drift 8 = 28；无 skip/todo）✅ |
| （额外佐证自报，只读）`npm run src:policy` | exit 0（161 个 TS，最大 350 行 = 上限；0 个 JS）✅ |
| （额外佐证自报，只读）`npm run dep:check` | modules 161 / edges 561 / cycles 0 / acyclic true ✅ |

「27→28」核对：`git show 5d96a7d -- test/protocol-codec.test.js` 新增 2 个 `test()` 块（"a nested envelope…S02" 与 "asset envelopes are gated against their own version pair…"）；本轮 3 文件合计 **28** 条，与自报 28 一致。

## 遗留（**非阻塞**，不影响 B1 结论）

1. **[NIT，与上一轮同源，仍未处理]** `L2-PROTOCOL-NOTES.md` 的断言计数仍是旧值：§2 第 43/45 行写「26 条断言 / 差值 26」，§5.1 第 111 行写「26 条协议断言」「tests 423」。本轮实测协议断言为 **28**，上轮已应为 27——fixer 只同步了 §4.2 的 `decode` 行（`git show 5d96a7d` 确认该文件仅 1 行改动）。**全量 `npm test` 按任务要求未跑**，故 423→?（推算 425）未经本轮实测，仅提示计数已过时。
2. **[观察，非 B1 回归]** 门只作用于**被 `decode` 的顶层定义自身的 `protocol`**；嵌套封套（如 `CapabilityAsset.asset.protocol` 携带未知版本）经普通 `validate` 返回 `EFK_SCHEMA_INVALID`（`CapabilityAsset.asset.protocol.namespace: expected "evofence.assets/1", got "evofence.runtime/1"`），而非 `EFK_PROTOCOL_UNSUPPORTED`。它**未被静默接受**（仍是拒绝），且属修复前既有作用域，不是本次引入的回归；与 S02「未知版本即协议错误」的字面措辞存在编号层面的不一致，可留待后续节点按需统一。

## 建议

B1 可判**通过**。若本轮一并收口，请顺手把 `L2-PROTOCOL-NOTES.md` §2/§5.1 的 26/423 更新为 28/（跑一次全量后的实际值）。
