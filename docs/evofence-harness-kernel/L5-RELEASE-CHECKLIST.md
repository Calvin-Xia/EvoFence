# L5 发布清单与授权边界

本文件位于 tracked 文档目录；`node --test` 不读取 execution 中的过程记录。可审查候选见 [L5-RELEASE-CANDIDATE.md](L5-RELEASE-CANDIDATE.md)。

**本节点不授权 tag/publish**。该 lane 提交其产物时只改 lane 文档、发布核验脚本和测试；集成点只读，未执行 commit/push/merge/tag/publish/install；未改源码、exports、工作流、图或凭据。

tag 与 GitHub Release 由**用户**在 2026-10-03 **另外明确授权**，见下面「发布授权」一节。本节点的 `nodeAuthorizesPublish: false` 记录的是**节点**授权范围，不因用户授权而改写：节点没有授权过发布，用户授权了。

## 版本裁决（2026-10-03）

用户裁决：允许为后续可能的 tag 做准备，把版本改到 `0.5.0`；tag/publish 仍需用户明确授权，merge 需用户审核，均未执行。本 lane 据此同步 `package.json`、`package-lock.json`、`CHANGELOG`（`## Unreleased` + `## 0.5.0`，无发布日期、无发布主张）、双语 README、插件/集成的版本手同步点与 `test/release.test.js`；`exports` 与 `src/**` 未动。`0.4.2` 是远端 registry 上一版本，`0.5.0` 尚未 tag/publish。

## 发布授权（2026-10-03）

用户于 2026-10-03 明确授权创建 tag 与 GitHub Release：`v0.5.0` 打在本 checkout 的 `main` 上，GitHub Release 触发 `publish.yml`，经 OIDC Trusted Publishing 发到 npm `latest`。`0.5.0` 不带 `-`，因此 Release 不得勾 prerelease，且发布工作流会先跑 `npm test`。这仍是**用户**的授权，不是本节点的；上文 `nodeAuthorizesPublish: false` 与本节并存，两者说的不是同一件事。

## 发布授权（2026-10-10）

用户于 2026-10-10 明确授权：创建 tag 与 GitHub Release，把 2026-10-07 只读审计的修复（PR #22）发到 npm `latest`。版本号以 `package.json` 为准（本次 `0.5.1`）；Release 不得勾 prerelease，发布工作流会先跑 `npm test`。

本次发布**含一处公共导出移除**：`createFakeHost` 不再由 `evofence/core`、`evofence/runtime` 导出。用户知晓该移除属于破坏性接口变更，并明确裁定把本次修复发布在 0.5.x 线上（semver 例外），而不是推迟到下一个 breaking 线；该裁定、理由与替代方案由本节与 `CHANGELOG.md` 的 0.5.1 条目共同记录。上文 `nodeAuthorizesPublish: false` 依旧只描述**节点**授权范围。

## 发布前置与后续步骤

