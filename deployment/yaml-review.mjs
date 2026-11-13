import {parseAllDocuments,LineCounter,isAlias,isMap,isScalar,isSeq} from 'yaml';

export const maxYamlBytes = 512 * 1024;
export const baselineFields = [
  {id:'emIp',label:'EM 入口 IP',hint:'实施单上的访问入口节点 IP'},
  {id:'emPort',label:'EM NodePort',hint:'已分配的入口端口'},
  {id:'emPath',label:'EM 本地卷路径',hint:'目标节点上的绝对路径'},
  {id:'emNode',label:'EM 本地卷节点标签值',hint:'填实际标签值，和 key 一起核对'},
  {id:'domain',label:'产品域名',hint:'客户已确认的门户域名'},
  {id:'database',label:'数据库地址',hint:'按当前包要求填写 host 字段'},
  {id:'redis',label:'Redis 地址',hint:'按当前包要求填写 host 字段'},
  {id:'minio',label:'MinIO Endpoint',hint:'使用方实际能访问的 endpoint'},
  {id:'s3',label:'S3 Endpoint',hint:'按应用或存储驱动的实际配置'},
];

const ignoredKeys = new Set(['__proto__','constructor','prototype']);
const issueLimit = 180;
const knownKinds = new Set(['ConfigMap','Secret','Service','Deployment','StatefulSet','DaemonSet','Job','CronJob','Ingress','PersistentVolume','PersistentVolumeClaim','StorageClass','Namespace']);
const severityOrder = {change:0,verify:1,note:2};
const roleVerify = '在获准的集群终端核对实际节点标签和工作负载调度结果。';
const helmVerify = '用本批 Chart 渲染结果核对字段，再从实际消费端复验。';
const ingressVerify = '核对 kubectl get nodes -o wide 和 EM Service 的实际访问端口，从获准客户端打开 EM。';
const volumeVerify = '在实际落点节点用 findmnt -T 核对该路径的挂载源，部署后核对 PV/PVC 和实际读写。';

function rule(id,label,type,advice,verify) { return {id,label,type,advice,verify}; }
const emIp = rule('emIp','EM 访问入口 IP','address','填实施单上批准的 Kubernetes 节点访问 IP，并核对访问链路。',ingressVerify);
const emPort = rule('emPort','EM NodePort','nodeport','填本项目已分配且未占用的 NodePort，沿用本批安装包要求的键与类型。',ingressVerify);
const emPath = rule('emPath','EM 本地卷目录','path','填计划落点节点上已准备的实际目录。复用实例时对照现有数据路径与备份，按变更计划处理。',volumeVerify);
const emLabelKey = rule('','EM 本地卷节点标签键','label-key','填本批 Chart 所用的实际节点标签键。按原配置键名修改。',roleVerify);
const emNode = rule('emNode','EM 本地卷节点标签值','label-value','填目标节点上对应标签的实际值。保留本批脚本约定的 nodeLableVal 或 nodeLabelVal 拼写。',roleVerify);
const domain = rule('domain','产品门户域名','address','回公司 Config 页面核对已批准的域名及 TLS/Ingress 方案，重新生成或按现场流程调整。','从客户实际访问端核对 DNS、证书、入口路由及登录。');
const database = rule('database','数据库连接地址','address','填当前包要求的实际 DB host 或 Service，另行核对端口、数据库类型和连接权限。','从应用实际运行位置核对 DNS、端口和授权连接。');
const redis = rule('redis','Redis 连接地址','address','核对单点、哨兵或外接拓扑，按本批组件读取的 host/url 字段及 Service 填写。','查实际 Service 和就绪后端，再验证应用能够建立连接。');
const s3 = rule('s3','S3 Endpoint','address','填实际使用方可达的 S3 入口，同时核对 bucket、region 和最小权限。','从应用或 CSI 挂载发起端验证 DNS、端口和获准的读写动作。');
const minio = {...s3,id:'minio',label:'MinIO Endpoint'};
const paths = new Map([
  ['global.domain',domain],['global.gateway_domain',{...domain,id:'',label:'网关域名'}],
  ['global.db.host',database],['global.redis.host',redis],['redis.url',{...redis,id:''}],
  ['global.db.port',rule('','数据库端口','port','核对获批数据库的实际连接端口。',helmVerify)],
  ['global.redis.port',rule('','Redis 端口','port','核对单点、哨兵或外部 Redis 实际连接端口。',helmVerify)],
  ['global.s3.endpoint',s3],['global.minio.endpoint',minio],['minio.endpoint',{...minio,id:''}],['s3.endpoint',{...s3,id:''}],
  ['global.es.host',rule('','Elasticsearch 地址','address','填写本项目使用的 ES Service 或外部地址，核对实际认证方式。',helmVerify)],
  ['global.zookeeper.host',rule('','ZooKeeper 地址','address','核对本批要求的节点或 Service 列表以及端口、分隔格式。',helmVerify)],
  ['global.images.imageprefix',rule('','镜像仓库前缀','address','对照本批仓库地址、项目路径和 Chart 拼接方式，替换模板前缀。','核对渲染后的完整镜像引用、仓库 digest 和实际 Pod imageID。')],
]);

