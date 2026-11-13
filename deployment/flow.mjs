const sop = section => ({type:'公司 SOP', ref:`《SOP_Sealos 部署 Kubernetes 集群数栈产品部署文档》${section}`});
const field = (file, lines) => ({type:'Hermes 现场复盘', ref:`FZSealos 数栈现场部署${file}.md · ${lines}`});
const step = (id, title, target, actions, checks, evidence, sources, extra = {}) =>
  ({id,title,target,actions,checks,evidence,sources,...extra});
const phase = (title, steps) => ({title,steps});
const k8s = '首个控制平面或获授权的 kubectl 运维终端';
const em = '客户现场 EasyManager 页面';
const componentSources = [sop('§7'),field('12','L69709–69776')];

export const preparation = [
  phase('开工与主机预检',[
    step('scope','确定本次交付范围','项目负责人、客户变更窗口和现场方案',[
      '确认是新装 Kubernetes 还是复用已有集群。复用时先盘点现有组件、配置归属、数据盘与备份，再决定是否新装或复用 EM。',
      '拿到本项目的物料清单、组件版本、已承诺的业务场景、实施和验收人员。确认网络隔离、介质传入方式、操作窗口以及允许带出的证据范围。',
      '记录部署别名，确认节点清单、K8s API 入口、产品和 EM Namespace、正式门户域名。下面的命令以你确认的 Namespace 为准。',
    ],['目标集群、产品版本、Namespace 与负责人一致','获准的变更窗口、物料和验收范围已核对','已区分新装、复用和本次明确不交付的模块'],
    '客户确认的实施方案编号和验收范围。',[sop('§1–§2、§4、§6'),field('02','L1126–1145')]),
    step('host','逐台核对主机与操作系统','所有计划使用的 Linux 节点',[
      '逐台核对主机名唯一且没有下划线、私网地址、CPU 架构、内存、内核和 OS 版本。SOP 的 32C、64G、SSD、10GbE 是规划建议，按项目容量表验收。',
      '确认 tar 可用、时间已同步、各节点能用批准的账号远程登录。根据实际发行版审查安装脚本依赖和包管理器；特殊 OS 或内核先用同版本样机验证。',
      '检查 Swap、安全策略和文件句柄。由客户批准的基线处理所需变更，分别留存原配置和回退方式；防火墙、SELinux、开机挂载和时间服务由现场按操作系统方案调整。',
    ],['逐台主机名、架构、OS 和 CPU/内存符合规划','所有节点时间同步、tar 可用、授权登录正常','Swap、安全策略、文件句柄及既有容器运行时均已核对'],
    '节点清单与每类节点预检结果，记录偏差及确认人。',[sop('§1'),field('02','L1116–1145'),field('03','L32 · 补齐基础工具')],{
      pitfalls:['同一套 SOP 在不同发行版上可能需要不同包管理器和时间服务。只有 RPM 安装分支的介质不能直接当作所有 OS 都适用。']}),
    step('architecture','选定拓扑、角色与访问链路','规划表与网络联通检查',[
      '确认单控制平面还是高可用方案。高可用需核对控制面与 etcd 成员、API VIP 或负载均衡、证书和故障切换验收。',
      '为控制面、普通 Worker、GPU、MySQL、ES、MinIO、PostgreSQL 等角色确认落点。绘制管理终端→EM NodePort、EM Pod→API、节点→镜像仓库、应用→存储/数据库、客户→门户的链路。',
      '确认节点间私网互通和端口放行，规划 Pod CIDR、Service CIDR、DNS，排除与现网网段的冲突。',
    ],['每台主机角色及首个控制平面已明确','API、镜像仓库、存储、门户链路及地址计划已获确认','已审批高可用或单点方案并记录容量例外'],
    '架构和网络放行单编号。',[sop('§2、§5、§6、§7'),field('02','L1126–1134')]),
  ]),
  phase('数据盘、存储与部署包',[
    step('disk','规划、挂载并验收数据盘','各节点，etcd 额外检查控制平面',[
      '先用 lsblk、findmnt、df 核对系统盘、业务数据盘、设备标识、容量、已有签名和挂载关系。保留的数据目录和磁盘按现状登记。',
      '仅对经审批确认可清空的新盘创建文件系统。逐台核对设备序列号、预期挂载点和现存数据。SOP 的设备名是示例，确认实际设备后按现场标准创建 XFS 或 ext4。',
      '备份 /etc/fstab 后创建挂载目录，通过 blkid 获取实际 UUID，录入 UUID、挂载点、文件系统及获批参数。先挂载数据盘，再按规划创建源和目标目录并配置 bind mount。',
      '区分 Sealos 本地镜像存储、containerd、kubelet 和业务盘，etcd 使用独立规划的低延迟本地存储。检查 fstab、在窗口内挂载并逐台核对后，再按计划重启验证。',
      '复用环境只做盘点和验收。若磁盘缺挂载或已有目录落到根盘，暂停部署，走客户审批的迁移流程。',
    ],['设备与路径逐台核对，已有数据及备份范围已确认','fstab、挂载源/目标、容量和 inode 符合规划','新装重启复验或已有开机挂载记录已核对，etcd 落盘符合规划'],
    '逐台磁盘映射、findmnt 结果及重启复验编号。',[sop('§3'),field('04','L3136–3145'),field('12','L69757–69761')],{
      pitfalls:['findmnt -T 即使返回根文件系统也会成功。要看 SOURCE、TARGET 和预期数据盘是否一致。','磁盘用量与 inode 建立基线。SOP 建议约 70% 告警，正式阈值以客户运维约定为准。']}),
    step('config','在公司 Config 页面生成部署配置','获批准的公司 Config 页面与部署包工作目录',[
      '按应用范围、产品版本、dev/prod 档位、存储、节点、账号、域名、数据库、中间件、ES/Redis/ZooKeeper 的顺序填写。功能开关映射到 global.feature，生产/开发档位映射到 global.resourceProfile。',
      '检查 MASTERS/NODES、产品域名、数据库类型互斥（MySQL/达梦 MySQL/达梦 Oracle）、中间件类型互斥（Tomcat/BES/TongWeb），后两类许可证按客户流程提供。',
      'S3 路线核对 endpoint、桶、区域与最小读写权限。NFS 路线核对 server、export path、权限、StorageClass。若插件走 NFS 而业务仍走 S3，分别核对各自消费者的实际配置。',
      '点击 Download 后检查 values.yaml、config.ini、secret.yaml（按适用范围）及包清单。账号、密码、许可证与生成的敏感配置留在获准环境。用当前安装包脚本核对列表分隔符，SOP 图示与表格口径有差异。',
    ],['应用范围、档位、数据库及中间件与方案一致','节点格式、DNS/入口、存储与依赖服务已逐项复核','生成包及实际安装脚本读取的键已核对'],
    '配置包版本、哈希和参数复核记录编号。',[sop('§4、§5 安装 Kubernetes 集群'),field('11','L9146–9155')],{
      pitfalls:['S3 端点、桶和区域同时核对。NFS 的 StorageClass 名称以现场实际对象和 Chart 为准，旧项目名称只能参考。']}),
    step('materials','验收离线物料、镜像和仓库','获准的物料机、首个控制平面、镜像仓库',[
      '按实施清单准备 Sealos/K8s、EM、产品、基础服务、算子和镜像包；对照架构、版本、校验和及同批组件兼容性。SOP 的版本号是示例，实际以本项目下发介质为准。',
      '在专用目录先列包内容并核对发布说明，再按包自身格式导入。区分 Sealos OCI、Docker 镜像归档、Helm Chart 及仅镜像包；核对镜像 repo、tag、digest 与 Chart 的最终引用。',
      '逐包核对所有顶层及依赖 Chart；同一个物料可能含多个 Chart。确认仓库 project、上传路径、HTTP/TLS 策略和目标节点拉取权限。仓库若随 Sealos 产生，在集群验收后补验证。',
    ],['每份介质的版本、架构、哈希与交付清单一致','已确认导入方式与每份包内 Chart/镜像数量','已确认目标仓库策略，安装所需镜像有可验证来源'],
    '物料核对表、仓库与镜像引用校验记录。',[sop('§5–§7'),field('07','L1466–1484'),field('12','L69748–69776')],{
      pitfalls:['.done、上传成功提示、镜像列表有同名条目，都需要继续核对实际包/Chart、目标仓库路径及镜像 digest。','Chart 包内的子 Chart 可能由父 Chart 自动部署，也可能需单独上传。以包结构、发布说明和实际对象验收。']}),
  ]),
  phase('安装与验收 Kubernetes',[
    step('install-k8s','准备 Kubernetes 安装目录并执行','首个控制平面，获批安装目录',[
      '确认上一阶段逐台预检通过，审阅当前包的 install.sh 与 config.ini，确认将变更的目标列表、运行时路径、网络参数和启动用户。',
      '新装时在首个控制平面的 K8s 安装包目录执行 SOP 安装脚本。记录批次与首条异常；中途失败先定位已完成的节点和阶段，再由负责人决定续跑、修复或回退。',
      '复用时登记现有 API、版本和管理归属，直接进入集群验收；旧集群的安装脚本操作需另行审批。',
    ],['已核对首个控制平面、安装目录和操作窗口','新装脚本已执行完毕，或复用集群的现有状态已登记','安装过程及异常已记录，下一步可以验证 API'],
    '安装任务记录或复用集群的基线记录。',[sop('§5'),field('04','L33、L3136–3145')],{
      pitfalls:['安装半途失败时先区分 SSH、镜像、磁盘、运行时、kubelet 和 CNI。不要把重跑脚本当成无影响操作。']}),
    step('k8s-check','验收控制面、所有节点、网络与仓库',k8s,[
      '确认当前 context 是目标环境。所有规划节点均登记并 Ready，版本和架构一致；对照安装包检查 API、etcd、控制器、调度器、CNI、CoreDNS、入口和 reloader 的期望状态。',
      '使用批准的探测工作负载，从两个不同 Worker 验证跨节点网络、集群 DNS、Service 与仓库拉取。核对失败事件，完成后按现场流程清理探测资源。',
      '检查磁盘用量、inode 及时间同步基线。高可用按批准方案额外验收 API 入口及控制面容错。',
    ],['目标 context 正确，预期节点全 Ready','核心组件、跨节点 DNS/网络和仓库拉取验证通过','安装后磁盘与时间同步复验完成'],
    '节点、核心组件与网络/镜像探测记录。',[sop('§3 运行后监控、§5 集群验证'),field('04','L3149–3169')],{
      pitfalls:['Ingress 和 reloader 在此先验收，已经随集群包提供时按已部署处理。拉取失败先查 Pod Events 里的实际镜像引用、仓库协议与所在节点。']}),
  ]),
  phase('安装与绑定 EasyManager',[
    step('em-install','准备 EM 存储并安装', '首个控制平面、EM 本地卷节点',[
      '新装时核对 EM 包和版本，准备获批 EM Namespace；将现场授权的 kubeconfig 放到脚本指定的 kubeconfig/kubeconfig，文件名按实际包要求。',
      '对照 emChart/config.yaml 的 IP、NodePort 和 storage.em 配置。local 模式先在目标节点建立实际目录，核对 nodeLabelKey/nodeLableVal、节点标签、PV/PVC 对应关系和目录权限。',
      '在 EM 包目录执行安装脚本，按 SOP 选择 1，填入获批镜像仓库与 project。注意脚本可能安装用于推镜像的工具，先确认是否允许。复用 EM 时登记已部署版本、存储与仓库。',
    ],['EM 版本、Namespace、存储节点和端口已确认','本地卷的实际目录、权限与节点标签已复核','EM 安装已完成或已核对获批复用实例'],
    'EM 版本、存储挂载、安装任务与仓库核对记录。',[sop('§6 一、部署 EasyManager'),field('05','L396–402、L895–907')],{
      pitfalls:['Kubernetes 包和 EM 包都可能叫 install.sh。执行前看 pwd、包版本和目标，避免在另一个包目录运行。']}),
    step('em-bind','验证 EM 页面、绑定目标集群和仓库',em,[
      '先看 EM Pod Ready、PV/PVC、Service/Endpoints 和实际 NodePort。对照包版本的组件清单；SOP 的 8 个 Pod 是该版示例。',
      '用获批入口登录 EM → 集群 → 添加集群 → 绑定 Kubernetes 集群。上传的是给 EM 服务使用的授权 kubeconfig，确保 EM Pod 能到达 API 地址且证书验证正常。',
      '填目标 Namespace、仓库与项目路径、仓库协议/证书策略，执行集群和仓库测试。刷新节点列表，和 kubectl 节点逐台比对后才提交部署。',
    ],['EM 能从批准的访问端打开并登录','集群和仓库连通性测试均成功','EM 与 kubectl 对应同一集群及目标 Namespace'],
    'EM 登录、节点与仓库测试记录。',[sop('§6 一.2、二.1'),field('05','L396–402、L895–907')],{
      pitfalls:['安装脚本使用的本机 kubeconfig 与 EM 页面使用的 kubeconfig 作用不同。后者的 API 地址要从 EM 的运行位置实际可达，保留正确 CA/证书校验。','EM 的 NodePort 和产品门户入口是两条访问链路。先从现场核对 Service/Endpoints，避免误用另一个 IP 或端口。']}),
  ]),
  phase('公共配置、落点与发布准备',[
    step('common','准备产品 Namespace 与 common-config',em,[
      '从当前获批 Chart 配置生成 common-config.yaml，核对产品 Namespace 和现有 common-config 对象。新环境按 SOP 创建；已有配置先留存版本和差异，确认实际维护入口再修改。',
      '逐项核对 DB/Redis/ES/ZooKeeper、存储、global.feature、插件 jobCount、节点角色与入口域名。jobCount 从当前版本的 Chart 逻辑和实际可调度节点算出。',
      '确认正式配置源、渲染结果、目标 ConfigMap 以及工作负载引用。对于已部署组件还要核对实际 Pod 装载内容和业务结果。',
    ],['产品 Namespace 与配置来源确定','连接项、启用项和插件 Job 目标已核对','已确认声明→对象→实例→业务的验证方式'],
    '公共配置版本与核对记录编号，原始配置留在现场。',[sop('§4、§6 一.3'),field('06','L1147–1175、L9144–9162')],{
      pitfalls:['Job 0/0 可能代表没启动。Redis 地址写到了当前组件不读取的键也会表现为配置存在但行为没变。']}),
    step('placement','核对角色标签、污点与持久化落点',k8s,[
      '从实际 Chart 渲染结果确认 nodeSelector、affinity、tolerations、存储卷与节点。逐台核对节点标签以及 MySQL/ES/MinIO/PG 等数据路径，变更先记录当前标签和落点。',
      '按实施方案由授权人员配置标签。核对 PostgreSQL、aiworks、dtstack 等键的准确拼写和值。扩 GPU 节点时，确认通用业务和插件分发是否会被调度过去。',
      '复用既有数据时，逐组件核对 Pod 实际节点、卷挂载、原数据和备份；目录为空或挂载指向不一致时暂停。',
    ],['实际 Chart 标签与现场节点匹配','存储卷和宿主机路径已按角色逐项核对','GPU/普通节点范围及插件可用性已经确认'],
    '节点标签、污点与有状态服务落点验收记录。',[sop('§7 节点角色标签'),field('02','L1136–1145'),field('12','L174783–174800')],{
      pitfalls:['SOP 标签示例、旧环境和新 Chart 可能使用不同键。以本次渲染后的工作负载为准。']}),
    step('charts','在 EM 分批上传并预核对 Chart',em,[
      '进入 应用 → Chart 包管理 → 上传 Chart 包。按实施清单逐个核对名称、Chart 版本、应用版本、包中全部 Chart 和仓库镜像。',
      '已由 Sealos 提供的组件仅复验。父 Chart 自带的子 Chart 按实际渲染核验；仅镜像的物料先入仓和验证引用，不创建虚假的 Helm release。',
      '部署应用前再次确认目标 Namespace、release 名称、配置覆盖顺序、期望对象与影响范围。尽量一个组件验收完成再部署下一个。',
    ],['按包核对 Chart 清单并标出仅镜像项','镜像仓库及最终引用已对齐','已确定发布顺序、失败时的证据和回退责任人'],
    '上传清单与预检报告编号。',[sop('§7 Chart 包管理'),field('07','L1466–1484'),field('12','L69748–69776')],{
      pitfalls:['上传成功只证明接收包。到 EM 列表逐个比对 Chart；集群端再按期望资源验证是否部署。']}),
  ]),
];

