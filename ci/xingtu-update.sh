#!/usr/bin/env bash
# Existing single-VM Docker installation only; never installs Jenkins or Docker.
set -Eeuo pipefail
umask 077
APP=${XINGTU_HOME:-/opt/xingtu-test}
CI_COMPOSE=${XINGTU_CI_COMPOSE:-/opt/xingtu-ci/compose.yaml}
CONTAINER=xingtu-test-xingtu-1
ACTION=${1:-update}
die() { echo "错误：$*" >&2; exit 1; }
[[ $# -le 1 ]] || die '用法：xingtu-update.sh [构建号|status|rollback]'
[[ $(id -u) == 0 ]] || die '请在 xuexi 虚拟机以 root 执行。'
for tool in docker curl sha256sum sed grep sort head; do command -v "$tool" >/dev/null || die "缺少 $tool"; done
[[ -d "$APP" && -s "$APP/service.env" ]] || die "找不到已有安装及配置：$APP/service.env"
APP=$(cd "$APP" && pwd -P)
mkdir "$APP/.update-lock" 2>/dev/null || die "另一个升级正在执行；若上次被强制中断，请确认没有升级进程后移除 $APP/.update-lock 空目录。"
stopped=0
cleanup() {
  code=$?
  trap - EXIT
  if [[ $stopped == 1 ]]; then docker start "$CONTAINER" >/dev/null || echo '旧容器恢复启动失败，请检查容器日志。' >&2; fi
  rmdir "$APP/.update-lock"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
inspect() { docker inspect --format "$1" "$CONTAINER"; }
health() {
  local host=$1 port=$2 attempt response
  [[ $host != 0.0.0.0 ]] || host=127.0.0.1
  for attempt in {1..30}; do
    if response=$(curl -fsS --max-time 3 "http://$host:$port/healthz" 2>/dev/null) &&
      grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<< "$response"; then
      echo "$response"
      echo "访问地址：http://$host:$port/deployment"
      return 0
    fi
    sleep 2
  done
  return 1
}
if [[ $ACTION == rollback ]]; then
  [[ -s "$APP/last-backup.txt" ]] || die '没有本脚本创建的回退点。'
  BACKUP=$(cat "$APP/last-backup.txt")
  [[ $BACKUP == "$APP/backups/"* && -s "$BACKUP/rollback.yaml" ]] || die '回退点不存在或路径不正确。'
  docker compose -f "$BACKUP/rollback.yaml" config --quiet
  docker compose -f "$BACKUP/rollback.yaml" up -d --no-build --pull never
  health "$(cat "$BACKUP/bind-ip")" "$(cat "$BACKUP/bind-port")" || die '回退后健康检查失败，请查看 docker logs --tail=80 xingtu-test-xingtu-1'
  echo '已切回升级前镜像和运行配置；未覆盖数据。数据格式不兼容时需另行评估备份恢复。'
  exit 0
fi
[[ $ACTION == update || $ACTION == status || $ACTION =~ ^[1-9][0-9]*$ ]] || die '参数只能是构建号、status 或 rollback。'
[[ $(inspect '{{index .Config.Labels "com.docker.compose.project"}}') == xingtu-test ]] || die '目标容器不是星图测试实例。'
[[ $(inspect '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}') == xingtu-test-data ]] || die '数据卷与既有安装不符，已停止。'
BIND_IP=$(inspect '{{range (index .HostConfig.PortBindings "22648/tcp")}}{{.HostIp}}{{end}}')
BIND_PORT=$(inspect '{{range (index .HostConfig.PortBindings "22648/tcp")}}{{.HostPort}}{{end}}')
[[ $BIND_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && $BIND_PORT =~ ^[0-9]{1,5}$ ]] || die '此入口要求现有 IPv4 单端口映射。'
if [[ $ACTION == status ]]; then
  inspect '{{.Config.Image}}'
  health "$BIND_IP" "$BIND_PORT" || die '服务健康检查失败。'
  exit 0
fi
[[ -f "$CI_COMPOSE" ]] || die "找不到 Jenkins 配置 $CI_COMPOSE"
CONTROLLER=$(docker compose -f "$CI_COMPOSE" ps -q jenkins)
[[ -n $CONTROLLER ]] || die 'Jenkins 容器未运行。'
# Read only completed SUCCESS builds from this local controller; no API token needed.
BUILD=$(docker exec "$CONTROLLER" sh -c '
  base=/var/jenkins_home/jobs/xingtu-ci/builds
  for path in "$base"/*; do
    n=${path##*/}
    case "$n" in ""|*[!0-9]*) continue;; esac
    [ "$1" = update ] || [ "$n" = "$1" ] || continue
    [ -d "$path/archive/dist" ] || continue
    grep -q "<result>SUCCESS</result>" "$path/build.xml" || continue
    printf "%s\n" "$n"
  done
' sh "$ACTION" | sort -nr | head -n 1)
[[ $BUILD =~ ^[1-9][0-9]*$ ]] || die '未找到已成功完成且保留发布包的构建。'
echo "读取 Jenkins xingtu-ci #$BUILD 的成功产物……"
STAMP=$(date +%Y%m%d-%H%M%S)-$$
RELEASE="$APP/releases/jenkins-$BUILD-$STAMP"
mkdir -p "$RELEASE"
docker cp "$CONTROLLER:/var/jenkins_home/jobs/xingtu-ci/builds/$BUILD/archive/dist/." "$RELEASE/"
cd "$RELEASE"
for file in commit.txt SHA256SUMS xingtu-server.jar Dockerfile compose.yaml .dockerignore deployment/contract_v21.py deployment/contract_worker.py deployment/requirements-contract.txt deployment/deployment-contract-v2.1.schema.json; do
  [[ -s $file && ! -L $file ]] || die "发布包缺少有效文件：$file"
done
COMMIT=$(tr -d '\r\n' < commit.txt)
[[ $COMMIT =~ ^[a-f0-9]{40}$ ]] || die 'commit.txt 不是有效提交号。'
grep -Eq '^[a-f0-9]{64} [ *](\./)?xingtu-server\.jar$' SHA256SUMS || die '校验清单没有包含主程序。'
sha256sum -c SHA256SUMS || die '发布包校验失败；旧服务未改动。'
if [[ $(inspect '{{.Config.Image}}') == "xingtu-test:$COMMIT" ]]; then
  health "$BIND_IP" "$BIND_PORT" || die '当前已是此提交，但服务不健康，请检查日志。'
  echo '当前已经是这个提交，无需重复更新。'
  exit 0
fi
# Preserve the VM's working IP:port instead of restoring the archive's loopback default.
grep -q '"127.0.0.1:22648:22648"' compose.yaml || die '发布包端口模板已变化，需要复核升级入口。'
sed -i "s/127\.0\.0\.1:22648:22648/$BIND_IP:$BIND_PORT:22648/" compose.yaml
export XINGTU_IMAGE_TAG="$COMMIT"
export XINGTU_SERVICE_ENV="$APP/service.env"
docker compose -f "$RELEASE/compose.yaml" config --quiet
[[ $(docker compose -f "$RELEASE/compose.yaml" config --images) == "xingtu-test:$COMMIT" ]] || die '镜像配置不一致。'
echo '先构建新镜像；旧服务保持运行……'
docker compose -f "$RELEASE/compose.yaml" build xingtu
NEW_IMAGE=$(docker image inspect --format '{{.Id}}' "xingtu-test:$COMMIT")
BACKUP="$APP/backups/$STAMP"
mkdir -p "$BACKUP"
OLD_IMAGE=$(inspect '{{.Image}}')
docker tag "$OLD_IMAGE" "xingtu-test:rollback-$STAMP"
inspect '{{range .Config.Env}}{{println .}}{{end}}' > "$BACKUP/runtime.env"
# Compose raw mode preserves literal dollar signs, quotes and hash characters.
cp "$APP/service.env" "$BACKUP/service.env"
printf '%s\n' "$BIND_IP" > "$BACKUP/bind-ip"
printf '%s\n' "$BIND_PORT" > "$BACKUP/bind-port"
cat > "$BACKUP/rollback.yaml" <<EOF
name: xingtu-test
services:
  xingtu:
    image: xingtu-test:rollback-$STAMP
    ports:
      - "$BIND_IP:$BIND_PORT:22648"
    env_file:
      - path: "$BACKUP/runtime.env"
        format: raw
    volumes:
      - xingtu-data:/data
    restart: unless-stopped
volumes:
  xingtu-data:
    name: xingtu-test-data
EOF
docker compose -f "$BACKUP/rollback.yaml" config --quiet
echo '短暂停服备份项目数据……'
stopped=1
docker stop "$CONTAINER" >/dev/null
docker cp -a "$CONTAINER:/data" "$BACKUP/data"
printf '%s\n' "$BACKUP" > "$APP/last-backup.txt.tmp"
mv "$APP/last-backup.txt.tmp" "$APP/last-backup.txt"
echo "备份完成：$BACKUP"
stopped=0
echo '切换新版本……'
if docker compose -f "$RELEASE/compose.yaml" up -d --no-build --pull never &&
   [[ $(inspect '{{.Image}}') == "$NEW_IMAGE" ]] && health "$BIND_IP" "$BIND_PORT"; then
  echo "升级成功：Jenkins #$BUILD / $COMMIT"
else
  echo '更新未通过验收；数据备份已保留。' >&2
  echo '查看：docker logs --tail=80 xingtu-test-xingtu-1' >&2
  echo '回退：bash /opt/xingtu-ci/xingtu-update.sh rollback' >&2
  exit 1
fi
