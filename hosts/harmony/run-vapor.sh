#!/usr/bin/env bash
# hosts/harmony/run-vapor.sh —— ★★★鸿蒙 Vapor 设备端链（矩阵 #14）：JSVM eval **同一份** bundle-vapor.js
#
# 【与 Android run-vapor.sh 的关系】**同一份判据**（`check-vapor-device.py`）、**同一份材料**
#   （`bundle-vapor.js` + `vapor-artifacts.json`——由 gen-fixtures.mjs 从 android 侧同源复制）：
#   唯一的差别是宿主：Android 走 QuickJS(JNI)、鸿蒙走 **JSVM(V8) C API**。
#
# 【链路（零移植）】rawfile bundle-vapor.js → C++ `vaporProbe`（JSVM 建 VM/Env + 注入
#   `globalThis.proteusHost` 四方法）→ `__proteusVaporRun`（设备端实例化 + 订阅驱动增量）
#   → 宿主 mount/applyOps（Rust 核）→ 报告落盘（沙箱 el2 映射路径，hdc 可读）。
#
# 【零盲等】探针跑完主动上报 `PROTEUS_VAPOR_DONE`——本脚本条件等待它（wait_for.sh）。
# 前置：bash hosts/harmony/build-host-app.sh（含 gen-fixtures 同源复制）
# 用法：bash hosts/harmony/run-vapor.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
# ★沙箱 el2 映射路径（hdc 可读；应用内 filesDir 的另一侧视图——实测 `数据文件` 实测验证）
REPORT_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files/vapor.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

echo "==> 0. 前置"
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in
  *Connected*) ;;
  *) echo "✗ 无设备/未授权（$STATE）"; exit 2 ;;
esac
echo "    hap=${HAP##*/}  设备=$STATE"

echo "==> 1. 安装 + 清场 + 删除旧报告"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $REPORT_DEV" >/dev/null 2>&1 || true

echo "==> 2. 启动（探针随页面 onAppear 自动跑）"
HDC shell "aa start -a EntryAbility -b $BUNDLE" 2>&1 | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }

echo "==> 3. 等主动上报 PROTEUS_VAPOR_DONE（条件等待 ≤90s——零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_VAPOR_DONE'" --timeout 90 --interval 3; then
  echo "✗ 90s 内未见 PROTEUS_VAPOR_DONE" >&2
  HDC shell "hilog -x | grep -E 'VAPOR|cppcrash' | tail -8" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi
DONE_LINE="$(HDC shell 'hilog -x | grep PROTEUS_VAPOR_DONE | tail -1' 2>/dev/null | head -1)"
echo "    $DONE_LINE"
case "$DONE_LINE" in
  *ok=1*) ;;
  *) echo "✗ 探针上报 ok=0（见上方日志）"; exit 1 ;;
esac

echo "==> 4. 取回报到"
HDC file recv "$REPORT_DEV" "$RESULTS/vapor.json" >/dev/null 2>&1
[ -s "$RESULTS/vapor.json" ] || { echo "✗ 报告未取回（$REPORT_DEV）"; exit 1; }

echo "==> 5. 判据（与 Android 共用 check-vapor-device.py；按 host_id 分档）"
python3 "$ROOT/hosts/android/check-vapor-device.py" "$RESULTS/vapor.json"
