# L5 可审查交付候选

本文件位于 tracked 文档目录，随源代码审查交付；`node --test` 只读取这里的候选与清单。它们不在 npm 包 `files` 面内。`execution/` 中的 brief、日志、交接和 dossier 保留为本地过程记录。

lane：`l5-release`；基线：`24af884f34d4dcb3bb899856d91c7fca42011abc`。本节点不授权 tag/publish/merge；候选尚待验收。2026-10-03 用户裁决：为后续可能的 tag，把 `package.json` / `package-lock.json` 版本置为 `0.5.0`；`0.5.0` 尚未 tag/publish，`0.4.2` 仍是远端 registry latest，本 lane 变更未进入注册表。

## 分层与实际产物

| 层 | 源入口 | 构建产物与边界 |
| --- | --- | --- |
| protocol | [src/protocol/index.ts](../../src/protocol/index.ts) | [dist/protocol/index.js](../../dist/protocol/index.js)；冻结 schema/codec/版本 |
| kernel | [src/kernel/index.ts](../../src/kernel/index.ts) | [dist/kernel/index.js](../../dist/kernel/index.js)；纯决策域 namespace |
| runtime/core | [src/runtime/index.ts](../../src/runtime/index.ts) | [dist/runtime/index.js](../../dist/runtime/index.js)；生产 `createSessionService(ports): SessionService`，不存在 `createKernel` factory |
| hosts | [Pi](../../src/hosts/pi/index.ts)、[DSH](../../src/hosts/dsh/index.ts) | [Pi ESM](../../dist/hosts/pi/index.js)、[DSH ESM](../../dist/hosts/dsh/index.js)；显式注入原生宿主 |
| storage | [memory](../../src/storage/index.ts)、[legacy](../../src/storage/legacy/index.ts) | [memory ESM](../../dist/storage/index.js)、[legacy ESM](../../dist/storage/legacy/index.js)；legacy 为仓库直接路径，无 package subpath |
| surface | [src/cli.ts](../../src/cli.ts)、[catalog](../../src/lib/cli/catalog.ts)、[kernel-view](../../src/lib/report/kernel-view.ts) | [dist/cli.js](../../dist/cli.js)、[kernel-view ESM](../../dist/lib/report/kernel-view.js)；薄 CLI 与单一投影 |
| optional bridge | [src/bridges/super-plumber/index.ts](../../src/bridges/super-plumber/index.ts) | [dist/bridges/super-plumber/index.js](../../dist/bridges/super-plumber/index.js)；仓库直接路径，无 package subpath，不依赖 SP CLI |
| legacy root | [src/index.ts](../../src/index.ts) | [dist/index.js](../../dist/index.js)；保留旧 facade；SQLite 依赖不能推定为 core import 的依赖 |

## 已导出的 typed ESM 入口

导出以 [package.json](../../package.json) 为真相源；本 lane 只核验，不改 exports。`./core` 与 `./runtime` 共享同次构建的入口。

