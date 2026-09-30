#!/usr/bin/env bash
# hosts/android/run-app-stack.sh —— ★★M5 路由虚拟栈真机跑（可复跑，含条件等待）
#
# 【与单测的分工】tests/app-stack.test.ts 证逻辑（Node/V8）；本脚本证**端上行为**（QuickJS）：
#   无层数上限（20000 层）/ 预算冻结有界 / 树保留 / 命令守恒 / 冻结后重建 / navigate diff。
#
# 【判据】hosts/android/check-app-stack.py（产物 app-stack.json；六组判据）
#
# 前置：① node hosts/android/bridge/build-batch.mjs（含 bundle-app-stack）
#      ② bash hosts/android/build-and-run.sh --no-install（把 bundle 拷进 assets 并打包）
#      ③ 设备已连接
# 用法：bash hosts/android/run-app-stack.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
BUNDLE="$HERE/bridge/dist/bundle-app-stack.js"
REPORT="/sdcard/Android/data/$PKG/files/app-stack.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
[ -f "$BUNDLE" ] || { echo "✗ 缺 bundle——先跑：node hosts/android/bridge/build-batch.mjs"; exit 2; }
# ★bundle 必须已进 APK（否则测的是旧包——本仓实测过"装到旧包排查一轮"）
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
if ! printf '%s' "$APK_LIST" | grep -q "assets/bundle-app-stack.js"; then
  echo "✗ APK 内无 assets/bundle-app-stack.js —— 需重新构建（build-and-run.sh 会把 bundle 拷进 assets）"
  exit 2
fi
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

EXEC_REPORT="/sdcard/Android/data/$PKG/files/app-stack-executor.json"

echo "==> ② 清旧报告 + 重启 + 等就绪 + 触发 app-stack"
# ★两份报告都清（场景 E 的异步报告；残留会让判据读上一轮——本仓已有此教训）
"$ADB" shell "rm -f $REPORT $EXEC_REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
# ★条件等待（替代原 `sleep 3`）：等 Activity 上报 "run-receiver-ready"（见 MainActivity.onCreate）
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh（${WAIT_SH}）——本脚本禁止盲等"; exit 2; }
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" \
  --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready（30s）——广播可能丢"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path app-stack -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（条件等待）"
bash "$WAIT_SH" --cmd "\"$ADB\" shell test -f $REPORT" --timeout 90 --interval 3 || true
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ 等执行器报告（异步；条件等待——动画由宿主帧循环推进）"
bash "$WAIT_SH" --cmd "\"$ADB\" shell test -f $EXEC_REPORT" --timeout 30 --interval 2 || true
if ! "$ADB" shell "test -f $EXEC_REPORT" >/dev/null 2>&1; then
  echo "  ⚠ 执行器报告未生成（${EXEC_REPORT}）—— 判据 ⑦ 组会如实判红"
fi

echo "==> ⑤ 取回报告（主报告 + 执行器报告）"
mkdir -p "$HERE/results"
rm -f "$HERE/results/app-stack.json" "$HERE/results/app-stack-executor.json"  # ★先删本地旧件（防 pull 失败读上轮）
"$ADB" pull "$REPORT" "$HERE/results/app-stack.json" >/dev/null 2>&1 || {
  echo "✗ adb pull 失败"; exit 1; }
"$ADB" pull "$EXEC_REPORT" "$HERE/results/app-stack-executor.json" >/dev/null 2>&1 || {
  echo "  ⚠ 执行器报告未取到"; }

echo "==> ⑥ 判据"
python3 "$HERE/check-app-stack.py" "$HERE/results/app-stack.json"