// SOP ordinals are stable. Extra items are individually confirmed from the actual package and scope.
const sequence = [
  ['基础服务',[
    ['ingress-nginx'],['reloader'],['dtstack-common',1],['zookeeper',2],['redis-operator'],
    ['redis-standalone',3,'Redis 哨兵 / 单点'],['mysql',4],['kube-prometheus-stack',5],
    ['postgresql',6],['elasticsearch',7],['minio',8],['csi-s3',9],['kafka'],
  ]],
  ['插件分发',[
    ['chunjun112',10],['datasourcex',11],['flinksql116',12],['sqlparserserver',13],['engineplugin',14],
  ]],
  ['平台子服务',[
    ['dtuic',15],['publicservice',16],['engine',17],['metadata',18],
    ['agent-shell',19],['kkfileview',20],['nacos',21],['gateway',22],
  ]],
  ['业务模块',[
    ['flink112-image'],['flink116-image'],
    ['batch',23],['stream',24],['api',25],['assets',26],['easyindex',27],['tag',28],
  ]],
  ['AI、计算与门户',[
    ['kuberay-operator'],['ray-datajuicer'],['python-runtime'],['aiworks',29],['xinference-cpu'],['uniparse'],['vectorized-image'],
    ['spark-operator'],['spark-py'],['hms-spark-s3',30],['portalfront',31],
  ]],
];

