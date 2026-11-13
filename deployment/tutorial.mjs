// Examples are invented. Customer-specific names and output stay in the field terminal.
const everyNode = '每台计划纳入集群的 Linux 节点';
const control = '首个控制平面，或已连接目标集群的运维终端';
const material = '已获准的 Linux 物料机，切到本次部署包所在目录';
const management = '客户现场 EasyManager 浏览器';

const error = (signal, check, fix, verify) => ({signal, check, fix, verify});
const terminal = (title, target, text, sample, normal, errors, options = {}) =>
  ({kind:'terminal',title,target,text,sample,normal,errors,...options});
const screen = (title, target, actions, sample, normal, errors) =>
  ({kind:'screen',title,target,actions,sample,normal,errors});

const permissions = error('Forbidden / Unauthorized','核对当前 context、用户和资源类型。区分未登录、kubeconfig 过期和 RBAC 拒绝。',
  '请集群管理员提供当前步骤所需的授权或代查结果。保留拒绝信息。','同一终端重跑原命令，确认返回的是目标集群中的资源。');
const notFound = error('NotFound / No resources found','核对 Namespace、实际对象名和当前执行阶段。到 EM 查本次任务 ID 与失败环节。',
  '查到真实名称后重跑。若资源确实未创建，回发布任务确认渲染、提交和权限。','预期资源出现在正确的 Namespace，名称与发布记录一致。');
const wrongContext = error('current-context is not set / 名称与项目不符','在同一终端检查 kubectl config get-contexts，只看 context 名称与当前标记。',
  '让现场管理员提供正确的授权配置或明确选择本次 context。目标未核对前暂停后续变更。','重新执行 current-context，名称与批准的集群记录一致。');
const imageError = error('ErrImagePull / ImagePullBackOff','展开 Pod Events，读 Failed to pull image 后面的原始原因。比较 Pod 引用的完整仓库/路径/tag 或 digest。',
  'manifest unknown 查物料是否推到了该路径。unauthorized 查项目访问权限和拉取凭据引用。x509 查节点信任链，timeout 查节点到仓库的路由和 DNS。按已批准的方案修复对应项。','重看同一个 Pod 的 Events 和状态，确认当前镜像已拉取、容器正常启动。');
const scheduleError = error('Pending / FailedScheduling','在 Events 区分 Insufficient cpu/memory、污点、node selector 和 PVC 问题。',
  '资源不足核对 requests 和目标节点余量。标签/污点不匹配回实际渲染值与节点规划。PVC 未绑定继续看 PVC Events。','Pod 分配到计划节点，相关警告消失或不再重复。');
const initError = error('Init:0/1 / Init:CrashLoopBackOff','用 describe 找到卡住的 init 容器，在状态里看等待原因或退出码。需要日志时只查该容器。',
  'FailedMount 先查卷和节点。初始化进程退出则对照该容器日志查前置服务、配置或权限。','init 容器按期完成，主容器随后就绪。');
const probeError = error('Running 但 READY 不齐 / CrashLoopBackOff','看容器 State、Last State、Restart Count 和 Events。找到具体探针、端口或退出原因。',
  'Readiness 失败核对应用监听地址、端口、路径与依赖。反复退出先查对应容器的上一次日志和 OOMKilled 等退出原因。','READY 分子等于分母，持续观察重启计数，执行该组件的功能验证。');
const claimError = error('PVC Pending / FailedMount','用 describe pvc 看 Events，核对 StorageClass、访问模式、容量和消费者。',
  'WaitForFirstConsumer 先确认是否已有匹配的 Pod。没有可用 PV 或 provisioner 报错时，按规划修复存储供给。Bound 后还挂不上，再查节点侧网络、挂载驱动和权限。','PVC 为 Bound 且实际消费 Pod 挂载成功，完成获准测试目录的读写。');
const authRegistry = error('unauthorized / x509 / i/o timeout','确认是安装机推送失败还是节点拉取失败，分别检查这两处的地址、证书和访问权限。',
  '核对仓库 project、镜像路径、对应身份和批准的 CA 信任链。网络超时从实际发起的节点查 DNS、路由与端口。','用相同身份从同一执行点复核目标镜像；拉取成功后检查运行实例的 imageID。');