- [x] 2026-10-03 用户裁决：为后续可能的 tag 把 `package.json` / `package-lock.json` 置为 `0.5.0`。
- [x] orchestrator 接收候选、合并后复跑：PR #21（`refactor/harness-kernel`）经用户审核以 merge commit `74798e6` 落地 `main`；四张图随本地面一并保留，`evofence-harness-kernel` 终态 40/40 passed、`validate` 0 错误、`export --docs --check` 21 文件无漂移。
- [x] `main` 精确 merge SHA 的 CI 4/4 全绿（run `37125978702`：ubuntu/windows × Node 22/24），e2e 24/24、fail 0。
- [x] DoD 全绿并获最终真人 `l5_accept`（由用户裁决关闭，非执行方自签）。core guard 的 39 条 I08、未来 `createKernel` 合同及 L4 未决证据仍留在各自授权范围，未借发布放宽。
- [x] 版本化 breaking changelog、package/lock 一致（均 `0.5.0`）；旧 ledger/config/旧 graph 冻结不改，新 namespace 独立。
- [x] 合并后复跑：`npm run build` / `typecheck` / `src:policy` / `dep:check` / `config:doc` exit 0；`npm run test:e2e` 24/24；`node verification/kernel/static-audit.mjs` exit 0（status passed）；`node scripts/check-core-imports.mjs` exit 1（39 I08，上游既有，未修未放宽）。
- [x] 发布核验：`RELEASE_TAG=v0.5.0 RELEASE_IS_PRERELEASE=false node scripts/verify-release-metadata.js` exit 0（`Release v0.5.0 matches package 0.5.0`、8 typed exports、1238 pack 条目、0 私有/generated 路径）；`node scripts/verify-publish-workflow.js` exit 0。
- [x] 在另外的明确授权下创建 tag 与 GitHub Release（2026-10-03，见「发布授权」一节）；按 stable/latest 选择，未用 prerelease/beta。
- [x] 发布后核实（不以 exit 0 代替状态证据）：tag `v0.5.0` = commit `387c248`；publish workflow run `37128739574` success，日志原文含 `npm notice Publishing to https://registry.npmjs.org/ with tag latest`、`Signed provenance statement`、`+ evofence@0.5.0`；registry 直查（带缓存击穿）显示 `dist-tags.latest = 0.5.0`、`time['0.5.0'] = 2026-10-03T14:16:02.266Z`，且 `dist.shasum` / `dist.integrity` 与工作流日志逐字符一致（`99d136ab…` / `sha512-iMN9jAPY…`）。消费者侧另装一份：`npm i evofence@0.5.0` 得 0.5.0，`evofence --version` 输出 0.5.0，8/8 export 子路径可解析，`fileCount` 1234、私有/generated 目录 0 命中，`dist.attestations.provenance.predicateType` = `https://slsa.dev/provenance/v1`。

已有 [publish.yml](../../.github/workflows/publish.yml) 在 release.published 后执行 build/metadata/workflow guard/npm test；本节点没有触发它。新增逐 pack 路径检查进入已有 metadata guard；release tests 被 npm test 自动发现。config-doc/e2e/static-audit 未全进入 publish workflow，core-imports 仍为手动诊断，这是目前边界。

## 本 lane 实测

同一净检出的一次性读数（build 与 `node --test` 均按仓库脚本口径执行；`0.5.0` 版本裁决后按同一文件集复跑，数字不变）：

| 命令 | exit | 读数 |
| --- | --- | --- |
| `npm run build` | 0 | tsc 无输出 |
| `npm run typecheck` | 0 | — |
| `npm run src:policy` | 0 | 303 TypeScript 文件，最大 350 行 |
| `npm run dep:check` | 0 | 303 modules / 1255 edges / 0 cycles |
| `npm run check` | 0 | typecheck + src:policy + dep:check + 1360 tests |
| `npm test` | 0 | 1360 tests / 1360 pass / 0 fail（约 118 s） |
| `node --test test/release.test.js test/l5-release-*.test.js` | 0 | 29 tests / 29 pass / 0 fail |
| `npm run test:e2e` | 0 | 24 tests / 24 pass / 0 fail |
| `npm run config:doc` | 0 | config-doc guard passed |
| `node verification/kernel/static-audit.mjs` | 0 | JSON status pass |
| `node scripts/check-core-imports.mjs` | 1 | 90 files / 39 I08；上游 r2 已知诊断，未修、未放宽 |
| `npm pack --dry-run --json --ignore-scripts --cache .npm-cache` | 0 | 1222 条目，0 私有/generated 路径，未落盘 tgz |

