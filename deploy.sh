#!/bin/sh
set -eu
HERE=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
APP=${APP:-/opt/xingtu-v33}
case "$APP" in /opt/xingtu-v33|/data/xingtu-v33) ;; *) echo 'APP 仅支持 /opt/xingtu-v33 或 /data/xingtu-v33'; exit 2 ;; esac
[ "$(id -u)" = 0 ] || { echo '安装 systemd 服务需要 root'; exit 2; }
JAVA=$(command -v java || true)
[ -n "$JAVA" ] || { echo '请先安装 Java 17 或以上'; exit 2; }
[ -f "$HERE/xingtu-server.jar" ] || { echo '缺少 xingtu-server.jar'; exit 2; }
command -v systemctl >/dev/null 2>&1 || { echo '此脚本需要 systemd；其他系统请使用 start.sh'; exit 2; }
id xingtu-v33 >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin xingtu-v33
mkdir -p "$APP/data" /etc/xingtu-v33
if [ ! -f /etc/xingtu-v33/service.env ]; then
  "$JAVA" -jar "$HERE/xingtu-server.jar" --init-config /etc/xingtu-v33
  printf 'XT_DATA_DIR=%s/data\n' "$APP" >> /etc/xingtu-v33/service.env
fi
chmod 600 /etc/xingtu-v33/service.env
cp "$HERE/xingtu-server.jar" "$APP/xingtu-server.jar"
chmod 644 "$APP/xingtu-server.jar"
chown xingtu-v33:xingtu-v33 "$APP/data"
chmod 700 "$APP/data"
cat > /etc/systemd/system/xingtu-v33.service <<UNIT
[Unit]
Description=Xingtu V3.3 Java delivery workbench
After=network.target
[Service]
Type=simple
User=xingtu-v33
Group=xingtu-v33
EnvironmentFile=/etc/xingtu-v33/service.env
WorkingDirectory=$APP
ExecStart=$JAVA -Dfile.encoding=UTF-8 -jar $APP/xingtu-server.jar
Restart=on-failure
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$APP/data
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable xingtu-v33 >/dev/null
systemctl restart xingtu-v33
sleep 2
systemctl is-active --quiet xingtu-v33 || { echo '服务未启动，请执行 journalctl -u xingtu-v33 -n 50'; exit 1; }
echo '已启动：http://127.0.0.1:22648/；密钥位于 /etc/xingtu-v33/service.env'
echo '默认真实数据未接入。配置 HTTPS 后再供多人访问，详见 README。升级保留 data 和已有 service.env。'
