import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync, mkdtempSync, symlinkSync, rmSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const guard=path.join(repo,'scripts/check-core-imports.mjs');
const require=createRequire(import.meta.url);
const ts=require('typescript6');
const {base,vectors}=JSON.parse(readFileSync(path.join(here,'fixtures.json'),'utf8'));

function put(root,file,text){
  const target=path.join(root,file);
  mkdirSync(path.dirname(target),{recursive:true});
  writeFileSync(target,text);
}
function emit(file,text){
  if(file.endsWith('.json'))return text;
  return ts.transpileModule(text,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true}}).outputText;
}

test('core guard I01-I08: green baseline and red counterexamples',async t=>{
  const workspace=path.join(here,'.work');
  mkdirSync(workspace,{recursive:true});
  const area=mkdtempSync(path.join(workspace,'run-'));
  try {
    for(const vector of vectors)await t.test(vector.name,()=>{
      const root=path.join(area,vector.name);
      mkdirSync(root);
      const files=vector.empty ? vector.files : {...base,...vector.files};
      for(const [file,text]of Object.entries(files))put(root,file,text);
      for(const name of vector.roots)mkdirSync(path.join(root,name),{recursive:true});
      if(vector.junction){
        symlinkSync(path.join(root,vector.junction.to),path.join(root,vector.junction.from),'junction');
      }
      const args=[guard];
      for(const name of vector.roots)args.push('--root',name+'='+path.join(root,name));
      if(vector.probes){
        put(root,'probes.json',JSON.stringify(vector.probes));
        args.push('--probes',path.join(root,'probes.json'));
      }
      if(vector.project){
        put(root,'tsconfig.json',JSON.stringify(vector.project));
        args.push('--project',path.join(root,'tsconfig.json'));
      }
      if(vector.built){
        for(const name of vector.roots){
          const directory=path.join(root,'built',name);
          mkdirSync(directory,{recursive:true});
          args.push('--built',name+'='+directory);
        }
        for(const [file,text]of Object.entries(files)){
          const name=file.split('/')[0];if(!vector.roots.includes(name))continue;
          const target=file.replace(/\.(ts|tsx)$/,'.js');
          put(root,'built/'+target,emit(file,text));
        }
        for(const [file,text]of Object.entries(vector.built))put(root,'built/'+file,text);
        if(vector.builtJunction)symlinkSync(path.join(root,'built',vector.builtJunction.to),path.join(root,'built',vector.builtJunction.from),'junction');
      }
      const result=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
      if(result.error)throw result.error;
      assert.equal(result.status,vector.expect,result.stdout+'\n'+result.stderr);
      if(vector.rule)assert.match(result.stderr,new RegExp('\\['+vector.rule+'/'),result.stdout+'\n'+result.stderr);
      if(vector.blind)for(const rule of vector.blind)assert.doesNotMatch(result.stderr,new RegExp('\\['+rule+'/'),'this witness must demonstrate the stated static blind spot');
      if(vector.expect===0)assert.match(result.stdout,/"status":"passed"/);
      const diagnostics=result.stderr.split(/\r?\n/).filter(s=>s.startsWith('['));
      t.diagnostic(vector.name+' exit='+result.status+' '+(diagnostics.length ? diagnostics.join(' | ') : 'passed'));
      t.diagnostic(vector.name+' stdout:\n'+result.stdout.trim());
    });
    await t.test('argv rejects unknown flags',()=>{
      const r=spawnSync(process.execPath,[guard,'--unknown'],{cwd:repo,encoding:'utf8'});
      assert.equal(r.status,1);assert.match(r.stderr,/unknown option/);
    });
    await t.test('missing declared root never passes',()=>{
      const r=spawnSync(process.execPath,[guard,'--root','protocol='+path.join(area,'missing')],{cwd:repo,encoding:'utf8'});
      assert.equal(r.status,1);assert.match(r.stderr,/ENOENT/);
    });
    await t.test('global compiler escape hatch is removed',()=>{
      const r=spawnSync(process.execPath,[guard,'--compiler','typescript'],{cwd:repo,encoding:'utf8'});
      assert.equal(r.status,1);assert.match(r.stderr,/unknown option/);
    });
  } finally {
    // Only this test-created directory is removed, after verifying the resolved target.
    const realArea=realpathSync(area),realWorkspace=realpathSync(workspace);
    assert.equal(path.dirname(realArea),realWorkspace);
    rmSync(realArea,{recursive:true});
  }
});