const anchors = {
  'ingress-nginx':['在集群实际入口节点验证 controller 就绪、IngressClass 与监听和路由。','复用当前入口时检查域名、证书和上游，不再重复装一套。'],
  reloader:['按包版本核对 reloader 进程与受管对象注解。','用受控测试配置检查重载生效链，避免把配置更新当成实例已经替换。'],
  'dtstack-common':['检查公共配置与共享对象版本，先确认当前版本要求是上传包还是实际部署。','不要套用上一项目升级时“只上传”的口径做新装。'],
  zookeeper:['在服务内确认集群成员、leader/follower 与连接端口。','核对各节点落点和原数据目录。'],
  'redis-operator':['确认当前 Redis 包是否需要 Operator。若需要，先验收 CRD、Operator Pod 及管理权限。','Operator Ready 后再确认对应 Redis 自定义资源是否被接管。'],
  'redis-standalone':['按项目选择哨兵/单点方案，按实际拓扑确认服务名、端口、主从/哨兵和应用连通。','Pod 0/1、无就绪 Endpoint 或应用使用错误键，会导致门户转圈。'],
  mysql:['验证应用侧连接目标 DB，核对 schema/初始化记录和读写权限。','复用时核对原数据与备份。发现库变空或路径改变，先暂停，禁止重新初始化。'],
  'kube-prometheus-stack':['按本包结构核对 operator、Prometheus、Grafana 等预期资源和 scrape target。','仅 node-exporter Running 时，核对是否漏了其余 Chart 或子资源。'],
  postgresql:['核对 PG 的节点标签、持久盘及访问，查验现有库和备份。','nodeSelector 以实际模板为准。'],
  elasticsearch:['在授权入口核对集群健康、节点与索引，结合副本策略解释 yellow。','Pod 就绪但关键索引不可用时不能签通过。'],
  minio:['核对集群磁盘落点、各桶和应用侧读写。已有桶要按预期保留。','分别从 Pod 和 CSI 实际执行位置核对 endpoint 解析和路由。'],
  'csi-s3':['核对驱动和挂载端，确认 PV/StorageClass/凭据引用，以及真实消费 Pod 中的挂载和读写。','看到 FailedMount 或 Timeout 时先分辨宿主机 DNS、路径、权限和节点侧挂载进程。'],
  kafka:['按需求核对 Broker、数据目录、应用访问的地址及测试消息收发。','仅端口打开不足以验证业务链路。'],
  chunjun112:['核对当前版本拆分的插件包及分发 Job；验证实际使用节点和容器内插件。','Job 0/0 先回公共配置检查 jobCount。'],
  datasourcex:['检查选定数据源类型的插件和 JDBC 驱动落点，做实际连接测试。','若部分服务可用，比较正常与异常 Pod 的卷定义、挂载路径和实际文件。'],
  flinksql116:['确认 Flink SQL 版本、插件/镜像与实际会话或 per-job 模板一致。','同名参数出现在多份模板时，按任务实际使用的模板验收。'],
  sqlparserserver:['确认安装包内 Chart 名、SQL 解析服务可用并跑一条小 SQL。','应用能打开不代表后端解析或引擎入口已打通。'],
  engineplugin:['验证 Job 期望数与成功数、目标节点或共享卷、插件目录和消费者的实际挂载。','对照正常节点与失败节点，不能只看 Job 页面完成。'],
  dtuic:['验证后端登录鉴权、用户与前端资源，并核对 DB/Redis。','登录页能打开时还要真实登录，核对错误与网关响应。'],
  publicservice:['确认 DB/Redis 和实际插件卷，执行数据源连接测试。','插件卷为空或挂载层级不对会报插件初始化异常，即使 Pod Ready。'],
  engine:['核对引擎注册、Service 端口与插件挂载。当前批次若需与 AgentShell 联装，按发布说明部署两者后回本步核验，端到端任务放在冒烟。','扩容和 GPU 节点加入后，检查重建实例是否漂到缺插件的节点。'],
  metadata:['验证一个数据源采集或 Catalog，按需核对 Gravitino URI、metalake 和实际配置键。','Catalog 页面配置完成后还需验证后端运行配置与访问链路。'],
  'agent-shell':['确认与 Engine 对应的版本、端口、注册状态及双向依赖。','Engine 与 AgentShell 以当批产品发布说明确定联调顺序，联合验收。'],
  kkfileview:['准备一份获批测试文件，检查预览请求、响应和浏览器实际渲染。','失败先区分入口、文件路径和格式支持。'],
  nacos:['在各实例核对成员表及服务注册一致性，再验 gateway 的发现链路。','同一个 Service 有多个 Endpoint 时，要验证各副本一致，避免间歇性 157。'],
  gateway:['核对网关上游、Nacos 注册查询及到业务服务的请求。','157 时比对注册名、Namespace、Group 与实际查询节点；保留定位结果再改配置。'],
  batch:['核对应用和调度接口、SQL 解析及引擎连接，计算组件到齐后在冒烟步骤跑小 SQL/离线任务。','调度状态、引擎状态和数据输出要能对应同一任务。'],
  stream:['核对应用、Kafka/Flink 的版本、模板及镜像，在冒烟步骤跑测试任务核验输入输出。','用小流量验证处理结果和指标，区分运行模式。'],
  api:['确认所有适用前端、后端和 api-server Chart，再验证真实 API 请求及返回。','157 先分辨无实例注册与注册视图不一致。'],
  assets:['分别验证文件管理、数据集、元数据采集与对象桶/前缀登记。','桶内对象与页面列表的范围可能不同，按本版本平台登记逻辑验证。'],
  easyindex:['在当前版本核对数据库、Redis 配置实际被读取，验证指标页面和后端请求。','旧版曾出现配置写到了组件不读取的 Redis 键，先查读取契约。'],
  tag:['使用批准的样本创建并运行标签任务，核对结果。','若本期不交付，按确认范围登记不适用。'],
  'kuberay-operator':['确认当前方案是否用 Ray。核对 CRD、Operator、对应镜像和测试 RayJob 生命周期。','多模态依赖 Ray 时先验收算力、资源和挂载。'],
  aiworks:['确认后端与适用前端 Chart、Redis/DB、对象存储、算力和模型入口。用批准的测试文件验证真实请求。','组件安装、模型能调用、知识库能解析和工作流能发布分别验收。'],
  uniparse:['核对 CPU/GPU 版、资源落点、Service、模型卷和解析输入输出。','用一份小 PDF 确认真正产出了可读文件。'],
  'spark-operator':['核对当前包是否需要 Spark Operator、CRD 和调度权限。','测试 SparkApplication 按方案正常创建和结束。'],
  'hms-spark-s3':['核对 HMS、Spark/Thrift 和 S3 实际链路，运行小查询并比对表数据。','CSI 宿主机访问和 Spark Pod 访问分别验证。'],
  portalfront:['门户最后配置，核对域名/Ingress、前端模块、网关 upstream 与登录链路。','从客户批准的访问端测试，不以部署节点本机返回 200 作为验收。'],
};

