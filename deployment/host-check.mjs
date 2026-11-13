const prefix='XT_PREFLIGHT_V1=';
export const hostReportLimit=4096;

const fields=['arch','cpu','memoryMiB','rootUsed','swap','dataMount','sync','tar','kube','ready','total'];
const enumValue=(value,values)=>values.includes(value);
const number=(value,min,max)=>value===null||Number.isSafeInteger(value)&&value>=min&&value<=max;

export function readHostReport(raw) {
  if (typeof raw!=='string'||raw.length>hostReportLimit) throw Error('结果过长，请只复制 XT_PREFLIGHT_V1= 开头的一行。');
  const input=raw.trim();
  if (!input.startsWith(prefix)||/[\r\n]/.test(input)) throw Error('请粘贴终端最后一行 XT_PREFLIGHT_V1= 结果。');
  let value;
  try { value=JSON.parse(input.slice(prefix.length)); } catch { throw Error('结果格式不完整，请重新复制整行。'); }
  if (!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||
      fields.some(key=>!Object.hasOwn(value,key))||
      !enumValue(value.arch,['x86_64','aarch64','other','unknown'])||
      !enumValue(value.swap,['on','off','unknown'])||
      !enumValue(value.dataMount,['missing','mounted','not-mounted','unknown'])||
      !enumValue(value.sync,['yes','no','unknown'])||
      !enumValue(value.kube,['not-run','no-tool','unavailable','api-ready'])||
      !number(value.cpu,1,100000)||!number(value.memoryMiB,0,999999999)||!number(value.rootUsed,0,999)||
      !number(value.ready,0,100000)||!number(value.total,0,100000)||typeof value.tar!=='boolean'||
      (value.ready===null)!==(value.total===null)||value.ready>value.total||
      (value.kube!=='api-ready'&&value.total!==null)) {
    throw Error('结果含未知字段或不符合检查格式，请重新运行本页的命令。');
  }
  return value;
}

export function interpretHost(value) {
  const results=[];
  const add=(level,title,detail)=>results.push({level,title,detail});
  if (value.arch==='other'||value.arch==='unknown') add('verify','核对 CPU 架构','检查节点架构与交付物料是否匹配。');
  else add('seen','资源已读取',`${value.arch} · CPU ${value.cpu??'未取得'} 核 · 内存 ${value.memoryMiB===null?'未取得':(value.memoryMiB/1024).toFixed(1)+' GiB'}。按本次容量表核对。`);
  if (!value.tar) add('fix','缺少 tar','按获准的软件源补齐 tar，再执行安装包检查。');
  else add('seen','tar 可用','当前终端能找到 tar。');
  if (value.swap==='on') add('verify','Swap 已启用','按本次 Kubernetes 与客户系统基线核对。由现场人员处理需要变更的项。');
  else if(value.swap==='off') add('seen','未看到活动 Swap','来自当前节点的 /proc/swaps。');
  else add('verify','Swap 状态未取得','现场检查 /proc/swaps。');
  if(value.rootUsed===null) add('verify','根分区用量未取得','现场执行 df -hT 查看当前根分区。');
  else if(value.rootUsed>=70) add('fix',`根分区已用 ${value.rootUsed}%`,'达到向导的 70% 提醒线。先核对空间和 inode，再按项目容量规划处理。');
  else add('seen',`根分区已用 ${value.rootUsed}%`,'这是当前用量，安装空间需对照物料与容量规划。');
  if(value.dataMount==='mounted') add('seen','发现 /data 挂载点','还需核对实际来源、数据盘容量和开机挂载。');
  else if(value.dataMount==='missing'||value.dataMount==='not-mounted') add('verify','未发现 /data 挂载点','若项目使用其他路径，按实施单核对。计划使用 /data 时先检查挂载源。');
  else add('verify','挂载情况未取得','按实施单在现场用 findmnt 核对实际目录。');
  if(value.sync==='yes') add('seen','系统报告已同步时间','还需按集群规划核对各节点时间源。');
  else add('verify',value.sync==='no'?'系统报告时间未同步':'时间同步状态未取得','使用本机实际时间服务检查，例如 chronyc tracking。');
  if(value.kube==='api-ready') {
    if (value.total===null) add('verify','API 就绪，节点列表未取得','从当前终端确认 list nodes 权限或请集群管理员代查。');
    else if (value.total>0&&value.ready===value.total) add('seen',`当前集群节点 ${value.ready}/${value.total} Ready`,'对照实际集群身份和本次计划节点数，再验证核心组件、网络和仓库。');
    else add('fix',`当前集群节点 ${value.ready}/${value.total} Ready`,'核对是否缺节点或有 NotReady，查看节点 Conditions 与 Events。');
  } else if(value.kube==='unavailable') add('verify','未取得 API 就绪结果','核对当前 context、权限与网络。失败可能来自连通性、授权或未安装。');
  else if(value.kube==='no-tool') add('verify','终端没有 kubectl','新装前可以继续做主机检查。集群验收时用授权运维终端复查。');
  else add('verify','本次未检查 Kubernetes','集群建好或复用时，可在确认目标 context 后重新检查。');
  const order={fix:0,verify:1,seen:2};
  return results.sort((a,b)=>order[a.level]-order[b.level]);
}

export function makeHostCommand(script,k8s) {
  const encoded=script.replace(/\r\n/g,'\n').replaceAll('\\','\\\\').replaceAll('\n','\\n');
  const quoted="'"+encoded.replaceAll("'","'\"'\"'")+"'";
  return `printf '%b' ${quoted} | sh -s --${k8s?' --k8s':''}`;
}
