import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {InvestigationEngine} from './legacy/connector/observability/investigation-engine.mjs';
import {DemoObservabilityAdapter} from './legacy/connector/observability/demo-adapter.mjs';
import {sanitizeSnapshot,snapshotSummary,diffSnapshots} from './legacy/connector/snapshot-store.mjs';
const root=dirname(fileURLToPath(import.meta.url)),legacy=join(root,'legacy');
const web=join(root,'build/web'),fixtures=join(root,'build/fixtures'),classes=join(root,'build/classes');
for(const dir of [web,fixtures,classes,join(root,'dist')])await mkdir(dir,{recursive:true});
const read=name=>readFile(join(root,name),'utf8');
const nav=`<nav class="xt-global"><a href="/">✦ 星图 · 全部功能</a><a href="/workbench">项目与验收</a><a href="/criteria">排障与配置质检</a><a href="/operations">运维工作台</a><a href="/universe">三维关系</a><a href="/confidential">保密现场</a><strong class="xt-source-note"><!--XT-SOURCE-MODE--></strong></nav><style>.xt-global{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;gap:6px;max-width:96vw;overflow-x:auto;padding:8px;border:1px solid #496080;border-radius:15px;background:#0b172df2;box-shadow:0 5px 24px #0008;font:12px/1.4 system-ui}.xt-global a,.xt-global strong{color:#d8e5ff;text-decoration:none;white-space:nowrap;padding:7px 9px;border-radius:8px}.xt-global a:hover{background:#263d62}.xt-global .xt-source-note{color:#ffd094;border-left:1px solid #496080;font-size:11px}</style>`;
function attachNav(html){const at=html.lastIndexOf('</body>');if(at<0)throw Error('缺少页面结束标签');const navigation=nav.replace('<a href="/workbench">','<a href="/deployment">现场部署向导</a><a href="/workbench">');return html.slice(0,at)+navigation+html.slice(at);}
async function page(name,file,transform=x=>x){const html=transform(await readFile(file,'utf8'));await writeFile(join(web,name+'.html'),attachNav(html));}
await page('criteria',join(legacy,'pages/criteria.html'));
await page('confidential',join(legacy,'pages/confidential.html'));
await import('./universe/build.mjs');
await import('./deployment/build.mjs');
await page('universe',join(root,'build/universe.html'));
await page('operations',join(legacy,'pages/operations.html'));
await page('map',join(legacy,'pages/map.html'));
let project=await readFile(join(legacy,'pages/workbench.html'),'utf8');
project=project.replaceAll('V3.2','V3.3');
project=project.replace('throw new Error(data.error||`服务器返回 ${response.status}`)','throw new Error(data.error?.message||data.error||`服务器返回 ${response.status}`)');
project=project.replace('placeholder="访问密钥，仅保留在内存"','placeholder="已登录可留空；也可填写访问密钥"');
const hook='function projectBar(){return `';if(!project.includes(hook))throw Error('项目工具栏接口变化');
project=project.replace(hook,'function projectBar(){return renderServerButtons()+`');
project=project.replace('function bindWorkbench(){','function bindWorkbench(){\n bindServerButtons();');
project=project.replace('<div id="app"></div>','<div id="app"></div><div id="server-dialog"></div>');
project=project.replace('render();</script>',`${await read('web/vault.js')}\nrender();</script>`);
if(!project.includes('function renderServerButtons'))throw Error('项目备份接口未注入');
await writeFile(join(web,'workbench.html'),attachNav(project));
for(const name of ['index.html','login.html','portal.js','portal.css'])await copyFile(join(root,'web',name),join(web,name));
const current=sanitizeSnapshot(JSON.parse(await readFile(join(legacy,'connector/demo-snapshot.json'),'utf8')));
current.source='EM Database · 内置脱敏演示快照';
const previous=structuredClone(current);previous.capturedAt=new Date(Date.parse(current.capturedAt)-86400000).toISOString();
const changed=previous.instances.find(x=>x.serviceVersion);if(changed)changed.serviceVersion+='-旧版';
const health=previous.instances.find(x=>x.healthState===1);if(health)health.healthState=0;
previous.relations=previous.relations.slice(0,-1);
const engine=new InvestigationEngine({snapshotProvider:async()=>current,environmentName:'内置脱敏演示环境',adapter:new DemoObservabilityAdapter()});
const demos={sources:engine.sources(),snapshots:{'demo-baseline':previous,'demo-current':current},summaries:[snapshotSummary(current,'demo-current'),snapshotSummary(previous,'demo-baseline')],diffs:{},investigations:{}};
for(const [a,b] of [['demo-baseline','demo-current'],['demo-current','demo-baseline'],['demo-current','demo-current'],['demo-baseline','demo-baseline']])demos.diffs[a+'|'+b]=diffSnapshots(demos.snapshots[a],demos.snapshots[b]);
for(const preset of demos.sources.presets)demos.investigations[preset.id]=await engine.investigate({scenario:preset.id,windowMinutes:15});
await writeFile(join(fixtures,'demo.json'),JSON.stringify(demos));
const javaHome=process.env.JAVA_HOME||'D:/Java/Java-install';
const javac=process.platform==='win32'?join(javaHome,'bin/javac.exe'):'javac';
const jar=process.platform==='win32'?join(javaHome,'bin/jar.exe'):'jar';
const stagedJar=join(root,'build/xingtu-server.jar');
const stageOnly=process.argv.includes('--stage-only');
for(const [cmd,args] of [[javac,['--release','17','-encoding','UTF-8','-d',classes,...['Json','EvidenceSchema','HttpUtil','Auth','Vault','EvidenceStore','Legacy','K8sTopology','DeploymentAssistant','DeploymentContract','XingtuServer'].map(x=>join(root,'src',x+'.java'))]],[jar,['--create','--file',stagedJar,'--main-class','XingtuServer','-C',classes,'.','-C',join(root,'build'),'web','-C',join(root,'build'),'fixtures']]]){const result=spawnSync(cmd,args,{stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error('Java 构建失败');}
if(!stageOnly) await rename(stagedJar,join(root,'dist/xingtu-server.jar'));
for(const name of ['deploy.sh','start.sh','启动星图.cmd','start.ps1','Dockerfile','compose.yaml','.dockerignore','nginx.conf.example','README.md','验证结果.md'])await copyFile(join(root,name),join(root,'dist',name));
await writeFile(join(root,'dist/start.ps1'),'\uFEFF'+await read('start.ps1'));
await mkdir(join(root,'dist/collector'),{recursive:true});
for(const name of ['xt-blackbox','catalog.tsv'])await copyFile(join(root,'collector',name),join(root,'dist/collector',name));
await copyFile(join(root,'collector/xt-topology'),join(root,'dist/collector/xt-topology'));
await copyFile(join(root,'collector/xt-preflight.sh'),join(root,'dist/collector/xt-preflight.sh'));
await mkdir(join(root,'dist/deployment'),{recursive:true});
for(const name of ['contract_v21.py','contract_worker.py','requirements-contract.txt','deployment-contract-v2.1.schema.json'])
  await copyFile(join(root,'deployment',name),join(root,'dist/deployment',name));
console.log(stageOnly
  ? '已生成待验证 JAR：build/xingtu-server.jar。'
  : '已生成星图发布包：dist/xingtu-server.jar。');
