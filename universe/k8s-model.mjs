const LABEL_KEYS=new Set(['app','app.kubernetes.io/name','app.kubernetes.io/instance','component','release','dtstack.com/component']);
const STATES=new Set(['ok','forbidden','error']);
const KINDS=new Set(['Deployment','StatefulSet','DaemonSet','Job','CronJob']);
const clone=x=>structuredClone(x);
function fields(o,keys){if(!o||typeof o!=='object'||Array.isArray(o))throw Error('对象格式不正确');for(const key of Object.keys(o))if(!keys.includes(key))throw Error('不接收字段：'+key);}
function text(o,key,max=100,optional=false){const value=o[key];if(typeof value!=='string'||value.length>max||/[\x00-\x1f]/.test(value)||(!optional&&!value))throw Error('字段无效：'+key);return value;}
function ident(o,key,optional=false){const value=text(o,key,100,optional);if(value&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value))throw Error('标识无效：'+key);return value;}
function labels(value){fields(value,[...LABEL_KEYS]);for(const v of Object.values(value))if(typeof v!=='string'||v.length>63||!/^[a-zA-Z0-9._-]*$/.test(v))throw Error('标签值无效');}
export function validateTopology(input){
 fields(input,['kind','version','projectId','clusterId','namespace','generatedAt','isDemo','collection','workloads','replicaSets','pods','services']);
 if(input.kind!=='xingtu-k8s-topology'||input.version!==1||typeof input.isDemo!=='boolean')throw Error('需要 7.0 拓扑格式；能力矩阵 JSON 不含对象归属，不能用于现场图');
 for(const key of ['projectId','clusterId','namespace'])ident(input,key);
 const rawTime=text(input,'generatedAt',40),time=Date.parse(rawTime);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(rawTime)||!Number.isFinite(time)||time<Date.UTC(2000,0,1)||new Date(time).toISOString().slice(0,19)!==rawTime.slice(0,19))throw Error('采集时间需要有效的 UTC ISO 时间');
 fields(input.collection,['workloads','replicaSets','pods','services','truncated']);
 for(const key of ['workloads','replicaSets','pods','services'])if(!STATES.has(input.collection[key]))throw Error('需要明确的采集状态：'+key);
 if(typeof input.collection.truncated!=='boolean')throw Error('缺少截断状态');
 const uids=new Set();
 for(const key of ['workloads','replicaSets','pods','services']){
  const list=input[key];if(!Array.isArray(list)||list.length>250)throw Error('对象列表无效或超过 250 项：'+key);if(input.collection[key]!=='ok'&&list.length)throw Error('采集受限的类别不能带对象');const names=new Set();
  for(const o of list){
   fields(o,key==='workloads'?['ns','name','uid','kind','ready','image','labels']:key==='replicaSets'?['ns','name','uid','ownerUid','ownerKind']:key==='pods'?['ns','name','uid','phase','ready','node','ownerUid','ownerKind','ownerName','restarts','image','imageID','reason','labels']:['ns','name','uid','selector','selectorComplete','ports']);
   if(ident(o,'ns')!==input.namespace)throw Error('对象超出声明的 Namespace');ident(o,'name');ident(o,'uid');if(uids.has(o.uid))throw Error('UID 重复');uids.add(o.uid);const name=(o.kind||'')+'/'+o.name;if(names.has(name))throw Error('对象重名');names.add(name);
   if(key==='workloads'){if(!KINDS.has(o.kind))throw Error('不支持的工作负载类型');if(!/^(\d{1,5}\/\d{1,5}|\?)$/.test(text(o,'ready',20)))throw Error('就绪格式无效');text(o,'image',300,true);labels(o.labels);}
   if(key==='replicaSets'||key==='pods'){ident(o,'ownerUid',true);text(o,'ownerKind',30,true);}
   if(key==='pods'){if(!['Running','Pending','Succeeded','Failed','Unknown'].includes(o.phase))throw Error('Pod phase 无效');if(!/^(\d{1,5}\/\d{1,5}|\?)$/.test(text(o,'ready',20)))throw Error('Pod ready 无效');ident(o,'ownerName',true);ident(o,'node',true);if(!Number.isSafeInteger(o.restarts)||o.restarts<0||o.restarts>1000000)throw Error('重启次数无效');text(o,'image',300,true);text(o,'imageID',400,true);text(o,'reason',100,true);labels(o.labels);}
   if(key==='services'){labels(o.selector);if(typeof o.selectorComplete!=='boolean'||!Array.isArray(o.ports)||o.ports.length>20||o.ports.some(p=>!Number.isInteger(p)||p<1||p>65535))throw Error('Service 字段无效');}
  }
 }
 if(new TextEncoder().encode(JSON.stringify(input)).length>65536)throw Error('拓扑 JSON 超过 64KiB');return clone(input);
}
function position(i,count){const a=i*2.399963,r=50+380*Math.sqrt(i/Math.max(1,count-1));return {x:550+Math.cos(a)*r,y:385+Math.sin(a)*r*.8,z:((i%5)-2)*3};}
export function knowledgeGraph(profile){
 const sources=new Map(profile.sources.map(s=>[s.id,s]));
 const components=profile.components.map((c,i)=>({...position(i,profile.components.length),id:'k:'+c.id,name:c.name,fullName:c.responsibility,group:profile.layers.find(l=>l.id===c.layer)?.name||c.layer,color:profile.layers.find(l=>l.id===c.layer)?.color||'#70b9ff',size:c.layer==='app'?16:13,summary:c.responsibility,status:'pending',tone:'idle',modules:[],ports:c.ports.map(String),knowledge:{...c,sources:c.sources.map(s=>({...s,title:sources.get(s.id)?.title||s.id}))}}));
 const ids=new Set(profile.components.map(c=>c.id)),relations=[];
 for(const c of profile.components)for(const dep of c.dependsOn||[])if(ids.has(dep))relations.push({id:'k:'+c.id+'>'+dep,from:'k:'+c.id,to:'k:'+dep,type:'deploy',label:'本项目 Profile 的部署前置，非运行调用证明',status:'pending'});
 return {mode:'k8s',baseline:'数栈 7.0 · 项目部署知识',defaultSource:profile.profileName,components,relations,paths:{},meta:{view:'knowledge',profileNote:profile.profileNote,componentCount:components.length,healthyCount:0,unhealthyCount:0,unknownCount:components.length}};
}
export function podTone(p){if(p.phase==='Succeeded')return 'idle';if(p.phase==='Failed'||/CrashLoop|ErrImage|ImagePullBackOff|OOMKilled|CreateContainerConfigError|^Error$|InvalidImage/.test(p.reason))return 'bad';if(p.phase==='Pending')return 'warn';const [a,b]=p.ready.split('/').map(Number);if(p.phase!=='Running'||!b)return 'idle';return a===b?'ok':'warn';}
export function topologyGraph(input){
 const s=validateTopology(input),byUid=new Map(s.workloads.map(w=>[w.uid,w])),rs=new Map(s.replicaSets.map(r=>[r.uid,r]));
 const ownerOf=p=>{const direct=byUid.get(p.ownerUid);if(direct&&direct.kind===p.ownerKind)return direct;if(p.ownerKind==='ReplicaSet'){const r=rs.get(p.ownerUid),owner=r&&byUid.get(r.ownerUid);if(owner&&owner.kind===r.ownerKind)return owner;}return null;};
 const idOf=w=>'w:'+w.ns+'/'+w.kind+'/'+w.name,groups=new Map(s.workloads.map(w=>[w.uid,[]])),orphans=[];
 for(const p of s.pods){const w=ownerOf(p);if(w)groups.get(w.uid).push(p);else orphans.push(p);}
 const components=s.workloads.map(w=>{const pods=groups.get(w.uid),tones=pods.map(podTone),[a,b]=w.ready.split('/').map(Number),tone=tones.includes('bad')?'bad':tones.includes('warn')||b&&a<b?'warn':b&&a===b&&pods.length&&s.collection.pods==='ok'?'ok':'idle';return {id:idOf(w),name:w.name,fullName:w.kind+' · '+w.ns,group:w.ns,namespace:w.ns,size:15,status:tone,tone,color:{ok:'#52e2cf',warn:'#ffc46b',bad:'#ff7793',idle:'#7c96ba'}[tone],modules:pods.map(p=>p.name),ports:[],summary:w.kind+' · Ready '+w.ready+' · '+pods.length+' 个归属 Pod',pods:pods.map(p=>({...p,tone:podTone(p)})),topology:{kind:w.kind,uid:w.uid,ready:w.ready,image:w.image}};});
 for(const p of orphans)components.push({id:'p:'+p.ns+'/'+p.name,name:p.name,fullName:'Pod · 归属未核实',group:p.ns,namespace:p.ns,size:10,status:podTone(p),tone:podTone(p),color:'#8aa0c8',modules:[],ports:[],summary:'未取得可验证的 owner UID 链；没有按名称前缀归属。',pods:[{...p,tone:podTone(p)}],topology:{kind:'Pod',uid:p.uid,ready:p.ready,image:p.image}});
 const relations=[],seen=new Set();
 for(const service of s.services){const id='s:'+service.ns+'/'+service.name,selector=Object.entries(service.selector),matches=service.selectorComplete&&selector.length?s.pods.filter(p=>selector.every(([k,v])=>p.labels[k]===v)):[];
  for(const p of matches){const w=ownerOf(p),to=w?idOf(w):'p:'+p.ns+'/'+p.name,key=id+'>'+to;if(!seen.has(key)){seen.add(key);relations.push({id:key,from:id,to,type:'selector',label:'完整 Service selector 匹配 Pod labels；未验证 Endpoint / 流量',status:'confirmed'});}}
  components.push({id,name:service.name+' [Service]',fullName:'Service · '+service.ns,group:service.ns,namespace:service.ns,size:11,status:'idle',tone:'idle',color:'#b69aff',modules:[],ports:service.ports.map(String),summary:'选择条件匹配 '+matches.length+' 个 Pod；这不代表业务可达。',pods:[],topology:{kind:'Service',uid:service.uid,selector:service.selector,selectorComplete:service.selectorComplete,routeEvidence:service.selectorComplete?'已核对所采集 Pod 标签；Endpoint / 流量未采集':'选择器存在未支持的 key，不能建立关联'}});
 }
 components.forEach((c,i)=>Object.assign(c,position(i,components.length)));
 return {mode:'k8s',baseline:'数栈 7.0 · '+(s.isDemo?'脱敏演示':'L2 对象快照'),defaultSource:s.projectId+' / '+s.clusterId+' / '+s.namespace,components,relations,paths:{},pods:s.pods,meta:{view:s.isDemo?'demo':'imported',scope:{projectId:s.projectId,clusterId:s.clusterId,namespace:s.namespace},generatedAt:s.generatedAt,collection:s.collection,orphanCount:orphans.length,workloadCount:s.workloads.length,serviceCount:s.services.length,podCount:s.pods.length,healthyCount:components.filter(c=>c.tone==='ok').length,unhealthyCount:components.filter(c=>c.tone==='bad').length,unknownCount:components.filter(c=>c.tone==='idle').length}};
}
export function demoTopology(){
 const ns='dtstack',names=['mysql','redis-standalone','minio','nacos','gateway','aiworks','uniparse','kuberay-operator','engine'],s={kind:'xingtu-k8s-topology',version:1,projectId:'demo-project',clusterId:'demo-cluster',namespace:ns,generatedAt:'2026-11-04T00:00:00Z',isDemo:true,collection:{workloads:'ok',replicaSets:'ok',pods:'ok',services:'ok',truncated:false},workloads:[],replicaSets:[],pods:[],services:[]};
 names.forEach((name,i)=>{const deployment=['gateway','kuberay-operator','engine'].includes(name),uid='demo-w-'+i;s.workloads.push({ns,name,uid,kind:deployment?'Deployment':'StatefulSet',ready:name==='aiworks'?'0/1':'1/1',image:'example.invalid/'+name+':demo',labels:{app:name}});if(deployment)s.replicaSets.push({ns,name:name+'-rs',uid:'demo-rs-'+i,ownerUid:uid,ownerKind:'Deployment'});s.pods.push({ns,name:name+(deployment?'-rs-demo':'-0'),uid:'demo-p-'+i,phase:'Running',ready:name==='aiworks'?'0/1':'1/1',node:'demo-node-'+i%3,ownerUid:deployment?'demo-rs-'+i:uid,ownerKind:deployment?'ReplicaSet':'StatefulSet',ownerName:deployment?name+'-rs':name,restarts:name==='aiworks'?7:0,image:'example.invalid/'+name+':demo',imageID:'',reason:name==='aiworks'?'CrashLoopBackOff':'',labels:{app:name}});s.services.push({ns,name,uid:'demo-s-'+i,selector:{app:name},selectorComplete:true,ports:[i===0?3306:8080]});});return s;
}
