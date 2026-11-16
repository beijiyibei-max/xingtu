import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const posix=p=>p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase());
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const commit='a'.repeat(40);
const runtime=join(root,'test/runtime');mkdirSync(runtime,{recursive:true});
// A fake Docker daemon and HTTP endpoint exercise the real Bash script. No VM access.
const mock=String.raw`
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const native=p=>process.platform==='win32'?p.replace(/^\/([a-z])\//i,'$1:/'):p;
const dir=process.env.XT_MOCK_DIR;
const statePath=dir+'/state.json';
let state=JSON.parse(fs.readFileSync(statePath));
const [tool,...args]=process.argv.slice(2);
fs.appendFileSync(dir+'/calls.jsonl',JSON.stringify([tool,...args])+'\n');
const save=()=>fs.writeFileSync(statePath,JSON.stringify(state));
const out=s=>process.stdout.write(s+'\n');
const fail=()=>process.exit(1);
if(tool==='curl'){
  if(!state.running||(process.env.XT_MOCK_CASE==='health-fail'&&state.image==='sha256:new'))fail();
  out('{"ok":true,"version":"test"}');
}else if(tool==='docker'){
  if(args[0]==='inspect'){
    const format=args[2];
    if(format.includes('com.docker.compose.project'))out('xingtu-test');
    else if(format.includes('.Mounts'))out('xingtu-test-data');
    else if(format.includes('.HostIp'))out('192.168.100.202');
    else if(format.includes('.HostPort'))out('22648');
    else if(format.includes('.Config.Image'))out(state.tag);
    else if(format.includes('.Config.Env'))out('XT_ACCESS_TOKEN=fixture-only\nEXAMPLE=literal$VALUE#tag');
    else if(format.includes('.Image'))out(state.image);
    else fail();
  }else if(args[0]==='compose'){
    const file=native(args[2]);const action=args[3];
    if(action==='ps')out('controller');
    else if(action==='config'){
      if(args.includes('--images'))out('xingtu-test:'+process.env.XINGTU_IMAGE_TAG);
      else if(!fs.existsSync(file))fail();
    }else if(action==='build'){
      if(process.env.XT_MOCK_CASE==='build-fail')fail();
    }else if(action==='up'){
      const rollback=file.endsWith('rollback.yaml');
      if(!rollback&&process.env.XT_MOCK_CASE==='up-fail')fail();
      state.image=rollback?'sha256:old':'sha256:new';
      state.tag=rollback?'xingtu-test:rollback-fixture':'xingtu-test:'+process.env.XINGTU_IMAGE_TAG;
      state.running=true;save();
    }else fail();
  }else if(args[0]==='exec'){
    const script=args[4].replace('/var/jenkins_home/jobs/xingtu-ci/builds',process.env.XT_MOCK_BUILDS);
    const result=spawnSync(process.env.XT_MOCK_BASH,['-c',script,'sh',args[6]],{encoding:'utf8'});
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
  }else if(args[0]==='cp'){
    const source=args.at(-2),dest=native(args.at(-1));
    if(source.startsWith('controller:')){
      const number=source.match(/builds\/(\d+)\//)[1];
      fs.cpSync(dir+'/builds/'+number+'/archive/dist',dest,{recursive:true});
    }else{
      if(process.env.XT_MOCK_CASE==='backup-fail')fail();
      fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(dest+'/project.json','{"fixture":true}');
    }
  }else if(args[0]==='stop'){state.running=false;save();}
  else if(args[0]==='start'){state.running=true;save();}
  else if(args[0]==='tag'){}
  else if(args[0]==='image')out('sha256:new');
  else fail();
}else fail();
`;

