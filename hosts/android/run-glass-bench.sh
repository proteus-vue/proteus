#!/usr/bin/env bash
# hosts/android/run-glass-bench.sh —— ★★★安卓玻璃**性能基线**（决策 #861）
#
# 【做什么】启动 `GlassActivity --ez bench true`：**程序化滚动 120 帧** + `Choreographer` 采**真实 vsync
#   间隔**（frameTimeNanos 差，非"花了多久画一帧"）⇒ 上报**实际交付帧率** / 平均·最大帧间隔 / 掉帧数 /
#   onDraw 成本均值。与鸿蒙 glass-bench 同口径（真 vsync 间隔 framediff）。
#
# 【为什么这样测（口径）】`delivered_fps` = (N-12) / (末帧-首帧) 秒，**跳前 12 帧预热**（首帧含初始化）；
#   `dropped` = 帧间隔 > 1.5× vsync 预算（跳过 ≥1 个 vsync）。锚在 Choreographer 的真实 vsync 时刻上，
#   不是 app 自报的绘制耗时 —— 后者会**高估**帧率。
#
# 前置：① 设备已连（adb devices）② 已装包（先跑 `bash hosts/android/build-and-run.sh`）
# 用法：bash hosts/android/run-glass-bench.sh [--runs 3]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
ACT="$PKG/.GlassActivity"
RUNS=3
while [ $# -gt 0 ]; do case "$1" in --runs) RUNS="$2"; shift 2 ;; *) echo "未知参数：$1"; exit 2 ;; esac; done

WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

STATE="$("$ADB" devices | grep -w device | head -1)"
[ -n "$STATE" ] || { echo "✗ 无设备——先 adb devices"; exit 2; }
echo "==> 设备：$STATE"

MODE="$("$ADB" shell dumpsys display 2>/dev/null | grep -oE 'mActiveModeId=[0-9]+' | head -1)"
echo "==> 显示模式: $MODE (120Hz 需 activeModeId 指向 fps=120 的 mode)"

# ★完成门：grep 放**本地侧**（管道退出码来自本地 grep——`adb shell` 的远端退出码经管道不可靠）
wait_done() { bash "$WAIT_SH" --cmd "$ADB logcat -d -s ProteusGlassBench | grep -q PROTEUS_ANDROID_GLASS_BENCH" --timeout 30 --interval 2 >/dev/null 2>&1; }

for i in $(seq 1 "$RUNS"); do
  "$ADB" shell am force-stop "$PKG" >/dev/null 2>&1
  "$ADB" logcat -c
  "$ADB" shell "am start -n $ACT --ez bench true" >/dev/null 2>&1
  wait_done || { echo "run$i: ✗ 超时未见上报"; continue; }
  echo "run$i: $("$ADB" logcat -d -s ProteusGlassBench | grep PROTEUS_ANDROID_GLASS_BENCH | tail -1 | sed 's/.*GLASS_BENCH //')"
done
echo "==> 判据：delivered_fps 应接近屏幕刷新率；dropped=0 = 零掉帧（满帧）"
