# 修复验收复核：`l2_public_contracts` 协议层（3 MINOR / 2 NIT）

- 复核者：`review-1`（独立 pane，非作者）；只读 `src/**`，未改任何源码。
- 位置：`C:\Users\Calvin-Xia\.codex\worktrees\72a4\EvoFence`，分支 `refactor/harness-kernel`，HEAD `7521ebcd`；改动未提交，`git diff --stat` = 13 files / +42 −16。
- 范围：`src/protocol/{codec,defs,errors,objects/*,types}.ts`、`test/protocol-codec.test.js`、`execution/L2-PROTOCOL-NOTES.md`。
- 未碰、也未以其绿灯为证据：`scripts/**`、`test/protocol-guard/**`（codex 正在改）；未跑全量 `npm test`。

## 结论

**需修订（blocker 1）** —— 三项自报修复中，① 注释测试路径、② codec 注释语义 均已按实测对齐；③ 的**预期行为全部达成**，但其实现方式引入了一个**新回归**：`decode('AssetRef', …)` / `decode('CapabilityAsset', …)` 对**合法**的资产封套 `evofence.assets/1 @ 1.0.0` 返回 `EFK_PROTOCOL_UNSUPPORTED`，因为新门拿 `$defs.ProtocolVersion`（runtime namespace）去校验 `$defs.AssetProtocolVersion`。现有 27 条测试无一条覆盖这两个定义作顶层解码，所以门禁全绿而缺陷存在。

## 实测证据

```
npm run build                         # = node node_modules/typescript/bin/tsc → exit 0
node node_modules/typescript/bin/tsc --noEmit              → exit 0
node --test test/protocol-codec.test.js test/protocol-ids-version-errors.test.js test/protocol-schema-drift.test.js
#   ℹ tests 27 / ℹ pass 27 / ℹ fail 0        （26→27，与自报一致）

grep -rn "test/protocol/" src/protocol/          → NONE
grep -rc "test/protocol-schema-drift.test.js" src/protocol/*.ts src/protocol/objects/*.ts
#   defs.ts:1 errors.ts:1 types.ts:1 objects/{assets,core,evaluation,graph,index,policy,runtime}.ts 各 1 → 共 10 处
```

任务点名的三条嵌套路径（全部符合预期）：

```
(a) decode('Command', {protocol:{namespace:'evofence.runtime/1',schemaVersion:'9.9.9'}})
      → EFK_PROTOCOL_UNSUPPORTED :: Command.protocol.schemaVersion: "9.9.9" is not one of 1.0.0 / 1.1.0   （路径含 Command.protocol ✓）
(b) decode('Command', {protocol:{namespace:'evofence.runtime/1'}})
      → EFK_SCHEMA_INVALID :: Command.protocol: missing required field "schemaVersion"                  ✓
(c) decode('NodeStateEntry', {…, protocol:{namespace:'evofence.runtime/1',schemaVersion:'9.9.9'}})
      → EFK_SCHEMA_INVALID :: NodeStateEntry: unknown field "protocol"                                  ✓（未被版本门劫持）
另：decode('Command', {protocol:{namespace:'evofence.runtime/2',schemaVersion:'1.1.0'}}) → EFK_PROTOCOL_UNSUPPORTED ✓
```

## BLOCKER

### B1. `decode()` 的新 S02 门对资产封套用错真相源，合法的 `AssetRef`/`CapabilityAsset` 被拒绝

- 位置：`src/protocol/codec.ts:220-231`（新增于 `decode`）
  ```ts
  const declared = (DEFS[name] as Def).properties?.protocol;
  if (declared !== undefined) { … decodeProtocolVersion(protocol, `${name}.protocol`) … }
  ```
  该分支只看「定义是否声明了 `protocol` 属性」，不区分这个 `protocol` 指向哪个 `$ref`；而 `decodeProtocolVersion` 固定用 `DEFS.ProtocolVersion`（`namespace` 为 `evofence.runtime/1`）。
- 事实：`SCHEMAS.md $defs` 中 `protocol` 指向 **`AssetProtocolVersion`** 的定义有 2 个（其余 11 个指向 `ProtocolVersion`）：
  ```
  AssetRef         protocol -> #/$defs/AssetProtocolVersion   (namespace evofence.assets/1, schemaVersion 1.0.0)
  CapabilityAsset  protocol -> #/$defs/AssetProtocolVersion
  ActivationReceipt protocol -> #/$defs/ProtocolVersion        (runtime，不受影响)
  ```
- 实测（合法输入）：
  ```
  decode('AssetRef', {protocol:{namespace:'evofence.assets/1',schemaVersion:'1.0.0'}, assetId:'a1', revision:1,
                      digest:'sha256:…', scope:{…}, qualificationRef:null})
      → EFK_PROTOCOL_UNSUPPORTED :: AssetRef.protocol.namespace: expected "evofence.runtime/1", got "evofence.assets/1"
  decode('CapabilityAsset', {protocol:{…assets/1…}, asset:(合法 AssetRef), kind:'skill', …})
      → EFK_PROTOCOL_UNSUPPORTED :: CapabilityAsset.protocol.namespace: expected "evofence.runtime/1", got "evofence.assets/1"
  ```
  同一条 `AssetRef` 值作为**嵌套**内容（`EvaluationReceipt.candidate`）解码正常（`OK`）——门只在顶层定义声明 `protocol` 时触发，所以影响面明确：**凡把 `AssetRef`/`CapabilityAsset` 作顶层目标解码的路径全部失效**（资产晋升/激活/资格核验是 L2 assets 的正路）。`INTERFACES.md:14` 明确「资产引用独立 `evofence.assets/1`（其 schemaVersion 独立）」，所以这不是"应当拒绝"的输入。
