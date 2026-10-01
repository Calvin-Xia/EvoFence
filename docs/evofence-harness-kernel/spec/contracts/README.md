# 双宿主公共协议冻结提案（Dual-host Contract Freeze Proposal）

**结论：冻结提案 `l1-freeze.2` 已形成；供 `l1_replan` 真人定案，不代表人审批准或运行实现通过。** 新协议固定 `evofence.runtime/1`（schemaVersion `1.1.0`）、资产 `evofence.assets/1`（schemaVersion `1.0.0`）。管辖ADR 0001/0004/0006/0009/0010仍为proposed；本lane不修改graph、源代码、旧integration或上游产物，不发布、不装包、不签署。

## 1. 文件索引

| 文件 | 规范内容 |
|---|---|
| [INTERFACES.md](INTERFACES.md) | 对象、服务、版本/状态/取消/预算、四类裁决、能力协商 |
| [SCHEMAS.md](SCHEMAS.md) | JSON Schema 2020-12与63对象/427直接成员逐字段类型、必填、语义、来源 |
| [HOST-MAPPING.md](HOST-MAPPING.md) | 427字段两host路线、44具体证据索引、差异、替代/代价/审批 |
| [ERRORS.md](ERRORS.md) | 58冻结EFK_*字符串、触发/重试策略与typed ErrorEnvelope |
| [OWNERSHIP.md](OWNERSHIP.md) | 未来模块所有权、I01–I08导入guard、A01–A15权威不重叠判据 |
| [OPEN-ITEMS.md](OPEN-ITEMS.md) | H01–H13真人政策选择/证据缺口/试验授权；均pending |

## 2. 一页结论

| 决定 | 本轮立场 |
|---|---|
| 版本 | 独立namespace与精确codec；minor须新schema并显式协商，ownership/必填/语义breaking进新major；旧资料保留为legacy source不直接执行 |
| 可导入core | 仅protocol/kernel/runtime静态闭包；拒绝任何bare import/node builtin、动态import/require、ambient进程/网络/时间/随机、CLI/Git/nativeSQLite/SP重导入；I01–I08可机检 |
| 核心数据流 | Command→授权/预算/11图校验→同CAS journal+claims/leases/reservations/outbox→真实HostPort Receipt→唯一DecisionService→view |
| 唯一权威 | 裁决/持久truth/原生执行/权限根角色分离；每attempt唯一claim、每资源合法lease、每request一次结算、projection无owner权限 |
| 协商 | task.requiredGuarantees按status+证据kind+coverage+pin判定；hard不足unsupported；显式、已证实替代待批准为needs-degradation，批准且完整满足才executable；不按host品牌分支 |
| 取消/恢复 | cancel确认真实停止与lease释放；未确认unknown；epoch迟到只归档；resume/replay不盲重做非幂等外部效果，不调用模型 |
| 预算/错误 | 父子/隐式请求同池预留、usage去重；缺usage保留预留不补0；整数微美元；58具体错误码供host/CLI同源显示 |
| 裁决/演化 | Task/Candidate/Promotion/Activation四kind独立；收益仅按评测v3；train-only资产来源提案；safe idle不等于激活成功 |

计数口径为唯一definition.member，不把递归路径无限展开：**427成员/423必填，15必填有两侧指定范围的直接原生证据；408必填缺至少一侧完整直接证据，其中315是共同kernel拟构造字段，93涉及host/适配保证缺口。** 每项均列替代路线、实现/取证代价与审批ID；“共同kernel可以设计”不等于已verified。15条直接证据里 8 条是宿主能力/身份/版本、7 条是证据包元数据（`EvidenceRef`/`HostSpecific`，只证 kernel 可从固定 probe 文件填入）。315/93 可用 `SCHEMAS.md` 的 `x-mapping` 复算：6 个 commonKernelProfiles 共 315，其余 profile 共 108，其中 15 条同时是 directBothScoped。schema/映射完整不声称目前双host都可执行生产任务。

