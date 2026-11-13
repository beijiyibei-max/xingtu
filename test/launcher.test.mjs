import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {copyFile,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {root,java,freePort,sleep,token} from './support.mjs';

test('配置初始化与 Windows 启动入口',async t=>{
 const dir=await mkdtemp(join(root,'test/win-'));
 await t.test('首次生成密钥，重复初始化不会覆盖',async()=>{const args=['-jar',join(root,'dist/xingtu-server.jar'),'--init-config',dir];const first=spawnSync(java,args,{windowsHide:true,encoding:'utf8'});assert.equal(first.status,0);const original=await readFile(join(dir,'service.env'),'utf8');assert.match(original,/XT_ACCESS_TOKEN=[A-Za-z0-9_-]{48}/);assert.ok(!first.stdout.includes(original.split('\n')[0].split('=')[1]));const again=spawnSync(java,args,{windowsHide:true,encoding:'utf8'});assert.notEqual(again.status,0);assert.equal(await readFile(join(dir,'service.env'),'utf8'),original);});
 if(process.platform!=='win32')return;
 await t.test('实际启动脚本可在中文路径下打开 Java 服务',async()=>{
   for(const file of ['xingtu-server.jar','start.ps1'])await copyFile(join(root,'dist',file),join(dir,file));
   const port=await freePort();await writeFile(join(dir,'service.env'),`XT_ACCESS_TOKEN=${token}\nXT_PORT=${port}\nXT_BIND=127.0.0.1\nXT_LEGACY_MODE=disabled\n`);
   const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(dir,'start.ps1')],{windowsHide:true,env:{...process.env,XT_DATA_DIR:join(dir,'data')},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
   try{let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(output);try{const r=await fetch('http://127.0.0.1:'+port+'/healthz');if(r.status===200){ready=true;break;}}catch{}await sleep(100);}assert.ok(ready,output);assert.ok(!output.includes(token));}
   finally{if(child.exitCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
 });
});
