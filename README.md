# 星图 V3.3.8 · Java 服务器版

原功能保留，统一通过浏览器访问。运行只需要 **Java 17+**；独立 JAR 内已带全部页面与脱敏演示资料，不要求服务器安装 Node、数据库或 Kubernetes 工具。旧版目录不改动。

## 全部入口

| 地址 | 保留或新增的功能 |
|---|---|
| `/` | 统一入口，显示真实数据接入状态 |
| `/deployment` | **数栈 7.0 现场部署向导**，逐步验收、记录卡点、保存进度和导出交接清单 |
| `/workbench` | V3.2 项目档案、问题处理、判断作废、环境代次、四层字段验收、能力矩阵、旧状态比较；新增服务器加密备份与历史版本恢复 |
| `/criteria` | 原 K8s 版本：现场排障导航、**配置文件/Chart/物料目录质检**、形态判定、部署知识、Top10 判据、能力矩阵 |
| `/operations` | 原运维工作台：环境总览、快照差异、环境定界、日志链路与报告 |
| `/k8s` | **7.0 K8s 重点入口**：45 个组件的部署知识、脱敏对象演示、离线拓扑导入、服务器环境选择 |
| `/universe` | 原三维组件宇宙，从 6.3 知识图进入，可切换到完整的 7.0 页面 |
| `/confidential` | 原保密现场 L0/L1 固定选项引导；加载后不提交现场选择，无浏览器持久化 |
| `/map` | 原二维组件关系知识图 |

统一了入口、登录与 Java 服务，各模块的数据仍独立。配置质检在浏览器本地读取文件，不上传原文件。切换页面会离开当前项目的内存记录，**先保存再切换**。

## Windows 先看效果

1. 安装 Java 17 或以上；解压部署包。
2. 双击 `启动星图.cmd`，保持窗口运行。首次生成 `service.env`，已有配置不会覆盖。
3. 在浏览器打开 `http://127.0.0.1:22648/`。
4. 用记事本打开同目录 `service.env`，复制 `XT_ACCESS_TOKEN=` 后的值，在登录页输入。
5. 默认不连接真实环境。若要完整体验旧运维台的脱敏演示，将 `service.env` 的 `XT_LEGACY_MODE=disabled` 改为 `XT_LEGACY_MODE=demo`，关闭服务后重开。

访问密钥不写入 HTML、地址栏或浏览器存储，登录后使用 HttpOnly 会话 Cookie，有效期 8 小时。Java 进程重启后需重新登录。

## 出差部署怎么用

启动星图服务后打开首页。7.0 K8s 星图是首页主入口，「现场部署向导」和其他功能一起列在工作台，也可访问 `/deployment`。出差时可双击部署包里的 `数栈7.0部署向导.html` 使用离线版。

默认进入「部署陪跑」。逐个回答当前已有环境和存储方案，按当前卡片完成操作。对照反馈示例选「我看到正常反馈」，或从「我的结果不一样」进入对应的排查、处理、复验。完成本步所有条件后人工确认通过。浏览器记住当前动作与已选报错分支；命令参数只在当页使用。

复用路线跳过对应安装命令。若现场使用不同 Namespace 或物料网络，先点「完整步骤和设置」核对。完整界面提供全部 SOP、报错搜索、配置、进度导出和交接清单。现场问题分支参考 Hermes 会话记录，具体版本、入口、配置和变更范围按本次实施单确认。

### 先检查服务器

点「检查服务器」并复制命令，在客户许可的 Linux shell 中执行。命令使用系统现有的 sh 和只读工具，读 CPU、内存、根盘用量、`/data` 挂载点、Swap、tar 和时间同步信息。每台机器分别检查。也可以下载 `xt-preflight.sh` 后执行 `sh xt-preflight.sh`。

获准查询集群且已确认当前 kubectl context 时，勾选集群检查，或给脚本加 `--k8s`。它用当前现场终端的身份只查询 API 就绪状态和节点 Ready 数量，要求终端已有 kubectl 和 timeout。没有权限、工具或连通性时显示待核对。

按客户许可，把 `XT_PREFLIGHT_V1=` 开头的最后一行粘贴回向导，或保存为单行文本后选择该文件。报告只有有限状态、容量和数量，结果只在当前页面展示。命令和导入不改变部署验收进度，节点总数、落点和业务仍按项目方案核验。