| 不得抹平的输入冲突 | 保留方式 |
|---|---|
| DSH版本与旧integration | 当前0.2.0-rc.2固定，旧peer/engines仍0.1.7-rc.1；旧plugin不声明兼容（H02） |
| 历史drift证据缺失 | 当前版本verified；旧变更/归因仅orchestrator报告，原npm日志不在artifact，drift unverified、changeTime=null；不重建原文 |
| Pi high | reasoningHighGuarantee=partial；参数接受与server-tier分开，后者未证实（H04） |
| 实时证据等级 | DSH 0付费、6 synthetic calls；Pi 2真实付费请求；fixture不替provider-live（H03） |
| DSH可靠消息 | teamMessageDurable=false、teamMessageDelivery=unknown；queued非target ack（H05） |
| OS隔离 | DSH unknown、Pi raw absent；hooks/worktree不证明OSsandbox（H06） |

下一门只可由真人处置H项与T0/额度；本节点不代签。最关键选择为H01协议/所有权、H02版本兼容、H03/H04实时与reasoning范围、H05/H06可靠消息/隔离、H08试验设计与额度。H09 backend、H10来源漂移、H11包络算术也保留，不静默修源。

## 3. 验证边界与后续义务

本轮检查规范JSON可解析、$ref闭合、每个schema字段有同名映射/类型/必填表、错误码枚举一致、44能力状态+pointer+hash对应实际探针、H项引用和本地链接、只写七文件且23输入hash不变。检查不执行任何付费调用/产品构建，不扩写验证脚本。

L2须实现I01–I08/A01–A15与纯reducer/atomicoutbox、预算/协商/图/恢复conformance；L3两host同suite取证；真人批准不能替这些证据。raw manifests当前没有新版compatibleProtocols，不自动填支持；真实任务/持久效果恢复/强制grant/长期能力收益仍未准入。seven-file提案自洽与“实现已通过”分别报告。

## 4. 授权输入固定（Source Pins）

以下为本轮只读输入的实际字节SHA256；路径相对repo根。必读内容已完整读取；Pi及DSH产物不改，proposed ADR只读。新增外部文档不是本次能力事实来源。下游变更输入时必须重新检查映射，不因文档冻结名沿用旧证据。

