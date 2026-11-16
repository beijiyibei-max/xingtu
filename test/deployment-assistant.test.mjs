import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startServer,root} from './support.mjs';

test('部署助手通过 Java 转接并拒绝敏感问题和有工具权限的服务',async t=>{
  const catalog=JSON.parse(await readFile(join(root,'build/fixtures/deployment-assistant.json'),'utf8'));
  const stepId=Object.keys(catalog)[0];
  let enabled=false,calls=0,last;
  const upstream=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/toolsets')return res.end(JSON.stringify({data:[{name:'terminal',enabled,tools:['terminal']}]}));
    let body='';for await(const chunk of req)body+=chunk;
    last=JSON.parse(body);calls++;
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({
      status:'answered',nextCheck:'核对当前节点。\n再核对当前 context。',where:'部署节点',expected:'节点符合本批规划。',
      ifDifferent:'回到节点检查。',references:[{stepId,stepVersion:'2.1.0',sourceId:'xingtu-'+stepId}]
    },null,2)}}]}));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  t.after(async()=>{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});
  const directory=await mkdtemp(join(root,'test/runtime/assistant-'));
  const key=join(directory,'key.txt');await writeFile(key,'mock-test-key');
  const app=await startServer({env:{XT_HERMES_ENABLED:'true',XT_HERMES_KEY_FILE:key,
    XT_CONTRACT_DIR:join(root,'deployment'),
    XT_HERMES_URL:'http://127.0.0.1:'+upstream.address().port,
    XT_HERMES_CONSENT_UNTIL:'2099-01-01T00:00:00Z'}});
  t.after(()=>app.stop());
  const body={question:'这一步先查什么？',stepId,stepVersion:'2.1.0',symptomOptionIds:[]};
  const consent={'X-Xingtu-Ask-Consent':'yes'};
  await t.test('需要登录',async()=>assert.equal((await app.call('/api/deployment/ask')).status,401));
  await t.test('带来源回答可显示，多行 JSON 可解析',async()=>{
    const response=await app.call('/api/deployment/ask',{bearer:true,method:'POST',body,headers:consent});
    assert.equal(response.data.status,'answered');
    assert.deepEqual(JSON.parse(last.messages[1].content),body);
    assert.equal(calls,1);
  });
  await t.test('敏感信息和额外字段拦截',async()=>{
    for(const question of ['token=fixture-secret','服务器 192.0.2.1','token%3Dfixture-secret']){
      const response=await app.call('/api/deployment/ask',{bearer:true,method:'POST',body:{...body,question},headers:consent});
      assert.equal(response.data.reason,'sensitive-content');
    }
    assert.equal((await app.call('/api/deployment/ask',{bearer:true,method:'POST',body:{...body,yaml:'fixture'},headers:consent})).status,400);
    assert.equal(calls,1);
  });
  await t.test('可执行工具启用时拒绝转发问题',async()=>{
    enabled=true;
    assert.equal((await app.call('/api/deployment/ask',{bearer:true,method:'POST',body,headers:consent})).data.reason,'provider-not-approved');
    assert.equal(calls,1);
  });
  await t.test('缺少本次提问许可时服务器拒绝出站',async()=>{
    assert.equal((await app.call('/api/deployment/ask',{bearer:true,method:'POST',body})).data.reason,'consent-required');
    assert.equal(calls,1);
  });
  await t.test('工具状态缺失时不能视为禁用',async()=>{
    enabled=undefined;
    assert.equal((await app.call('/api/deployment/ask',{bearer:true,method:'POST',body,headers:consent})).data.reason,'provider-not-approved');
    assert.equal(calls,1);
  });
  await t.test('页面服务允许同源接口，离线文件保持断网',async()=>{
    assert.match((await app.call('/deployment',{bearer:true})).text,/connect-src 'self'/);
    assert.match(await readFile(join(root,'dist/数栈7.0部署向导.html'),'utf8'),/connect-src 'none'/);
  });
  await t.test('操作单字段和重复键在 Java 边界拒绝',async()=>{
    const response=await app.call('/api/deployment/validate',{bearer:true,method:'POST',raw:true,body:'{"order":{},"order":{},"manifest":{},"evidence":{}}'});
    assert.equal(response.status,400);
  });
  await t.test('Java 调用契约校验，篡改物料时拦截',async()=>{
    const order=JSON.parse(await readFile(join(root,'deployment/deployment-contract-v2.1.example.json'),'utf8'));
    const manifest=JSON.parse(await readFile(join(root,'deployment/examples/manifest.json'),'utf8'));
    const evidence=JSON.parse(await readFile(join(root,'deployment/examples/evidence.json'),'utf8'));
    const response=await app.call('/api/deployment/validate',{bearer:true,method:'POST',body:{order,manifest,evidence}});
    assert.equal(response.data.valid,true,JSON.stringify(response.data));
    assert.equal(response.data.executionApproved,false);
    manifest.packageList[0].sha256='1'.repeat(64);
    const changed=await app.call('/api/deployment/validate',{bearer:true,method:'POST',body:{order,manifest,evidence}});
    assert.equal(changed.data.code,'MANIFEST_HASH_MISMATCH');
  });
});