| import specifier | source | default | types |
| --- | --- | --- | --- |
| `evofence` | [src/index.ts](../../src/index.ts) | [./dist/index.js](../../dist/index.js) | [./dist/index.d.ts](../../dist/index.d.ts) |
| `evofence/core` | [src/runtime/index.ts](../../src/runtime/index.ts) | [./dist/runtime/index.js](../../dist/runtime/index.js) | [./dist/runtime/index.d.ts](../../dist/runtime/index.d.ts) |
| `evofence/protocol` | [src/protocol/index.ts](../../src/protocol/index.ts) | [./dist/protocol/index.js](../../dist/protocol/index.js) | [./dist/protocol/index.d.ts](../../dist/protocol/index.d.ts) |
| `evofence/kernel` | [src/kernel/index.ts](../../src/kernel/index.ts) | [./dist/kernel/index.js](../../dist/kernel/index.js) | [./dist/kernel/index.d.ts](../../dist/kernel/index.d.ts) |
| `evofence/runtime` | [src/runtime/index.ts](../../src/runtime/index.ts) | [./dist/runtime/index.js](../../dist/runtime/index.js) | [./dist/runtime/index.d.ts](../../dist/runtime/index.d.ts) |
| `evofence/hosts/pi` | [src/hosts/pi/index.ts](../../src/hosts/pi/index.ts) | [./dist/hosts/pi/index.js](../../dist/hosts/pi/index.js) | [./dist/hosts/pi/index.d.ts](../../dist/hosts/pi/index.d.ts) |
| `evofence/hosts/dsh` | [src/hosts/dsh/index.ts](../../src/hosts/dsh/index.ts) | [./dist/hosts/dsh/index.js](../../dist/hosts/dsh/index.js) | [./dist/hosts/dsh/index.d.ts](../../dist/hosts/dsh/index.d.ts) |
| `evofence/storage/memory` | [src/storage/index.ts](../../src/storage/index.ts) | [./dist/storage/index.js](../../dist/storage/index.js) | [./dist/storage/index.d.ts](../../dist/storage/index.d.ts) |

```json release-entries
{
  "bin": {
    "evofence": "dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/runtime/index.d.ts",
      "default": "./dist/runtime/index.js"
    },
    "./protocol": {
      "types": "./dist/protocol/index.d.ts",
      "default": "./dist/protocol/index.js"
    },
    "./kernel": {
      "types": "./dist/kernel/index.d.ts",
      "default": "./dist/kernel/index.js"
    },
    "./runtime": {
      "types": "./dist/runtime/index.d.ts",
      "default": "./dist/runtime/index.js"
    },
    "./hosts/pi": {
      "types": "./dist/hosts/pi/index.d.ts",
      "default": "./dist/hosts/pi/index.js"
    },
    "./hosts/dsh": {
      "types": "./dist/hosts/dsh/index.d.ts",
      "default": "./dist/hosts/dsh/index.js"
    },
    "./storage/memory": {
      "types": "./dist/storage/index.d.ts",
      "default": "./dist/storage/index.js"
    }
  }
}
```

CLI bin 为 `evofence -> dist/cli.js`。全局命令和新观测命令由 `src/cli.ts` 路由到同一 catalog：

```sh
evofence --help
evofence --version
evofence session view review.json --json
```

最后一条要求调用者提供显式 review export，不发现宿主或调用 provider；查询成功不把内部 unknown/inconclusive 改成任务成功。

## 样例、文档与打包面

- [SDK 三宿主可执行样例](L5-SDK-DELIVERY-AND-EXAMPLES.md)及 [SDK surface 测试](../../test/l5-sdk-surface.test.js)：同一生产 SessionService 的 Pi/DSH/fake fixtures；运行 `node --test test/l5-sdk-surface.test.js`。
- [CLI 视图与可执行 recipes](L5-CLI-OBSERVABILITY-VIEWS.md)及 [CLI views 测试](../../test/l5-cli-views.test.js)：`node --test test/l5-cli-views.test.js`。
- [SP 损失报告](L5-SP-BRIDGE-LOSS-REPORT.md)、[往返说明](L5-SP-BRIDGE-ROUNDTRIP.md)：可选互操作，不产生执行资格。
- [中文入口](../../README.md)、[English entry](../../README.en.md)、[config 真相表](../config.md)、[Pi 策略](../pi-tool-strategy.md)、[LICENSE](../../LICENSE)、[CHANGELOG](../../CHANGELOG.md)、[templates](../../templates/)。

冻结 pack allowlist：`dist/`、`templates/`、`docs/pi-tool-strategy.md`、`README.md`、`README.en.md`、`LICENSE`、`CHANGELOG.md`；npm 自动包含 `package.json`。dist 只允许 .js/.js.map/.d.ts/.d.ts.map，.d.ts 是编译声明；其余 TypeScript 源不得入包。逐路径拒绝私有目录、evidence、execution、scenarios、experiments、.graph 和 node_modules。没有上传或 tgz 落盘。