- 为什么没被测出：`grep -rn "decode('AssetRef'\|decode('CapabilityAsset'" test/` → `NONE`；套件里唯一涉及 assets 的两个断言是 `decodeRuntimeVersion(assets) → false` 与 `gateRuntimeVersion(assets) → 'unsupported'`，恰好是"应拒"方向。
- 建议（任一）：① 门只在 `declared.$ref === '#/$defs/ProtocolVersion'` 时启用；② 或按 `declared.$ref` 选择真相源（`AssetProtocolVersion` 是固定 `const` 对，值不符应回落到 `EFK_SCHEMA_INVALID`/资产域码，而不是 runtime 的 `EFK_PROTOCOL_UNSUPPORTED`）。无论哪种，请补一条把 `AssetRef`/`CapabilityAsset` 作顶层解码的**正向**测试——本次回归正是"只测应拒方向"造成的。

## 逐条 MINOR / NIT 状态

| # | 上一轮问题 | 状态 | 证据 |
|---|---|---|---|
| MINOR-1 | `decodeProtocolVersion` 注释称"wrong type → EFK_SCHEMA_INVALID"，与实测不符 | **已修** | 注释改为"**值**与 namespace/schemaVersion 不符 → `EFK_PROTOCOL_UNSUPPORTED`；缺 `namespace` 或结构错 → `EFK_SCHEMA_INVALID`"。实测：`decodeProtocolVersion(5)` → `EFK_SCHEMA_INVALID`（结构），`decodeProtocolVersion({namespace:123,schemaVersion:'1.1.0'})` → `EFK_PROTOCOL_UNSUPPORTED`（值），`decodeProtocolVersion({})` → `EFK_SCHEMA_INVALID`（缺字段）。三种情况与新注释一致 |
| MINOR-2 | 封套内嵌未知 `schemaVersion` 返回 `EFK_SCHEMA_INVALID`，不符 S02 | **已修（但有回归，见 B1）** | 三条路径 (a)(b)(c) 实测符合预期；(a) 的 message 带 `Command.protocol` 路径（`at` 参数生效）；新测试 1 条，26→27。缺口：门对 `AssetProtocolVersion` 用错真相源 |
| MINOR-3 | 10 处注释指向不存在的 `test/protocol/schema-drift.test.ts` | **已修** | `git diff` 逐处确认 10 个文件各改 1 行；`grep -rn "test/protocol/" src/protocol/` → NONE |
| NIT-1 | 校验器三处"比 JSON Schema 更严"的潜在语义（`minLength` 按 UTF-16 单元、`additionalProperties` 子 schema 也作用于已声明键、无 `type` 的 `{properties}` 节点要求对象） | **未处理（可接受）** | `defs.ts` 除路径外无改动；三处在当前冻结 schema 下**仍不可达**（`minLength` 只有 1；`properties`+子 schema `additionalProperties` 组合为 0；该类节点只出现在被对象守卫包住的 `if/then` 与 `BudgetAnyOf` 分支）。属已披露的近似，不阻塞 |
| NIT-2 | `L2-PROTOCOL-NOTES §5.1` 记 `npm test` 423/423/0（实测曾 422/1） | **仍有残留，且新增计数漂移** | 本次已把 §4.2 的 `decode` 行改准确（+1 行 diff）；但 §2（第 43/45 行）与 §5.1（第 111 行）仍写"本节点 **26** 条协议断言""差值 26""423/423"。加了测试后应为 **27**（总数 424）。建议随本轮一起更新，避免消费者照旧数字核对 |

## 其它核对结论

1. **注释路径**：10/10 已改，`src/protocol/` 下无 `test/protocol/` 残留；`L2-PROTOCOL-NOTES.md` 用的本来就是正确名。
2. **`at` 参数**：`decodeProtocolVersion(value, at = 'ProtocolVersion')` 为**可选**新增参数，导出面未变（`index.ts` 无改动），不构成破坏性变更；实测嵌套 message 带 `Command.protocol.…` 路径。
3. **门的前置顺序**：门先于 `validate` 返回，因此"版本对非法 + 其它必填缺失"的输入会先报 `EFK_PROTOCOL_UNSUPPORTED`（如路径 (a) 只传 `protocol`）。这与 S02 的"未知版本即协议错误"一致，`ERRORS.md` 也未规定 `EFK_PROTOCOL_UNSUPPORTED` 与 `EFK_SCHEMA_INVALID` 的先后，故只作记录、不判缺陷。附带确认：`protocol: null` 不被跳过（→ `EFK_SCHEMA_INVALID`），`value` 非对象/`protocol` 缺失时门不触发而由 `validate` 报缺字段或类型错。
4. **未使用 guard**：`scripts/check-core-imports.mjs`、`test/protocol-guard/**` 在本工作区有未提交改动（codex 在进行），本轮既未修改也未引用其结论。
5. **未跑全量 `npm test`**（按要求），因此护栏/并发 lane 的既有 flake 不在本次判定内。

## 遗留清单（按优先级）

1. **[BLOCKER]** B1：`decode()` 的 S02 门改用 `declared.$ref` 判定真相源；补 `AssetRef`/`CapabilityAsset` 顶层正向测试。
2. **[NIT]** `L2-PROTOCOL-NOTES.md`：§2/§5.1 的断言计数 26→27、总数 423→424。
3. **[NIT，可选]** 上一轮 NIT-1 的三处潜在语义仍可保持（不可达），若日后引入 `minLength>1` 或 `properties`+子 schema `additionalProperties` 需先修。
