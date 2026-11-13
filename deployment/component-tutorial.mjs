import {
  error,terminal,screen,lessons,control,management,podList,podDetails,podLogs,
  claimList,claimDetails,releaseStatus,serviceEndpoints,permissions,notFound,authRegistry,
} from './tutorial.mjs';

const pluginIds = new Set(['chunjun112','datasourcex','flinksql116','sqlparserserver','engineplugin']);
const storageIds = new Set(['zookeeper','redis-standalone','mysql','postgresql','elasticsearch','minio','csi-s3','kafka']);
const operatorIds = new Set(['redis-operator','spark-operator','kuberay-operator']);
const serviceIds = new Set(['redis-standalone','dtuic','nacos','gateway','publicservice','metadata','assets','api','aiworks','uniparse','portalfront','kkfileview']);

const jobCount = error('COMPLETIONS 为 0/0 / 没有分发 Pod','检查获批 common-config 中 global.plugin.jobCount 的配置来源、当前 Job 渲染值与可调度节点数。',
  '核对本批 Chart 是否使用这个键以及每节点/共享卷的分发方式。从正式配置源调整后，按窗口重新发布对应插件。','期望完成数与规划相符且达到完成数，实际消费者所在节点或共享卷有正确版本的插件。');
const missingPlugin = error('Job 已完成 / 客户端仍提示插件初始化异常','核对消费 Pod 的 NODE、卷定义和挂载目录。对照 Job 写入目录、共享卷或 hostPath，以及消费者实际读取路径。',
  '以本次 Chart 的存储设计修正分发或挂载。GPU 扩容后重点查新节点有没有需要的插件或节点约束。','实际消费 Pod 能读到正确版本的插件，用获准数据源或任务重试通过。');
const nacos = error('157 / 网关查不到服务 / 间歇性失败','定位真实请求的上游服务。核对 Nacos Namespace、Group、服务名与注册实例。多副本逐个查成员表及该服务的注册视图。',
  '修复该服务的注册和网关查询契约，或按批准方案修正 Nacos 集群成员配置。先保留各副本的注册差异证据。','从客户入口重复发起原请求，确认每次返回预期结果，且各副本注册视图一致。');
const zeroOutput = error('任务显示完成 / 读取 0 / 写入 0','用任务 ID 找对应实例，核对源文件存在、路径与过滤规则，检查目标桶和前缀，留意路径被重复拼接。',
  '用获准的小样本缩小验证范围，调整本次任务里的源端路径、规则或目标位置。','同一类任务读写数量符合样本，目标对象非空并能从页面打开。');
const accessDenied = error('403 / AccessDenied','先确认是谁返回 403。分别识别 S3、仓库、模型 API 或网关；S3 按读、写、列举分别对照请求和桶/前缀。',
  '用现场授权的身份核对 endpoint、region、桶策略与动作权限。模型或网关按该接口校验授权范围。','使用相同发起端、相同身份重跑相同操作，返回预期数据。');
const missingModel = error('Model directory not found / 任务容器读不到模型','查实际任务读取的卷、挂载目录、桶/前缀及用户权限；对照模型分发 Job 的真实写入位置。',
  '按本次模型清单对齐写入和读取路径，核对挂载与运行账号。','消费任务能加载同一模型，返回可核验结果。');

function jobList() {
  return terminal('找本次发布生成的 Job 名称',control,'kubectl -n {{ns}} get jobs',
    'NAME            STATUS     COMPLETIONS   DURATION   AGE\nexample-plugin  Complete   3/3           42s        2m',
    '通过任务时间与名称找到这次 Job，记录实际名称。若安装钩子按策略清理了 Job，查发布记录、已保存的日志和消费者结果。',
    [jobCount,missingPlugin,notFound,permissions]);
}