```json
{
  "proposal": "l1-freeze.2",
  "inputs": [
    {
      "file": "docs/evofence-harness-kernel/CONTRACTS.md",
      "sha256": "4caf8cc43be96206e22e7d6368c8896a38030b2408b02547f0eef8dcea6cae42",
      "lines": 149
    },
    {
      "file": "docs/evofence-harness-kernel/probes/dsh/README.md",
      "sha256": "5facbb572a5606d5db75ff6e6d1354e9fbf52163f28938202af14aa4af01af83",
      "lines": 112
    },
    {
      "file": "docs/evofence-harness-kernel/probes/dsh/HOST-MANIFEST.json",
      "sha256": "616a0e9af7b9e0d9a4d7a934ee9b349f05c188a96c93808d034bc1001ad4f459",
      "lines": 548
    },
    {
      "file": "docs/evofence-harness-kernel/probes/dsh/VERSION-PIN.json",
      "sha256": "8a1074518d6adfd939c2ab610d4855dac3d0cf45b6fb2518aafdd63b42bb3dbe",
      "lines": 488
    },
    {
      "file": "docs/evofence-harness-kernel/probes/dsh/offline-trace.json",
      "sha256": "65a8df0e26415ddd9cea6047858aa36c66361c46db1f1ed84028f254d984e546",
      "lines": 1912
    },
    {
      "file": "docs/evofence-harness-kernel/probes/dsh/live-trace.json",
      "sha256": "20e30c16f29b9cfacc88924e5566e6620cde27958bbfd6a6a8aae6e22b2daeda",
      "lines": 9
    },
    {
      "file": "docs/evofence-harness-kernel/probes/pi/README.md",
      "sha256": "0e95171a58ce5bc671c98ba93879eb3e08b5274e1ea8a50a8549ce8ec17800cc",
      "lines": 51
    },
    {
      "file": "docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json",
      "sha256": "85718169933628bb2f4302b638ccc79497ee72eeff6dd89950142197b448d99f",
      "lines": 35
    },
    {
      "file": "docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json",
      "sha256": "38c21638b9df54ae50a6d87b11705ae6cde8f24a79285a795f5d38c3f0c9c736",
      "lines": 74
    },
    {
      "file": "docs/evofence-harness-kernel/probes/pi/offline-trace.json",
      "sha256": "200b687995097b69cea3ed22a60bb8fa28edfecc0295f74c8ead570780bab09f",
      "lines": 382
    },
    {
      "file": "docs/evofence-harness-kernel/probes/pi/live-trace.json",
      "sha256": "3ed696eb4983a479b79038aa20499b98c04e25f6d057eb2fe58a7fdbd525006d",
      "lines": 278
    },
    {
      "file": "docs/evofence-harness-kernel/spec/graph/SEMANTICS.md",
      "sha256": "07a1f07959c373ec1511921a36453381388bae92e6c72da5375cfcfa6cdec0ba",
      "lines": 380
    },
    {
      "file": "docs/evofence-harness-kernel/spec/graph/EXAMPLES.md",
      "sha256": "6a3132a73008b1dbd8475fb6bcb665801d5797149cd3e5d93218f7ee35ff9a21",
      "lines": 323
    },
    {
      "file": "docs/evofence-harness-kernel/spec/evaluation/PROTOCOL.md",
      "sha256": "52c1f9360824bac0b70eafddbd97bde26ff4f6e0099b456fa651252034f7e3d4",
      "lines": 234
    },
    {
      "file": "docs/evofence-harness-kernel/spec/evaluation/SCENARIOS.md",
      "sha256": "d87bb76b0e5526037403658c0ee0c35b6a6155f6a4c8f2ed5bfe332da89111e6",
      "lines": 147
    },
    {
      "file": "docs/evofence-harness-kernel/spec/evaluation/METRICS.md",
      "sha256": "dd5c75fdf1437a9fece6586ebd3317fa4879ac90caf4d2c83365af81c58f34fd",
      "lines": 310
    },
    {
      "file": "docs/evofence-harness-kernel/spec/evaluation/PREREGISTRATION.md",
      "sha256": "fbd9f14c33c327816d6f9828463e56b71afa53e146bee4ddf65646a7cfc7fd0e",
      "lines": 131
    },
    {
      "file": "docs/evofence-harness-kernel/spec/evaluation/OPEN-QUESTIONS.md",
      "sha256": "66bde5072e1c1d34d1f37abdc4a458cfd4deb522136700fe871000b4610fdc74",
      "lines": 70
    },
    {
      "file": ".graph/evofence-harness-kernel/nodes/adr_0001.yaml",
      "sha256": "7f695a1215c01e198507ae098c3d5e4a4625950c4d100c93146b049adc4ec81e",
      "lines": 14
    },
    {
      "file": ".graph/evofence-harness-kernel/nodes/adr_0004.yaml",
      "sha256": "d8e326e6bd9599e8510643982a63d390d89e437362340e405d9c4a4d95f1947f",
      "lines": 14
    },
    {
      "file": ".graph/evofence-harness-kernel/nodes/adr_0006.yaml",
      "sha256": "cdc4477adbf167eec02b7622aa5206df5317ce6d6fb20ac2cbc77b01f2123dda",
      "lines": 14
    },
    {
      "file": ".graph/evofence-harness-kernel/nodes/adr_0009.yaml",
      "sha256": "98d40b6c95a4d3777de7c89b923eb547ccfc0a476633bc3319b464184bb65557",
      "lines": 14
    },
    {
      "file": ".graph/evofence-harness-kernel/nodes/adr_0010.yaml",
      "sha256": "fc814875d243bf850fcbeb26b04a1cf2f71ba765baa2b489938098d37e346b8c",
      "lines": 14
    }
  ]
}
```

