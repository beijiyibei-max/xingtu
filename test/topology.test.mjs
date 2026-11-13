import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {knowledgeGraph,topologyGraph,validateTopology,demoTopology,podTone} from '../universe/k8s-model.mjs';
import {root,startServer} from './support.mjs';
const real=()=>{const s=demoTopology();s.isDemo=false;s.projectId='project-a';s.generatedAt=new Date().toISOString();return s;};

test('7.0 关系模型：资料与现场、归属与状态不能混用',async t=>{
 const profile=JSON.parse(await readFile(join(root,'universe/profile.json'),'utf8'));
 await t.test('知识图包含实际 Profile 的所有组件、来源与部署前置',()=>{const g=knowledgeGraph(profile);assert.equal(g.components.length,profile.components.length);assert.ok(g.components.some(c=>c.name==='AIWorks'));assert.ok(g.components.some(c=>c.name==='uniparse'));assert.ok(g.components.every(c=>c.tone==='idle'&&c.knowledge.sources.length));assert.ok(g.relations.every(r=>r.type==='deploy'&&r.status==='pending'));assert.equal(g.components.find(c=>c.name==='AIWorks').knowledge.verifiedAt,'2026-10-08');});
 await t.test('Pod 按 ReplicaSet → Deployment 的 UID 链归属',()=>{const g=topologyGraph(real()),node=g.components.find(c=>c.name==='gateway');assert.equal(node.pods.length,1);assert.equal(node.pods[0].ownerKind,'ReplicaSet');});
 await t.test('前缀相似或旧 UID 的 Pod 不冒充当前工作负载',()=>{const s=real(),p=s.pods.find(p=>p.ownerKind==='StatefulSet');p.ownerUid='old-uid';const g=topologyGraph(s);assert.equal(g.meta.orphanCount,1);assert.ok(g.components.some(c=>c.id==='p:'+p.ns+'/'+p.name));assert.equal(g.components.find(c=>c.name==='mysql').pods.length,0);});
 await t.test('Service 只按完整 selector 与 Pod 实际标签连线',()=>{const s=real(),svc=s.services[0];s.workloads[0].labels.app='other';let g=topologyGraph(s);assert.ok(g.relations.some(r=>r.from==='s:dtstack/mysql'));svc.selectorComplete=false;g=topologyGraph(s);assert.ok(!g.relations.some(r=>r.from==='s:dtstack/mysql'));});
 await t.test('不从配置键、能力名称或同类组件推造调用关系',()=>{const g=topologyGraph(real());assert.ok(g.relations.every(r=>r.type==='selector'&&r.label.includes('未验证')));});
 await t.test('0/0、未知归属和无权限不变成绿色健康',()=>{const s=real();s.collection.pods='forbidden';s.pods=[];s.workloads[0].ready='0/0';const g=topologyGraph(s);assert.ok(g.components.every(c=>c.tone!=='ok'));assert.equal(g.meta.collection.pods,'forbidden');assert.equal(podTone({phase:'Running',ready:'0/0',reason:''}),'idle');});
 await t.test('保留异常原因与镜像信息，Pod 初始化状态不过判为根因',()=>{const g=topologyGraph(real());assert.equal(g.components.find(c=>c.name==='aiworks').tone,'bad');assert.equal(podTone({phase:'Pending',ready:'0/1',reason:'PodInitializing'}),'warn');assert.ok(g.components.find(c=>c.name==='aiworks').pods[0].image.includes('example.invalid'));});
 await t.test('原能力 JSON、跨 Namespace、重复 UID、日志与密码字段拒绝',()=>{const bad=[];bad.push({schemaVersion:2,capabilities:[]});for(const change of [s=>s.pods[0].ns='other',s=>s.pods[0].uid=s.workloads[0].uid,s=>s.podLogs={raw:'secret'},s=>s.pods[0].password='secret',s=>s.pods[0].labels.password='secret']){const s=real();change(s);bad.push(s);}for(const s of bad)assert.throws(()=>validateTopology(s));});
});

