#!/usr/bin/env bash
# hosts/android/run-vapor-ab.sh —— ★★★Vapor **长列表虚拟化**真机跑（1000 行 · 物化有界 · 回顶恒等）
#
# 【要证明什么】见 `check-vapor-ab.py` 头注（判据六项：产物/实例化、物化有界、滚动真动、回顶恒等、增量有界、复用池在动）。
# 【与 run-vapor.sh 的差别】那条跑**短列表**（8 行：实例化 + 订阅驱动增量）；
#   本脚本跑**长列表**（1000 行）：整树进内核（几何正确）而宿主**只物化可见区**，
#   30 帧下滚 + 30 帧上滚（回顶签名应恒等）。
#
# 前置：① bash hosts/android/build-and-run.sh --no-install（构建 APK + bundle + 产物）
#      ② 设备已连接 · 屏幕点亮
# 用法：bash hosts/android/run-vapor-ab.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
REPORT="/sdcard/Android/data/$PKG/files/vapor-ab.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -x "$WAIT" ] || { echo "✗ 缺 wait_for.sh（${WAIT}）——本脚本禁止盲等"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 清旧产物 + 清 logcat + 启动 + 等就绪"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/.MainActivity" >/dev/null 2>&1
bash "$WAIT" --cmd "\"$ADB\" logcat -d -s proteus:I | grep -q 'run-receiver-ready'" \
  --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready"

echo "==> ② 触发 vaporAb 通路（1000 行虚拟化）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path vaporAb -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（完成信号——条件等待，零盲等）"
bash "$WAIT" --cmd "\"$ADB\" shell test -f $REPORT" --timeout 120 --interval 2 --max-interval 5 \
  || { echo "✗ 报告未生成（${REPORT}）—— 看 logcat：adb logcat -d -s proteus:I | tail -30"; exit 1; }

echo "==> ④ 取回报告 + 判据"
mkdir -p "$HERE/results"
rm -f "$HERE/results/vapor-ab.json"
"$ADB" pull "$REPORT" "$HERE/results/vapor-ab.json" >/dev/null 2>&1 || { echo "✗ pull 失败"; exit 1; }
python3 "$HERE/check-vapor-ab.py" "$HERE/results/vapor-ab.json"