人审签署时另计算这七份**交付物**hash并绑定ArtifactRef；这里是输入pin，避免README内嵌自身hash的循环。已有模型价格只是源快照/估价基础，非账单、非当前价保证；没有授权试验额度或新模型条件的隐含批准。


## 5. 可复现的文档核验

从repo根运行以下PowerShell，只读取文档/输入、在stdout给出检查结果与七文件hash，不写额外文件：

```powershell
$freezeText = Get-Content -LiteralPath 'docs/evofence-harness-kernel/spec/contracts/README.md' -Raw
$freezeCode = [regex]::Match($freezeText, '(?s)```js\r?\n(// verify-l1-freeze.*?)\r?\n```').Groups[1].Value
$freezeCode | node --input-type=module -
```

此核验是文档字段/证据一致性检查，使用Node内置模块；它不在未来core import闭包里，不证明JSON Schema语义校验器/host adapter/故障conformance已实现。随后分别运行 `git diff --exit-code -- src test test-e2e integrations package.json` 和 `git status --short`；预期保护路径零差异、仅两个既有untracked目录。

```js
// verify-l1-freeze
async function verifyFreeze(){
const assert=(await import('node:assert/strict')).default;
const fs=(await import('node:fs')).default;
const path=(await import('node:path')).default;
const {createHash}=await import('node:crypto');
const lane='docs/evofence-harness-kernel/spec/contracts';
const names=['README.md','INTERFACES.md','SCHEMAS.md','HOST-MAPPING.md','ERRORS.md','OWNERSHIP.md','OPEN-ITEMS.md'];
assert.deepEqual(fs.readdirSync(lane).sort(), [...names].sort(), 'exact seven deliverables');
const docs=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(lane,n),'utf8')]));
const jsonBlocks=d=>[...d.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(m=>JSON.parse(m[1]));
const schema=jsonBlocks(docs['SCHEMAS.md'])[0], defs=schema.$defs;
assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');
assert.equal(defs.ProtocolVersion.properties.namespace.const,'evofence.runtime/1');
assert.equal(defs.AssetProtocolVersion.properties.namespace.const,'evofence.assets/1');
assert.deepEqual(defs.ProtocolVersion.properties.schemaVersion.enum,['1.0.0','1.1.0']);
const visit=x=>{if(x&&typeof x==='object'){
  if(x.$ref){assert.match(x.$ref,/^#\/\$defs\//);assert.ok(defs[x.$ref.slice(8)],'unresolved ref');}
  Object.values(x).forEach(visit);
}};visit(schema);
const section=(d,n)=>d.split('### '+n+'\n')[1]?.split(/\n#{2,3} /)[0];
const fields=d=>[...d.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map(m=>[m[1],m[2].split(' | ')]);
let members=0,required=0,direct=0,kernelMissing=0,hostMissing=0;
const types=s=>{
  if(s.$ref)return s.$ref.slice(8);
  if('const' in s)return JSON.stringify(s.const);
  if(s.enum)return s.enum.join(' / ');
  if(s.anyOf)return s.anyOf.map(types).join(' / ');
  if(s.type==='array')return 'array<'+types(s.items)+'>';
  if(s.type==='object'&&s.additionalProperties?.$ref)return 'map<Id,'+types(s.additionalProperties)+'>';
  return s.type;
};
const evidence=jsonBlocks(docs['HOST-MAPPING.md'])[0].evidence;
const stats=jsonBlocks(docs['HOST-MAPPING.md'])[1];
const proofIds=new Set(evidence.map(e=>e.id));assert.equal(proofIds.size,44);
const objects=Object.entries(defs).filter(([,s])=>s.type==='object'&&s.properties);
assert.equal(objects.length,63);
for(const [n,s] of objects){
  assert.equal(s.additionalProperties,false,'unclosed object '+n);
  const st=new Map(fields(section(docs['SCHEMAS.md'].replaceAll('\r\n','\n'),n)||''));
  const mt=new Map(fields(section(docs['HOST-MAPPING.md'].replaceAll('\r\n','\n'),n)||''));
  assert.equal(st.size,Object.keys(s.properties).length,'schema table '+n);
  assert.equal(mt.size,st.size,'mapping table '+n);
  for(const [f,p] of Object.entries(s.properties)){
    const a=st.get(f),b=mt.get(f),req=s.required.includes(f);
    assert.ok(a&&b,'missing field '+n+'.'+f);
    assert.equal(a.length,4);assert.equal(b.length,6);
    assert.equal(a[1],req?'是':'条件/可省略');assert.equal(b[0],a[1]);
    const expected=types(p),actual=a[0].replace('safe integer','integer');
    assert.ok(actual===expected||(p.type==='object'&&actual==='map<Id,CapabilityObservation>'),'type row '+n+'.'+f);
    assert.equal(a[2],p.description,'meaning row '+n+'.'+f);
    assert.equal(a[3],p['x-source'],'source row '+n+'.'+f);
    for(const cell of b.slice(1))assert.ok(cell.length>0 && !cell.includes('undefined'),'mapping gap '+n+'.'+f);
    for(const side of b.slice(1,3)){
      const ids=side.match(/\b(?:D[0-9]+|P[0-9]+|DV|PV)\b/g)||[];
      assert.ok(ids.length>0,'no evidence seam '+n+'.'+f);
      ids.forEach(id=>assert.ok(proofIds.has(id),'bad proof '+id));
    }
    members++;required+=Number(req);
    if(req){if(b[3].startsWith('yes-scoped'))direct++;
      else if(stats.commonKernelProfiles.includes(p['x-mapping']))kernelMissing++;else hostMissing++;}
  }
}
assert.deepEqual([members,required,direct,kernelMissing,hostMissing],[427,423,15,315,93]);
assert.deepEqual([stats.fields,stats.requiredFields,stats.directBothScoped,stats.noDirectBothRequired,stats.commonKernelRequired,stats.hostGapRequired],[427,423,15,408,315,93]);
assert.deepEqual([stats.directBothScopedHost,stats.directBothScopedEvidenceMeta],[8,7]);
const errorRows=[...docs['ERRORS.md'].matchAll(/^\| (EFK_[A-Z0-9_]+) \| (.+) \| ([a-z-]+) \|$/gm)];
const codes=errorRows.map(m=>m[1]);
assert.equal(codes.length,58);assert.equal(new Set(codes).size,58);
assert.deepEqual([...defs.ErrorCode.enum].sort(),[...codes].sort());
errorRows.forEach(m=>assert.ok(['never','after-refresh','after-authorization','after-reconcile'].includes(m[3])));
for(const d of Object.values(docs))for(const m of d.matchAll(/\bEFK_[A-Z0-9_]+\b/g))assert.ok(codes.includes(m[0]),'unknown error');
const pointer=(v,p)=>p.split('/').slice(1).reduce((o,k)=>{k=k.replaceAll('~1','/').replaceAll('~0','~');assert.ok(o!=null&&Object.hasOwn(o,k),'missing pointer '+p);return o[k];},v);
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
for(const e of evidence){
  assert.equal(hash(e.file),e.sha256,'trace hash '+e.id);
  assert.equal(hash(e.manifestFile),e.manifestSha256,'manifest hash '+e.id);
  const raw=JSON.parse(fs.readFileSync(e.file,'utf8')),value=pointer(raw,e.pointer);
  const manifest=JSON.parse(fs.readFileSync(e.manifestFile,'utf8'));
  assert.equal(pointer(manifest,e.manifestPointer).status,e.status,'raw capability '+e.id);
  assert.ok(defs.EvidenceKind.enum.includes(e.kind));
  if('check' in e)assert.equal(value,e.check,'check '+e.id);
  if(e.id==='D10')assert.equal(value,false,'durable message');
}
const pins=jsonBlocks(docs['README.md'])[0].inputs;assert.equal(pins.length,23);
for(const p of pins)assert.equal(hash(p.file),p.sha256,'input drift '+p.file);
for(const p of pins.filter(p=>p.file.startsWith('.graph/')))assert.match(fs.readFileSync(p.file,'utf8'),/^status: proposed$/m);
for(const kind of defs.CommandPayload.properties.kind.enum){
  assert.ok(docs['INTERFACES.md'].includes('| `'+kind+'` |'),'missing command '+kind);
  assert.ok(defs.CommandPayload.allOf.some(s=>s.if.properties.kind.const===kind),'command predicate '+kind);
}
assert.equal(defs.CommandPayload.properties.kind.enum.length,15);
assert.equal(defs.NodeSpec.properties.kind.enum.length,7);assert.equal(defs.EdgeSpec.properties.type.enum.length,6);
assert.equal(defs.NodeState.enum.length,11);assert.deepEqual(defs.Status.enum,['absent','partial','unknown','verified']);
for(const d of Object.values(docs)){
  for(const id of d.match(/\bH[0-9]{2}\b/g)||[])assert.ok(docs['OPEN-ITEMS.md'].includes('### '+id+' '),'unknown human item '+id);
  for(const m of d.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){
    const url=m[1];if(/^[a-z]+:\/\//i.test(url)||url.startsWith('#'))continue;
    assert.ok(fs.existsSync(path.resolve(lane,url.split('#')[0])),'broken link '+url);
  }
}
const rules=jsonBlocks(docs['OWNERSHIP.md'])[0];
assert.deepEqual(rules.closureModules,['protocol','kernel','runtime']);
assert.equal(rules.denyAnyBareImportInClosure,true);assert.equal(rules.denyAnyNodeBuiltinInClosure,true);
assert.match(docs['OWNERSHIP.md'],/\| A14 /);assert.match(docs['OWNERSHIP.md'],/\| A15 /);assert.match(docs['OWNERSHIP.md'],/\| I08 /);assert.match(docs['OPEN-ITEMS.md'],/### H13 /);
const price=JSON.parse(fs.readFileSync('docs/evofence-harness-kernel/probes/pi/VERSION-PIN.json','utf8')).price;
assert.deepEqual([price.input,price.output],[0.14,0.28]);
const reserve=(60000n*140000n+4096n*280000n+999999n)/1000000n;assert.equal(reserve,9547n);
const ds=JSON.parse(fs.readFileSync('docs/evofence-harness-kernel/probes/dsh/VERSION-PIN.json','utf8'));
assert.equal(ds.observedVersion,'0.2.0-rc.2');assert.deepEqual(ds.drift.evidence,[]);assert.equal(ds.drift.changeTime,null);
const pi=JSON.parse(fs.readFileSync('docs/evofence-harness-kernel/probes/pi/HOST-MANIFEST.json','utf8'));
assert.equal(pi.capabilities.reasoningHighGuarantee.status,'partial');
console.log(JSON.stringify({status:'passed',objectDefinitions:63,fields:members,requiredFields:required,evidence:44,errorCodes:58,sourcePins:23,commandKinds:15,nativeBothRequired:direct,kernelMissingRequired:kernelMissing,hostMissingRequired:hostMissing,humanItems:13,reserveUsdMicros:Number(reserve)}));
for(const n of names)console.log(n+' lines='+docs[n].split(/\r?\n/).filter((_,i,a)=>i!==a.length-1||a[i]!=='').length+' sha256='+hash(path.join(lane,n)));
}
await verifyFreeze();
```