const runningPodExample = 'NAME              READY   STATUS    RESTARTS   NODE\nexample-app-0     1/1     Running   0          worker-01';

const context = terminal('确认当前操作的是目标集群',control,'kubectl config current-context','example-install',
  '这一行必须与部署计划里的 context 对应。即使返回名称，也要确认目标集群；后续命令都在同一终端执行。',[wrongContext]);

function nodeList() {
  return terminal('核对所有规划节点的 Ready 状态',control,'kubectl get nodes -o wide',
    'NAME       STATUS   ROLES           VERSION\nmaster-01  Ready    control-plane   v1.xx.y\nworker-01  Ready    <none>          v1.xx.y',
    '逐台核对节点数量、名字、角色及版本。所有本次计划使用的节点应为 Ready。普通 Worker 的 ROLES 显示 <none> 可以正常。',
    [error('NotReady / 节点少一台','用 kubectl describe node 对应节点查看 Conditions 和 Events，检查 Ready、网络和磁盘压力；缺席节点回看该节点的安装或加入记录。',
      '按证据排查 kubelet、容器运行时、CNI 或节点间网络。容量有压力先核对挂载和资源，交由现场负责人处置。','所有规划节点重新显示 Ready，再继续应用部署。'),permissions]);
}

function podList(ns = 'ns', title = '查目标 Pod 的 READY、STATUS 和落点') {
  return terminal(title,control,`kubectl -n {{${ns}}} get pods -o wide`,runningPodExample,
    '对照预期清单找到当前组件的 Pod。长驻容器 READY 分子等于分母、STATUS 为 Running，重启数在观察期不增加且 NODE 符合规划；一次性 Job 用完成数验收。',
    [scheduleError,imageError,initError,probeError,notFound]);
}

function podDetails(ns = 'ns') {
  return terminal('打开单个异常 Pod 的事件和状态',control,`kubectl -n {{${ns}}} describe pod {{pod}}`,
    'Conditions:\n  Ready              True\nEvents:\n  Normal  Scheduled   Successfully assigned ...\n  Normal  Started     Started container example',
    '从上一条列表抄目标 Pod 名。重点看 Conditions、容器 State/Last State，以及末尾的 Events。正常样例中的事件可能因保留期限已清理。',
    [scheduleError,imageError,initError,probeError,claimError,permissions]);
}

function podLogs(ns = 'ns') {
  return terminal('查看指定容器的最近日志',control,`kubectl -n {{${ns}}} logs {{pod}} -c {{container}} --tail=60`,
    '示意 · 服务启动完成\n示意 · 依赖连接正常',
    '容器名从 describe 输出读取。按该组件实际日志识别启动完成和依赖连通；空日志或没有 ERROR 不能单独作为通过依据。',
    [error('container is waiting to start / PodInitializing','先看对应容器的 State 和 Events。尚未启动的容器通常没有日志可读。',
      '按事件处理镜像、卷或上游 init 容器。若主容器刚重启，可在确认名称后用相同命令追加 --previous 查上一次实例。','容器启动后重查日志，并结合 READY 和业务请求确认。'),
      error('container ... is not valid for pod','从 describe 的 Containers 或 Init Containers 段复制准确的名字。',
        '核对 Namespace 和 Pod 是否已经重建，再重填名称。','查询命中预期的容器实例。'),permissions]);
}

function claimList(ns = 'ns') {
  return terminal('核对存储卷绑定和落点',control,`kubectl -n {{${ns}}} get pvc -o wide`,
    'NAME          STATUS   VOLUME       CAPACITY   STORAGECLASS\nexample-data  Bound    pv-example   200Gi      local-storage',
    '本组件需要的卷逐一匹配，容量和 StorageClass 符合设计。Bound 之后要从消费 Pod 或获准的测试任务确认实际挂载和读写。',
    [claimError,notFound,permissions]);
}