const related = {
  'redis-standalone':[field('09','L16581–16594')], 'kube-prometheus-stack':[field('07','L1466–1484')],
  'csi-s3':[field('07','L30593–30610'),field('09','L33701–33719')],
  'datasourcex':[field('11','L42516–42525')], 'engineplugin':[field('06','L1147–1175'),field('11','L9146–9155')],
  publicservice:[field('11','L42516–42525')], engine:[field('12','L174783–174800')],
  metadata:[field('12','L96794–96807')], nacos:[field('12','L92719–92735')], gateway:[field('12','L92719–92735')],
  assets:[field('12','L48806–48825')], aiworks:[field('10','L58508–58527')],
};

export function componentPhases(profile) {
  const byId = new Map(profile.components.map(item => [item.id,item]));
  const seen = new Set();
  const ordinals = new Set();
  const result = sequence.map(([title,items])=>phase(title,items.map(([id,num,label])=>{
    const c = byId.get(id);
    if (!c || seen.has(id) || (num && ordinals.has(num))) throw Error('部署顺序条目无效：'+id);
    seen.add(id);
    if(num) ordinals.add(num);
    const image = c.artifactType === 'image-only';
    const bundled = c.artifactType === 'sealos-bundled';
    const optional = !num || [3,4,6,7,8,9,23,24,25,26,27,28,29,30].includes(num);
    const verdict = anchors[id] || ['核对镜像路径、架构、tag/digest，并由真实消费者拉取和运行。','镜像已入仓后按实际需求完成平台镜像登记，验收任务能选到并使用该镜像。'];
    const actions = image ? [
      '按实施清单确认使用范围和完整镜像引用。在受控仓库按原包说明导入、推送并核对 digest。',
      verdict[0],
    ] : bundled ? [
      '确认集群安装包是否已经提供该组件，按实际 Namespace 验收。若本项目使用外置等效实现，登记对应验收依据。',
      verdict[0],
    ] : [
      '在 EM 查本批包对应的 Chart 与镜像，核对 release、配置、落点和适用前置。在批准窗口部署或验证已部署实例。',
      verdict[0],
    ];
    const checks = image ? ['镜像架构、版本与消费者引用已核对','已验证从目标执行节点拉取，或有批准的同版本镜像可用证据']
      : bundled ? ['已确认由集群提供或按审批补齐','已验证对应组件服务可用']
      : ['声明版本、Chart、镜像和落点已核对','集群对象、运行实例与目标配置一致','本项功能验证通过或已按实施方案复用验收'];
    return step('component-'+id,label||c.name,image?'获准的镜像仓库与目标执行节点':bundled?k8s:em,actions,checks,
      image?'仓库 digest、节点拉取和消费者验证记录。':'实际对象/镜像版本、落点和功能验证记录。',
      [...componentSources,...(related[id]||[])],{
        number:num,optional,pitfalls:[verdict[1]],
        reference:{chart:c.chartNames,packages:c.pkgNames,placement:c.placement?.key,services:c.serviceNames,
          scope:'下列名称和落点取自星图现有参考 Profile。与本项目包不一致时，以本次发布清单和实际渲染为准。'},
      });
  })));
  if (ordinals.size !== 31 || seen.size !== byId.size) throw Error('部署向导未覆盖 SOP 31 步与组件目录');
  return result;
}

