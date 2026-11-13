import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {root,startServer,token,sleep} from './support.mjs';
import {demoTopology} from '../universe/k8s-model.mjs';
import {preparation} from '../deployment/flow.mjs';

await mkdir(join(root,'test/runtime'),{recursive:true});
const app=await startServer(),profile=await mkdtemp(join(root,'test/runtime/chrome-'));
const chrome=spawn(process.env.XT_TEST_CHROME||'C:/Users/Administrator/AppData/Local/Google/Chrome/Bin/chrome.exe',['--headless=new','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='',wsUrl='';chrome.stderr.on('data',b=>{stderr+=b;const m=stderr.match(/DevTools listening on (ws:\/\/[^\r\n]+)/);if(m)wsUrl=m[1];});
class CDP{constructor(url){this.ws=new WebSocket(url);this.pending=new Map();this.handlers=new Map();this.seq=0;this.ready=new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j;});this.ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else this.handlers.get(m.method)?.(m.params);};}async send(method,params={}){await this.ready;const id=++this.seq;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}}
let browser,page,count=0;const exceptions=[],requests=[];
try{
 for(let i=0;i<100&&!wsUrl;i++){if(chrome.exitCode!==null)break;await sleep(100);}if(!wsUrl)throw Error(stderr);
 browser=new CDP(wsUrl);await browser.ready;const origin=wsUrl.replace(/^ws:/,'http:').split('/devtools/')[0],target=await browser.send('Target.createTarget',{url:'about:blank'}),tabs=await(await fetch(origin+'/json/list')).json();page=new CDP(tabs.find(x=>x.id===target.targetId).webSocketDebuggerUrl);await page.ready;
 for(const domain of ['Page','Runtime','DOM','Network'])await page.send(domain+'.enable');
 page.handlers.set('Runtime.exceptionThrown',e=>exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));page.handlers.set('Network.requestWillBeSent',e=>requests.push(e.request.url));page.handlers.set('Page.javascriptDialogOpening',()=>page.send('Page.handleJavaScriptDialog',{accept:true}));
 const evalJS=async expression=>{const r=await page.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=async(expression,message)=>{for(let i=0;i<140;i++){if(await evalJS(expression))return;await sleep(70);}throw Error('等待失败：'+message);};
 const click=async selector=>{await evalJS(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(130);};
 const set=(selector,value)=>evalJS(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
 const nav=async path=>{await page.send('Page.navigate',{url:app.base+path});await sleep(180);};
 const check=(name,condition)=>{assert.ok(condition,name);count++;console.log('PASS',name);};
 await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 await nav('/deployment');await wait('Boolean(document.getElementById("access-key"))','登录页');check('浏览器未登录时跳转登录页',await evalJS('location.pathname==="/login"'));
 await set('#access-key',token);await click('#login-submit');await wait('Boolean(document.querySelector("[data-step]"))','部署向导');
 check('向导直达登录后回到 62 步部署页面',await evalJS('location.pathname==="/deployment" && document.querySelectorAll("[data-step]").length===62'));
 check('部署页可直接问星图并校验操作单',await evalJS('Boolean(document.getElementById("ask-form") && document.getElementById("contract-form"))'));
 await evalJS('document.getElementById("ask-question").value="这一步先查什么"; document.getElementById("ask-form").dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}))');
 await wait('document.getElementById("ask-answer").textContent.includes("本地步骤建议")','问星图本地回落');
 await nav('/');await wait('Boolean(document.querySelector(".modules"))','首页');
 check('首页主入口仍是 7.0，部署向导与原有六个模块并列',await evalJS(`
   document.querySelector('.intro-actions .primary').getAttribute('href')==='/k8s' &&
   JSON.stringify(Array.from(document.querySelectorAll('.modules .card'),a=>a.getAttribute('href')))===
   JSON.stringify(['/workbench','/criteria','/operations','/k8s','/confidential','/map','/deployment'])
 `));
 check('前端存储与 URL 不保存访问密钥',await evalJS(`!document.cookie.includes('xt_session') && localStorage.length===0 && sessionStorage.length===0 && !location.href.includes(${JSON.stringify(token)})`));
 await wait('document.getElementById("server-mode").textContent.includes("内置脱敏演示")','模式标识');
 const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'preview-server.png'),Buffer.from(shot.data,'base64'));
 await nav('/workbench');await wait('Boolean(document.getElementById("project-demo"))','项目工作台');
 check('L1 不显示服务器上传按钮',await evalJS('W.project.policy==="L1" && !document.getElementById("server-backup")'));
 await click('#project-demo');await click('#server-backup');await set('#server-pass','browser-project-password-33');await set('#server-repeat','browser-project-password-33');await click('#server-submit');await wait('SERVER_VAULT.revision===1','上传密文');
 check('项目加密后成功上传服务器',await evalJS('!W.dirty && W.notice.includes("服务器已保存版本 1")'));
 const saved=await app.call('/api/projects',{bearer:true});check('服务器列表不泄露项目名称',saved.status===200&&!saved.text.includes('project-demo'));
 await evalJS('W.project.phase="交接中"; W.dirty=false');await click('#server-restore');await click('#server-list-load');await wait('Boolean(document.querySelector("[data-server-id]"))','读取备份列表');await click('[data-server-id]');await wait('Boolean(document.getElementById("server-unlock"))','解密弹窗');await set('#server-unlock','wrong-password');await click('#server-unlock-submit');await wait('Boolean(document.getElementById("server-dialog-error").textContent)','错误口令');
 check('错误口令不替换当前内存项目',await evalJS('W.project.phase==="交接中"'));
 await set('#server-unlock','browser-project-password-33');await click('#server-unlock-submit');await wait('!document.getElementById("server-unlock")','恢复完成');check('服务器备份在浏览器解密并恢复问题记录',await evalJS('W.project.cases.length===3 && W.project.phase!=="交接中" && !W.dirty'));
 await click('[data-page="acceptance"]');await click('#fill-layer-declaration');await click('[data-layer="template"]');await click('#fill-layer-template');await click('[data-layer="runtime"]');await click('#fill-layer-old');check('原字段验收仍识别 OnDelete 的旧实例',await evalJS('XTProject.evaluate(W.project,selectedChange()).status==="fail"'));
 await click('#fill-layer-runtime');await click('[data-layer="business"]');await click('#fill-layer-business');check('原四层验收完整时通过',await evalJS('XTProject.evaluate(W.project,selectedChange()).status==="pass"'));
 await evalJS('W.dirty=false');await nav('/criteria');await wait('Boolean(document.querySelector("[data-page=preflight]"))','部署判据页');check('原排障导航与部署质检同时保留',await evalJS('document.body.innerText.includes("排障导航") && document.body.innerText.includes("部署质检")'));
 check('旧功能页也可返回统一入口',await evalJS('document.querySelector("body > .xt-global a")?.getAttribute("href")==="/"'));
 await click('[data-page="preflight"]');await click('[data-preflight-mode="config"]');const start=requests.length;
 const doc=await page.send('DOM.getDocument');const input=await page.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#preflight-files'});await page.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[join(root,'../xingtu/k8s/fixtures/preflight-demo/common-config.yaml')]});
 await wait('Boolean(document.querySelector(".result-summary"))','配置检查结果');
 check('原配置文件质检读取真实选中文件并指出 jobCount',await evalJS('document.body.innerText.includes("jobCount 为 0") && document.body.innerText.includes("服务地址回落到本机")'));
 check('配置文件内容没有上传 API',requests.slice(start).every(x=>!x.includes('/api/')));
 const configShot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'preview-config.png'),Buffer.from(configShot.data,'base64'));
 await nav('/operations');await wait('Boolean(window.XINGTU_OPERATIONS?.state.observability)','原运维台');await wait('Boolean(document.querySelector("[data-investigation-preset]"))','演示按钮');await click('[data-investigation-preset="db-timeout"]');await wait('Boolean(window.XINGTU_OPERATIONS.state.investigation)','演示调查');check('Java 服务提供原日志链路回放与可疑点',await evalJS('XINGTU_OPERATIONS.state.investigation.mode==="demo" && XINGTU_OPERATIONS.state.investigation.candidates.length>0'));
 await click('[data-view="changes"]');check('原环境快照差异仍可展示',await evalJS('XINGTU_OPERATIONS.state.diff.changes.length>=3'));
 await nav('/universe');await wait('Boolean(window.XINGTU_IMMERSIVE?.data.components.length)','三维星图');check('原三维关系图可运行',await evalJS('XINGTU_IMMERSIVE.data.components.length>10'));
 await click('[data-mode="live"]');await wait('window.XINGTU_IMMERSIVE.data.mode==="live"','EM 脱敏实况图');check('三维实况回放有明确演示标识',await evalJS('document.body.innerText.includes("非现场实时数据") && XINGTU_IMMERSIVE.data.components.length>10'));
 const apiBefore7=requests.filter(x=>x.includes('/api/')).length;
 await click('[data-version="7.0"]');await wait('window.XINGTU_K8S7?.graph?.meta.view==="knowledge"','7.0 知识图');
 check('点击 7.0 立即显示全部部署组件，保持版本选中',await evalJS('XINGTU_IMMERSIVE.data.components.length>=40 && [...document.querySelectorAll("[data-version]")].find(b=>b.dataset.version==="7.0").getAttribute("aria-pressed")==="true"'));
 check('7.0 知识图不调用旧 latest 或客户接口',requests.filter(x=>x.includes('/api/')).length===apiBefore7);
 await sleep(1200);const overview=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'preview-k8s7-overview.png'),Buffer.from(overview.data,'base64'));
 await evalJS('XINGTU_IMMERSIVE.selectNode("k:aiworks")');
 check('AIWorks 详情含 Chart、落点、来源和项目部署前置',await evalJS('document.getElementById("detailsPanel").innerText.includes("aiworksfront") && document.getElementById("detailsPanel").innerText.includes("node-role.kubernetes.io/aiworks") && document.getElementById("detailsPanel").innerText.includes("资料来源")'));
 await click('#k8s7-catalog [data-k7-node="k:uniparse"]');
 check('左侧目录可切换 uniparse 组件',await evalJS('document.getElementById("detailsPanel").innerText.includes("uniparse")'));
 await sleep(1200);const k7shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'preview-k8s7.png'),Buffer.from(k7shot.data,'base64'));
 await click('#k7-demo');await wait('XINGTU_K8S7.graph.meta.view==="demo"','7.0 演示对象');
 check('7.0 演示明确标注，Pod 归属和异常可见',await evalJS('document.getElementById("dataStatusTitle").textContent.includes("脱敏") && XINGTU_K8S7.graph.components.find(c=>c.name==="aiworks").tone==="bad" && document.getElementById("k7-save").disabled'));
 await evalJS('XINGTU_IMMERSIVE.selectNode("w:dtstack/StatefulSet/aiworks")');await click('[data-k7-pod]');
 check('点击 7.0 Pod 显示对象字段，不发送失效的日志请求',await evalJS('document.getElementById("detailsPanel").innerText.includes("CrashLoopBackOff") && document.getElementById("detailsPanel").innerText.includes("imageID")')&&requests.every(x=>!x.includes('/api/pod-diagnose')));
 const fixture=demoTopology();fixture.isDemo=false;fixture.projectId='browser-project';fixture.generatedAt=new Date().toISOString();const fixturePath=join(profile,'topology-approved.json');await writeFile(fixturePath,JSON.stringify(fixture));
 let k7doc=await page.send('DOM.getDocument'),k7input=await page.send('DOM.querySelector',{nodeId:k7doc.root.nodeId,selector:'#k7-file'});const beforeImport=requests.filter(x=>x.includes('/api/k8s/ingest')).length;
 await page.send('DOM.setFileInputFiles',{nodeId:k7input.nodeId,files:[fixturePath]});await wait('Boolean(document.getElementById("k7-preview-confirm"))','拓扑预检');
 check('导入预检期间不上传，不覆盖当前视图',requests.filter(x=>x.includes('/api/k8s/ingest')).length===beforeImport&&await evalJS('XINGTU_K8S7.graph.meta.view==="demo"'));
 await click('#k7-preview-confirm');await wait('XINGTU_K8S7.graph.meta.view==="imported"','导入对象展示');await click('#k7-save');
 check('保存前显示共享服务器字段与授权确认',await evalJS('Boolean(document.getElementById("k7-upload-confirm")) && document.getElementById("k8s7-modal").innerText.includes("共享访问密钥")'));
 await click('#k7-upload-confirm');await wait('document.getElementById("k7-note").textContent.includes("已保存到服务器")','现场快照保存');
 await click('#k7-knowledge');await click('[data-mode="live"]');await click('#k7-fetch-scopes');await wait('Boolean(document.querySelector("[data-k7-scope]"))','环境列表');await click('[data-k7-scope]');await wait('XINGTU_K8S7.graph.meta.view==="imported"','按环境恢复');
 check('按项目集群选择服务器快照，保持 7.0 版本',await evalJS('XINGTU_K8S7.graph.meta.scope.projectId==="browser-project" && XINGTU_IMMERSIVE.data.mode==="k8s"'));
 await click('[data-version="6.3"]');await wait('XINGTU_IMMERSIVE.data.mode==="knowledge"','返回 6.3');check('6.3 原知识图仍保留，7.0 控件正确隐藏',await evalJS('XINGTU_IMMERSIVE.data.components.length===22 && document.getElementById("k8s7-tools").hidden'));
 await evalJS('document.querySelector(\'[data-version="7.0"]\').click();document.querySelector(\'[data-version="6.3"]\').click();document.querySelector(\'[data-version="7.0"]\').click()');await sleep(1100);check('快速切换版本时旧页面异步回调不会覆盖 7.0',await evalJS('XINGTU_IMMERSIVE.data.mode==="k8s" && XINGTU_IMMERSIVE.data.components.length===45 && !document.body.classList.contains("is-transitioning")'));
 await nav('/k8s');await wait('window.XINGTU_K8S7?.graph?.meta.view==="knowledge"','7.0 直达入口');check('7.0 直达入口无需现场数据也有内容',await evalJS('XINGTU_IMMERSIVE.data.components.length>=40'));
 const before=requests.length;await nav('/confidential');await wait('Boolean(document.querySelector("#app button"))','保密页面');await sleep(350);check('原保密现场无后台 API 和自由文本输入',requests.slice(before).every(x=>!x.includes('/api/'))&&await evalJS('!document.querySelector("input[type=text],textarea,input[type=file]")'));
 await nav('/');await wait('Boolean(document.querySelector(".modules"))','首页');await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});check('统一首页窄屏无水平溢出',await evalJS('document.documentElement.scrollWidth<=innerWidth+1'));
 const beforeGuide = requests.length;
 await click('.modules a[href="/deployment"]');
 await wait('document.querySelectorAll("[data-step]").length===62','首页进入部署向导');
 check('向导窄屏可用，设置前禁止记录通过',await evalJS('document.documentElement.scrollWidth<=innerWidth+1 && document.getElementById("pass").disabled'));
 check('默认陪跑只提出一个起步问题，完整表单隐藏',await evalJS(`
   document.getElementById('deployment-main').dataset.view==='beginner' &&
   getComputedStyle(document.getElementById('settings')).display==='none' &&
   getComputedStyle(document.querySelector('.outline')).display==='none' &&
   document.querySelector('#walk-screen h1').textContent==='你现在从哪里开始？' &&
   document.querySelectorAll('[data-walk=route]').length===3 && !document.querySelector('[data-walk=storage]')
 `));
 await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
 const beginnerShot=await page.send('Page.captureScreenshot',{format:'png'});
 await writeFile(join(root,'preview-deployment-beginner.png'),Buffer.from(beginnerShot.data,'base64'));
 const hostResult='XT_PREFLIGHT_V1='+JSON.stringify({arch:'x86_64',cpu:8,memoryMiB:16384,rootUsed:73,swap:'on',dataMount:'not-mounted',sync:'unknown',tar:false,kube:'not-run',ready:null,total:null});
 await click('.toolbar [data-host-check]');
 check('服务器检查默认命令为单行且未启用 kubectl',await evalJS(`
   document.getElementById('host-check').open && !document.getElementById('host-k8s').checked &&
   !document.getElementById('host-command').textContent.includes(String.fromCharCode(10)) &&
   document.getElementById('host-command').textContent.endsWith('| sh -s --')
 `));
 await set('#host-result-input',hostResult);
 await click('#host-interpret');
 check('服务器检查显示优先项、清空粘贴值且不变更进度',await evalJS(`
   document.getElementById('host-results').textContent.includes('缺少 tar') &&
   document.getElementById('host-results').textContent.includes('根分区已用 73%') &&
   document.getElementById('host-result-input').value==='' &&
   !localStorage.getItem('xingtu-deployment-progress-v1')
 `));
 await click('#host-close');
 await click('[data-walk=route][data-value=fresh]');
 await click('[data-walk=storage-help]');
 check('不知道存储时先解释去哪里确认，流程停在当前问题',await evalJS('document.querySelector("#walk-screen .callout").textContent.includes("实施单的存储章节") && !localStorage.getItem("xingtu-deployment-progress-v1")'));
 await click('[data-walk=storage][data-value=mixed]');
 check('依次回答两个问题后进入当前操作和正常反馈',await evalJS(`
   JSON.parse(localStorage.getItem('xingtu-deployment-progress-v1')).scope.ns==='dtstack' &&
   document.querySelector('#walk-screen h1').textContent==='确定本次交付范围' &&
   document.querySelector('#walk-screen .result pre').textContent.includes('项目范围已确认')
 `));
 await click('#walk-normal');
 check('看到正常示例后仍需确认验收条件才保存通过',await evalJS(`
   document.querySelector('#walk-screen h2').textContent==='这些条件都满足了吗？' &&
   !JSON.parse(localStorage.getItem('xingtu-deployment-progress-v1')).records.scope
 `));
 await click('[data-walk=back-action]');
 await click('#view-mode');
 check('可随时展开原有完整步骤和项目设置',await evalJS('document.getElementById("deployment-main").dataset.view==="full" && document.getElementById("settings").open'));
 const guideScope={alias:'E2E',cluster:'new',manager:'new',network:'offline',storage:'mixed',ns:'e2e-dt',emNs:'e2e-em'};
 for(const [field,value] of Object.entries(guideScope)) await set(`#scope-form [name="${field}"]`,value);
 await click('#scope-form button[type="submit"]');
 await click('[data-step="4"]');
 await click('#detail [data-yaml-review]');
 const yamlFile=join(profile,'config.yaml');
 const yamlSource='IP: 10.90.7.10\nport: 30080\nstorage: {em: {pvc: local, local: {path: /data/em, nodeLabelKey: kubernetes.io/hostname, nodeLableVal: work01}}}\n---\nglobal:\n  db:\n    password: test-yaml-secret-never-render\n';
 await writeFile(yamlFile,yamlSource,'utf8');
 const yamlDoc=await page.send('DOM.getDocument');
 const yamlInput=await page.send('DOM.querySelector',{nodeId:yamlDoc.root.nodeId,selector:'#yaml-files'});
 await page.send('DOM.setFileInputFiles',{nodeId:yamlInput.nodeId,files:[yamlFile]});
 await wait('document.getElementById("yaml-status").textContent.includes("已检查 1 份")','本地 YAML 读取');
 check('部署步骤中自动识别 EM 文件，并按行报告地址和卷，隐藏密码',await evalJS(`
   document.getElementById('yaml-review').open && document.getElementById('yaml-results').textContent.includes('EasyManager') &&
   document.getElementById('yaml-results').textContent.includes('第 1 行') &&
   document.getElementById('yaml-results').textContent.includes('已填写，待现场核对') &&
   !document.getElementById('yaml-results').textContent.includes('test-yaml-secret-never-render')
 `));
 await click('.yaml-baseline summary');
 await set('#yaml-baseline [name="emIp"]','10.90.7.20');
 await click('#yaml-rescan');
 await wait('document.getElementById("yaml-status").textContent.includes("已对照")','现场值对照完成');
 check('对照现场值列出修改建议，原文件和进度均未写入',await evalJS(`
   document.getElementById('yaml-results').textContent.includes('与填写的现场确认值不一致') &&
   document.querySelector('.yaml-expected').textContent.includes('10.90.7.20') &&
   !localStorage.getItem('xingtu-deployment-progress-v1').includes('10.90.7.20')
 `) && await readFile(yamlFile,'utf8')===yamlSource);
 await click('.yaml-baseline summary');
 const yamlShot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'preview-yaml-review.png'),Buffer.from(yamlShot.data,'base64'));
 await click('#yaml-close');
 await click('[data-step="6"]');
 await click('.lesson-nav [data-lesson="1"]');
 check('未验收前置时可学习安装判读但不能复制安装命令',await evalJS('!document.getElementById("command-text") && document.getElementById("pass").disabled && document.getElementById("lesson-output").textContent.includes("INSTALL_EXIT=0")'));
 await click('#resume');
 const passStep=async()=>{
   await evalJS('document.querySelectorAll("#checks input:not(:checked)").forEach(box=>box.click())');
   await click('#pass');
 };
 await passStep();await passStep();
 await click('.reasons summary');await set('#block-reason','等现场确认或变更窗口');await click('#block');
 await nav('/deployment');
 await wait('document.querySelector(".badge")?.textContent==="卡住"','恢复已记录卡点');
 check('保存卡点后刷新恢复，自动定位最早未完成步骤',await evalJS('document.getElementById("step-title").textContent.includes("拓扑") && document.getElementById("progress-label").textContent.includes("通过 2 / 62")'));
 await click('#view-mode');
 await click('[data-step="7"]');
 await click('.lesson-nav [data-lesson="2"]');
 check('节点命令有执行位置、示例输出和通过判据',await evalJS('document.querySelector("#detail .lesson-target").textContent.includes("运维终端") && document.getElementById("command-text").textContent.includes("kubectl get nodes") && document.querySelector("#detail .result pre").textContent.includes("Ready") && document.querySelector("#detail .result p").textContent.includes("逐台核对")'));
 await evalJS('window.scrollTo(0,0)');
 const guideShot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'preview-deployment.png'),Buffer.from(guideShot.data,'base64'));
 await click('[data-output="errors"]');
 check('NotReady 给出定位、处理和复验',await evalJS('document.querySelector(".error-case[open] summary").textContent.includes("NotReady") && document.querySelector(".error-case[open]").textContent.includes("怎么复验")'));
 await click('[data-step="3"]');await click('.lesson-nav [data-lesson="1"]');
 await evalJS('(()=>{const p=document.querySelector("[data-param=path]");p.value="/data;id";p.dispatchEvent(new Event("input",{bubbles:true}));})()');
 check('无效参数不进入命令且不能复制',await evalJS('document.getElementById("copy-command").disabled && !document.getElementById("command-text").textContent.includes(";id")'));
 await evalJS('(()=>{const p=document.querySelector("[data-param=path]");p.value="/var/lib/etcd";p.dispatchEvent(new Event("input",{bubbles:true}));})()');
 check('有效路径进入命令且不写入进度',await evalJS('!document.getElementById("copy-command").disabled && document.getElementById("command-text").textContent.includes("findmnt -T /var/lib/etcd") && !localStorage.getItem("xingtu-deployment-progress-v1").includes("/var/lib/etcd")'));
 await evalJS('const input=document.getElementById("search");input.value="157";input.dispatchEvent(new Event("input"))');
 check('可按 157 现象找到 Nacos 和 Gateway 步骤',await evalJS('document.getElementById("steps").innerText.includes("Nacos") && document.getElementById("steps").innerText.includes("Gateway")'));
 await evalJS('Array.from(document.querySelectorAll("#steps [data-step]")).find(b=>b.innerText.includes("Gateway")).click()');
 check('点击故障搜索结果直接展开 157 处置',await evalJS('document.querySelector(".error-case[open] summary").textContent.includes("157") && document.querySelector(".error-case[open]").textContent.includes("Group")'));
 const downloadDir=join(profile,'downloads');await mkdir(downloadDir);
 await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
 await click('#download');await click('#report');
 const progressFile=join(downloadDir,'星图部署进度-E2E.json'),reportFile=join(downloadDir,'星图部署交接-E2E.md');
 const readDownloaded=async path=>{for(let i=0;i<30;i++){try{return await readFile(path,'utf8');}catch{await sleep(100);}}throw Error('下载未生成');};
 const progress=JSON.parse(await readDownloaded(progressFile)),report=await readDownloaded(reportFile);
 check('下载的 JSON 和交接清单保存卡点与验收结果',progress.records.architecture.status==='blocked' && report.includes('等现场确认或变更窗口') && report.includes('已通过'));
 await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await page.send('Page.navigate',{url:pathToFileURL(join(root,'dist/数栈7.0部署向导.html')).href});
 await wait('location.protocol==="file:" && document.querySelectorAll("[data-step]").length===62','断网打开单文件向导');
 const guideDoc=await page.send('DOM.getDocument');
 const guideInput=await page.send('DOM.querySelector',{nodeId:guideDoc.root.nodeId,selector:'#import-file'});
 await page.send('DOM.setFileInputFiles',{nodeId:guideInput.nodeId,files:[progressFile]});
 await wait('document.querySelector(".badge")?.textContent==="卡住"','离线进度导入');
 await click('.toolbar [data-host-check]');
 await set('#host-result-input',hostResult);
 await click('#host-interpret');
 check('断网单文件可以解读服务器结果',await evalJS('document.getElementById("host-results").textContent.includes("当前用量") || document.getElementById("host-results").textContent.includes("根分区已用 73%")'));
 await click('#host-close');
 await click('#view-mode');
 await click('[data-step="9"]');
 check('断网导入成功，命令填入已确认的 EM Namespace',await evalJS('document.querySelector("#detail .command pre").textContent.includes("kubectl -n e2e-em get") && document.getElementById("main-links").hidden'));
 await click('[data-output="errors"]');
 check('断网可查看 EM Pod 异常处置',await evalJS('document.getElementById("lesson-output").textContent.includes("ImagePullBackOff")'));
 await click('.toolbar [data-yaml-review]');
 await click('#yaml-example');
 await wait('document.getElementById("yaml-status").textContent.includes("已检查 2 份演示")','断网 YAML 演示');
 check('离线文件可检查 YAML 占位符和回环地址',await evalJS('document.getElementById("yaml-results").textContent.includes("模板占位值") && document.getElementById("yaml-results").textContent.includes("回环")'));
 await click('#yaml-close');
 await click('#view-mode');
 const emPlanFile=join(profile,'em-branch-progress.json');
 const earlier=preparation.flatMap(phase=>phase.steps).slice(0,9);
 await writeFile(emPlanFile,JSON.stringify({...progress,records:Object.fromEntries(earlier.map(step=>[
   step.id,{status:'passed',checks:step.checks.map((_,index)=>index),ref:'',reason:'',updatedAt:new Date().toISOString()},
 ]))}));
 const walkDoc=await page.send('DOM.getDocument');
 const walkInput=await page.send('DOM.querySelector',{nodeId:walkDoc.root.nodeId,selector:'#import-file'});
 await page.send('DOM.setFileInputFiles',{nodeId:walkInput.nodeId,files:[emPlanFile]});
 await wait('document.querySelector("#walk-screen h1")?.textContent.includes("验证 EM 页面")','进入 EM 陪跑');
 for(let i=0;i<3;i++) await click('#walk-normal');
 await click('.walk-errors summary');
 await evalJS('Array.from(document.querySelectorAll("#walk-screen [data-walk=issue]")).find(b=>b.textContent.includes("电脑超时")).click()');
 check('EM 访问分支给出浏览器所在机器的命令、正常输出和复验',await evalJS(`
   document.getElementById('walk-command').textContent.includes('Test-NetConnection') &&
   document.querySelector('#walk-screen .result pre').textContent.includes('TcpTestSucceeded : True') &&
   document.querySelector('.walk-recovery').textContent.includes('Hermes 05')
 `));
 const walkShot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'preview-deployment-companion.png'),Buffer.from(walkShot.data,'base64'));
 await click('[data-walk=block]');
 await page.send('Page.navigate',{url:pathToFileURL(join(root,'dist/数栈7.0部署向导.html')).href});
 await wait('document.querySelector("#walk-screen h2")?.textContent.includes("电脑超时")','断网刷新恢复卡点分支');
 check('断网刷新后恢复同一报错分支',await evalJS('document.querySelector(".walk-top").textContent.includes("已记录卡点")'));
 await click('[data-walk=retry]');
 check('复查回到同一动作并保留卡点状态',await evalJS('document.querySelector("#walk-screen h2").textContent.includes("打开 EM 登录页") && JSON.parse(localStorage.getItem("xingtu-deployment-progress-v1")).records["em-bind"].status==="blocked"'));
 check('向导只在本机保存与导入导出，没有发送 API 请求',requests.slice(beforeGuide).every(url=>!url.includes('/api/')));
 check('所有页面没有未捕获脚本错误',exceptions.length===0);console.log(`${count} browser checks passed`);
}finally{if(browser)await browser.send('Browser.close').catch(()=>{});page?.ws.close();browser?.ws.close();chrome.kill();await app.stop();}