function claimDetails(ns = 'ns') {
  return terminal('查看异常 PVC 的绑定事件',control,`kubectl -n {{${ns}}} describe pvc {{claim}}`,
    'Status:       Bound\nVolume:       pv-example\nAccess Modes: RWO',
    'Status、Volume 和访问模式对应本次设计。未绑定时先读 Events，判断有没有消费者、是否能动态供给及是否存在节点约束。',
    [claimError,permissions]);
}

function releaseStatus() {
  return terminal('核对这一次的 Helm 发布记录',control,'helm -n {{ns}} list --all',
    'NAME         NAMESPACE  REVISION  STATUS    CHART\nexample-app  dtstack    1         deployed  example-app-x.y.z',
    '找到本次 release，版本与实际发布一致且状态为 deployed。表中状态只核实发布层，接着看资源、实例和业务功能。',
    [error('failed / pending-install / pending-upgrade','对照 EM 任务时间及 release 记录；确认是否有发布仍在运行。查 hook Job 和失败资源的事件。',
      '先保留失败信息并修复具体原因。卡住的历史任务由现场负责人决定继续、回退或重试。','当前 release 状态恢复，运行对象与实例都已到本次版本。'),notFound,permissions]);
}

function serviceEndpoints(ns = 'ns') {
  return terminal('确认 Service 有可用的后端地址',control,
    `kubectl -n {{${ns}}} get endpointslice -l kubernetes.io/service-name={{service}} -o 'custom-columns=NAME:.metadata.name,PORTS:.ports[*].port,READY:.endpoints[*].conditions.ready'`,
    'NAME               PORTS   READY\nexample-svc-ab123  8080    true',
    '对照实际 Service 名、端口与预期后端数量，检查相应 Endpoint 的 READY 为 true。路由可达性继续用浏览器或获准的请求验证。',
    [error('没有切片 / READY 为 false','查看 Service selector，和目标 Pod labels、READY 状态及端口对照。',
      '修复批准的 Chart 配置或 Pod 探针、依赖问题。ExternalName 或无 selector 的 Service 按其设计验收，不能按普通 selector 服务判断。','EndpointSlice 出现正确的就绪后端，并完成上游请求验证。'),permissions]);
}

const installDirectory = (target, expected) => terminal('先确认进入了正确的安装包目录',target,
  'pwd\nls -l -- ./install.sh',
  `${expected}\n-rw-r--r-- 1 deploy deploy ... ./install.sh`,
  'pwd 指向本次获批介质的解压目录，且存在该包的 install.sh。和操作单里的包名、版本与哈希对照；用只读方式确认同目录配置已准备。',
  [error('No such file or directory / 找到的是另一个包','核对当前位置，分清 Kubernetes 安装包与 EM 安装包。','回到获批解压目录，按介质文档复核结构。','两行结果均与本次操作单对应。')]);

const installCommand = (title, target, normal, errors, mode) => terminal(title,target,
  "sh ./install.sh; rc=$?; printf 'INSTALL_EXIT=%s\\n' \"$rc\"",
  '…安装脚本按当前包版本显示各阶段信息…\nINSTALL_EXIT=0',normal,errors,{change:true,mode});

const installProblems = [
  error('Permission denied / Authentication failed','定位失败节点、账号、SSH 认证方式或脚本执行权限。','请现场管理员确认授权和节点之间的连接，按当前包文档纠正，不把凭据写入记录。','该失败环节已按批准方式补齐，集群节点与 API 复验通过。'),
  error('no space left on device / failed to mount','在失败节点比较 df -hT、df -i 和 findmnt，确认是容量、inode 还是落错分区。',
    '先停止续跑。回数据盘步骤核对持久挂载，按现场审批清理或扩容。','路径与容量恢复，已完成阶段与失败节点均核对后再续做。'),
  error('INSTALL_EXIT 非 0 / 任务中途停止','从脚本输出找第一处失败和已变更的节点。分别核对 SSH、镜像、运行时与 kubelet 状态。',
    '先记录已完成环节和影响范围。按本批包说明与负责人确认续跑或回退。','安装任务完成后到下一步核验 API、节点和系统组件。'),
];

