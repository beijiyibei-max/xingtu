#!/bin/sh
# 星图只读预检。标准输出仅包含枚举、容量和计数，不包含原始命令输出。
LC_ALL=C
export LC_ALL

number() {
  case "$1" in
    ''|*[!0-9]*) printf 'null' ;;
    *)
      n=$1
      while [ "${n#0}" != "$n" ]; do n=${n#0}; done
      if [ "${#n}" -le 9 ]; then printf '%s' "${n:-0}"; else printf 'null'; fi
      ;;
  esac
}

has() { command -v "$1" >/dev/null 2>&1; }
available() { if has "$1"; then printf 'true'; else printf 'false'; fi; }

case "$(uname -m 2>/dev/null)" in
  x86_64|amd64) arch=x86_64 ;;
  aarch64|arm64) arch=aarch64 ;;
  '') arch=unknown ;;
  *) arch=other ;;
esac
cpu=$(number "$(getconf _NPROCESSORS_ONLN 2>/dev/null)")
memory=$(number "$(awk '/^MemTotal:/ {printf "%d", $2/1024; exit}' /proc/meminfo 2>/dev/null)")
root_used=$(number "$(df -Pk / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')")
swap=unknown
if [ -r /proc/swaps ]; then
  swap=$(awk 'NR>1 {count++} END {if (NR==0) print "unknown"; else if (count) print "on"; else print "off"}' /proc/swaps 2>/dev/null)
fi
case "$swap" in on|off) ;; *) swap=unknown ;; esac

data_mount=unknown
if [ ! -d /data ]; then
  data_mount=missing
elif [ -r /proc/self/mountinfo ]; then
  data_mount=$(awk '$5=="/data" {seen=1} END {if (seen) print "mounted"; else print "not-mounted"}' /proc/self/mountinfo 2>/dev/null)
fi
case "$data_mount" in missing|mounted|not-mounted) ;; *) data_mount=unknown ;; esac

sync=unknown
if has timeout && has timedatectl; then
  case "$(timeout 3 timedatectl show -p NTPSynchronized --value 2>/dev/null)" in
    yes) sync=yes ;;
    no) sync=no ;;
  esac
fi

kube=not-run
ready=null
total=null
if [ "${1-}" = '--k8s' ]; then
  if ! has kubectl; then
    kube=no-tool
  elif ! has timeout; then
    kube=unavailable
  elif [ "$(timeout 7 kubectl --request-timeout=4s get --raw=/readyz 2>/dev/null)" = ok ]; then
    kube=api-ready
    if states=$(timeout 7 kubectl --request-timeout=4s get nodes --no-headers -o 'custom-columns=READY:.status.conditions[?(@.type=="Ready")].status' 2>/dev/null); then
      counts=$(printf '%s\n' "$states" | awk '$1=="True" {r++} NF {t++} END {printf "%d %d", r, t}')
      ready=$(number "${counts%% *}")
      total=$(number "${counts##* }")
    fi
  else
    kube=unavailable
  fi
fi

printf 'XT_PREFLIGHT_V1={"arch":"%s","cpu":%s,"memoryMiB":%s,"rootUsed":%s,"swap":"%s","dataMount":"%s","sync":"%s","tar":%s,"kube":"%s","ready":%s,"total":%s}\n' \
  "$arch" "$cpu" "$memory" "$root_used" "$swap" "$data_mount" "$sync" "$(available tar)" "$kube" "$ready" "$total"