function fixture(scenario='ok'){
  const dir=mkdtempSync(join(runtime,'upgrade-'));const app=join(dir,'app');const bin=join(dir,'bin');
  mkdirSync(app);mkdirSync(bin);
  writeFileSync(join(app,'service.env'),'XT_ACCESS_TOKEN=fixture-only\n');
  writeFileSync(join(dir,'ci.yaml'),'name: xingtu-ci\n');
  writeFileSync(join(dir,'state.json'),JSON.stringify({running:true,image:'sha256:old',tag:'xingtu-test:previous'}));
  writeFileSync(join(dir,'mock.mjs'),mock);
  for(const tool of ['docker','curl'])writeFileSync(join(bin,tool),'#!/bin/sh\nexec '+quote(posix(process.execPath))+' '+quote(join(dir,'mock.mjs').replaceAll('\\','/'))+' '+tool+' "$@"\n',{mode:0o755});
  writeFileSync(join(bin,'id'),'#!/bin/sh\nprintf "0\\n"\n',{mode:0o755});
  writeFileSync(join(bin,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  for(const n of ['2','3']){
    const dist=join(dir,'builds',n,'archive/dist');mkdirSync(join(dist,'deployment'),{recursive:true});
    writeFileSync(join(dir,'builds',n,'build.xml'),n==='2'?'<result>SUCCESS</result>':'<result>FAILURE</result>');
    for(const f of ['Dockerfile','compose.yaml','.dockerignore'])cpSync(join(root,f),join(dist,f));
    for(const f of ['contract_v21.py','contract_worker.py','requirements-contract.txt','deployment-contract-v2.1.schema.json'])writeFileSync(join(dist,'deployment',f),'fixture');
    writeFileSync(join(dist,'commit.txt'),commit+'\n');
    writeFileSync(join(dist,'xingtu-server.jar'),'fixture-jar');
    writeFileSync(join(dist,'SHA256SUMS'),createHash('sha256').update('fixture-jar').digest('hex')+'  xingtu-server.jar\n');
  }
  function run(action){
    const env={...process.env,XT_MOCK_DIR:dir,XT_MOCK_BUILDS:posix(join(dir,'builds')),XT_MOCK_BASH:bash,XT_MOCK_CASE:scenario,
      XINGTU_HOME:posix(app),XINGTU_CI_COMPOSE:posix(join(dir,'ci.yaml')),MSYS_NO_PATHCONV:'1',MSYS2_ARG_CONV_EXCL:'*'};
    const script='export PATH='+quote(posix(bin))+':"$PATH"; exec bash '+quote(posix(join(root,'ci/xingtu-update.sh')))+(action?' '+quote(action):'');
    return spawnSync(bash,['-c',script],{env,encoding:'utf8',windowsHide:true,timeout:60000});
  }
  return {dir,app,run,state:()=>JSON.parse(readFileSync(join(dir,'state.json'))),calls:()=>readFileSync(join(dir,'calls.jsonl'),'utf8')};
}
test('同机升级入口：真实 shell 与模拟 Docker 的发布及故障分支', {timeout:240000},async t=>{
  await t.test('只选成功构建，保留 IP，先构建再备份，支持回退且不覆盖数据',()=>{
    const f=fixture();let r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);
    assert.equal(f.state().image,'sha256:new');
    const release=join(f.app,'releases',readdirSync(join(f.app,'releases'))[0]);
    assert.match(readFileSync(join(release,'compose.yaml'),'utf8'),/192\.168\.100\.202:22648:22648/);
    const calls=f.calls();assert.ok(calls.indexOf('"build","xingtu"')<calls.indexOf('"stop"'));
    assert.ok(calls.indexOf('"cp","-a"')<calls.indexOf('"up","-d"'));
    assert.match(r.stdout,/#2/);assert.doesNotMatch(r.stdout,/fixture-only/);
    const backup=readFileSync(join(f.app,'last-backup.txt'),'utf8').trim();
    const native=process.platform==='win32'?backup.replace(/^\/([a-z])\//i,'$1:/'):backup;
    assert.match(readFileSync(join(native,'runtime.env'),'utf8'),/literal\$VALUE#tag/);
    assert.match(readFileSync(join(native,'rollback.yaml'),'utf8'),/format: raw/);
    r=f.run('rollback');assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(f.state().image,'sha256:old');
    assert.ok(existsSync(join(native,'data/project.json')));
  });
  await t.test('校验失败不停止服务',()=>{
    const f=fixture();writeFileSync(join(f.dir,'builds/2/archive/dist/xingtu-server.jar'),'tampered');
    const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/发布包校验失败/);assert.equal(f.state().running,true);assert.doesNotMatch(f.calls(),/"stop"|"build","xingtu"/);
  });
  await t.test('构建失败不停止服务',()=>{
    const f=fixture('build-fail');assert.notEqual(f.run().status,0);assert.match(f.calls(),/"build","xingtu"/);assert.equal(f.state().running,true);assert.doesNotMatch(f.calls(),/"stop"/);
  });
  await t.test('备份失败会重新启动旧容器，且不切换新版',()=>{
    const f=fixture('backup-fail');const r=f.run();assert.notEqual(r.status,0);assert.match(f.calls(),/"cp","-a"/);assert.match(f.calls(),/"start","xingtu-test-xingtu-1"/);assert.equal(f.state().running,true);assert.equal(f.state().image,'sha256:old');assert.doesNotMatch(f.calls(),/"up","-d"/);
  });
  await t.test('启动失败保留回退点，回退命令可恢复服务',()=>{
    const f=fixture('up-fail');const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/rollback/);assert.ok(existsSync(join(f.app,'last-backup.txt')));assert.equal(f.run('rollback').status,0);assert.equal(f.state().running,true);
  });
  await t.test('健康检查失败不报升级成功，仍可回退',()=>{
    const f=fixture('health-fail');const r=f.run();assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/升级成功/);assert.equal(f.run('rollback').status,0);
  });
  await t.test('重复升级健康的同提交不会再次停服',()=>{
    const f=fixture();assert.equal(f.run().status,0);const before=f.calls().match(/"stop"/g)?.length;const r=f.run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/无需重复更新/);assert.equal(f.calls().match(/"stop"/g)?.length,before);
  });
  await t.test('指定失败构建拒绝升级；并发锁拒绝第二次操作',()=>{
    const f=fixture();assert.notEqual(f.run('3').status,0);assert.equal(f.state().image,'sha256:old');mkdirSync(join(f.app,'.update-lock'));assert.notEqual(f.run().status,0);assert.equal(f.state().running,true);
  });
});