运行时依赖仍只有 `better-sqlite3` 和 `yaml`。不安装依赖；结合现有 lock、已安装依赖加载和只读注册表查询记录可用性，新的干净安装与全部平台 ABI 尚未证明。

## 版本与 breaking 对照

[Unreleased](../../CHANGELOG.md) 与 [legacy 升级对照](../../src/storage/legacy/README.md)一致：旧 ledger/config/旧 graph 保持原样；只读导出一致副本，显式导入独立 archive，不能重写 hash chain、自动迁移或继承执行资格。新 runtime 使用 `evofence.runtime/1@1.1.0`，assets 使用 `evofence.assets/1@1.0.0`；历史导出/归档使用 `evofence.legacy-export/1` / `evofence.legacy-source/1`，schemaVersion `1.0.0`。

版本裁决（2026-10-03）：`package.json` / `package-lock.json` 已置为 `0.5.0`，为后续可能的 tag 做准备；`0.5.0` 是 breaking 线，尚未 tag/publish，`0.4.2` 仍是远端 registry latest。发布清单、双语 README 与插件/集成的版本手同步点已按同一值对齐。发行段只写 `## Unreleased` 与 `## 0.5.0`，不预填发布日期、不写发布主张；tag/publish 仍需用户明确授权，merge 需用户审核。SQLite marker 2、bundle marker 1、YAML version/contract_version 1 和 validator-v2 无版本文档不被新协议默认解释。

## 可复现验证与当前结果

| 命令 | 本 lane 结果 |
| --- | --- |
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run src:policy` | exit 0（303 TypeScript 文件，最大 350 行） |
| `npm run dep:check` | exit 0（303 modules / 1255 edges / 0 cycles） |
| `npm run check` | exit 0（typecheck + src:policy + dep:check + test） |
| `npm test`（build + `node --test`） | exit 0；1360 tests / 1360 pass / 0 fail（约 118 s） |
| `node --test test/release.test.js test/l5-release-*.test.js` | exit 0；29 tests / 29 pass / 0 fail |
| `npm run test:e2e` | exit 0；24 tests / 24 pass / 0 fail |
| `npm run config:doc` | exit 0（config-doc guard passed） |
| `node verification/kernel/static-audit.mjs` | exit 0 |
| `node scripts/check-core-imports.mjs` | exit 1，90 files / 39 I08；上游 r2 已知诊断，未修，未放宽 |
| `npm pack --dry-run --json --ignore-scripts --cache .npm-cache` | exit 0；1222 条目（dist js 303 / d.ts 303 / map 606；templates 4；docs 1；根文件 5），未落盘 tgz |

### 逐 bin / 逐 export / 逐 pack 路径核验

`package.json` 是导出与打包面的唯一真相源；本 lane 只核验不改。可复现命令按顺序执行：

1. `node -e "const p=require('./package.json'),fs=require('fs');for(const [k,v] of Object.entries(p.bin))console.log('bin',k,v,fs.existsSync(v));for(const [s,e] of Object.entries(p.exports))for(const c of ['types','default'])console.log('export',s,c,e[c],fs.existsSync(e[c].replace(/^\.\//,'')));for(const f of p.files)console.log('file',f,fs.existsSync(f.replace(/\/$/,'')));"` — 逐条打印并断言存在。
2. `npm pack --dry-run --json --ignore-scripts --cache .npm-cache` — 取真实 pack 清单，逐条对照冻结 allowlist 与导出目标。

本 lane 实测（净检出即 `npm ci` + `npm run build` 后）：`bin` 1/1 存在；`exports` 8 个子路径 × (types, default) 共 16 个目标全部存在，`types` 与 `files` 全部存在；pack 清单 1222 条中，14/14 个 export/bin 目标在包内、6 份必需根文档在包内、dist 严格只含 `.js`/`.js.map`/`.d.ts`/`.d.ts.map`，私有/generated/execution/scenarios/experiments/evidence/node_modules 路径 0 条，未写出任何 `.tgz`。0.5.0 版本裁决后按同一文件集复跑结果一致，`exports` 目标未变。

### 负控与真实变异（绿 → 红 → 复原 → 绿）

边界断言不止于进程内注入：本 lane 对真实交付文件做文件级变异，跑同一组 29 条 release 测试取得红色失败，再按字节复原（sha256 前后一致），最后复跑回绿，全程 0 残留：

1. `package.json#files` 混入被忽略的 `execution/` 目录路径 → 红（`frozen publish allowlist`）。
2. `package.json#exports["./kernel"].default` 指向不存在的 `./dist/kernel/missing.js` → 红（文档/元数据不一致与缺失产物）。
3. `CHANGELOG.md` 删除 breaking/no-migration 说明 → 红（Unreleased 说明缺失）。
4. 候选删除显式授权边界声明（no-publish 边界）→ 红（缺显式 release authorization boundary）。
5. 清单写入“发布已完成”类主张 → 红（unauthorized release claim）。

