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
      status:'answered',nextCheck:'核对当前节点。',where:'部署节点',expected:'节点符合本批规划。',
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
  await t.test('需要登录',async()=>assert.equal((await app.call('/api/deployment/ask')).status,401));
  await t.test('带来源回答可显示，多行 JSON 可解析',async()=>{
    const response=await app.call('/api/deployment/ask',{bearer:true,method:'POST',body});
    assert.equal(response.data.status,'answered');
    assert.deepEqual(JSON.parse(last.messages[1].content),body);
    assert.equal(calls,1);
  });
  await t.test('敏感信息和额外字段拦截',async()=>{
    for(const question of ['token=fixture-secret','服务器 192.0.2.1','token%3Dfixture-secret']){
      const response=await app.call('/api/deployment/ask',{bearer:true,method:'POST',body:{...body,question}});
      assert.equal(response.data.reason,'sensitive-content');
    }
    assert.equal((await app.call('/api/deployment/ask',{bearer:true,method:'POST',body:{...body,yaml:'fixture'}})).status,400);
    assert.equal(calls,1);
  });
  await t.test('可执行工具启用时拒绝转发问题',async()=>{
    enabled=true;
    assert.equal((await app.call('/api/deployment/ask',{bearer:true,method:'POST',body})).data.reason,'provider-not-approved');
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
