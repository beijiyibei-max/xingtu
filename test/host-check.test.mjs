import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {makeHostCommand,readHostReport,interpretHost} from '../deployment/host-check.mjs';
import {root} from './support.mjs';

const sample={arch:'x86_64',cpu:8,memoryMiB:16384,rootUsed:73,swap:'on',dataMount:'not-mounted',
  sync:'unknown',tar:false,kube:'api-ready',ready:2,total:3};
const wrap=value=>'XT_PREFLIGHT_V1='+JSON.stringify(value);
test('输出只接受定长白名单记录，优先提示根盘、缺工具和节点异常',()=>{
  const parsed=readHostReport(wrap(sample));
  const findings=interpretHost(parsed);
  assert.equal(findings.filter(item=>item.level==='fix').length,3);
  assert.match(findings[0].title,/tar/);
  assert.throws(()=>readHostReport(wrap({...sample,token:'no'})),/未知字段/);
  assert.throws(()=>readHostReport(wrap({...sample,ready:5})),/不符合/);
  assert.throws(()=>readHostReport(wrap(sample)+'\n另一个终端输出'),/最后一行/);
});

test('实际运行复制的单行命令，只有显式选择时才查询模拟集群',async()=>{
  const source=await readFile(join(root,'collector/xt-preflight.sh'),'utf8');
  const runtime=join(root,'test/runtime');
  await mkdir(runtime,{recursive:true});
  const dir=await mkdtemp(join(runtime,'preflight-'));
  const mock=`#!/bin/sh
printf '%s\\n' "$*" >> "$XT_PROBE_MARKER"
case "$*" in
  *--raw=/readyz*) printf 'ok\\n' ;;
  *'get nodes'*) printf 'True\\nFalse\\n' ;;
  *) exit 1 ;;
esac
`;
  await writeFile(join(dir,'kubectl'),mock,{mode:0o755});
  const windows=process.platform==='win32';
  const posix=path=>windows?path.replace(/^(\w):/,'/$1').replaceAll('\\','/'):path;
  const run=k8s=>{
    const command=makeHostCommand(source,k8s);
    assert.ok(!/[\r\n]/.test(command));
    const result=spawnSync(windows?'C:/Program Files/Git/bin/bash.exe':'bash',['-s'],{
      input:'export PATH="$XT_PROBE_BIN:$PATH"\n'+command+'\n',encoding:'utf8',windowsHide:true,
      env:{...process.env,XT_PROBE_BIN:posix(dir),XT_PROBE_MARKER:posix(join(dir,'queries'))},timeout:20000,
    });
    assert.equal(result.status,0,result.error?.message||result.stderr);
    return readHostReport(result.stdout);
  };
  assert.equal(run(false).kube,'not-run');
  await assert.rejects(()=>readFile(join(dir,'queries')),error=>error.code==='ENOENT');
  const k8s=run(true);
  assert.equal(k8s.kube,'api-ready');
  assert.deepEqual([k8s.ready,k8s.total],[1,2]);
  assert.equal((await readFile(join(dir,'queries'),'utf8')).trim().split(/\r?\n/).length,2);
});