### 跟着向导执行

1. 开始记录后按项目实际情况核对代号、Kubernetes/EM 安装方式、网络、存储方案和两个 Namespace。
2. 按左侧阶段推进，点「下一项操作」切换该步中的命令或页面操作。先核对执行位置，填写所需参数，再将命令复制到客户许可的终端。
   「正常反馈」给出示例和通过判据，「报错处置」给出检查点、处理办法和复验条件。安装命令在对应新装方案及前置验收通过后可见，核对执行目标后可复制。进度文件不包含命令参数。
3. SOP §7 的 31 个序号保持可查。Redis Operator、Kafka、Spark/Ray Operator、uniparse、仅镜像包等额外条目按本项目范围确认。SOP 版本示例、旧项目包名和节点角色以实际交付清单、Chart 和客户规划复核。
4. 把每步结果标为通过、卡住或不适用，记录现场证据编号。下一步会定位到最早未完成项。若重开已通过的步骤，后续已通过项需要复验。
5. 通过「保存进度文件」保留 JSON。在线页和离线文件分别使用自己的浏览器存储，可通过进度文件互相迁移。交接时导出 Markdown，汇总已验收步骤、卡点和不适用项。

向导内置经过整理的公司 SOP 步骤和 Hermes 现场案例摘要，附章节或行号。正式 SOP、当前交付包及批准的实施方案用于核对真实环境。进度文件含项目代号、Namespace 和证据编号，保存及携带按客户许可。凭据、原始日志、现场配置及 kubeconfig 在获准环境内处理。

