import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectYaml,readBaseline,maxYamlBytes} from '../deployment/yaml-review.mjs';

const findings=(name,source,options)=>inspectYaml(name,source,options).sections.flatMap(section=>section.findings);
const em=`IP: 192.0.2.18
port: 29999
storage:
  em:
    pvc: local
    local:
      path: /etc/kubernetes/pv/dtstack/data
      nodeLabelKey: kubernetes.io/hostname
      nodeLableVal: work01
`;

test('按内容识别 EM，给出节点、端口、目录和标签的现场核验建议',()=>{
  const result=inspectYaml('config.yaml',em);
  const rules=result.sections[0].findings;
  assert.match(result.sections[0].label,/EasyManager/);
  assert.ok(rules.some(item=>item.path==='IP'&&item.line===1&&item.severity==='change'&&item.title.includes('文档示例')));
  assert.ok(rules.some(item=>item.path==='port'&&item.severity==='verify'&&item.title.includes('默认范围')));
  assert.ok(rules.some(item=>item.path.endsWith('nodeLableVal')&&item.title.includes('SOP 示例')));
});

test('普通私网 IP 待核对，有现场值时才报告不一致和建议值',()=>{
  const source=em.replace('192.0.2.18','10.20.30.40');
  assert.ok(findings('config.yaml',source).some(item=>item.path==='IP'&&item.severity==='verify'&&!item.expected));
  const {values,invalid}=readBaseline({emIp:'10.20.30.50',emPort:'30080',emPath:'/data/em',emNode:'worker-em'});
  assert.deepEqual(invalid,[]);
  const mismatches=findings('config.yaml',source,{baseline:values}).filter(item=>item.expected);
  assert.deepEqual(new Set(mismatches.map(item=>item.expected)),new Set(['10.20.30.50','30080','/data/em','worker-em']));
  assert.ok(findings('config.yaml',source,{baseline:{emIp:'10.20.30.40'}}).some(item=>item.path==='IP'&&item.severity==='note'));
});

test('仅在本地卷方案要求对应路径与节点标签，端口无法凭未知文件名判为 EM',()=>{
  const nonLocal='IP: 10.20.30.40\nport: 30080\nstorage: {em: {pvc: nfs}}\n';
  assert.ok(!findings('config.yaml',nonLocal).some(item=>item.path.includes('storage.em.local')));
  const local=nonLocal.replace('pvc: nfs','pvc: local');
  assert.ok(findings('config.yaml',local).some(item=>item.path==='storage.em.local.path'&&item.line===0));
  assert.match(inspectYaml('config.yaml','port: 8080\nfoo: bar\n').sections[0].label,/通用 YAML/);
});

test('嵌套、点号配置、双开关与未渲染占位值按字段报告',()=>{
  const source=`global:
  domain: portal.example.com
  db_type: {mysql: true, dmMysql: true}
  redis: {host: 127.0.0.1, port: 99999}
  minio: {endpoint: "<填写对象存储地址>"}
  feature: {ai: "false"}
global.plugin.jobCount: 0
global.images.imagePrefix: "prefix/{{ .Values.registry }}"
`;
  const rules=findings('values.yaml',source,{storage:'s3'});
  assert.ok(rules.some(item=>item.path==='global.db_type'&&item.title.includes('互斥')));
  assert.ok(rules.some(item=>item.path==='global.redis.host'&&item.title.includes('回环')));
  assert.ok(rules.some(item=>item.path==='global.redis.port'&&item.title.includes('整数')));
  assert.ok(rules.some(item=>item.path==='global.minio.endpoint'&&item.title.includes('占位')));
  assert.ok(rules.some(item=>item.path==='global.plugin.jobCount'&&item.severity==='verify'));
  assert.ok(rules.some(item=>item.path==='global.images.imagePrefix'&&item.severity==='verify'));
});

test('多文档 ConfigMap 内嵌 YAML、错误和凭据保持独立，结果不含明文',()=>{
  const source=`apiVersion: v1
kind: ConfigMap
data:
  common-config.yaml: |
    global:
      domain: portal.example.com
      db:
        password: sample-db-secret-NOT-IN-RESULT
---
apiVersion: v1
kind: Secret
stringData:
  password: sample-k8s-secret-NOT-IN-RESULT
---
global:
  db:
    host: http://test:sample-url-secret-NOT-IN-RESULT@localhost:3000
---
global: {domain: first.example.com, domain: second.example.com}
`;
  const result=inspectYaml('mixed.yaml',source);
  assert.ok(result.sections.some(section=>section.label.includes('内嵌文档')&&section.findings.some(item=>item.path==='global.domain')));
  assert.ok(result.sections.some(section=>section.label.endsWith('Secret')&&section.findings.length===1));
  assert.ok(result.sections.some(section=>section.findings.some(item=>item.title.includes('重复键'))));
  assert.ok(result.sections.some(section=>section.findings.some(item=>item.title.includes('连接串疑似内含凭据'))));
  assert.ok(!JSON.stringify(result).includes('NOT-IN-RESULT'));
});

test('别名、合并键、坏语法与过大文件可安全提示',()=>{
  const alias='defaults: &base {host: my-host}\nservice: {<<: *base, host: *base}\n';
  assert.ok(findings('x.yaml',alias).some(item=>item.title.includes('别名')));
  assert.ok(findings('x.yaml','field: [1, 2').some(item=>item.title.includes('解析失败')));
  assert.ok(findings('x.yaml','x'.repeat(maxYamlBytes+1)).some(item=>item.title.includes('超过')));
  assert.deepEqual(readBaseline({emIp:'192.0.2.22',emPort:'8080;id',database:'mysql://user:pass@server'}).invalid,
    ['EM 入口 IP','EM NodePort','数据库地址']);
});