function jobs() {
  return terminal('按分发 Job 的期望数和实际完成数验收',control,
    'kubectl -n {{ns}} get job {{job}} -o custom-columns=NAME:.metadata.name,EXPECTED:.spec.completions,PARALLEL:.spec.parallelism,SUCCEEDED:.status.succeeded,FAILED:.status.failed',
    'NAME            EXPECTED   PARALLEL   SUCCEEDED   FAILED\nexample-plugin  3          3          3           <none>',
    '填本次实际 Job 名。示例分发到 3 个目标，实际数量以本项目为准。先确认期望数，再看成功数和失败数；字段 <none> 要结合 Job 状态解释。',
    [jobCount,missingPlugin,notFound,permissions]);
}

function runtimeImage() {
  return terminal('检查实际 Pod 引用和运行的镜像 digest',control,
    "kubectl -n {{ns}} get pod {{pod}} -o 'custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[*].image,IMAGEID:.status.containerStatuses[*].imageID'",
    'NAME           IMAGE                            IMAGEID\nexample-app-0  registry.example/app:release     registry.example/app@sha256:…',
    '逐个对照容器的 IMAGE 与实际 IMAGEID。确认目标架构可运行，且实际 digest 对应本次发版；多容器时不要混读。',
    [error('同 tag 但 digest 对不上 / exec format error','对照仓库期望 digest、节点 CPU 架构、镜像平台和当前工作负载模板。',
      '从获批物料补齐对应架构或正确的镜像引用。由现场负责人确认发布策略与已运行实例的替换范围。','真实消费者实例以期望镜像启动，通过业务或测试任务验收。'),authRegistry,notFound]);
}

function rolloutGate() {
  return terminal('用四层证据核对实际变更是否生效',control,
    'kubectl -n {{ns}} get statefulset {{workload}} -o custom-columns=NAME:.metadata.name,STRATEGY:.spec.updateStrategy.type,CURRENT:.status.currentRevision,UPDATE:.status.updateRevision,READY:.status.readyReplicas',
    'NAME         STRATEGY       CURRENT         UPDATE          READY\nexample-sts  RollingUpdate  example-new     example-new     3',
    '用于目标确实是 StatefulSet 的情况。先核实正式配置与对象模板，然后检查实际 Pod 的版本和业务输出；版本字符串相同只是其中一项证据。',
    [error('OnDelete / currentRevision 与 updateRevision 不一致','确认是发布策略、滚动进行中还是实例卡住。看现存 Pod 的实际镜像、创建时间和事件。',
      'OnDelete 场景由现场负责人按该服务可用性方案组织实例替换。等待中查就绪和失败事件。','对象模板、每个应替换的实例及业务结果均到达批准版本。'),notFound,permissions]);
}

const componentTrouble = {
  'dtstack-common':[jobCount],
  'redis-standalone':[error('Redis 没有就绪后端 / 应用仍连接旧地址','核对 Redis release、Service、Endpoint 及该应用实际读取的配置键。','在正式配置源纠正读取键和地址，再按本版策略生效。','应用用预期地址建立连接，登录或缓存场景复验。')],
  mysql:[error('库变空 / permission denied / 存储路径不对','比较当前 Pod 节点、PVC/PV 或宿主路径与开工基线，确认本次是否复用数据。','停止继续初始化或写入。按现场数据保全方案找回正确卷与路径，交由负责人确认恢复。','实际连接到原数据目录，预期 schema/测试数据可读写。')],
  'kube-prometheus-stack':[error('只有 node-exporter / Grafana 或 Prometheus 缺失','比对父 Chart 依赖、独立包清单、release 和实际 Deployment/StatefulSet。','补齐本批预期的 Chart 或配置，不以单个采集 DaemonSet 就绪结案。','各预期组件可用，测试目标能采集到指标。')],
  'csi-s3':[accessDenied,error('FailedMount / CSI 进程解析失败','从真实挂载执行点查 endpoint 解析与端口，再看卷引用和节点侧 CSI 日志。','按批准的存储连接参数修正。宿主侧的解析和路由要单独复核。','原消费 Pod 能完成挂载，做一次实际读写。')],
  minio:[accessDenied],
  datasourcex:[missingPlugin],
  engine:[missingPlugin,jobCount],
  publicservice:[missingPlugin,jobCount],
  metadata:[error('Invalid URI / 找不到 metalake / Catalog 创建失败','核对组件实际读取的 URI、metalake 和注册配置，再看依赖服务能否从当前 Pod 访问。','按本批契约更新正式配置，验证对象和容器真正生效。','创建测试 Catalog 并从目标入口查询。')],
  nacos:[nacos],gateway:[nacos],api:[nacos],
  assets:[zeroOutput,accessDenied],
  aiworks:[missingModel,accessDenied],
  uniparse:[missingModel,accessDenied],
  'hms-spark-s3':[accessDenied],
  portalfront:[nacos,error('登录页 502 / 静态页可开但业务失败','核对浏览器访问的域名、Ingress、路径与 Service Endpoint。打开浏览器网络面板找到第一个失败请求。',
    '修复实际失败的上游或配置，并确认该项在工作负载里生效。','客户侧完成登录，实际打开已开通模块。')],
};

