/** Project records contain reviewed evidence summaries, never raw dialogue or credentials. */
const XTProject = (() => {
  const clone = value => structuredClone(value);
  const now = () => new Date().toISOString();
  const id = () => crypto.randomUUID();
  const source = (file, line) => ({ file, line, type:'historical-replay' });
  const CASES = [
    {id:'ray-image',title:'Ray 侧车镜像：现场误填与旧结论撤销',symptom:'RayJob 报 InvalidImageName，曾被解释为服务端拼接错误。',
      source:source('FZSealos 数栈现场部署10.md',32202),
      hypotheses:[{id:'ray-product',text:'服务端错误拼接镜像名',status:'rejected',reason:'历史记录已更正为参数值混入键名，原缺陷上报和临时脚本撤销。'},
        {id:'ray-value',text:'参数值混入键名，渲染出非法镜像串',status:'confirmed',reason:'历史更正记录支持该次事件；不能直接认定当前任务也同因。'}],
      checks:[{id:'ray-source',label:'平台参数值是否混入键名',choices:['未检查','值中混入键名','值为纯镜像地址'],em:'数栈平台 → Ray 参数 → ray.job.log.sidecar.image；仅检查值的形态，不复制凭据。'},
        {id:'ray-render',label:'本次 RayJob 的镜像字段',choices:['未检查','镜像字段非法','镜像字段正确','对象已回收'],em:'任务实例 → 对应 RayJob；确认是本次任务，不能沿用上一次 Pod 名。'},
        {id:'ray-result',label:'正规修正后最小任务结果',choices:['未检查','任务及输出均正常','仍失败','未批准变更'],em:'在批准的参数修改后重跑最小任务，核对输出内容。'}]},
    {id:'nacos-members',title:'Nacos：文件正确不等于成员同步',symptom:'后端自报注册完成，网关仍提示没有可用服务。',
      source:source('FZSealos 数栈现场部署11.md',45530),
      hypotheses:[{id:'nacos-file',text:'修正 cluster.conf 的 Namespace 就足以解决本次故障',status:'rejected',reason:'历史记录随后撤回了“改文件即解决”的判断，需检查配置实际被读取及成员状态。'},
        {id:'nacos-launch',text:'启动参数或其他配置源覆盖文件中的成员名单',status:'pending',reason:'历史仅提供检查方向，当前环境需要启动参数和成员查询证据。'}],
      checks:[{id:'nacos-ready',label:'Nacos 对象就绪情况',choices:['未检查','三个副本 Ready','存在非 Ready 副本','无权限'],em:'EM → Nacos → 实例列表；Ready 只证明对象状态。'},
        {id:'nacos-source',label:'实际启动参数与成员名单',choices:['未检查','启动参数覆盖或名单为空','已确认采用正确名单','无权限'],em:'EM 查看当前启动配置；必要时由有权限人员核对进程参数。'},
        {id:'nacos-sync',label:'逐节点成员与目标服务实例',choices:['未检查','成员与实例均一致','节点间不一致','无法获取'],em:'批准的 Nacos 查询入口，逐节点核验同一服务、同一 namespace/group。'}]},
    {id:'aiworks-rollback',title:'AIWorks：Chart 回退但 Pod 仍跑新镜像',symptom:'回退操作提示完成，实际 Pod 镜像未变化。',
      source:source('FZSealos 数栈现场部署12.md',149745),
      hypotheses:[{id:'aw-history',text:'Chart 版本回退就代表应用已经回退',status:'rejected',reason:'历史回显中 Chart 已回退而 Pod 仍是新镜像；需要分别核对声明、模板和运行容器。'},
        {id:'aw-pod',text:'模板已改，现有 Pod 尚未采用目标镜像',status:'pending',reason:'需核对 workload 类型、updateStrategy、Pod UID 和 imageID。'}],
      checks:[{id:'aw-declaration',label:'EM 中的镜像声明',choices:['未检查','前后端均为目标值','仍有旧值','无权限'],em:'EM → AIWorks → 配置；核对 global.imageTags 中前后端键，以当前 Chart 为准。'},
        {id:'aw-template',label:'模板与当前 Pod',choices:['未检查','模板正确但 Pod 仍旧','模板与 Pod 均匹配','模板未更新'],em:'实例详情核对 StatefulSet/Deployment、更新策略和当前 Pod 实际镜像。'},
        {id:'aw-business',label:'本次业务复测',choices:['未检查','页面与最小知识库任务正常','业务仍失败','未批准变更'],em:'保留同一个最小样本的处理结果；到字段验收页关联样本与证据。'}]}
  ];
  const FIELD_LABELS={backendImage:'后端镜像',frontendImage:'前端镜像',backendDigest:'后端 digest',frontendDigest:'前端 digest',cpu:'CPU',memory:'内存'};
  function event(p,type,summary) { p.events.push({id:id(),at:now(),epoch:p.epoch,type,summary});p.updatedAt=now(); }
  function create({projectId='project-01',clusterId='cluster-01',namespace='dtstack',policy='L1'}={}) {
    return {kind:'xingtu-project',version:1,id:id(),projectId,clusterId,namespace,policy,phase:'部署中',epoch:1,isDemo:false,
      createdAt:now(),updatedAt:now(),facts:[],changes:[],cases:[],events:[]};
  }
  function templates(){return clone(CASES);}
  function addCase(p,templateId) {
    const next=clone(p), t=CASES.find(x=>x.id===templateId);if(!t)throw Error('未知案例模板');
    if(next.cases.some(x=>x.templateId===templateId&&x.epoch===p.epoch&&x.status!=='resolved'))throw Error('当前环境代次已有未闭环的同类问题');
    const c={...clone(t),id:id(),templateId:t.id,epoch:p.epoch,status:'investigating',evidence:[],judgments:[],nextAction:'先取得当前环境证据，历史结论只作为检查参考'};
    c.judgments=c.hypotheses.map(h=>({...h,id:id(),status:h.status==='rejected'?'rejected':'pending',history:[{at:now(),status:h.status==='rejected'?'rejected':'pending',reason:h.reason}],source:clone(t.source)}));
    delete c.hypotheses;next.cases.push(c);event(next,'case-added',`添加问题：${c.title}`);return next;
  }
  function getCase(p,cid){const c=p.cases.find(x=>x.id===cid);if(!c)throw Error('问题不存在');return c;}
  function evidence(p,cid,{checkId,value,reference,checkedAt}) {
    const next=clone(p),c=getCase(next,cid),check=c.checks.find(x=>x.id===checkId);
    if(c.epoch!==p.epoch)throw Error('历史环境问题仅供回看，请为新代次添加问题');
    if(c.status==='resolved')throw Error('问题已闭环；复发时请新建记录');
    if(!check||!check.choices.includes(value)||value==='未检查')throw Error('请选择实际检查结果');
    if(!reference?.trim()||!validTime(checkedAt))throw Error('需要证据定位和实际核对时间');
    c.evidence.push({id:id(),checkId,value,reference:reference.trim(),checkedAt,recordedAt:now(),epoch:p.epoch});
    const remaining=c.checks.find(x=>!c.evidence.some(e=>e.checkId===x.id));
    c.nextAction=remaining?remaining.em:'证据项已记录；复核相互矛盾的结果和当前判断，不能只按填完数量结案';
    event(next,'evidence-added',`问题证据：${check.label} → ${value}`);return next;
  }
  function reject(p,cid,jid,reason,reference) {
    const next=clone(p),c=getCase(next,cid),j=c.judgments.find(x=>x.id===jid);
    if(c.epoch!==p.epoch)throw Error('历史问题不可改写');
    if(!j||j.status==='rejected')throw Error('该判断已作废或不存在');
    if(!reason?.trim()||!reference?.trim())throw Error('作废需要原因和反证定位');
    j.status='rejected';j.reason=reason.trim();j.history.push({at:now(),status:'rejected',reason:reason.trim(),reference:reference.trim()});
    event(next,'judgment-rejected',`判断作废：${j.text}`);return next;
  }
  function confirm(p,cid,jid,evidenceId) {
    const next=clone(p),c=getCase(next,cid),j=c.judgments.find(x=>x.id===jid);
    if(c.epoch!==p.epoch||!j||j.status==='rejected')throw Error('旧代次或已作废判断不能重新启用');
    const e=c.evidence.find(x=>x.id===evidenceId&&x.epoch===p.epoch);
    if(!e||['无权限','无法获取','对象已回收','未批准变更'].includes(e.value))throw Error('需要当前代次的有效支持证据');
    j.status='operator-confirmed';j.history.push({at:now(),status:'operator-confirmed',evidenceId});event(next,'judgment-confirmed',`人员关联证据确认：${j.text}`);return next;
  }
  function closeCase(p,cid){
    const next=clone(p),c=getCase(next,cid);if(c.epoch!==p.epoch)throw Error('旧环境问题不可直接闭环');
    const latest=new Map(c.evidence.map(e=>[e.checkId,e]));
    if(c.checks.some(check=>!latest.has(check.id)||['无权限','无法获取','对象已回收','未批准变更'].includes(latest.get(check.id).value)))throw Error('仍有检查缺口或权限限制，不能标为闭环');
    const final=latest.get(c.checks.at(-1).id);if(!['任务及输出均正常','成员与实例均一致','页面与最小知识库任务正常'].includes(final?.value))throw Error('需要当前问题的结果层复测正常');
    c.status='resolved';c.nextAction='本次问题已由人员核对闭环；同类现象再次出现时新建记录，不沿用本次根因。';event(next,'case-resolved',`问题闭环：${c.title}`);return next;
  }
  function addFact(p,{label,value,scope,reference,checkedAt}) {
    if(!label?.trim()||!value?.trim()||!reference?.trim()||!validTime(checkedAt)||!['runtime','persistent'].includes(scope))throw Error('事实需包含项目、结果、类别、证据定位和核对时间');
    const next=clone(p);next.facts.push({id:id(),label,value,scope,reference,checkedAt,epoch:p.epoch,status:'operator-confirmed'});event(next,'fact-added',`记录事实：${label}`);return next;
  }
  function recheckFact(p,fid,{value,reference,checkedAt}) {
    if(!value?.trim()||!reference?.trim()||!validTime(checkedAt))throw Error('重新核对需要结果、证据定位和时间');
    const next=clone(p),f=next.facts.find(x=>x.id===fid);if(!f)throw Error('事实不存在');
    f.history=[...(f.history||[]),{value:f.value,reference:f.reference,checkedAt:f.checkedAt,epoch:f.epoch,status:f.status}];
    Object.assign(f,{value,reference,checkedAt,epoch:p.epoch,status:'operator-confirmed'});event(next,'fact-rechecked',`重新核对：${f.label}`);return next;
  }
  function rebuild(p,reason) {
    if(!reason?.trim())throw Error('需要记录新代次原因');
    const next=clone(p);next.epoch++;next.phase='重建恢复';
    next.facts.forEach(f=>{f.status=f.scope==='runtime'?'invalid':'pending-recheck';});
    next.cases.forEach(c=>{c.status='historical';c.nextAction='旧环境记录，仅供回看；新代次需要重新取证';});
    event(next,'environment-rebuilt',reason);return next;
  }
  function newAcceptance(p,target,baseline={}) {
    for(const key of Object.keys(FIELD_LABELS))if(!target[key]?.trim())throw Error(`目标缺少${FIELD_LABELS[key]}`);
    for(const key of ['backendDigest','frontendDigest'])if(!/^sha256:[0-9a-f]{64}$/i.test(target[key]))throw Error('目标 digest 格式应为 sha256: 加 64 位十六进制');
    if(resource('cpu',target.cpu)===null||resource('memory',target.memory)===null)throw Error('CPU 或内存目标格式无效');
    if(!target.reference?.trim())throw Error('目标需要批准物料或变更单定位');
    const next=clone(p);const change={id:id(),kind:'aiworks',epoch:p.epoch,createdAt:now(),target:clone(target),baseline:clone(baseline),layers:{},records:[]};next.changes.push(change);event(next,'change-planned','冻结 AIWorks 前后端镜像、digest 和资源目标');return next;
  }
  function saveLayer(p,changeId,layer,data) {
    const next=clone(p),change=next.changes.find(x=>x.id===changeId);
    if(!change||change.epoch!==p.epoch)throw Error('变更不属于当前环境代次');
    if(!['declaration','template','runtime','business'].includes(layer))throw Error('未知生效层');
    if(!data.reference?.trim()||!validTime(data.checkedAt))throw Error('每层需要证据定位和实际核对时间');
    const record={...clone(data),epoch:p.epoch,recordedAt:now()};
    change.layers[layer]=record;change.records.push({layer,...record});event(next,'layer-recorded',`记录 AIWorks ${layer} 层证据`);return next;
  }
  function validTime(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.now()+300000;}
  function resource(kind,value){
    if(typeof value!=='string')return null;const text=value.trim();
    if(kind==='cpu'){if(!/^\d+(?:\.\d+)?m?$/.test(text))return null;const n=text.endsWith('m')?parseFloat(text)/1000:Number(text);return n>0?n:null;}
    const m=text.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/);if(!m)return null;
    const factors={Ki:1024,Mi:1024**2,Gi:1024**3,Ti:1024**4,K:1000,M:1e6,G:1e9,T:1e12};const n=Number(m[1])*(factors[m[2]]||1);return n>0?n:null;
  }
  function evaluate(p,change) {
    if(!change)return {status:'pending',rows:[],gaps:['尚未建立变更目标']};
    if(change.epoch!==p.epoch)return {status:'stale',rows:[],gaps:['环境已重建，旧代次验收不可沿用']};
    const rows=[],gaps=[],target=change.target;
    for(const layer of ['declaration','template','runtime']){
      const e=change.layers[layer],fresh=e&&e.epoch===p.epoch&&validTime(e.checkedAt)&&Date.parse(e.checkedAt)>=Math.floor(Date.parse(change.createdAt)/1000)*1000;
      for(const key of ['backendImage','frontendImage','cpu','memory']){
        let state='missing';if(fresh&&e.reference&&e[key]){const same=['cpu','memory'].includes(key)?resource(key,e[key])!==null&&resource(key,e[key])===resource(key,target[key]):e[key]===target[key];state=same?'pass':'fail';}
        rows.push({layer,key,label:FIELD_LABELS[key],expected:target[key],actual:e?.[key]||'',state});
      }
      if(!fresh)gaps.push(`${layer} 层缺少当前变更开始之后的有效证据`);
      if(layer==='template'&&(!fresh||!['OnDelete','RollingUpdate'].includes(e.strategy)))gaps.push('缺少已核实的模板更新策略');
      if(layer==='runtime'){
        for(const key of ['backendDigest','frontendDigest']){
          const actual=e?.[key]||'',match=actual.match(/sha256:[0-9a-f]{64}/i),state=!fresh||!match?'missing':match[0].toLowerCase()===target[key].toLowerCase()?'pass':'fail';
          rows.push({layer,key,label:FIELD_LABELS[key],expected:target[key],actual,state});
        }
        if(!fresh||!e.podUID?.trim())gaps.push('缺少当前后端 Pod UID，不能确认检查的是哪个实例');
        if(!fresh||!e.frontendPodUID?.trim())gaps.push('缺少当前前端 Pod UID');
      }
    }
    const business=change.layers.business;
    const businessValid=business&&business.epoch===p.epoch&&validTime(business.checkedAt)&&Date.parse(business.checkedAt)>=Math.floor(Date.parse(change.createdAt)/1000)*1000&&business.reference&&business.sampleId?.trim()&&business.summary?.trim();
    const businessState=!businessValid?'missing':business.status==='pass'?'pass':business.status==='fail'?'fail':'missing';
    rows.push({layer:'business',key:'result',label:'样本业务结果',expected:'页面与最小样本均正常',actual:business?.summary||'',state:businessState});
    if(!businessValid)gaps.push('业务层需要样本编号、结果摘要、证据定位和复测时间');
    const template=change.layers.template,runtime=change.layers.runtime;
    if(template?.strategy==='OnDelete'&&template.backendImage===target.backendImage&&runtime?.backendImage&&runtime.backendImage!==target.backendImage)gaps.push('模板已改，当前 Pod 仍用旧镜像；OnDelete 场景需按批准流程处理实例并重新取证');
    const status=rows.some(x=>x.state==='fail')?'fail':rows.some(x=>x.state==='missing')||gaps.length?'pending':'pass';
    return {status,rows,gaps};
  }
  function handover(p){
    return [`星图项目续接 · ${p.projectId} / ${p.clusterId} / ${p.namespace}`,`阶段：${p.phase}；环境代次：${p.epoch}；${p.isDemo?'脱敏回放，非现场数据':'人员维护的本机项目档案'}`,
      '', '当前事实：',...p.facts.filter(x=>x.status==='operator-confirmed'&&x.epoch===p.epoch).map(x=>`- ${x.label}：${x.value}；证据 ${x.reference}；核对 ${x.checkedAt}`),
      '', '待重新核验：',...p.facts.filter(x=>x.status!=='operator-confirmed').map(x=>`- ${x.label}：${x.status==='invalid'?'运行态已失效':'持久数据待回查'}`),
      '', '问题与下一步：',...p.cases.filter(x=>x.epoch===p.epoch).map(c=>`- ${c.title}\n  现象：${c.symptom}\n  下一步：${c.nextAction}`),
      '', '已作废判断（不得沿用）：',...p.cases.flatMap(c=>c.judgments.filter(j=>j.status==='rejected').map(j=>`- ${j.text}；原因：${j.reason}`)),
      '', '变更验收：',...p.changes.map(c=>`- AIWorks / 代次 ${c.epoch}：${evaluate(p,c).status}；${evaluate(p,c).gaps.join('；')}`),
      '', '续接纪律：先核对当前环境代次和证据时间；历史结论只作检查方向。'].join('\n');
  }
  function demo(){
    let p=create({projectId:'demo-project',clusterId:'demo-cluster',namespace:'dtstack',policy:'L2'});p.isDemo=true;p.phase='升级维护';
    for(const t of CASES)p=addCase(p,t.id);
    p=addFact(p,{label:'AIWorks 控制来源',value:'EM 配置 → StatefulSet → 当前 Pod',scope:'runtime',reference:'脱敏回放：人员检查摘要',checkedAt:now()});
    p=addFact(p,{label:'数据落点',value:'保留在原数据节点；重建后需要核对挂载与原数据可见性',scope:'persistent',reference:'脱敏回放：存储核对摘要',checkedAt:now()});
    const target={backendImage:'example.invalid/aiworks:stable',frontendImage:'example.invalid/aiworksfront:stable',backendDigest:'sha256:'+'a'.repeat(64),frontendDigest:'sha256:'+'b'.repeat(64),cpu:'8',memory:'16Gi',reference:'脱敏示例：批准的目标物料'};
    p=newAcceptance(p,target,{backendImage:'example.invalid/aiworks:new',frontendImage:'example.invalid/aiworksfront:new',reference:'脱敏示例：变更前记录'});
    return p;
  }
  function secretCheck(text){if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|passwd|secret[_-]?key|access[_-]?key|authorization|api[_-]?token)\s*[:=]\s*\S+/i.test(text))throw Error('检测到疑似凭据赋值，请移除明文后再保存；项目文件不能存账号密钥');}
  function validate(value){
    if(!value||value.kind!=='xingtu-project'||value.version!==1)throw Error('不是 V3.2 项目文件');
    const keys=Object.keys(create());if(Object.keys(value).some(k=>!keys.includes(k)))throw Error('项目文件包含不支持的顶层字段');
    if(!['L1','L2'].includes(value.policy)||!Number.isInteger(value.epoch)||value.epoch<1)throw Error('项目模式或环境代次无效');
    for(const key of ['id','projectId','clusterId','namespace','phase','createdAt','updatedAt'])if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>200)throw Error('项目字段无效：'+key);
    for(const key of ['facts','cases','changes','events'])if(!Array.isArray(value[key])||value[key].length>1000)throw Error('项目记录过多或格式无效');
    const safeText=(text,max=1000)=>typeof text==='string'&&text.length<=max;
    const epoch=e=>Number.isInteger(e)&&e>=1&&e<=value.epoch;
    if(typeof value.isDemo!=='boolean'||!PHASE_VALUES.includes(value.phase))throw Error('项目阶段或演示标识无效');
    if(value.policy==='L1'&&(!/^project-\d{2}$/.test(value.projectId)||!/^cluster-\d{2}$/.test(value.clusterId)||!['dtstack','easymanager','aiworks'].includes(value.namespace)))throw Error('L1 项目标识只能使用固定代号和选项');
    for(const c of value.cases){if(!c||!epoch(c.epoch)||typeof c.id!=='string'||typeof c.title!=='string'||typeof c.symptom!=='string'||!safeText(c.nextAction)||!c.source||!safeText(c.source.file)||!Number.isInteger(c.source.line)||!Array.isArray(c.checks)||!Array.isArray(c.evidence)||!Array.isArray(c.judgments))throw Error('问题记录不完整');
      for(const check of c.checks)if(!check||typeof check.id!=='string'||!Array.isArray(check.choices)||check.choices.some(x=>typeof x!=='string'))throw Error('检查项无效');
      for(const j of c.judgments)if(!j||typeof j.text!=='string'||!['pending','rejected','operator-confirmed'].includes(j.status)||!Array.isArray(j.history)||j.history.some(h=>!h||typeof h.status!=='string'))throw Error('判断记录无效');
      for(const e of c.evidence)if(!e||!epoch(e.epoch)||!safeText(e.value)||!safeText(e.reference)||!safeText(e.checkedAt)||!safeText(e.recordedAt))throw Error('问题证据无效');
      if(c.judgments.some(j=>j.history.some(h=>h.status==='rejected')&&j.status!=='rejected'))throw Error('已作废判断被重新启用，拒绝导入');}
    for(const f of value.facts)if(!f||!epoch(f.epoch)||!safeText(f.label)||!safeText(f.value)||!safeText(f.reference)||!safeText(f.checkedAt)||!['operator-confirmed','invalid','pending-recheck'].includes(f.status)||!['runtime','persistent'].includes(f.scope))throw Error('事实记录无效');
    for(const c of value.changes){
      if(!c||!epoch(c.epoch)||typeof c.id!=='string'||!c.target||!c.layers||Array.isArray(c.layers)||!Array.isArray(c.records)||!safeText(c.createdAt))throw Error('变更记录不完整');
      for(const key of [...Object.keys(FIELD_LABELS),'reference'])if(!safeText(c.target[key],500)||!c.target[key].trim())throw Error('冻结目标字段无效');
      if(!/^sha256:[0-9a-f]{64}$/i.test(c.target.backendDigest)||!/^sha256:[0-9a-f]{64}$/i.test(c.target.frontendDigest))throw Error('目标 digest 无效');
      for(const [name,e] of Object.entries(c.layers)){if(!['declaration','template','runtime','business'].includes(name)||!e||typeof e!=='object'||!epoch(e.epoch)||Object.entries(e).some(([key,v])=>key==='epoch'?!epoch(v):typeof v!=='string'))throw Error('生效层字段无效');}
    }
    for(const e of value.events)if(!e||!epoch(e.epoch)||!safeText(e.summary)||!safeText(e.at)||!safeText(e.type))throw Error('项目事件无效');
    if(new TextEncoder().encode(JSON.stringify(value)).length>512*1024)throw Error('项目档案超过 512KB，请按项目阶段归档');
    secretCheck(JSON.stringify(value));return clone(value);
  }
  function b64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
  function unb64(text){return Uint8Array.from(atob(text),x=>x.charCodeAt(0));}
  function requireCrypto(){if(!crypto.subtle)throw Error('当前连接不支持项目加密，请使用离线 HTML、localhost 或 HTTPS 打开');}
  async function keyFor(password,salt,usage){requireCrypto();const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);}
  async function encrypt(p,password){
    if(typeof password!=='string'||password.length<10)throw Error('请设置至少 10 个字符的项目保护口令');
    const clean=validate(p),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await keyFor(password,salt,['encrypt']),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(clean)));
    return {kind:'xingtu-encrypted-project',version:1,kdf:'PBKDF2-SHA256',iterations:210000,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted))};
  }
  async function decrypt(envelope,password){
    requireCrypto();
    if(!envelope||envelope.kind!=='xingtu-encrypted-project'||envelope.version!==1||envelope.iterations!==210000||envelope.kdf!=='PBKDF2-SHA256')throw Error('项目加密格式不支持');
    try{const salt=unb64(envelope.salt),iv=unb64(envelope.iv);if(salt.length!==16||iv.length!==12)throw Error();const key=await keyFor(password,salt,['decrypt']),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,unb64(envelope.ciphertext));return validate(JSON.parse(new TextDecoder().decode(plain)));}
    catch(error){throw Error('口令不正确，或项目文件损坏 / 格式无效');}
  }
  const PHASE_VALUES=['部署中','冒烟测试','升级维护','重建恢复','交接中'];
  return {create,templates,addCase,evidence,reject,confirm,closeCase,addFact,recheckFact,rebuild,newAcceptance,saveLayer,evaluate,resource,handover,demo,validate,encrypt,decrypt,FIELD_LABELS};
})();
export { XTProject };
