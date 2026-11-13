const use=(step,indexes)=>indexes.map(index=>step.tutorial[index]).filter(Boolean);
const caseOf=(signal,check,fix,verify,extra={})=>({signal,check,fix,verify,...extra});
const command=(target,text,sample)=>({target,text,sample});
const cluster='能访问目标集群的现场终端';
const emPods=command(cluster,'kubectl -n {{emNs}} get pods -o wide','em-frontend-example   1/1   Running   0');
const emSvc=command(cluster,'kubectl -n {{emNs}} get svc -o wide','em-frontend-example   NodePort   …   80:30080/TCP');
const frontAccess={
  kind:'screen', title:'从实际访问端打开 EM 登录页', target:'要使用 EM 的客户现场浏览器',
  actions:['根据上一步查到的前端 Service 和实际配置，取客户批准的访问地址。NodePort 用实施单允许访问的节点地址和外部端口；有代理时按实施单用代理入口。','在实际使用的浏览器打开并登录。'],
  sample:'浏览器出现本次环境的 EM 登录页，登录后可进入集群管理。',
  normal:'确认访问的是本次集群的 EM。仅在服务器本机能打开，还需要从实际浏览器所在位置验证。',
  errors:[
    caseOf('不知道该用哪个 IP 和端口','核对 EM 前端 Service 的 TYPE 和 PORT(S)，再对照实际入口配置。',
      'NodePort 示例 80:30080/TCP 中，30080 是外部端口。访问地址取客户已确认的节点或发布入口。前端 Service 可能有不同名称。',
      '从实际浏览器打开已确认的入口。',{diagnostic:emSvc,source:'Hermes 05 · 890–922；06 · 5069–5088'}),
    caseOf('服务器侧能开，自己电脑超时','在打开浏览器的那台 Windows 电脑测试实际入口，而不是只测部署机本地。',
      'TcpTestSucceeded 为 False 时，让客户网络人员核对访问通道、路由、ACL 和端口放行。为 True 时继续核对 URL、代理和浏览器请求。',
      '在同一台电脑访问同一入口，能进入登录页。',{diagnostic:command('实际打开浏览器的 Windows PowerShell','Test-NetConnection -ComputerName {{host}} -Port {{port}}','TcpTestSucceeded : True'),source:'Hermes 05 · 1037–1060'}),
    caseOf('502 / 503 或集群内也打不开','先看 EM 前端和后端 Pod 的 Ready，再核对 Service 的 EndpointSlice。',
      '发现 Pod 未就绪，查该 Pod 的事件和上游依赖。Pod 正常时对照访问端口、代理路由和服务后端。',
      '前端后端就绪，实际入口能登录。',{diagnostic:emPods,source:'Hermes 05 · 897–922'}),
    caseOf('404 或打开的是其他系统','核对是否用错产品门户、端口或代理路径。','查看本批部署入口和代理规则，使用获准登录路径。','浏览器进入目标 EM，而非其他服务。'),
  ],
};

const questions={
  materials:[caseOf('包传不上去','确认客户允许的文件通道和接收目录。','通过客户批准的介质、堡垒机传输或现场管理员代传，把文件放到部署目录。','目标机能看到本批物料，SHA-256 与交付清单一致。',{source:'Hermes 12 · 107268–107286'})],
  'install-k8s':[caseOf('终端很久没出新内容','保留原安装窗口。在现有任务或批准的日志里查看最近进度、最后成功阶段和退出码。','任务还有进度时等待。看到失败、退出或持续停滞，记下失败节点、首条错误和已变更范围，再按本批续跑或回退说明处理。','安装记录结束后检查 API、节点和系统 Pod。',{source:'Hermes 10 · 73804 附近'})],
  'em-install':[caseOf('终端很久没出新内容','保留原窗口，确认在等待交互、拉镜像还是已经退出。','先看当前脚本阶段和仓库侧结果。卡住时记下首个异常，按本批脚本说明处置。','EM Pod、存储与入口实际可验证。',{source:'Hermes 10 · 73804 附近'})],
  charts:[caseOf('EM 里找不到应部署的 Chart','核对物料内 Chart.yaml、版本和 EM 仓库实际条目。','按交付清单补齐漏传或拆分的 Chart。若本项目已批准使用 Helm 直装，核对正式 values 和归属记录后按批准流程处理。','能定位到本批 Chart 和实际发布归属。',{source:'Hermes 07 · 1466–1484；12 · 69971–69987'})],
  'component-mysql':[caseOf('改完了，怎么知道配置生效','如本次要验 MySQL CDC，从获准的数据库会话查看运行时变量。','和本批 CDC 需求对照。若运行值与文件不同，查实际读取配置、重启状态和发布记录，再按现场流程处理。','运行值符合本次 CDC 方案，再用一条获准测试任务验证。',{
    diagnostic:command('已获准连接目标 MySQL 的 SQL 会话',"SHOW VARIABLES WHERE Variable_name IN ('log_bin','binlog_format','binlog_row_image');",'log_bin          ON\nbinlog_format    ROW\nbinlog_row_image FULL'),
    source:'Hermes 08 · 4788–4813',
  })],
  'smoke-platform':[caseOf('刚改过配置，怎么知道生效','看实际 Pod 的更新时间与镜像，找本次改动影响到的实例。',
    '对照改动记录核实正式配置源、集群对象、实际运行实例和业务结果。仅看到 AGE 更新时，继续查运行值。',
    '实际实例达到本次预期，原失败操作从客户访问端重测通过。',{
      diagnostic:command(cluster,'kubectl -n {{ns}} get pods -o wide --sort-by=.metadata.creationTimestamp','预期实例已更新，READY 符合计划。'),
      source:'Hermes 06 · 9006–9026；08 · 4788–4813',
    })],
  'smoke-ai':[caseOf('未获取到可用的外部向量化模型','在 AIWorks 模型管理里核对可用的 embedding 模型、端点和权限。','模型列表为空时，按本项目计划补获准的向量模型或模型服务。已有模型时测试真实调用和应用引用。','能选中实际模型，小样本向量化成功且产物可查。',{source:'Hermes 07 · 15448–15476'})],
};

