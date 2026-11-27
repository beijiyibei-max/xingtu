import {readFile,writeFile,mkdir,copyFile,rename} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {applyShell} from './web/shell.mjs';
import {InvestigationEngine} from './legacy/connector/observability/investigation-engine.mjs';
import {DemoObservabilityAdapter} from './legacy/connector/observability/demo-adapter.mjs';
import {sanitizeSnapshot,snapshotSummary,diffSnapshots} from './legacy/connector/snapshot-store.mjs';
const root=dirname(fileURLToPath(import.meta.url)),legacy=join(root,'legacy');
const web=join(root,'build/web'),fixtures=join(root,'build/fixtures'),classes=join(root,'build/classes');
for(const dir of [web,fixtures,classes,join(root,'dist')])await mkdir(dir,{recursive:true});
const read=name=>readFile(join(root,name),'utf8');
const shellCss=[await read('web/tokens.css'),await read('web/ui.css')].join('\n');
async function page(name,file,transform=x=>x){
  const html=transform(await readFile(file,'utf8'));
  await writeFile(join(web,name+'.html'),applyShell(html,{active:name,css:shellCss}));
}
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
await writeFile(join(web,'workbench.html'),applyShell(project,{active:'workbench',css:shellCss}));
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
for(const [cmd,args] of [[javac,['--release','17','-encoding','UTF-8','-d',classes,...['Json','EvidenceSchema','HttpUtil','Auth','Vault','EvidenceStore','Legacy','K8sTopology','DeploymentAssistant','DeploymentContract','DeploymentPlans','XingtuServer'].map(x=>join(root,'src',x+'.java'))]],[jar,['--create','--file',stagedJar,'--main-class','XingtuServer','-C',classes,'.','-C',join(root,'build'),'web','-C',join(root,'build'),'fixtures']]]){const result=spawnSync(cmd,args,{stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error('Java 构建失败');}
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