export const acceptance = [
  phase('冒烟、回退与交接',[
    step('smoke-platform','验收门户、基础链路与持久化','客户批准的浏览器、EM 与目标集群',[
      '用获批测试账号从客户侧门户登录，打开交付模块，检查网关、服务入口及 DNS/TLS。检查工作负载副本、就绪探针、事件和 Service Endpoint。',
      '用测试目录/桶验证按项目方案配置的读写链路。S3 区分 endpoint、bucket、prefix、region 和权限；NFS 核对 PV/PVC Bound 与容器实际挂载和写入，检查是否能跨预期节点访问。',
      '验证一项已部署的数据库或数据源访问，记录失败分类和受影响功能。对照安装前记录核对数据盘、既有库和业务数据。',
    ],['客户侧入口、登录、已开通模块正常','基础数据库及已启用存储完成真实验证','集群事件与数据落点已核对'],
    '经批准的门户、存储与数据源验收证据编号。',[sop('§6 部署验证、§7'),field('11','L9146–9155')]),
    step('smoke-compute','验收数据开发、同步及多模态算子','门户任务页、集群与获准测试桶',[
      '对照范围各提交一条小 SQL/离线任务、实时任务或 API。同步任务使用非空小样本，核对读写数、任务 ID、目标文件大小和时间；完成但 0 读 0 写应复核过滤条件和路径。',
      '多模态链路按范围检查资产上传/登记→算子镜像→任务提交→Ray/Flink/Spark 执行→输出桶/前缀→页面能打开产物。用实际任务引用核对镜像、PVC、模型及可写目录。',
      '遇到 403 区分模型 API、仓库、S3 读/写与网关的请求方，分别检查对应端点和授权。看到模型 Job 成功也要比对消费者实际使用的桶与前缀。',
    ],['约定的任务均使用小样本执行','状态、任务实例与实际非空输出一一对应','已记录失败任务及未交付模块'],
    '任务编号、输入输出对照和业务验收结果。',[sop('§7'),field('10','L10705–10717、L20326–20344'),field('12','L48806–48825、L116786–116805')],{
      optional:true,
      pitfalls:['界面镜像下拉为空，核对仓库镜像及 Console 镜像中心登记；存储下拉为空，核对平台路径登记和调用方权限。']}),
    step('smoke-ai','验收 AIWorks、知识库及工作流','AIWorks 与客户批准的模型服务',[
      '按已承诺范围逐个验证 LLM 和 embedding 实际可调用，记录接入批准、容量和权限。选用安全样本，先完成知识库解析，再验证检索。',
      '配置工作流的模型、知识库和运行参数，发布后验证 API 调用，再按模块范围验收灵瞳入口。记录模型不可用、未授权或超出范围的项目。',
    ],['适用的模型接入已测试','知识库、工作流与下游入口按范围验证','业务样本返回符合预期并可复验'],
    '模型与工作流测试编号。',[sop('§7 AIWorks'),field('10','L58508–58527')],{optional:true}),
    step('handover','整理变更、遗留项、回退和签收','项目负责人、客户运维和验收人',[
      '记录集群与版本基线、节点角色、依赖、入口、数据路径、管理归属和变更台账。交付材料中的账号、证书、原始日志及敏感地址按客户规则另行保管。',
      '核对各组件声明、对象、实例、业务四层证据；保留不适用范围、阻塞项、影响、临时方案、责任人和复验日期。',
      '交代备份和恢复方法、告警、运行维护与回退顺序。回退有状态服务时按组件备份和数据兼容性方案处理，明确由谁在何时操作。',
    ],['安装与冒烟证据能按编号复查','遗留项和不适用范围已获确认','回退/备份归属及交付验收已签认'],
    '变更台账、验收单、备份与交接记录编号。',[sop('§3 运行后监控、§6–§7'),field('12','L148314、L149462、L151570')]),
  ]),
];