逐 bin / 逐 export / 逐 pack 路径核验与负控结果见 [候选 §可复现验证](L5-RELEASE-CANDIDATE.md)。真实变异 5 条（文件级改 → 跑同一组 release 测试变红 → 字节级复原 → 复跑回绿），最终 29/29，0 残留；`0.5.0` 裁决后按同一文件集复跑 5/5 变红、复原、最终 29/29，另把 12 份被读文本整体转 CRLF 复跑 46/46 绿并字节复原（断言不依赖 LF/CRLF）；新增测试读取的每个路径逐个 `git check-ignore` 均为未忽略。日志仅存本地 execution，不作为测试输入。

## 集成点只读复跑（不改集成点）

集成点头 `24af884f34d4dcb3bb899856d91c7fca42011abc` 与本 lane 基线相同；复跑前`git status --porcelain` 只有既有的 `?? experiments/`。仅运行不写工作区的检查：

| 命令 | 集成点 exit | 读数 |
| --- | --- | --- |
| `npm run typecheck` | 0 | — |
| `npm run src:policy` | 0 | 303 TypeScript 文件，最大 350 行 |
| `npm run dep:check` | 0 | 1255 edges / 0 cycles |
| `node verification/kernel/static-audit.mjs` | 0 | status pass |
| `node scripts/check-core-imports.mjs` | 1 | 91 files / 39 I08 |

会先写 `dist/` 的 build 包装（`check`/`test`/`test:e2e`/`config:doc`）不在集成点运行，以保持集成点只读；集成点 HEAD 与本 lane 基线相同且本 lane 未改 `src/`，源码面读数因此与 lane 一致，合并后仍须由 orchestrator 复跑。复跑后 `git status --porcelain` 仍只有既有 `?? experiments/`。

## 只读发布状态核实（原始输出）

命令原样输出：

```text
$ git log -1 --oneline
24af884 fix(l5): accurate attribution in the bridge containment comment (delta review F1); l5_sp_bridge passed 38/40

$ git tag --points-at HEAD
(空)

$ npm view evofence version dist-tags
version = '0.4.2'
dist-tags = { latest: '0.4.2' }

$ gh pr view 21 --json isDraft,state,changedFiles,title
{"changedFiles":424,"isDraft":false,"state":"OPEN","title":"harness-kernel: L1-L5 graph 38/40 passed — host-independent kernel, dual-host surfaces, SDK/CLI/SP-bridge; controlled-benefit inconclusive"}

$ gh pr checks 21
8 行全部 pass：ubuntu-latest 与 windows-latest × Node 22/24，两次 run（37114260007、37114262410）各 4 job。
```

> **历史读数（已被后文取代）**：下面这段记录的是 PR 合并前、发布前的判断。其中的「`0.5.0`
> 尚未 tag/publish」与「PR #21 为 `OPEN`」已被紧随其后的 2026-10-03 后续读数（PR 为
> `MERGED`）以及文末的发布后核实推翻。原文保留以便追溯，**不要**把它当作当前状态。

解读边界：本 checkout 的 `package.json` / `package-lock.json` / 清单 / 双语 README / 插件 manifest 已按 2026-10-03 裁决同步为 `0.5.0`，但注册表 historical latest 仍为 `0.4.2`，`0.5.0` 尚未 tag/publish、本 lane 变更未进入注册表；PR #21 为 `OPEN` 非 draft，但只证明其当时 head 的 CI，不证明本 lane 未提交改动已过 CI；`git log` 与空标签列表不证明 merge 或发布。HEAD 标签检查原为「必须为空」；2026-10-03 授权后改为「HEAD 上的 tag 必须恰好等于 `v<package version>`，且本清单留有那次用户授权的原文」——未记录授权的 tag 仍然阻塞，不删除标签。

该改动做了真负控（临时 tag 只在本地建，不 push）：本地给 HEAD 打 `v0.5.0`、且本清单授权原文在位时，发布相关测试 24/24 绿；把授权原文从本清单删掉后，同一条 cp3 测试变红（`a tag on HEAD requires the recorded user release authorization`）；字节级复原后复绿；临时 tag 随即删除。