export function walkCards(step,scope) {
  if (step.id==='install-k8s') return use(step,scope.cluster==='new'?[0,1]:[2]);
  if (step.id==='em-install'&&scope.manager==='reuse') return [{
    ...step.tutorial[0],title:'确认复用的 EM 和运行基线',actions:[
      '找实施单中批准复用的 EM 版本、入口、存储和集群归属。',
      '确认客户管理员同意复用，并记录现有实例与存储状态。',
    ],sample:'EM 版本、入口、已有存储与管理归属已核对。',normal:'复用范围明确，再到下一步验证 Pod、入口与绑定结果。',
  }];
  if (step.id==='em-bind') return [...use(step,[0,1,2]),frontAccess,...use(step,[7])];
  if (step.id==='common') return use(step,[0,1]);
  if (step.id==='k8s-check') return use(step,[0,1,2,3]);
  if (['smoke-platform','smoke-compute','smoke-ai'].includes(step.id)) return use(step,[0]);
  if (step.id.startsWith('component-')) {
    const cards=step.tutorial;
    if (cards[1]?.title.startsWith('检查实际 Pod 引用')) return use(step,[0]);
    const job=cards.find(card=>card.title.startsWith('找本次发布生成的 Job'));
    if (job) return [cards[0],job];
    const core=cards.filter(card=>card===cards[0]||/所需的 CRD|查目标 Pod|核对存储卷绑定/.test(card.title));
    return core.length?core:use(step,[0]);
  }
  return step.tutorial;
}

export function walkIssues(step,card,scope) {
  const issues=[...card.errors];
  const extras=['install-k8s','em-install'].includes(step.id)&&!card.change?[]:questions[step.id]||[];
  if (extras.length) issues.unshift(...extras);
  if (step.id==='common'&&scope.cluster==='new') {
    const create=card===step.tutorial[0]?step.tutorial[2]:step.tutorial[3];
    issues.unshift(caseOf('查不到对象，本次是新装','确认 kubectl context 和目标 Namespace，核对该对象按本次方案应当新建。',
      '获准变更且目标确认不存在时，按下面的新建命令执行。发现已有对象先查归属。',
      '回到原检查，看对象是否出现并符合预期。',{diagnostic:create}));
  }
  issues.push(caseOf('没有相符的报错','记下当前动作、执行位置、时间和首条错误。在已有部署记录或对象事件里确认失败环节。',
    '请现场负责人结合本批文档处理。需要证据时，按客户许可保留相关错误行和已执行的步骤。',
    '回到原动作，用同一执行位置检查是否恢复。'));
  return issues.map(issue=>{
    if(issue.diagnostic) return issue;
    const signal=issue.signal;
    if (/NotReady/.test(signal)) return {...issue,diagnostic:command(cluster,'kubectl describe node {{node}}',
      'Conditions:\n  Ready   True\nEvents:  根据现场逐项核对')};
    if (/ImagePull|Scheduling|CrashLoop|Init:|FailedMount/.test(signal)) {
      const ns=step.id==='em-bind'?'emNs':card.text?.includes('{{objectNs}}')?'objectNs':'ns';
      return {...issue,diagnostic:command(cluster,`kubectl -n {{${ns}}} describe pod {{pod}}`,
        'Events:\n  Warning  …   这里会显示首次失败原因')};
    }
    if (/157/.test(signal)) return {...issue,diagnostic:command(cluster,
      'kubectl -n {{ns}} get svc,endpointslice -o wide','目标服务有与实际端口匹配的后端地址。')};
    if (/0\/0/.test(signal)) return {...issue,diagnostic:command(cluster,'kubectl -n {{ns}} get jobs','example-plugin   Complete   3/3   …')};
    return issue;
  });
}