function leafOf(path) { return path.split('.').at(-1).toLowerCase(); }
function sensitive(path) {
  return path.toLowerCase().split('.').some(part=>{
    const key=part.replace(/[-_]/g,'');
    return /(?:password|passwd|token|accesskey|secretkey|apikey|privatekey|tlskey|credentials?|clientsecret)$/.test(key) ||
      ['license','licensecontent','clientkeydata','certificateauthoritydata','tlscert','tlscrt','secret'].includes(key);
  });
}

function placeholder(value) {
  if (typeof value!=='string') return '';
  const text=value.trim();
  if (/\$\{[^{}]+\}|\{\{[\s\S]+?\}\}/.test(text)) return '变量或渲染表达式尚待解析';
  if (/^<[^<>]+>$|^__[A-Z0-9_]+__$|^(?:your|replace|change|fill)[_-][A-Za-z0-9_-]+$|^(?:todo|changeme|replace-me|待填|待填写|待替换|按现场填写)$/i.test(text)) {
    return '发现明确的模板占位值';
  }
  return '';
}

function hosts(value) {
  return String(value).split(',').slice(0,16).map(part=>{
    const text=part.trim().replace(/^jdbc:/i,'');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      try { return new URL(text).hostname.replace(/^\[|\]$/g,'').toLowerCase(); } catch { return ''; }
    }
    return text.match(/^\[([0-9a-f:]+)\](?::\d+)?$/i)?.[1]?.toLowerCase() ||
      text.match(/^([a-z0-9_.-]+)(?::\d+)?(?:\/.*)?$/i)?.[1]?.toLowerCase() ||
      (/^[a-f0-9:]+$/i.test(text)&&text.includes(':') ? text.toLowerCase() : '');
  });
}

function exampleHost(host) {
  return /(?:^|\.)example\.(?:com|org|net)$|\.(?:example|invalid|test)$|^192\.0\.2\.\d+$|^198\.51\.100\.\d+$|^203\.0\.113\.\d+$|^2001:db8(?::|$)/i.test(host);
}

function localHost(host) {
  return host==='localhost'||host.endsWith('.localhost')||/^127\./.test(host)||['0.0.0.0','::1','::'].includes(host);
}

function isIpv4(text) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)&&text.split('.').every(part=>Number(part)<=255);
}

function ipAddress(text) {
  if(isIpv4(text)) return true;
  if (!text.includes(':') || !/^[0-9a-f:.]+$/i.test(text)) return false;
  try { return new URL(`http://[${text}]/`).hostname.length>0; } catch { return false; }
}

function portNumber(value) {
  const text = String(value);
  return /^\d{1,5}$/.test(text)&&Number(text)>0&&Number(text)<=65535;
}

