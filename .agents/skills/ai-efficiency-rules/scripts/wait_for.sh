#!/usr/bin/env bash
# wait_for.sh —— 以条件探测替代固定 sleep
#
# 用法:
#   wait_for.sh --http <url> [--timeout 90] [--interval 1] [--max-interval 10] [--grep <pattern>]
#   wait_for.sh --file <path> [--timeout 60] [--stable]        # 文件存在（--stable: 大小稳定）
#   wait_for.sh --cmd  '<shell command>' [--timeout 60]        # 命令退出码为 0 即就绪
#   wait_for.sh --port <host:port> [--timeout 60]              # TCP 端口可连通
#
# 退出码: 0 就绪 / 1 超时 / 2 参数错误
# 禁止使用固定 sleep 作为同步手段，本脚本提供带退出条件与总超时的等待。

set -uo pipefail

TIMEOUT=90
INTERVAL=1
MAX_INTERVAL=10
MODE=""
TARGET=""
PATTERN=""
STABLE=0

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --http) MODE=http; TARGET=${2:?--http 需要 URL}; shift 2;;
    --file) MODE=file; TARGET=${2:?--file 需要路径}; shift 2;;
    --cmd)  MODE=cmd;  TARGET=${2:?--cmd 需要命令}; shift 2;;
    --port) MODE=port; TARGET=${2:?--port 需要 host:port}; shift 2;;
    --timeout) TIMEOUT=${2:?}; shift 2;;
    --interval) INTERVAL=${2:?}; shift 2;;
    --max-interval) MAX_INTERVAL=${2:?}; shift 2;;
    --grep) PATTERN=${2:?}; shift 2;;
    --stable) STABLE=1; shift;;
    -h|--help) usage;;
    *) echo "未知参数: $1" >&2; usage;;
  esac
done

[[ -n $MODE ]] || usage

check() {
  local out=""
  case $MODE in
    http)
      out=$(curl -fsS --connect-timeout 3 --max-time 8 "$TARGET" 2>/dev/null) || return 1
      if [[ -n $PATTERN ]]; then grep -qE -- "$PATTERN" <<<"$out" || return 1; fi
      ;;
    file)
      [[ -s $TARGET ]] || return 1
      if (( STABLE )); then
        local cur; cur=$(stat -c%s "$TARGET" 2>/dev/null || stat -f%z "$TARGET" 2>/dev/null || echo 0)
        [[ $cur -gt 0 && $cur -eq ${LAST_SIZE:--1} ]] || { LAST_SIZE=$cur; return 1; }
      fi
      ;;
    cmd)
      bash -c "$TARGET" >/dev/null 2>&1 || return 1
      ;;
    port)
      (exec 3<>"/dev/tcp/${TARGET%%:*}/${TARGET##*:}") 2>/dev/null || {
        # /dev/tcp 不可用时退回 nc
        command -v nc >/dev/null && nc -z "${TARGET%%:*}" "${TARGET##*:}" || return 1
      }
      ;;
  esac
  return 0
}

deadline=$(( SECONDS + TIMEOUT ))
delay=$INTERVAL
while true; do
  if check; then
    echo "READY: $MODE=$TARGET (waited ${SECONDS}s)"
    exit 0
  fi
  (( SECONDS >= deadline )) && {
    echo "TIMEOUT: $MODE=$TARGET not ready within ${TIMEOUT}s" >&2
    exit 1
  }
  sleep "$delay"
  delay=$(( delay * 2 > MAX_INTERVAL ? MAX_INTERVAL : delay * 2 ))
done