每条红线由 `test/l5-release-{boundary,docs,pack}.test.js` 与 `test/release.test.js` 断言；变异与复原由文件级字节比较验证，最终 `29/29` 复绿。

2026-10-03 版本裁决（`0.4.2` → `0.5.0`）后，以上 5 条按同一文件集复跑：5/5 变红、字节级复原、最终 `29/29` 绿。另把 12 份被读文本（候选/清单/CHANGELOG/双语 README/插件与集成 manifest/`test/release.test.js`）整体转为 CRLF 后复跑 `46/46` 绿再按字节复原，新增断言不依赖 LF/CRLF。

最终结果和集成点只读复跑见 [发布清单](L5-RELEASE-CHECKLIST.md)。pack 使用 dry-run、关闭生命周期脚本，缓存只在 lane；发布工作流已有 metadata guard 和 npm test，新增 release tests 由 node --test 自动发现。static-audit 与 core guard 只记录当前结果，不假称已进入 CI/publish workflow；该工作流只读，后续增强需另立范围。

## 双宿主与收益证据的限度

SDK/CLI/包边界证据为 native-fixture；provider-live 本节点不适用，不发模型请求。历史双宿主 scenario 为 13 请求、38,743 tokens、参考 $0.01748496（非发票，首条 Pi raw usage unknown），来自本地 [SESSION-007-HANDOFF §5](execution/SESSION-007-HANDOFF.md)，本节点不重跑、不把它当统计收益。

受控收益 **inconclusive**；l4_capability_trial attempt 1 **failed**（blocker 1 / major 2），历史 **747 / 943 USD 并列未裁决**，预注册设计包络 **938.470100 USD**。依据本地 [独立复核 dossier](execution/reviews/L4-capability-trial-verify-dossier.md)与 [剩余评估 §6](execution/L4-L5-REMAINING-ASSESSMENT.md)。attempt 2 正在重试的 brief 表述不构成 pass，本 lane 不裁决其节点状态。`adr_0001` / `adr_0004` 仍 proposed，雾区 `dual-host-runtime-and-uplift` 不毕业。

```json release-boundary
{
  "nodeAuthorizesPublish": false,
  "benefit": "inconclusive",
  "attempt1": "failed",
  "findings": {
    "blocker": 1,
    "major": 2
  },
  "historicalBudgetUsd": [
    747,
    943
  ],
  "budgetAdjudication": "unresolved",
  "preregisteredEnvelopeUsd": "938.470100",
  "proposedAdrs": [
    "adr_0001",
    "adr_0004"
  ],
  "fog": {
    "dual-host-runtime-and-uplift": "not-graduated"
  }
}
```

供应商取消计费/发票、服务端 high 档语义、OS sandbox、process-kill/disk-crash 恢复、生产 DSH 多请求 E2E、Codex 订阅逐请求用量均未证明。最终人审 l5_accept 仍需真人；包和测试通过不能代替目标收益验收。