function ordinaryHost(text) {
  const parsed = hosts(text);
  return parsed.length>0 && parsed.every(host=>host && (
    ipAddress(host) || (/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)&&!/^\d+(?:\.\d+)+$/.test(host))
  ));
}

function validateField(value, field) {
  if (typeof value!=='string' && typeof value!=='number') return '字段需要一个标量值';
  const text=String(value).trim();
  if (field.id==='emIp' && !ipAddress(text)) return '此入口字段需要实际节点 IP';
  if (field.type==='address' && !ordinaryHost(text)) return '无法识别为常见地址，请按当前包字段格式核对';
  if (['nodeport','port'].includes(field.type) && !portNumber(value)) return '端口必须为 1–65535 的整数';
  if (field.type==='path' && (!text.startsWith('/') || /[\r\n\0]/.test(text))) return '本地卷需要 Linux 绝对路径';
  if (field.type==='label-key' && !/^(?:[a-z0-9.-]+\/)?[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?$/.test(text)) return '标签键格式需核对';
  if (field.type==='label-value' && !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?$/.test(text)) return '标签值格式需核对';
  return '';
}

export function readBaseline(input) {
  const fields=[emIp,emPort,emPath,emNode,domain,database,redis,minio,s3];
  const values={};
  const invalid=[];
  for (const field of fields) {
    const value=typeof input[field.id]==='string'?input[field.id].trim():'';
    if (!value) continue;
    if (value.length>240||/[\r\n<>?#@]/.test(value)||placeholder(value)||
        validateField(value,field)||(field.type==='address'&&hosts(value).some(host=>exampleHost(host)||localHost(host)))) {
      invalid.push(baselineFields.find(item=>item.id===field.id).label);
      continue;
    }
    values[field.id]=value;
  }
  return {values,invalid};
}

function describeShape(filename, rows) {
  const byPath = new Map(rows.map(row=>[row.path.toLowerCase(),row]));
  const has = path=>byPath.has(path);
  const kind = byPath.get('kind')?.value;
  if (kind==='Secret') return {type:'secret',label:'Kubernetes Secret'};
  if (has('clusters') && has('contexts') && has('users')) return {type:'kubeconfig',label:'kubeconfig'};
  if (has('apiversion') && knownKinds.has(kind)) return {type:kind,label:'Kubernetes '+kind};
  if (has('storage.em') || (/(?:^|[\\/])emchart[\\/]config\.ya?ml$/i.test(filename) && (has('ip')||has('port')||has('frontport')))) {
    return {type:'em',label:'EasyManager · emChart/config.yaml'};
  }
  if (has('ip') && (has('port')||has('frontport'))) return {type:'possible-em',label:'入口配置 · 疑似 EM'};
  if (rows.some(row=>/^(?:global\.(?:domain|db|redis|minio|s3|feature|plugin|resourceprofile))\b/i.test(row.path))) {
    return {type:'common',label:'数栈公共配置 / Helm Values'};
  }
  if (/(?:^|[\\/])values(?:[-_.][^\\/]*)?\.ya?ml$/i.test(filename)||has('replicacount')||has('imagetags')) return {type:'values',label:'组件 Helm Values'};
  return {type:'unknown',label:'通用 YAML'};
}

function astRows(root,counter) {
  const rows=[];
  const skipped=[];
  const queue=[{node:root,parts:[],line:1,depth:0}];
  while(queue.length) {
    const current=queue.pop();
    const {node,parts,line,depth}=current;
    const path=parts.join('.');
    if (rows.length>=6000||depth>36||queue.length>6500) return {rows,skipped,limited:true};
    if (isAlias(node)) {
      skipped.push(line);
      continue;
    }
    if (parts.length) rows.push({path,line,value:isScalar(node)?node.value:node===null?null:undefined,collection:isMap(node)||isSeq(node)});
    if (isMap(node)) {
      for (let i=node.items.length-1;i>=0;i--) {
        const pair=node.items[i];
        if (!isScalar(pair.key)||typeof pair.key.value!=='string') continue;
        const key=pair.key.value;
        const location=counter.linePos(pair.key.range?.[0]||0).line||line;
        if (ignoredKeys.has(key)||key==='<<') { skipped.push(location); continue; }
        queue.push({node:pair.value,parts:[...parts,key],line:location,depth:depth+1});
      }
    } else if (isSeq(node)) {
      for (let i=node.items.length-1;i>=0;i--) {
        const item=node.items[i];
        queue.push({node:item,parts:[...parts,String(i)],line:counter.linePos(item?.range?.[0]||0).line||line,depth:depth+1});
      }
    }
  }
  return {rows,skipped,limited:false};
}

function safePath(path) {
  return path.split('.').map(part=>/^[\w/-]{1,90}$/.test(part)?part:'[键名略]').join('.').slice(0,210);
}

function fieldFor(path,type) {
  const leaf=leafOf(path);
  if (type==='em'||type==='possible-em') {
    if (path==='ip') return emIp;
    if (['port','frontport','nodeport'].includes(path)) return emPort;
    if (path==='storage.em.local.path') return emPath;
    if (path==='storage.em.local.nodelabelkey') return emLabelKey;
    if (['storage.em.local.nodelableval','storage.em.local.nodelabelval'].includes(path)) return emNode;
  }
  if (paths.has(path)) return paths.get(path);
  if (leaf==='nodeport') return {...emPort,id:'',label:'Service NodePort'};
  if (/^(?:endpoint|url|host|server)$|(?:endpoint|url|host)$/.test(leaf)) {
    return {...rule('','连接地址','address','核对当前版本实际读取的字段、使用方和现场 DNS/Service/外接入口。',helmVerify),inferred:true};
  }
  return null;
}

function expectedText(field,baseline) { return field?.id?baseline[field.id]||'':''; }

function analyzeRows(rows,shape,options,add) {
  const fieldIndex=new Map(rows.map(row=>[row.path.toLowerCase(),row]));
  const baseline=options.baseline||{};
  const em=shape.type==='em';
  const local=String(fieldIndex.get('storage.em.pvc')?.value??'').trim().toLowerCase()==='local';

  for (const row of rows) {
    const path=row.path.toLowerCase();
    const {value}=row;
    const field=fieldFor(path,shape.type);
    const empty=value===null || typeof value==='string'&&!value.trim();
    if (row.collection) {
      if (field && field.id) add(row,'verify','预期字段未读到单个值',field.advice,field.verify);
      continue;
    }
    const marker=placeholder(value);
    if (sensitive(path)) {
      if (marker||!empty && value!==undefined) {
        add(row,'note',marker?'凭据字段待正式注入':'凭据字段已隐藏',
          '按客户批准的 Secret、密文或注入流程核对，凭据由现场管理员提供。',
          '从获准的实际消费端验证授权结果。');
      }
      continue;
    }
    if (marker) {
      const deferred=marker.startsWith('变量');
      add(row,deferred?'verify':'change',marker,deferred?'确认本批发布流程如何注入该变量，并核对最终渲染值。'+(field?.advice||''):
        field?.advice||'确认正式发布环节由谁替换该值，检查渲染结果后再提交。',
        field?.verify||helmVerify,expectedText(field,baseline));
      continue;
    }
    if (field) {
      const expected=expectedText(field,baseline);
      if (empty) {
        const required=em && (field===emIp||field===emPort||local && [emPath,emLabelKey,emNode].includes(field));
        const verifyEmpty=['domain','database','redis'].includes(field.id)||options.storage!=='nfs'&&[minio,s3].includes(field);
        if (required||expected||verifyEmpty) {
          add(row,required?'change':'verify',required?'所选方案的字段为空':'字段为空，核对运行配置或后续注入',
            field.advice,field.verify,expected);
        }
        continue;
      }
      if (value===undefined) continue;
      if (field.inferred&&typeof value!=='string') continue;
      if (field.type==='address'&&typeof value==='string'&&/(?:\/\/[^/\s]*:[^/\s]*@|[?&](?:password|token|secret|key)=)/i.test(value)) {
        add(row,'note','连接串疑似内含凭据，内容已隐藏','核对本批认可的连接串和凭据注入方式。','从获准的消费端验证连接与授权。');
        continue;
      }
      const problem=validateField(value,field);
      if (problem) {
        add(row,field.inferred?'verify':'change',problem,field.advice,field.verify,expected);
        continue;
      }
      if (field.type==='address'&&hosts(value).some(exampleHost)) {
        add(row,'change','发现文档示例地址',field.advice,field.verify,expected);
      } else if (field.type==='address'&&hosts(value).some(localHost)) {
        add(row,'verify','回环或通配地址需要核对用途',field.advice+' 若设计为同一运行单元内访问，按本批契约核对。',field.verify,expected);
      } else if (expected&&String(value).trim()!==expected) {
        add(row,'change','与填写的现场确认值不一致',field.advice,field.verify,expected);
      } else if (field.type==='nodeport'&&(Number(value)<30000||Number(value)>32767)) {
        add(row,'verify','不在常见 NodePort 默认范围',field.advice+' 自定义范围以目标集群配置为准。',field.verify);
      } else if (expected) {
        add(row,'note','与填写的现场值一致','当前字段和手工基线一致，继续检查实际连通性与配置生效。',field.verify);
      } else if (field.id||field.type==='address'||field===emLabelKey) {
        const example=field===emNode&&/^work\d+$/i.test(String(value))||field===emPath&&value==='/etc/kubernetes/pv/dtstack/data';
        add(row,'verify',example?'类似 SOP 示例值，需对照现场':field.label+'已填写，待现场核对',
          field.advice,field.verify);
      }
      continue;
    }
    if (['global.plugin.jobcount','plugin.jobcount','jobcount'].includes(path)&&/^0$/.test(String(value))) {
      add(row,'verify','插件分发数为 0','如果本期启用插件分发，按本批 Chart 规则和计划可调度节点核算。停用场景可按方案保留 0。',
        '对照 Job 期望完成数、实际完成数及消费节点的插件目录。');
    } else if (/^global\.feature\.[^.]+$/.test(path)&&value!==null&&typeof value!=='boolean') {
      add(row,'verify','功能开关不是 YAML 布尔值','核对当前包是否要求 true/false，按 Config 选项重新生成并核对启用范围。',helmVerify);
    } else if (['global.s3.bucket','global.minio.bucket','global.s3.region','global.minio.region','global.storageclass','global.plugin.nfs_sc','storage.em.local.class','storage.em.local.name'].includes(path) && !empty && value!==undefined) {
      add(row,'verify','存储配置需要对照现场','核对桶、区域、StorageClass 或 PV 名称与本次存储设计一致，确认默认名是否适用。',
        '分别验证 S3 实际读写，或检查 StorageClass、PV/PVC 与消费 Pod 挂载。');
    }
  }

  if (em) {
    const required=[['ip',['ip'],emIp],['port',['port','frontport','nodeport'],emPort]];
    if (local) required.push(
      ['storage.em.local.path',['storage.em.local.path'],emPath],
      ['storage.em.local.nodeLabelKey',['storage.em.local.nodelabelkey'],emLabelKey],
      ['storage.em.local.nodeLableVal',['storage.em.local.nodelableval','storage.em.local.nodelabelval'],emNode]);
    for (const [display,aliases,field] of required) if (!aliases.some(key=>fieldIndex.has(key))) {
      add({path:display,line:0},'verify','未找到 SOP 对应字段，核对本批结构',field.advice,field.verify,expectedText(field,baseline));
    }
    if (fieldIndex.has('storage.em.local.nodelableval')&&fieldIndex.has('storage.em.local.nodelabelval')) {
      add(fieldIndex.get('storage.em.local.nodelableval'),'verify','发现两种标签值键名','查看本批脚本或 Chart 实际读取哪个键，核对两个值是否冲突。',roleVerify);
    }
  }

  for (const [group,keys] of [['global.db_type',['mysql','dmmysql','dmoracle']],['global.middleware_type',['tomcat','bes','tongweb']]]) {
    if (keys.filter(key=>fieldIndex.get(`${group}.${key}`)?.value===true).length>1) {
      add(fieldIndex.get(group)||{path:group,line:0},'change','互斥选项同时开启',
        '按公司 Config 选择本次部署的数据库或中间件方案，核对只启用批准的一项。',helmVerify);
    }
  }
}

export function inspectYaml(filename,text,options={}) {
  const sections=[];
  let remaining=issueLimit;
  let limited=false;
  const addTo=(section,row,severity,title,advice,verify,expected='')=>{
    if (remaining--<=0) { limited=true; return; }
    section.findings.push({path:safePath(row.path),line:row.line,severity,title,advice,verify,expected});
  };
  function inspect(source,name,outer='') {
    const counter=new LineCounter();
    let docs;
    try { docs=parseAllDocuments(source,{lineCounter:counter,prettyErrors:false,stringKeys:true,uniqueKeys:true,merge:false}); }
    catch { docs=null; }
    if (!docs?.length) {
      const section={label:outer||'YAML 文档',findings:[]};
      sections.push(section);
      addTo(section,{path:'YAML',line:0},'change','文件为空或解析未完成','检查文件编码、结构和内容。','选择 UTF-8 YAML 文件重新检查。');
      return;
    }
    if(docs.length>24) limited=true;
    for (const [index,doc] of docs.slice(0,24).entries()) {
      const section={label:outer?`${outer} / 内嵌文档 ${index+1}`:`文档 ${index+1}`,findings:[]};
      sections.push(section);
      const add=(...args)=>addTo(section,...args);
      if (doc.errors.length) {
        const first=doc.errors[0];
        const line=counter.linePos(first.pos?.[0]||0).line;
        const title=first.code==='DUPLICATE_KEY'?'YAML 存在重复键':/\{\{[\s\S]*?\}\}/.test(source)?'可能是未渲染的 Helm 模板，或 YAML 结构有误':'YAML 解析失败';
        add({path:'YAML',line},'change',title,'核对该处缩进、引号及重复键。Chart 模板请优先检查 values.yaml 或已渲染的 YAML。',
          '修正后重新读取。当前文档的字段判断暂停。');
        continue;
      }
      const scanned=astRows(doc.contents,counter);
      if(scanned.limited) limited=true;
      const shape=describeShape(name,scanned.rows);
      section.label+=` · ${shape.label}`;
      if(['secret','kubeconfig'].includes(shape.type)) {
        add({path:shape.type,line:0},'note','跳过凭据文档','请在现场受控环境核对凭据文件，体检继续处理其他文档。','由获准人员验证连接和权限。');
        continue;
      }
      if(scanned.skipped.length||doc.warnings.length) {
        add({path:'YAML',line:scanned.skipped[0]||0},'verify','存在别名、合并键或不支持的标签',
          '使用本批 Chart 渲染或工具展开后的正式 YAML 复查相应字段。','复核最终渲染结果，尤其是继承来的地址和节点落点。');
      }
      analyzeRows(scanned.rows,shape,options,add);
      if (!outer&&shape.type==='ConfigMap') {
        for (const row of scanned.rows.filter(row=>/^data\..+\.ya?ml$/i.test(row.path)&&typeof row.value==='string').slice(0,8)) {
          inspect(row.value,row.path,`${safePath(row.path)} · 外层第 ${row.line} 行`);
        }
      }
      section.findings.sort((a,b)=>severityOrder[a.severity]-severityOrder[b.severity]||a.line-b.line);
    }
  }
  if (new TextEncoder().encode(text).length>maxYamlBytes) {
    return {sections:[{label:'文件大小',findings:[{path:'YAML',line:0,severity:'change',title:'文件超过 512 KiB',
      advice:'拆出本次要检查的配置文档后重试。',verify:'单文件大小在限制内。',expected:''}]}],limited:false};
  }
  inspect(text,filename);
  return {sections,limited};
}