test('Java 7.0 拓扑入口：独立协议、环境范围与持久化',async t=>{
 let app=await startServer({env:{XT_LEGACY_MODE:'disabled'}});t.after(()=>app.stop());const call=(path,o={})=>app.call(path,{bearer:true,...o});
 await t.test('不依赖 EM，空服务器给出明确空列表和 404',async()=>{assert.equal((await call('/k8s')).status,200);assert.deepEqual((await call('/api/k8s/scopes')).data.scopes,[]);assert.equal((await call('/api/k8s/latest?projectId=a&clusterId=b&namespace=dtstack')).status,404);assert.equal((await call('/api/k8s/latest')).status,400);});
 await t.test('仍要求登录，拒绝把演示与能力状态混进现场库',async()=>{assert.equal((await app.call('/api/k8s/scopes')).status,401);for(const body of [demoTopology(),{schemaVersion:2,capabilities:[]}])assert.equal((await call('/api/k8s/ingest',{method:'POST',body})).status,400);});
 await t.test('Java 与浏览器共同拒绝额外字段、跨环境、缺字段和重复 UID',async()=>{for(const change of [s=>s.rawLogs='secret',s=>s.pods[0].ns='other',s=>s.pods[0].uid=s.workloads[0].uid,s=>s.pods[0].labels.token='secret',s=>delete s.collection.pods,s=>delete s.workloads[0].kind,s=>delete s.pods[0].phase]){const s=real();change(s);assert.throws(()=>validateTopology(s));assert.equal((await call('/api/k8s/ingest',{method:'POST',body:s})).status,400);}});
 await t.test('保存两个不同环境后明确选中其中一个，不串用',async()=>{for(const id of ['project-a','project-b']){const s=real();s.projectId=id;assert.equal((await call('/api/k8s/ingest',{method:'POST',body:s})).status,201);}assert.equal((await call('/api/k8s/scopes')).data.scopes.length,2);const latest=await call('/api/k8s/latest?projectId=project-a&clusterId=demo-cluster&namespace=dtstack');assert.equal(latest.data.projectId,'project-a');assert.equal(latest.data.workloads.length,9);assert.ok(!latest.data._id);});
 await t.test('无权限与截断原样保留，不与原能力库混用',async()=>{const s=real();s.collection.pods='forbidden';s.collection.truncated=true;s.pods=[];assert.equal((await call('/api/k8s/ingest',{method:'POST',body:s})).status,201);const latest=(await call('/api/k8s/latest?projectId=project-a&clusterId=demo-cluster&namespace=dtstack')).data;assert.equal(latest.collection.pods,'forbidden');assert.equal(latest.collection.truncated,true);assert.deepEqual((await call('/api/scopes')).data.scopes,[]);});
 await t.test('错误输入及超大文件后服务仍可用',async()=>{assert.equal((await call('/api/k8s/ingest',{method:'POST',body:'{bad',raw:true})).status,400);assert.equal((await call('/api/k8s/ingest',{method:'POST',body:{padding:'x'.repeat(66000)}})).status,413);assert.equal((await call('/healthz')).status,200);});
 await t.test('重启保留 7.0 数据，旧 API 仍要求完整范围',async()=>{const data=app.data;await app.stop();app=await startServer({data,env:{XT_LEGACY_MODE:'disabled'}});assert.equal((await call('/api/k8s/scopes')).data.scopes.length,2);assert.equal((await call('/api/latest')).status,400);});
});

test('Bash 拓扑采集器：白名单、无权限与 <20KB 截断',async t=>{
 await mkdir(join(root,'test/runtime'),{recursive:true});const dir=await mkdtemp(join(root,'test/runtime/collector-'));
 const fake=`#!/usr/bin/env bash
case "$2" in
 deployments,*) printf 'dtstack|api|uid-api|Deployment|1|1|||example.invalid/api:v1|map[app:api password:never-export-this]\\n' ;;
 replicasets) printf 'dtstack|api-rs|uid-rs|uid-api|Deployment\\n' ;;
 pods) if [ "\$DENY_PODS" = 1 ]; then printf 'Forbidden\\n' >&2; exit 1; fi
  count=1; [ "\$BULK_PODS" != 1 ] || count=300
  for ((i=0;i<count;i++)); do printf 'dtstack|api-rs-%s|uid-p-%s|Running|true|api|node-a|uid-rs|ReplicaSet|api-rs|0|example.invalid/api:v1|containerd://digest||||map[app:api]\\n' "$i" "$i"; done ;;
 services) printf 'dtstack|api|uid-service|map[app:api custom:unsupported]|8080\\n' ;;
esac
`;
 await writeFile(join(dir,'kubectl'),fake,{mode:0o755});
 const posix=p=>process.platform==='win32'?p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()):p;
 const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
 const run=env=>spawnSync(bash,['-c','export PATH="$XT_TEST_BIN:$PATH"\nexec bash "$XT_TEST_SCRIPT" --project=project-a --cluster=cluster-a --namespace=dtstack'],{env:{...process.env,XT_TEST_BIN:posix(dir),XT_TEST_SCRIPT:posix(join(root,'collector/xt-topology')),...env},windowsHide:true,encoding:'utf8'});
 await t.test('正常采集 JSON 可直接解析，owner UID 与实际标签保留',()=>{const r=run({});assert.equal(r.status,0,r.stderr);const s=validateTopology(JSON.parse(r.stdout));assert.equal(s.pods[0].ownerUid,'uid-rs');assert.equal(s.pods[0].labels.app,'api');assert.ok(!r.stdout.includes('never-export-this'));assert.equal(s.services[0].selectorComplete,false);});
 await t.test('Forbidden 不吞成对象不存在',()=>{const r=run({DENY_PODS:'1'});assert.equal(r.status,0,r.stderr);const s=validateTopology(JSON.parse(r.stdout));assert.equal(s.collection.pods,'forbidden');assert.equal(s.pods.length,0);});
 await t.test('大对象列表输出小于 20KB，并标记截断',()=>{const r=run({BULK_PODS:'1'});assert.equal(r.status,0,r.stderr);assert.ok(Buffer.byteLength(r.stdout)<20000);const s=validateTopology(JSON.parse(r.stdout));assert.equal(s.collection.truncated,true);assert.ok(s.pods.length>0&&s.pods.length<300);});
});
