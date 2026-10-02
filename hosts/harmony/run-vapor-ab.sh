#!/usr/bin/env bash
# hosts/harmony/run-vapor-ab.sh —— ★★★Vapor A/B 对照（鸿蒙腿；矩阵 #14 续）
#
# 【要证明什么（与 Android check-vapor-ab.py 同一份判据）】Vapor（编译产物）与 Vue 运行时
#   **同一台设备、同一份 SFC、同一个内核**上跑，逐节点比几何——回答"Vapor 跑出来的东西与
#   Vue 运行时是否等价"（"能替换 Vue 运行时"的量化证据）。
#
# 【零移植】JSVM 直接 eval 与 Android 同一份 bundle-vapor.js（含 `mode:'ab'` 入口），
#   宿主桥补 `updatePatches`（B 路所需）；判据共用 `hosts/android/check-vapor-ab.py`
#   （按 `host_id` 分档：④绘制通道/⑦事件路径属渲染层与手势批次，如实跳过）。
#
# 用法：bash hosts/harmony/run-vapor-ab.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/hosts/harmony"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
REPORT_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files/vapor-ab.json"
OUT="$HERE/results"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$OUT"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（$STATE）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE"

echo "==> ① 安装 + 清场 + 启动 A/B 场景"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $REPORT_DEV" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene vapor-ab" >/dev/null 2>&1 | head -1

echo "==> ② 等 A/B 报告落盘（条件等待 ≤120s——零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $REPORT_DEV'" --timeout 120 --interval 4; then
  echo "✗ 报告未出现（120s）" >&2
  HDC shell "hilog -x | grep -E 'VAPOR|cppcrash' | tail -8" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi
HDC file recv "$REPORT_DEV" "$OUT/vapor-ab.json" >/dev/null 2>&1
[ -s "$OUT/vapor-ab.json" ] || { echo "✗ 报告未取回"; exit 1; }

echo "==> ③ 判据（与 Android 共用 check-vapor-ab.py；按 host_id 分档）"
python3 "$ROOT/hosts/android/check-vapor-ab.py" "$OUT/vapor-ab.json"