function imageLesson(step) {
  return [
    screen('核对入仓、平台登记和实际消费者','获准的仓库与镜像管理页面',[
      '从当前交付清单抄录仓库、项目路径、镜像名、tag 或 digest，核对架构和本次使用的任务模板。',
      '按包内说明完成导入或推送。若平台从镜像目录选用，再按当前框架登记该镜像。',
      '在已批准的测试任务中选择它，查真正运行的镜像 ID。',
    ],'期望 digest 可查 · 平台列表能选到 · 消费任务使用实际镜像',
    step.actions[1],
    [authRegistry,error('仓库有镜像，平台下拉列表为空','核对注册所在的项目、镜像类型及工作区筛选条件。','按批准流程补平台登记，再刷新任务选择界面。','对应项目能选到正确的镜像，并提交小样本任务。')]),
    runtimeImage(),
  ];
}

function releaseLesson(step, id) {
  return screen(`部署或复核 ${step.title}`,management,[
    '打开 应用 → Chart 包管理，按当前包清单定位 Chart。核对应用版本、Namespace、release 名称和本次配置；参考名以当前交付介质为准。',
    '已有发布时先检查实际状态。新装或获准变更时，在操作窗口提交任务，记录 EM 任务 ID、时间与第一处失败。',
    step.actions[1],
  ],'任务成功 · 目标 release 与实例可核对 · 组件功能已实测',
  `验收重点：${step.actions[1]}`,
  componentTrouble[id] || [error('任务提示成功，但实际组件不可用','按声明、对象、实例、结果四层对照。先确认 Chart、版本和目标，再查实际 Pod 事件。',
    '把问题改回正式配置或物料来源，按审批处置发布失败与回退。','组件使用正确版本、运行稳定，完成本步功能验证。')]);
}

function componentLesson(step, component) {
  const id = component.id;
  if (component.artifactType === 'image-only') return imageLesson(step);
  if (component.artifactType === 'sealos-bundled') {
    return [
      screen(`核对集群已经提供的 ${step.title}`,'Kubernetes 验收清单与集群终端',[
        '从本批 Sealos 发行清单确认实现、Namespace 和预期对象。使用外部等效实现时按本项目方案复核。',
        step.actions[1],
      ],'预期对象可查 · 运行实例就绪 · 对应功能实测通过',
      step.actions[1],[notFound]),
      podList('objectNs'),
      podDetails('objectNs'),
    ];
  }
  const cards = [releaseLesson(step,id),releaseStatus()];
  if (pluginIds.has(id)) cards.push(jobList(),jobs());
  if (operatorIds.has(id)) {
    cards.push(terminal('查控制器所需的 CRD 是否已经注册',control,'kubectl get crd -o name',
      'customresourcedefinition.apiextensions.k8s.io/examples.operator.example',
      '对照本批 Operator 文档确认应安装的 CRD。CRD 存在后继续查控制器 Ready 和实际对象 reconcile。',
      [notFound,permissions]));
  }
  cards.push(podList(),podDetails());
  if (storageIds.has(id)) cards.push(claimList(),claimDetails());
  if (serviceIds.has(id)) cards.push(serviceEndpoints());
  if (['engine','nacos','minio','mysql','aiworks','uniparse','portalfront','gateway','publicservice','metadata'].includes(id)) {
    cards.push(podLogs());
  }
  return cards;
}

