# CentOS Stream 9 上用 Docker 练习 Jenkins 发布星图

练习目标是从 GitHub 私仓拉取星图，运行构建和测试，下载对应提交的发布产物，再手动更新测试实例。虚拟机当前地址为 `192.168.100.202`。

## 1. 设置私仓并推送初始提交

在 [xingtu 仓库设置](https://github.com/beijiyibei-max/xingtu/settings) 打开 **General → Danger Zone → Change repository visibility → Make private**，按页面提示确认。回到仓库主页看名称旁是否显示 **Private**。

本机的 `xingtu-github` 是准备好的独立源码目录。先查看提交内容，再用已登录的 GitHub 账号推送。

```powershell
cd C:\Users\Administrator\Desktop\xuexi\xingtu-github
git status
git log -1 --oneline
git ls-files
git push -u origin main
```

如果 GitHub CLI 登录过期，可在 Windows 上运行 `gh auth login -h github.com`，通过浏览器登录，然后执行 `gh auth setup-git` 并重试。GitHub 网页也可以完成仓库可见性设置。之后每次改动先建分支、提交、推送，合并到 `main` 后 Jenkins 拉取新版本。Jenkins 只持有本仓库的读取凭据。

## 2. 在虚拟机安装 Docker Engine

在 CentOS Stream 9 的 root 终端执行。已有 Docker 时，从版本检查和 `hello-world` 验证开始。

```bash
dnf install -y dnf-plugins-core
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version
docker compose version
docker run --rm hello-world
```

若 RPM 提示导入 Docker 签名密钥，和官方文档的指纹核对后确认。若此前装过原生 Jenkins，先用 `ss -lntp '( sport = :8080 )'` 确认端口是否在用。确认为本次练习安装的 Jenkins 后，可用 `systemctl stop jenkins` 让出 8080，原配置仍可供切换。 [Docker CentOS 安装文档](https://docs.docker.com/engine/install/centos/)

## 3. 启动 Jenkins 容器

用 Windows PowerShell 把本目录的两个文件传到虚拟机。示例采用 `root`，按实际 SSH 登录账号和目录替换。

```powershell
ssh root@192.168.100.202 "mkdir -p /opt/xingtu-ci"
scp C:\Users\Administrator\Desktop\xuexi\xingtu-github\ci\compose.yaml C:\Users\Administrator\Desktop\xuexi\xingtu-github\ci\Dockerfile.agent root@192.168.100.202:/opt/xingtu-ci/
```

在虚拟机中启动 Jenkins。

```bash
cd /opt/xingtu-ci
docker compose config --quiet
docker compose up -d jenkins
docker compose ps
docker compose logs --tail=50 jenkins
```

Jenkins 使用官方 LTS 镜像及持久卷。控制器只在虚拟机的 `127.0.0.1:8080` 上发布端口。另开 Windows PowerShell 并保持窗口打开。

```powershell
ssh -N -L 8080:127.0.0.1:8080 root@192.168.100.202
```

打开 [Jenkins 初始化](http://127.0.0.1:8080)，在虚拟机上用 `docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword` 取初始密码。选 **Install suggested plugins**，创建管理员。建议插件需包含 **Pipeline** 和 **Git**，可以在 **Manage Jenkins → Plugins** 检查。宿主机本地端口冲突时，用 `-L 18080:127.0.0.1:8080`，浏览器访问 18080。 [Jenkins Docker 安装指南](https://www.jenkins.io/doc/book/installing/docker/)

## 4. 连上构建容器

1. 在 **Manage Jenkins → Nodes → New Node** 建一个 **Permanent Agent**，名称和标签都填 `xingtu-build`。Executors 填 `1`，Remote root directory 填 `/home/jenkins/agent`，Launch method 选 **Launch agent by connecting it to the controller**。
2. 打开该节点页面，找到连接命令的 `-secret` 值。在虚拟机的 `/opt/xingtu-ci` 目录执行下面命令，按提示粘贴 Secret 并回车。

```bash
read -rsp 'Agent secret: ' JENKINS_AGENT_SECRET
printf '\n'
export JENKINS_AGENT_SECRET
docker compose --profile build up -d --build agent
unset JENKINS_AGENT_SECRET
docker compose --profile build ps
docker compose logs --tail=30 agent
```

3. 节点页面显示在线后，在控制器内置节点设置中把 executors 设为 `0`。构建由 Agent 执行，它通过容器网络向 Jenkins 建立 WebSocket，镜像带 JDK 21、Node.js、Python 和 Git。 [Jenkins Inbound Agent](https://github.com/jenkinsci/docker-agent/blob/master/README_inbound-agent.md) · [Jenkins Controller Isolation](https://www.jenkins.io/doc/book/security/controller-isolation/)

## 5. Jenkins 连接 GitHub 私仓

在虚拟机生成仅给 Jenkins 使用的密钥。已存在同名文件时换一个文件名。

```bash
ssh-keygen -t ed25519 -C 'jenkins-xingtu-readonly' -f /root/.ssh/jenkins-xingtu
cat /root/.ssh/jenkins-xingtu.pub
```

1. 在 GitHub 仓库的 **Settings → Deploy keys → Add deploy key** 粘贴公钥，保持 **Allow write access** 未勾选。
2. 在 Jenkins 的 **Manage Jenkins → Credentials → System → Global credentials → Add Credentials**，Kind 选 **SSH Username with private key**，Username 填 `git`，ID 填 `github-xingtu-read`。在网页的 Private Key 输入框填写私钥。密钥有口令时，同页填写口令。
3. 在 **Manage Jenkins → Security → Git Host Key Verification Configuration**，选 **Manually provided keys**，填入 GitHub 官方页面提供的 `github.com ssh-ed25519 ...` 公钥行。这一项验证 GitHub 服务器身份。
4. 在 Jenkins 选 **New Item → Pipeline**。Definition 选 **Pipeline script from SCM**，SCM 选 Git，Repository URL 填 `git@github.com:beijiyibei-max/xingtu.git`，Credentials 选 `github-xingtu-read`，Branch Specifier 填 `*/main`，Script Path 填 `Jenkinsfile`。保存后点 **Build Now**。

构建按 **Checkout → Build → Verify → Archive** 运行。成功后在构建页下载 `xingtu-server.jar`、`SHA256SUMS`、`commit.txt` 及配套文件。首跑成功后，Jenkinsfile 中的 `pollSCM` 会约每五分钟检查一次 `main` 的更新。

[GitHub Deploy Key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys#deploy-keys) · [GitHub SSH 主机公钥](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) · [Jenkins Git 主机密钥验证](https://plugins.jenkins.io/git-client/#plugin-content-ssh-host-key-verification) · [Jenkins Poll SCM](https://www.jenkins.io/doc/book/pipeline/syntax/#triggers)

## 6. 练习发布、升级和回滚

把 Jenkins 构建产物的 `dist` 目录内容上传到虚拟机的独立版本目录，包含 `compose.yaml`、`Dockerfile`、隐藏文件 `.dockerignore` 和 `deployment` 子目录。以下命令在该版本目录运行。Jenkins 的 Compose 文件位于 `/opt/xingtu-ci`，星图的 Compose 文件位于当前版本目录。

```bash
sha256sum -c SHA256SUMS
export XINGTU_IMAGE_TAG=$(cat commit.txt)
export XINGTU_SERVICE_ENV=/opt/xingtu-test/service.env
mkdir -p /opt/xingtu-test
chmod 700 /opt/xingtu-test
if [ ! -f "$XINGTU_SERVICE_ENV" ]; then
  (umask 077; printf 'XT_ACCESS_TOKEN=%s\n' "$(openssl rand -hex 24)" > "$XINGTU_SERVICE_ENV")
fi
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -fsS --retry 12 --retry-delay 2 --retry-connrefused http://127.0.0.1:22648/healthz
docker inspect --format '{{.Config.Image}}' "$(docker compose ps -q xingtu)"
```

看到 `ok=true`、版本正确且容器镜像标签与 `commit.txt` 一致后，可以通过 SSH 转发 22648，用浏览器做一次页面和操作单验收。首次运行时登录密钥在虚拟机的 `/opt/xingtu-test/service.env`。

升级前记录旧镜像的提交号并备份 `xingtu-test-data`。进入新版本目录，再执行上面的部署命令。Compose 使用固定项目名和数据卷，以新镜像替换服务。回滚时保留旧镜像并指定旧提交号。

```bash
export XINGTU_SERVICE_ENV=/opt/xingtu-test/service.env
export XINGTU_IMAGE_TAG=上一个成功部署的提交号
docker compose up -d --no-build --pull never
curl -fsS --retry 12 --retry-delay 2 --retry-connrefused http://127.0.0.1:22648/healthz
```

涉及数据格式迁移的版本，回滚前按对应说明恢复备份。 [Docker Compose 环境变量](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
