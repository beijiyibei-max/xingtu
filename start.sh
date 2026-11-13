#!/bin/sh
set -eu
HERE=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
cd "$HERE"
command -v java >/dev/null 2>&1 || { echo '请先安装 Java 17 或以上'; exit 2; }
if [ ! -f service.env ]; then java -jar xingtu-server.jar --init-config "$HERE"; fi
set -a
. "$HERE/service.env"
set +a
XT_DATA_DIR=${XT_DATA_DIR:-"$HERE/data"}
export XT_DATA_DIR
echo '访问密钥请查看本目录 service.env 中的 XT_ACCESS_TOKEN；默认地址 http://127.0.0.1:22648/'
exec java -Dfile.encoding=UTF-8 -jar xingtu-server.jar