const lessons = {
  scope:[
    screen('和现场负责人逐项确认开工信息','现场实施方案及变更单',[
      '拿本次操作单和客户确认的版本清单，先圈出新建或复用的集群、EM 及交付模块。',
      '对着节点清单确认首个控制平面、Worker、仓库、存储及两个 Namespace。需要填写实际 Namespace 或脱敏代号时，打开「完整步骤和设置」。',
      '在现场台账登记变更窗口、执行人、验收人和证据编号，标出客户允许使用的终端和物料通道。',
    ],'项目范围已确认 → 节点/版本清单已确认 → 变更与验收人已明确',
    '开工范围和当前环境只有一份经确认的口径，实施人知道失败时找谁决策。',
    [error('版本、主机角色或窗口对不上','比较订单、节点表、变更单三处的值，标出冲突。','由现场负责人确认最终基线，再修改当前计划。','重新口头复核首节点、版本和窗口，记录确认编号。')]),
  ],
  host:[
    terminal('逐台确认主机名、CPU 架构和操作系统',everyNode,'hostname\nuname -m\ncat /etc/os-release',
      'worker-01\nx86_64\nNAME="Example Linux"', '第一行应是节点清单中的唯一名字。x86_64 与 aarch64 对应不同物料；OS 和内核需符合本次支持范围。',
      [error('主机重名 / 架构与介质不一致','逐台比较节点清单和安装包架构。必要时补看 uname -r。','按批准的 OS 基线修正主机命名，或换用匹配的获批物料。','每台输出与清单一致，再检查资源。')]),
    terminal('核对 CPU、内存和解包工具',everyNode,'nproc\nfree -h\ncommand -v tar',
      '32\n               total   used   free\nMem:            62Gi   2Gi    54Gi\n/usr/bin/tar',
      'CPU 和可用内存与该角色规划相符。tar 输出可执行文件路径；空输出要先检查工具。',
      [error('命令找不到 / 资源低于规划','用 OS 信息确认发行版和获准软件仓库。对照节点角色要求。','按现场软件源补齐工具；容量偏差由负责人确认后再继续。','tar 返回路径且容量达标，或已有书面偏差确认。')]),
    terminal('检查时间同步、Swap 和文件句柄',everyNode,
      'date -u\ntimedatectl show -p NTPSynchronized --value\ncat /proc/swaps\nulimit -Sn\nulimit -Hn',
      'Thu Nov 12 02:00:00 UTC 2026\nyes\nFilename  Type  Size  Used  Priority\n65535\n65535',
      '各节点时间与同一时源一致；系统使用其他时间服务时看该服务状态。Swap 与句柄值按本版本方案对照；无已启用 Swap 时只有表头。',
      [error('no / timedatectl 不可用 / Swap 有设备','如果使用 chrony，现场运行 chronyc tracking 看同步状态；确认 Swap 来自哪个设备或文件。',
        '由现场按当前发行版配置时源、Swap 和句柄基线，并记录现有配置与变更方式。','复查每台时间与系统基线；确认重登或计划内重启后的结果。')]),
  ],
  architecture:[
    screen('在拓扑图上走一遍部署和访问路径','规划表、网络放行单',[
      '标出首个控制平面、API 入口、Worker、仓库、EM 入口、存储和门户入口。',
      '为每一条链路记录从哪里发起、到哪个地址及端口。优先查安装机到各节点、EM 到 API、节点到仓库、应用到存储。',
      '核对 Pod/Service 网段与现网是否冲突，确认访问入口使用的是本次规划地址。',
    ],'安装机 → 节点｜EM → Kubernetes API｜Worker → 镜像仓库｜客户浏览器 → 门户',
    '关键链路均能从实际发起点验证，单点或高可用方案与实施单一致。',
    [error('管理机可达，实际发起端不可达','查哪个节点或运行位置发出请求，检查其 DNS、路由和防火墙策略。','按批准的源和目标补齐实际链路。','从该发起端重测，不能用管理机结果代替。')]),
    terminal('从实际发起节点检查一个 TCP 端口','网络放行单指定的源端（需已安装 nc）',
      'nc -vz -w 3 {{host}} {{port}}','Connection to example.internal 443 port [tcp/https] succeeded!',
      '目标主机和端口来自批准的网络清单。成功只说明 TCP 能建立；身份认证、TLS 和业务仍需各自验证。',
      [error('Name or service not known / timed out / refused','无法解析先查 DNS；timeout 查路由、防火墙和放行；refused 查目标监听和端口是否填错。',
        '在实际源节点修复对应链路后复测。nc 不可用时使用客户批准的等效检测工具。','同一源、同一目标及端口能够建立连接。')]),
  ],
  disk:[
    terminal('先识别系统盘、数据盘与已有文件系统',everyNode,'lsblk -o NAME,SIZE,FSTYPE,UUID,MOUNTPOINT,SERIAL',
      'NAME   SIZE FSTYPE UUID       MOUNTPOINT SERIAL\nvda    200G                             SYS-EXAMPLE\n└─vda1 200G ext4   uuid-root  /\nvdb      1T xfs    uuid-data  /data      DATA-EXAMPLE',
      '从挂载 / 的条目识别系统盘，再按设备标识、容量、文件系统和挂载点确认数据盘。已有业务盘要识别并保留。',
      [error('磁盘缺失 / 盘号变化 / 发现意外文件系统','先核对云平台或服务器提供的设备映射、序列号及本次变更单。',
        '停止初始化。请现场负责人核对盘归属及备份。复用或有数据的盘走既定挂载和迁移流程。','设备与计划逐台对应，原数据范围清楚，才进行下一步。')]),
    terminal('核对实际挂载源与目标',everyNode,'findmnt -T {{path}} -o TARGET,SOURCE,FSTYPE,OPTIONS',
      'TARGET SOURCE   FSTYPE OPTIONS\n/data  /dev/vdb xfs    rw,relatime',
      '填计划里的实际路径。例如 /data，或控制平面的 /var/lib/etcd。重点看 TARGET 和 SOURCE 是否与规划相符；bind 挂载时确认对应源目录。',
      [error('TARGET 显示 / / SOURCE 是系统盘 / 无输出','先用 lsblk 看设备与分区，再查目录是否存在和 /etc/fstab 的 UUID 与挂载顺序。',
        '按批准的挂载设计纠正源和目标。已有业务目录若落在根盘，停下走数据迁移方案，避免直接覆盖。','重新执行 findmnt，确认实际挂载源和目标均符合规划。')]),
    terminal('检查持久挂载语法、可用容量和 inode',everyNode,'findmnt --verify\ndf -hT\ndf -i',
      'Success, no errors or warnings detected\nFilesystem  Type  Size  Used  Avail  Use%  Mounted on\n/dev/vdb    xfs   1.0T  20G   980G   2%    /data',
      '核对 fstab 校验结果、容量和 inode 的 Use%。新装按变更窗口复验重启后的挂载，复用环境核对可用的既有验证记录。',
      [error('unreachable source / parse error / Use% 过高','对照 fstab 的 UUID、文件系统、目录和 bind 顺序；对比实际挂载与容量规划。',
        '按批准方案纠正配置或处理容量。发现只读挂载、异常文件系统或根盘写满时暂停安装。','校验无影响本次安装的问题，容量余量与挂载复验符合计划。')]),
  ],
  config:[
    screen('按页面顺序准备安装配置','公司 Config 页面',[
      '从本次交付清单选择产品能力、7.0 批次、dev/prod、存储方案和中间件类型。',
      '填当前集群的控制面、Worker 与依赖服务。S3 核对 endpoint、bucket、region；NFS 核对 export、访问权限和实际 StorageClass。',
      '生成安装包后，在获准的终端核对 config.ini、values.yaml 及适用的 Secret 文件。用当前包文档核对字段和节点列表分隔格式。',
    ],'版本与应用范围已选定 → 配置包生成 → 实际安装脚本字段复核',
    '配置包、脚本与本次环境一致。敏感文件留在受控目录，验收记录使用编号。',
    [error('提交失败 / 生成包配置与界面不一致','查页面校验提示及当前批次字段名，核对互斥开关、存储与节点列表。',
      '在正式配置源纠正后重新生成；比对包内最终值和适用范围。','下载新包能验证哈希，且实际脚本能按本批说明读取配置。')]),
  ],
  materials:[
    terminal('逐个比对离线介质的 SHA-256',material,'sha256sum -- {{archive}}',
      '0123456789abcdef…共 64 位十六进制…  ./approved-package.tar',
      '完整摘要必须逐字和交付方提供的 SHA-256 一致。短样例仅展示输出形状。',
      [error('No such file / Permission denied / 校验值不同','核对当前目录、文件名、权限及交付方公布的原始校验值。',
        '向物料负责人重新获取可信介质或校验记录。哈希不一致时暂停解包和安装。','对实际部署文件重算摘要，与批准记录完全一致。')]),
    terminal('只列包内容，核对安装脚本、镜像和 Chart',material,'tar -tf {{archive}}',
      'install.sh\nconfig.ini\ncharts/example/Chart.yaml\nimages/example.tar',
      '包结构以当前发行说明为准。清点该包里应有的安装脚本、Chart 和镜像；发现多个 Chart 时逐个登记。',
      [error('Unexpected EOF / This does not look like a tar archive','确认文件类型、分卷是否完整以及本批介质的解包方法。',
        '按当前包格式在获准的物料目录复核，必要时重新传输并核对哈希。','工具能完整列出条目，包类型和内容符合发布清单。')]),
  ],
  'install-k8s':[
    installDirectory('首个控制平面，Kubernetes 安装包解压目录','/data/example-kubernetes-release'),
    installCommand('在 Kubernetes 包目录执行安装脚本','首个控制平面，Kubernetes 安装包解压目录',
      'INSTALL_EXIT=0 是脚本层信号。按本批脚本提示核对各节点和任务，下一步还要检查 API、节点和系统 Pod。',installProblems,'newCluster'),
    screen('复用集群时采集现状基线','现有集群的运维终端与项目台账',[
      '复用时登记集群入口、context、节点清单、K8s 版本与管理归属。',
      '把已完成的变更与当前数据落点关联到证据编号，再前往集群验收。',
    ],'已对齐现有集群 → 获得本次可用的运维权限 → 转入集群验收',
    '新装或复用路线已确认，现有数据与工作负载范围清楚。',
    [error('现有集群归属或节点与文档不一致','从当前集群获取真实节点清单，请管理员确认。','补齐审批和基线后继续。','当前 context 与节点清单都有可复查记录。')]),
  ],
  'k8s-check':[
    context,
    terminal('检查 Kubernetes API 是否已经就绪',control,'kubectl get --raw=/readyz','ok',
      '通常返回 ok。它只验 API 的就绪状态；还需要查节点和系统组件。',
      [error('connection refused / timeout / no route','确认 context 和本次 API 地址。从执行机检查 DNS、路由、端口与控制面进程。',
        '区分访问链路故障和 API 服务未启动，按本次部署方式排查控制面和负载均衡。','同一执行点执行 /readyz，返回 ok。'),
        error('服务端返回未就绪','在授权范围内查询 /readyz?verbose，查看失败检查项。','按失败项定位 API 依赖或控制面异常；保留证据给集群管理员。','失败项消失，API 返回 ok。'),permissions]),
    nodeList(),
    terminal('核对集群核心组件与 Pod 状态',control,'kubectl get pods -A -o wide',
      'NAMESPACE    NAME                 READY   STATUS\nkube-system  coredns-example      1/1     Running\nkube-system  example-network-pod  1/1     Running',
      '按当前安装包检查控制面、CNI、CoreDNS、入口和 reloader 的预期对象。部分实现由系统进程承载，按实际拓扑验证。',
      [scheduleError,imageError,initError,probeError,permissions]),
    screen('从不同 Worker 验证 DNS、跨节点通信和仓库','客户批准的测试工作负载与执行终端',[
      '使用客户已经批准的测试镜像和测试工具，在计划使用的两个 Worker 验证 Pod 间通信和 Service DNS。',
      '从目标 Worker 验证本次仓库可拉取指定的测试镜像。任务完成后按现场方式清理临时测试资源。',
    ],'两端工作负载能通信 · Service 名可解析 · 目标节点拉取成功',
    '现象来自实际 Worker 和 Pod，且与网络规划一致。',
    [error('能 ping 节点，但 Service 失败','分别核对 Pod IP、Service 后端、CoreDNS 和 NetworkPolicy。','按实际断点交由网络或集群管理员修正。','从原执行端重跑同一探测，登记结果。'),authRegistry]),
  ],
  'em-install':[
    screen('准备 EM 的访问入口、kubeconfig 与持久化位置','首个控制平面和计划的 EM 数据节点',[
      '按 EM 包要求准备受控 kubeconfig。核对脚本读取的文件名与路径，确认配置只用于现场授权集群。',
      '对照 emChart/config.yaml 里的 IP、NodePort、storage.em，核对节点标签、实际目录和权限。',
      '如果使用本地卷，到计划的 EM 节点确认目录已建且挂载指向数据盘；用批准的 Namespace 和仓库 project。',
    ],'访问入口已确认 · kubeconfig 通过现场核对 · 本地卷目录、权限与节点标签一致',
    '安装机、仓库与数据落点均已按同一份实施单核验。',
    [error('NodePort 冲突 / 本地卷路径在另一台机器','对照既有 Service 端口和 PV 节点约束，检查真正的落点节点。','更改获批的 EM 配置并复核目标路径，已有数据卷按现状处理。','端口无冲突，目录、标签和目标节点一致。')]),
    installDirectory('首个控制平面，EasyManager 安装包解压目录','/data/example-em-release'),
    installCommand('在 EM 包目录执行安装脚本','首个控制平面，EasyManager 安装包解压目录',
      '按本批脚本菜单选择 EM 部署，确认仓库和 project。退出码为 0 后继续查 EM 的 Pod、PVC 和前端入口。',
      [...installProblems,authRegistry],'newManager'),
  ],
  'em-bind':[
    podList('emNs','检查 EM 所在 Namespace 的 Pod'),
    claimList('emNs'),
    terminal('从 Service 列表找到 EM 的实际入口',control,'kubectl -n {{emNs}} get svc -o wide',
      'NAME          TYPE       PORT(S)\nexample-em    NodePort   8080:30080/TCP',
      '对照安装配置识别 EM 前端 Service。示例中 30080 是节点外部访问端口，8080 是 Service 端口；现场按实际 IP、协议和端口访问。',
      [error('页面打不开 / 502 / 访问到产品门户','先确认访问的是 EM 入口。比较 Service 类型、端口、EndpointSlice 和前端 Pod，再从客户浏览器位置查网络。',
        '按失效环节调整获批入口、上游或网络策略。','客户侧登录页可访问，成功登录并进入集群列表。'),notFound,permissions]),
    serviceEndpoints('emNs'),
    podDetails('emNs'),
    podLogs('emNs'),
    claimDetails('emNs'),
    screen('在 EM 绑定集群并测试仓库',management,[
      '进入 集群 → 添加集群 → 绑定 Kubernetes 集群，确认目标集群及产品 Namespace。',
      '用客户批准的绑定用 kubeconfig，先点测试集群连接，再填获准仓库和项目路径，测试仓库连接。',
      '提交后刷新节点列表，和 kubectl 输出逐台对照。',
    ],'集群连接通过 · 镜像仓库测试通过 · 节点列表对应目标集群',
    '浏览器登录成功，EM 后端从自身位置可访问正确 API 与仓库，展示的节点对应本次环境。',
    [error('集群连接失败 / x509 / Unauthorized','区别安装机使用的配置与 EM 实际使用的配置，确认 API 地址从 EM Pod 可达、证书与权限有效。',
      '按批准方式校正 API 地址、CA 或权限；必要时请客户管理员代办。','EM 集群测试成功，并显示计划里的节点。'),authRegistry]),
  ],
  common:[
    terminal('先确认产品 Namespace',control,'kubectl get namespace {{ns}}',
      'NAME      STATUS   AGE\ndtstack   Active   2m',
      'Active 且名称与本次设置一致。新装第一次查不到可预期，复用查不到要核对 context。',
      [notFound,permissions]),
    terminal('检查公共配置是否已经存在',control,'kubectl -n {{ns}} get configmap common-config -o name',
      'configmap/common-config',
      '这个命令只核对对象存在。通过后仍需确认工作负载引用和实际应用配置；它不会显示配置值。',
      [notFound,permissions]),
    terminal('新装时创建产品 Namespace',control,'kubectl create namespace {{ns}}',
      'namespace/dtstack created','看到 created 后，返回上面的 get namespace，确认是目标集群且状态 Active。',
      [error('AlreadyExists','确认对象是否来自本次任务或已有项目。','核对目标集群和 Namespace 归属，按复用验收。','get namespace 返回目标对象，负责人已确认可复用。'),permissions],{change:true,mode:'newCluster'}),
    terminal('新装时从核对过的文件创建 common-config','已复核 common-config.yaml 的运维终端工作目录',
      'kubectl -n {{ns}} create configmap common-config --from-file=common-config.yaml',
      'configmap/common-config created',
      '创建成功后逐层核实声明、对象、容器实际引用和业务结果。先确认该文件是本次获批输入，适用的凭据按本项目 Secret 方案处理。',
      [error('AlreadyExists / no such file / Forbidden','确认是已有对象、当前目录或授权问题。',
        '已有对象走差异对比与正式配置变更。缺文件回获批部署包；无权限请管理员确认。','对象名与最终版本一致，至少一项受影响功能可验证。')],{change:true,mode:'newCluster'}),
  ],
  placement:[
    terminal('核对节点已有标签和当前角色',control,'kubectl get nodes --show-labels',
      'NAME       STATUS  LABELS\nworker-01  Ready   kubernetes.io/hostname=worker-01,example-role=storage',
      '从本次 Chart 渲染里找 nodeSelector、affinity 和 tolerations，再逐个与现有标签和值核对。样例标签只是示意。',
      [error('标签不存在 / 多台匹配 / 带污点节点未容忍','对照 Chart 选择条件和角色表，特别核对 GPU/普通节点及卷所在节点。',
        '由批准人员修改正式 Chart 或目标标签，不照抄历史项目的标签命令。','实际 Pod 到计划节点，卷源与业务目录匹配。'),permissions]),
    nodeList(),
  ],
  charts:[
    screen('在 EM 逐张核对已上传的 Chart',management,[
      '进入 应用 → Chart 包管理 → 上传 Chart 包，上传前核对本批包内的 Chart 清单。',
      '回列表按实际 Chart 名和版本逐个比对；子 Chart 或仅镜像项按物料说明处理。',
      '部署时再核对集群、产品 Namespace、release 和覆盖配置，记录这次任务编号。',
    ],'包内预期 Chart 齐全 · 镜像引用一致 · 发布任务指向目标 Namespace',
    '每个预期对象可对应到正确的 Chart、父 Chart 或仅镜像用途。',
    [error('包上传成功，但列表少了一张 Chart','比对 tar 列表、Chart.yaml 和 EM 列表，区分独立 Chart 与父子依赖。',
      '按物料结构补齐缺失的独立 Chart 或依赖，确认发布任务使用正确版本。','所有应部署的 Chart 均可选，实际资源按预期生成。'),authRegistry]),
    releaseStatus(),
  ],
};

export {error, terminal, screen, lessons, control, management, podList, podDetails, podLogs,
  claimList, claimDetails, releaseStatus, serviceEndpoints, imageError, scheduleError, initError,
  probeError, permissions, notFound, authRegistry, claimError};