test('项目操作单生成、恢复、参数放行与旧版失效',async t=>{
  let app=await startServer();
  t.after(()=>app.stop());
  const post=(action,body)=>app.call('/api/deployment/plans/'+action,{bearer:true,method:'POST',body});
  const request={scope:{alias:'site-one',cluster:'reuse',manager:'reuse',network:'offline',storage:'s3',ns:'site-product',emNs:'site-em'},
    target:'control-one',context:'site-context',confirmed:true,allowAssistant:false};
  let plan;
  await t.test('未经登录不能读写操作单',async()=>{
    assert.equal((await app.call('/api/deployment/plans')).status,401);
    assert.equal((await app.call('/api/deployment/plans/generate',{method:'POST',body:request})).status,401);
  });
  await t.test('按项目生成 62 步，不伪造正式批准和通过证据',async()=>{
    const response=await post('generate',request);assert.equal(response.status,200,JSON.stringify(response.data));plan=response.data;
    assert.equal(plan.steps.length,62);assert.equal(plan.executionApproved,false);
    assert.equal(plan.kind,'xingtu-deployment-draft');assert.deepEqual(plan.records,{});
    assert.equal((await app.call('/api/deployment/plans',{bearer:true})).data.plans[0].id,plan.id);
  });
  await t.test('正式步骤中的 kubectl 固定本项目 context 与 Namespace',async()=>{
    const stepId='k8s-check';
    const cards=(await post('cards',{id:plan.id,revision:plan.revision,stepId})).data.cards;
    const card=cards.find(card=>card.kind==='terminal'&&card.text.includes('kubectl')&&!card.missing.length);
    assert.ok(card);
    const response=await post('command',{id:plan.id,revision:plan.revision,stepId,cardIndex:card.index,inputs:{}});
    assert.equal(response.status,200);assert.match(response.data.command,/kubectl --context 'site-context'/);
    assert.equal(response.data.executionApproved,false);
  });
  await t.test('复用路线不放行安装命令，任意附带脚本被拒绝',async()=>{
    const stepId='install-k8s';const cards=(await post('cards',{id:plan.id,revision:plan.revision,stepId})).data.cards;
    const change=cards.find(card=>card.change);assert.ok(change);assert.equal(change.copyAllowed,false);
    assert.equal((await post('command',{id:plan.id,revision:plan.revision,stepId,cardIndex:change.index,inputs:{}})).status,409);
    assert.equal((await post('command',{id:plan.id,revision:plan.revision,stepId,cardIndex:0,inputs:{},script:'echo unsafe'})).status,400);
    assert.equal((await post('command',{id:plan.id,revision:plan.revision,stepId,cardIndex:0,inputs:{host:'$(whoami)'}})).status,400);
  });
  await t.test('未确认的项目参数不能复制检查命令',async()=>{
    const other=(await post('generate',{...request,confirmed:false})).data;
    assert.equal((await post('command',{id:other.id,revision:other.revision,stepId:'host',cardIndex:0,inputs:{}})).status,409);
  });
  await t.test('从零部署允许尚无 context，主机准备可用而集群命令不放行',async()=>{
    const other=(await post('generate',{...request,context:'',scope:{...request.scope,cluster:'new',manager:'new'}})).data;
    assert.equal(other.context,'');
    assert.equal((await post('command',{id:other.id,revision:other.revision,stepId:'host',cardIndex:0,inputs:{}})).status,200);
    assert.equal((await post('command',{id:other.id,revision:other.revision,stepId:'k8s-check',cardIndex:0,inputs:{}})).status,409);
  });
  await t.test('只有可选步骤允许按实施单标记范围外',async()=>{
    const other=(await post('generate',request)).data;
    assert.equal((await post('record',{id:other.id,revision:other.revision,stepId:'scope',status:'not-applicable',checks:[],reference:'scope-ref'})).status,409);
    const optional=other.steps.find(step=>step.optional);assert.ok(optional);
    const response=await post('record',{id:other.id,revision:other.revision,stepId:optional.id,status:'not-applicable',checks:[],reference:'scope-ref'});
    assert.equal(response.status,200);assert.equal(response.data.records[optional.id].status,'not-applicable');
  });
  await t.test('逐项核对、前置顺序和证据编号必须满足',async()=>{
    const [first,second]=plan.steps;
    assert.equal((await post('record',{id:plan.id,revision:plan.revision,stepId:first.id,status:'recorded',checks:[],reference:'review-1'})).status,409);
    assert.equal((await post('record',{id:plan.id,revision:plan.revision,stepId:second.id,status:'recorded',checks:second.checks.map((_,i)=>i),reference:'review-2'})).status,409);
    const oldRevision=plan.revision;
    const response=await post('record',{id:plan.id,revision:plan.revision,stepId:first.id,status:'recorded',checks:first.checks.map((_,i)=>i),reference:'review-1'});
    assert.equal(response.status,200);plan=response.data;assert.equal(plan.revision,oldRevision+1);assert.equal(plan.nextStepId,second.id);
    assert.equal((await post('command',{id:plan.id,revision:oldRevision,stepId:'host',cardIndex:0,inputs:{}})).status,409);
  });
  await t.test('旧步骤重开会使后续人工记录失效',async()=>{
    const [first,second]=plan.steps;
    plan=(await post('record',{id:plan.id,revision:plan.revision,stepId:second.id,status:'recorded',checks:second.checks.map((_,i)=>i),reference:'review-2'})).data;
    plan=(await post('record',{id:plan.id,revision:plan.revision,stepId:first.id,status:'blocked',checks:[],reference:'issue-1'})).data;
    assert.equal(plan.records[first.id].status,'blocked');assert.equal(plan.records[second.id],undefined);
  });
  await t.test('项目关闭助手时不得出站',async()=>{
    const response=await app.call('/api/deployment/ask',{bearer:true,method:'POST',
      headers:{'X-Xingtu-Ask-Consent':'yes','X-Xingtu-Project':plan.id},
      body:{question:'这个步骤应该先检查什么',stepId:'host',stepVersion:'2.1.0',symptomOptionIds:[]}});
    assert.equal(response.data.reason,'project-forbidden');
  });
  await t.test('服务重启后操作单与记录仍在，项目设置修改会清空旧记录',async()=>{
    const data=app.data;await app.stop();app=await startServer({data});
    assert.equal((await post('open',{id:plan.id})).data.records.scope.status,'blocked');
    plan=(await post('generate',{...request,id:plan.id,revision:plan.revision,context:'new-context'})).data;
    assert.equal(plan.context,'new-context');assert.deepEqual(plan.records,{});
  });
  await t.test('路径穿越、冲突路线和篡改模板被拒绝',async()=>{
    assert.equal((await post('open',{id:'../../service.env'})).status,400);
    assert.equal((await post('generate',{...request,scope:{...request.scope,cluster:'new',manager:'reuse'}})).status,400);
    assert.equal((await post('generate',{...request,template:{commands:[]}})).status,400);
  });
  await t.test('服务教学模板变化后，旧操作单不得继承记录或继续放行',async()=>{
    const path=join(app.data,'deployment-plans',plan.id+'.json');
    const saved=JSON.parse(await readFile(path,'utf8'));saved.catalogHash='0'.repeat(64);
    await writeFile(path,JSON.stringify(saved));
    const opened=(await post('open',{id:plan.id})).data;
    assert.equal(opened.templateChanged,true);assert.equal(opened.steps[0].record.status,'stale');
    assert.equal((await post('command',{id:plan.id,revision:plan.revision,stepId:'host',cardIndex:0,inputs:{}})).data.error.code,'PLAN_TEMPLATE_CHANGED');
    plan=(await post('generate',{...request,id:plan.id,revision:plan.revision})).data;
    assert.equal(plan.templateChanged,false);assert.deepEqual(plan.records,{});
  });
});
