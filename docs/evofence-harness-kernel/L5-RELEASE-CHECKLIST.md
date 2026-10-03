# L5 发布清单与授权边界

本文件位于 tracked 文档目录；`node --test` 不读取 execution 中的过程记录。可审查候选见 [L5-RELEASE-CANDIDATE.md](L5-RELEASE-CANDIDATE.md)。

**本节点不授权 tag/publish**。本次仅本 lane 文档、发布核验脚本和测试改动；集成点只读。未执行 commit/push/merge/tag/publish/install；未改源码、exports、工作流、图或凭据。没有发布授权。

## 版本裁决（2026-10-03）

用户裁决：允许为后续可能的 tag 做准备，把版本改到 `0.5.0`；tag/publish 仍需用户明确授权，merge 需用户审核，均未执行。本 lane 据此同步 `package.json`、`package-lock.json`、`CHANGELOG`（`## Unreleased` + `## 0.5.0`，无发布日期、无发布主张）、双语 README、插件/集成的版本手同步点与 `test/release.test.js`；`exports` 与 `src/**` 未动。`0.4.2` 是远端 registry 上一版本，`0.5.0` 尚未 tag/publish。

## 发布前置与后续步骤（全部待授权/待核实）

- [x] 2026-10-03 用户裁决：为后续可能的 tag 把 `package.json` / `package-lock.json` 置为 `0.5.0`；tag/publish 仍需用户明确授权、merge 需用户审核，均未执行。
- [ ] orchestrator 接收候选、合并后复跑全部适用检查；本 lane 的新改动尚不在远端 CI 上。
- [ ] PR 精确 head 的 Ubuntu/Windows × Node 22/24 CI 全绿；以当时的远端原始输出核实。
- [ ] DoD 全绿并获最终真人 l5_accept；core guard 的39条 I08、未来 createKernel 合同及 L4 未决证据须在各自授权范围裁决。
- [x] 版本化 breaking changelog（`## Unreleased` + `## 0.5.0`，无发布日期）、package/lock 一致（均 `0.5.0`）；旧 ledger/config/旧 graph 冻结不改，新 namespace 独立，核对 legacy 对照。
- [ ] 再构建、运行项目 check/e2e/config-doc、static-audit、core-imports、pack 路径/文档/授权边界核验，保留真实负控证据。
- [ ] 此后才可在另外明确授权下创建 tag / GitHub release，核验 release metadata/Trusted Publishing workflow，按 stable/latest 或 prerelease/beta 选择。
- [ ] 发布后另外核实 registry version、精确 tag/commit 与 publish workflow 的原始输出；不以命令 exit 0 代替状态证据。

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

解读边界：本 checkout 的 `package.json` / `package-lock.json` / 清单 / 双语 README / 插件 manifest 已按 2026-10-03 裁决同步为 `0.5.0`，但注册表 historical latest 仍为 `0.4.2`，`0.5.0` 尚未 tag/publish、本 lane 变更未进入注册表；PR #21 为 `OPEN` 非 draft，但只证明其当时 head 的 CI，不证明本 lane 未提交改动已过 CI；`git log` 与空标签列表不证明 merge 或发布。HEAD 标签检查要求为空；有标签即阻塞，不删除标签。

## 必须保留的负结果与未决事项

受控收益 **inconclusive**；l4_capability_trial attempt 1 **failed**（blocker 1 / major 2 / minor 2 / nit 1）。失败包括 CRLF/LF 冻结 manifest 不可移植、self-check 受祖先 AGENTS.md 影响、准入界限与预留包络失配而无任务级统计证据。**747 / 943 USD 并列未裁决**；预注册设计包络 **938.470100 USD**，与微美元请求预留、实际 settled 花费分别记账，不能混作本次消费。

真相源为集成点本地 [L4 capability-trial 独立复核 dossier](execution/reviews/L4-capability-trial-verify-dossier.md)、[L4-L5 剩余评估 §6](execution/L4-L5-REMAINING-ASSESSMENT.md)、[SESSION-007-HANDOFF §4/§8/§9](execution/SESSION-007-HANDOFF.md)。这些是 process records，不随 PR/npm 包交付；测试只校验本文件承接的事实，不读取这些本地文件。attempt 2 未被本 lane 判定通过。

`adr_0001` / `adr_0004` 仍 proposed；雾区 `dual-host-runtime-and-uplift` 不毕业。收益未建立不能写成达成，也不能从失败推定收益为负。

execution/MODEL-BUDGET.json 只读快照：settledUsd 0.00198217 / reservedUsd 0 / unknownSpend false，属 S01 旧账；SESSION-007 记录 capability 累计 0.0054597644 / limit 0.50 USD，是另一账目范围。任何后续 unknownSpend 必须保留，不按零回收。本节点 provider 调用 0，不修改任何账本。

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

本地交接路径：execution/L5-RELEASE-HANDOFF.md。execution 下的 L5-RELEASE-CANDIDATE.md / L5-RELEASE-CHECKLIST.md 为指向 tracked 产物的索引，不参与 node --test。