const acceptanceLessons = {
  'smoke-platform':[
    screen('从客户访问点验证门户与基础读写','客户批准的访问端、测试账号和测试存储位置',[
      '用交付域名打开门户，实际登录并打开本期交付模块。记录第一个失败的请求，而非只看主页。',
      '用批准的小样本分别写入和读回。S3 核对桶、前缀与文件大小；NFS 在真实消费容器验证挂载和读写。',
      '核对已有数据和备份范围，将凭据之外的验收结果登记为证据编号。',
    ],'门户登录成功 · 数据样本读写一致 · 原数据与运行基线已核对',
    '从客户侧完成实际业务动作。S3 和 NFS 按本项目范围分别验收。',[accessDenied,nacos]),
    podList(),serviceEndpoints(),claimList(),rolloutGate(),
  ],
  'smoke-compute':[
    screen('跑一个小样本并比对实际产物','业务任务页、获准的测试输入和输出位置',[
      '挑一份很小且非空的批准样本，记下任务 ID、提交时间、输入位置和预期输出。',
      '提交 SQL、同步或算子任务后，打开任务详情，核对对应 Ray/Flink/Spark 实例和实际退出结果。',
      '检查实际读写计数和目标文件。打开产物或执行最小查询验证内容，再记录证据。',
    ],'任务 SUCCESS · 读取 10 · 写入 10 · 目标文件可打开',
    '任务状态、读写数量与实际产物能对应同一次任务。数字仅展示判断方式。',
    [zeroOutput,accessDenied,missingModel,error('镜像或存储下拉为空','核对平台镜像登记、任务框架和存储路径是否属于当前项目。','补齐批准的登记或权限后重新选择。','提交时能选到准确目标，实际运行任务使用同一镜像和存储。')]),
    podList(),podDetails(),podLogs(),jobList(),jobs(),claimDetails(),runtimeImage(),
  ],
  'smoke-ai':[
    screen('逐层验证 AIWorks 的模型、检索与工作流','AIWorks 和获准模型服务',[
      '分别提交小请求，验证对话模型与 embedding 在本次环境可调用。记录失败发生在哪个模型端点。',
      '导入批准的少量样本建立知识库，确认解析完成并能检索到已知片段。',
      '运行并发布工作流，用同一小样本验证下游调用结果。',
    ],'模型请求成功 · 文档解析成功 · 检索有结果 · 下游返回预期内容',
    '对话、向量化、检索和下游分别有可复验结果。依据项目实际模块范围判断。',
    [accessDenied,missingModel,error('模型能对话，但知识库解析失败','检查向量模型是否独立可调用、数据源是否可读、解析任务是否取得正确目录。','按实际失败环节对齐端点、权限或存储路径。','同一小样本完成解析，能检索并进入工作流。')]),
    podList(),podDetails(),podLogs(),
  ],
  handover:[
    screen('用验收记录组织交接和后续处置','项目交接单和运维接收人',[
      '导出「交接清单」，逐项核对已通过、卡住和不适用范围。登记责任人、复验时间和现场证据编号。',
      '和运维接收人核对启动入口、数据落点、备份恢复、版本基线、告警及变更回退顺序。',
      '把备份与权限的交接留在客户允许的渠道，按操作单签收。',
    ],'交接清单已复核 · 遗留项有负责人和复验时间 · 运维接收确认',
    '能从每条签收结论定位到实际验收证据，未完成项有明确跟进方式。',
    [error('步骤显示通过但缺少可复查结果','逐项找对应发布、对象、实例及业务证据。','回到该步骤重新核验。无法闭环的项保留卡点并指定责任人。','证据可复查后再交付签收。')]),
  ],
};

export function tutorialFor(step, component) {
  if (component) return componentLesson(step,component);
  const cards = lessons[step.id] || acceptanceLessons[step.id];
  if (!cards) throw Error('缺少部署教学：'+step.id);
  return cards;
}