通用命令判读参考 [Kubernetes API 健康检查](https://kubernetes.io/docs/reference/using-api/health-checks/)、[Pod 排障](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)、[持久卷](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)和 [Helm 发布状态](https://helm.sh/docs/helm/helm_status/)。向导里的终端输出均为教学示例。

### 部署前检查公司 YAML

在「现场部署向导」工具栏点击「配置体检 · YAML」，或在配置、EM、公共配置和 Chart 步骤点击「体检本步 YAML」。选择 UTF-8 的 `.yaml` 或 `.yml`，一次最多 8 份、每份最多 512 KiB。

- 体检根据实际结构识别 EM 配置、公共配置、Helm Values 和常见 Kubernetes 对象。可识别 ConfigMap 中作为 YAML 文件保存的内容。检查项显示文档、字段路径、行号、修改建议和复验办法。
- 明确示例域名、文档保留 IP、占位值及格式错误可直接指出。普通地址、默认卷路径和标签需要对照现场。展开「填写已确认的现场值」后，可按实际批准值对比 EM 入口、端口、路径、节点标签值和常见服务入口。
- 文件和现场比对值只在当前浏览器使用，原文件保持原样。结果省略凭据值和原文。未解析的变量、别名、合并键及自定义标签需要核对实际渲染文件。体检结论用于准备和复核，连通性及最终生效仍由现场验证。

YAML 解析器已随页面打包，使用 [yaml 2.9.1](https://github.com/eemeli/yaml/releases/tag/v2.9.1)。

## 7.0 K8s 怎么看

升级后关闭旧服务，再启动本目录的 `启动星图.cmd`，浏览器打开 `http://127.0.0.1:22648/k8s`，必要时按 Ctrl+F5。页面角落应显示 V3.3.7。

1. **知识图**：默认立即显示 45 个组件、88 项已录入的部署前置，不依赖 EM 或客户集群。左侧选组件，或点击星球，右侧查看包名、Chart、Service/端口契约、落点键、配置键、失效现象、来源章节与核验日期。资料过期会提示，不能当成当前集群事实。
2. **脱敏对象演示**：9 个工作负载、9 个 Pod、9 个 Service 的合成示例，展示 AIWorks 异常和 Pod 归属。演示有持续标识，不能保存进现场快照库。
3. **导入拓扑 JSON**：先校验格式、显示范围和对象数量，确认后只在当前页面查看。没有自动上传。离开或刷新前，决定是否按现场授权手动保存。
4. **保存当前快照到服务器**：再次列出共享字段，人工确认后才保存。所有持有服务器访问密钥的用户都能读取这些拓扑；它与项目的加密档案存储不同。未获授权时不要上传。
5. **选择服务器环境**：明确选择项目、集群、Namespace 三项，再读取该范围最近导入的一份快照。没有数据时保留清楚的空状态，不混入演示。

知识来自现有的“16 节点云化 K8s 多模态实测 Profile”，沿用原来源与核验时间，**本次没有重新验证客户现场**。组件、包、子 Chart、仅镜像项和部署步骤分别计数；45 个图节点不等于 45 步必装。内部 4 节点裁剪清单不与它合并。知识连线表示项目部署前置，不证明运行调用。

现场图按 Pod → ReplicaSet → Deployment 等 **owner UID** 归属，不按名称前缀猜测。Service 仅在完整 selector 与实际 Pod 标签匹配时连线，**不能证明 Endpoint、网络或业务成功**。无权限、未采集、被截断、0/0 和旧快照不会被当成绿色健康。点击 Pod 可看节点、Ready、首容器重启原因、镜像和 imageID；当前格式没有完整的多容器诊断、日志正文、容器文件或配置值。

### 获准导出的现场

随包 `collector/xt-topology` 需要 **Bash 4+、kubectl 和 date**；无 jq/python 依赖。由获授权人员手工执行，每次仅一个 Namespace：

```sh
bash collector/xt-topology --project=project-a --cluster=cluster-a --namespace=dtstack > topology.json
```

在 7.0 页面选择这个 JSON，预检后查看。Java 服务不会执行此命令，也不安装采集器、不请求客户提供 kubeconfig 或新增 RBAC。没有 kubectl 或不允许导出的现场继续使用知识图和 L0/L1 固定选项。

只读取工作负载、ReplicaSet、Pod、Service 的允许字段，不读取 Secret、ConfigMap 值、日志或 exec。输出紧凑单行 JSON，限制在 20KB 内，超出时截断并保留标记；每类最多 250 项，可能需要缩小现场范围重新采集。权限不足明确记录 forbidden/error。脚本对每次 kubectl 请求设置 12 秒超时，实际耗时取决于集群。不能上传脚本或传出文件时，此方式不可用，不要求突破现场规定。

新拓扑使用 `kind=xingtu-k8s-topology, version=1`；旧 `xt-blackbox` 的能力矩阵 JSON 不包含 Pod 归属，不能代替。接口 `POST /api/k8s/ingest`（最大 64KiB、最多 1000 份）、`GET /api/k8s/scopes`、`GET /api/k8s/latest?projectId=...&clusterId=...&namespace=...` 均需登录/访问密钥。保存时间决定“最近导入”，采集时间另行显示，不自动比较新旧现场事实。

## Linux 部署

先准备 Java 17+ 和 systemd，将部署包解压到任意安装源目录：

```sh
sudo sh deploy.sh
```

默认安装 `/opt/xingtu-v33`，配置 `/etc/xingtu-v33/service.env`，数据 `/opt/xingtu-v33/data`，服务 `xingtu-v33`。运行使用独立系统用户。不会安装 Java、调整防火墙、配置证书或连接客户集群。升级只替换 JAR，保留配置和数据。

```sh
systemctl status xingtu-v33
journalctl -u xingtu-v33 -n 50
curl http://127.0.0.1:22648/healthz
```

无 systemd 时在解压目录执行 `sh start.sh`，保持运行；配置与数据放在该目录。`service.env` 只由管理员维护，不给不可信来源修改。

## 局域网 / HTTPS

只想验证网络访问时可将 `XT_BIND=0.0.0.0`，重启后访问 `http://服务器IP:22648/`。**浏览器项目加密依赖安全上下文，服务器 IP 的普通 HTTP 无法使用加密备份。** 对外提供完整功能时使用 HTTPS：

1. Java 保持 `XT_BIND=127.0.0.1`。
2. 使用随包 `nginx.conf.example`，替换内部域名和证书路径。
3. 在 `service.env` 增加：

```text
XT_PUBLIC_ORIGIN=https://xingtu.example.internal
XT_COOKIE_SECURE=true
```

4. `systemctl restart xingtu-v33`，检查 Nginx 配置后重载，用配置中的 HTTPS 地址访问。需要使用受浏览器信任的证书。

密钥和 Cookie 不应通过不受信任网络上的明文 HTTP 传输。此版本采用共享访问密钥，获授权使用者拥有相同的查看/保存权限；**尚无个人账号、项目成员权限或 SSO**。不将它描述为完善的多人权限系统。审计只记动作与成功/失败，不含项目内容、访问密钥或查询原文。

## 项目加密备份

1. `/workbench` 新建获批准的 L2 项目，或点击“载入脱敏回放”。L1 不提供服务器上传按钮。
2. “加密备份到服务器”：设置项目保护口令。浏览器执行原 V3.2 的 PBKDF2-SHA256（210000 次）与 AES-GCM-256 加密，仅上传密文。
3. “打开服务器备份” → 读取列表 → 选择匿名编号与版本 → 在浏览器输入项目口令解密。
4. 每次保存新增不可变版本。多窗口同时修改会返回版本冲突，不覆盖服务器较新内容；先本机另存，再打开服务器版本核对。恢复旧版本后继续保存会创建另一份备份。

服务器只保留匿名随机编号、版本、保存时间和加密包；不接收解密口令、不解析项目字段、不验证证据真实性。所有共享密钥使用者都能读取密文和匿名备份列表，解密需要口令。不能从服务器备份找回遗失口令。每份最多 100 版、最多 200 份，达到限制请由管理员归档后使用新备份。升级后保留 `data` 即可续用。

原“保存加密项目”仍下载 `.xtproject` 到本机，**不会自动上传**；续接 TXT 是明文，外发前审阅。原版独立 HTML 离线方式也保留在 V3.2 目录。项目先存于当前页面内存，刷新、退出登录或跳转前手动保存。

## 旧功能的数据模式

`XT_LEGACY_MODE` 三选一：

- `disabled`（默认）：本地质检/导航/知识/档案可用。EM 实况与真实日志接口返回未配置，不伪装成功。
- `demo`：运维台、EM 三维实况读取原版脱敏快照，日志链路读取原版引擎产生的三个固定演示回放。保留实际回放时间，**不会冒充实时查询，不生成假采集记录**。选择 15/60/120 分钟不重新计算固定演示证据；真实时间窗查询仍属于原连接器功能。
- `upstream`：通过 Java 服务代理到管理员明确配置的原 EM 连接器（`XT_LEGACY_URL=http://127.0.0.1:8787`，不能附带路径/凭据）。保留原真实 EM 查询、快照保存和比较行为；凭据仍放原连接器的受保护配置。只转发列出的功能接口，不转发浏览器密钥/Cookie，不跟随重定向；错误不回退演示。

**迁移边界：** 统一服务、登录、离线证据接收、加密档案持久化均由 Java 实现。此前 Node 的数据库查询与评分引擎未重写成 Java；演示模式使用构建时离线结果，真实 EM 接入可选复用原连接器。纯 Java 部署可独立使用所有本地功能与演示，真实 EM 接入才需另行运行已有连接器。原连接器在本机曾有只读账号认证失败，未因此宣称现网已接通。真实 Loki/ES/SkyWalking 等适配器仍未实现。

## 证据接口兼容

保留 `POST /api/ingest`、`GET /api/scopes`、`GET /api/latest`，以及 `GET /api/snapshots?projectId=...&clusterId=...&namespace=...`。三项环境范围必须齐全。支持原 `Authorization: Bearer <访问密钥>` 与网页登录会话，严格校验 schemaVersion=2 和字段白名单，单份最大 64KiB，最多保存 5000 份。

`/api/snapshots` 不带项目范围时属于旧 EM 快照列表。保留两种协议，避免把 K8s 证据误传进 EM 页。Java 服务不接收 kubeconfig、不执行 kubectl，不读取 Pod 容器日志。

部署包附带原 V3.2 的 `collector/xt-blackbox` 和能力目录。它是按授权手工运行的外部只读采集器；不由 Java 服务安装或自动执行。允许导出的现场可生成 JSON 后，在 `/workbench` 能力矩阵页导入。无 kubectl 或不允许导出的现场继续使用固定选项，不能要求客户开放接口。

## 备份、恢复与升级

- 停止服务后备份整个 `data` 和受保护的 `service.env`，项目口令由使用者另外保管。
- `data/projects` 为加密项目版本，`data/snapshots` 为通过白名单的离线能力证据，`data/topology` 为 7.0 拓扑白名单快照（不是加密档案）。
- V3.1/V3.2 的 `data/snapshots` 可在停止服务后复制至 V3.3 的同名目录（保留旧副本）；这只迁移离线能力证据，不自动迁移项目记录或原 Node 快照目录。
- 原 Node 的 EM 快照仍由该连接器管理，Java 的 upstream 模式按原接口访问。
- 不随部署包分发自己的 `service.env`、运行时 data、客户原始对话或浏览器测试资料。

## 构建与验证

开发构建需要 Node.js 和 JDK 17 或以上。仓库内的 `legacy` 目录存放历史页面及构建所需素材。用 Docker 练习 Jenkins 和私仓接入，见 [Jenkins 部署练习](ci/README.md)。

```sh
npm ci --prefix deployment --ignore-scripts --no-audit --no-fund
npm ci --prefix legacy/immersive --ignore-scripts --no-audit --no-fund
node build.mjs
node --test test/server.test.mjs test/launcher.test.mjs test/topology.test.mjs test/yaml-review.test.mjs test/host-check.test.mjs test/companion-flow.test.mjs
node test/browser.test.mjs
```

构建生成 `dist/xingtu-server.jar` 与部署脚本。Java 服务器在本机实际启动验证；Linux systemd、Nginx HTTPS 和 Docker 配置需在目标服务器按上述步骤验收，不能将本机检查视为已在目标环境部署。Dockerfile 为可选模板，运行前须提供持久卷、访问密钥和 HTTPS 入口。
# V3.3.8 部署操作单与问星图

浏览器进入 `/deployment`，在当前步骤下展开「问星图」或「检查本次操作单」。提问仅发送简短问题及步骤标识，回答显示核验位置、正常反馈、异常分支与来源。使用者勾选本次发送许可后才会请求助手；关闭许可、离线文件或服务不可用时显示本地教学卡。

操作单校验读取独立的操作单、manifest.json、evidence.json。需允许将这三份文件交给当前星图服务器，服务校验后返回步骤概览。此入口校验导入内容，执行批准仍需绑定现场目标和服务端发布记录。接口使用当前共享访问密钥会话，适合现有单人工作流；组织账号和项目成员授权属于后续团队接入。

在安装包目录安装本地校验依赖：

```sh
python -m pip install -r deployment/requirements-contract.txt
```

可在 `service.env` 设置 `XT_CONTRACT_PYTHON` 为 Python 可执行文件绝对路径，`XT_CONTRACT_DIR` 为随包附带的 deployment 目录绝对路径。Java 通过固定参数调用本地校验器，校验数据经标准输入传递。

Hermes 需提供独立的问答实例。该实例的 API 工具集应全部关闭，并停用 MCP、私有文件及现场终端访问；模型服务及数据地域按客户许可配置。在 Hermes 配置中设置 `platform_toolsets.api_server: []`，启用有密钥的 API Server。先用其官方安装流程检查运行环境。

在星图的 `service.env` 中配置：

```ini
XT_HERMES_ENABLED=true
XT_HERMES_URL=http://127.0.0.1:8642
XT_HERMES_KEY_FILE=/approved/private/hermes-api-key.txt
XT_HERMES_CONSENT_UNTIL=2026-12-01T00:00:00Z
```

密钥文件只含 Hermes API 密钥，限制为星图运行账号可读。地址、文件路径和使用许可到期时间要替换成实际值。远程服务使用 HTTPS。每次转发前检查 `/v1/toolsets`，发现启用的工具集时拒绝提问，回到本地建议。助手请求还会携带构建时提炼的通用步骤知识；现场参数、导入文件及问答历史均不加入请求。

新增接口为 `GET/POST /api/deployment/ask` 和 `POST /api/deployment/validate`。均需登录，同源写入验证沿用现有服务。接口限制输入大小、请求并发与频率，工具检查和模型请求均有超时，审计只记录动作及状态。