2026-10-03 后续读数（同一命令口径）：`git log -1 --oneline` = `74798e6 Merge pull request #21 from Calvin-Xia/refactor/harness-kernel`；`gh pr view 21 --json state` = `{"state":"MERGED"}`；`gh run view 37125978702` = 4 job 全 success；打 tag 前 `npm view evofence version dist-tags` 仍为 `0.4.2` / `{ latest: '0.4.2' }`。这些读数只说明前置条件达成，不构成本次发布已经完成的证据；发布结果按最后一节单独核实。

## 必须保留的负结果与未决事项

受控收益 **inconclusive**；l4_capability_trial attempt 1 **failed**（blocker 1 / major 2 / minor 2 / nit 1）。失败包括 CRLF/LF 冻结 manifest 不可移植、self-check 受祖先 AGENTS.md 影响、准入界限与预留包络失配而无任务级统计证据。**747 / 943 USD 并列未裁决**；预注册设计包络 **938.470100 USD**，与微美元请求预留、实际 settled 花费分别记账，不能混作本次消费。

真相源为集成点本地 process records：`execution/reviews/L4-capability-trial-verify-dossier.md`、`execution/reviews/L4-capability-trial-verify-b-dossier.md`、`execution/L4-L5-REMAINING-ASSESSMENT.md`、`execution/SESSION-007-HANDOFF.md`（**本地保留面，不随 PR / npm 包交付**）；测试只校验本文件承接的事实，不读取这些本地文件。attempt 2 于 2026-10-03 **passed**（独立复核 16/16），但其成立范围仅为 r2 的有界 pilot 标准，**不构成收益成立**。

另记一条**上游真缺陷（major，非本节点、未修）**：`src/runtime/session/plans.ts` 在 join 未完成时产出 `changedIds=[id,id]`（`src/kernel/graph/readiness.ts` 的 `joinReadiness` 在 join 未完成时把 gap.node 设成 join 自身 id），违反 `src/protocol/objects/runtime.ts` 的 `uniqueItems: true`；**正常可达、确定性触发**，且写侧无 wire-codec 门禁（非法事件静默落盘，只有 `decode('Event')` 才报 `EFK_SCHEMA_INVALID`）。修法在产出侧，属 L2/L3 所有权。

`adr_0001` / `adr_0004` 仍 proposed；雾区 `dual-host-runtime-and-uplift` 不毕业。收益未建立不能写成达成，也不能从失败推定收益为负。

`execution/MODEL-BUDGET.json` 只读快照：settledUsd 0.00198217 / reservedUsd 0 / unknownSpend false，属 S01 旧账；capability 账本 `experiments/capability/MODEL-BUDGET.json` 现为 **settledUsd 0.0080161252 / limit 0.50 / reservedUsd 0.009547 / unknownSpend true**（27 行 = 4 继承 + 23 新，22 settled + 1 unknown），扣预留后余额 **0.4824368748**，`actualInvoiceUsd` 为 `null`（官方价表测算 ≠ 账单）。任何 unknownSpend 必须保留，不按零回收。本节点 provider 调用 0，不修改任何账本。

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

## 集成边界与交接

初始 lane 干净；lane/integration HEAD = 24af884f34d4dcb3bb899856d91c7fca42011abc；集成点初始 git status 只有 `?? experiments/`，这些既有文件保留。集成点不运行 npm run build/check/test/config:doc 等构建封装，不安装、不 pack、不写日志到该处。仅运行已核实不会在集成目录写入的检查与使用 os.tmpdir fixture 的选定测试；新增 lane 产物在集成点未落盘，合并后复跑仍待 orchestrator。

本地交接路径（**本地保留面，不随包交付**）：`execution/L5-RELEASE-HANDOFF.md`。`execution/` 下的同名 CANDIDATE / CHECKLIST 为指向 tracked 产物的索引，不参与 `node --test`。
