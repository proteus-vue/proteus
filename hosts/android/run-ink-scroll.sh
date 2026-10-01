#!/usr/bin/env bash
# hosts/android/run-ink-scroll.sh —— ★★手卷浏览（宽卷横移）真机跑（含**进程内真实手势**）
#
# 【要证明什么】见 check-ink-scroll.py 头注（①~⑤）：画布 3.2 屏宽 · 手势真的驱动 ·
#   卷轴补偿抵消画布平移 · 画面真的随滚动变了（像素级）· 零逃生口。
# 【与其它 run-*.sh 的差别】本脚本**驱动真实横挥手势**（进程内 dispatchTouchEvent —
#   `adb shell input swipe` 在真机被 INJECT_EVENTS 权限拒，见 LightsHost 注释），
#   并用**条件等待**等宿主记账（不盲等）：
#   · app 侧自驱动：建树 → 采起点视觉签名 → 横挥 3 步 → 等惯性停稳 → 收尾出报告；
#   · 收尾靠**显式收尾**（`path=inkScrollFinalize`——滚动模式不按时间切幕，见 LightsHost）。
#
# 前置：① bash hosts/android/build-and-run.sh --no-install（构建 APK + bundle）
#      ② 设备已连接 · 屏幕点亮
# 用法：bash hosts/android/run-ink-scroll.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
REPORT="/sdcard/Android/data/$PKG/files/ink.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -x "$WAIT" ] || { echo "✗ 缺 wait_for.sh（${WAIT}）——本脚本禁止盲等"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 清旧产物 + 清 logcat + 启动 + 等就绪"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am force-stop dev.proteus.ink" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/.MainActivity" >/dev/null 2>&1
bash "$WAIT" --cmd "\"$ADB\" logcat -d -s proteus:I | grep -q 'run-receiver-ready'" \
  --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready"

echo "==> ② 触发手卷模式（宽卷横移）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path inkScroll -p $PKG" >/dev/null 2>&1
# 条件等待：节目建树日志（手卷已 mount + 节目单就绪）
bash "$WAIT" --cmd "\"$ADB\" logcat -d -s proteus:I | grep -q '节目已建树：inkScroll'" \
  --timeout 30 --interval 1 --max-interval 3 || { echo "✗ 手卷未建树（看 logcat）"; exit 1; }

echo "==> ③ ★等演出就绪 + 自驱动（手势 + 收尾都在**进程内**）"
# 【为什么不用 `adb shell input swipe`】Android 新版对 `input` 注入要求 INJECT_EVENTS 权限 ⇒
#   真机 SecurityException、**静默失败**（实测：手势一条都没到，scroll_min/max = -1）。
#   ⇒ 本仓先例（M6b 真手势滚动）：进程内 `dispatchTouchEvent` 注入真 MotionEvent——
#     走完整 GestureDetector → 生产通路链，且**不需要任何系统权限**。
#   app 侧时序（MainActivity 自驱动）：建树 → 等 2.5s → 采起点视觉签名 → 横挥 3 步
#   → **等惯性停稳**（条件等待 flingActive）→ 收尾出报告。
#   这里只需**条件等待报告**（它是自驱动的完成信号）。
echo "    （app 内自驱动：3 步横挥 + 抛滑停稳 ⇒ 收尾写报告）"

echo "==> ④ 等报告（自驱动完成信号——条件等待，零盲等）"
bash "$WAIT" --cmd "\"$ADB\" shell test -f $REPORT" --timeout 90 --interval 2 --max-interval 5 \
  || { echo "✗ 报告未生成（${REPORT}）—— 看 logcat：adb logcat -d -s proteus:I | tail -30"; exit 1; }

echo "==> ⑤ 取回报告 + 判据"
mkdir -p "$HERE/results"
rm -f "$HERE/results/ink-scroll.json"
"$ADB" pull "$REPORT" "$HERE/results/ink-scroll.json" >/dev/null 2>&1 || { echo "✗ pull 失败"; exit 1; }
python3 "$HERE/check-ink-scroll.py" "$HERE/results/ink-scroll.json"
