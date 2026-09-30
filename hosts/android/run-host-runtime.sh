#!/usr/bin/env bash
# hosts/android/run-host-runtime.sh —— ★★G-39 宿主运行时真机跑（含**真实 Activity 生命周期转发**）
#
# 【要证明什么】见 hosts/android/check-host-runtime.py 头注（六组判据）。
# 【与其它 run-*.sh 的关键差别】本脚本**主动触发真实 onPause/onResume**
#   （HOME 键 → 回前台），验证"壳把系统生命周期交给 runtime"（G-39 动机第一条），
#   而不是只在 JS 里手动调 rt.suspend()（那只证明状态机）。
#
# 前置：① node hosts/android/bridge/build-batch.mjs（含 bundle-host-runtime）
#      ② bash hosts/android/build-and-run.sh --no-install（把 bundle 拷进 assets 并打包）
#      ③ 设备已连接
# 用法：bash hosts/android/run-host-runtime.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
ACTIVITY="$PKG/.MainActivity"
APK="$HERE/build/proteus-layoutcore.apk"
BUNDLE="$HERE/bridge/dist/bundle-host-runtime.js"
REPORT="/sdcard/Android/data/$PKG/files/host-runtime.json"
SHELL_REPORT="/sdcard/Android/data/$PKG/files/host-shell.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
[ -f "$BUNDLE" ] || { echo "✗ 缺 bundle——先跑：node hosts/android/bridge/build-batch.mjs"; exit 2; }
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
if ! printf '%s' "$APK_LIST" | grep -q "assets/bundle-host-runtime.js"; then
  echo "✗ APK 内无 assets/bundle-host-runtime.js —— 需重新构建"
  exit 2
fi
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 清旧报告 + 重启 + 触发 host-runtime"
"$ADB" shell "rm -f $REPORT $SHELL_REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
sleep 3
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path host-runtime -p $PKG" >/dev/null 2>&1

echo "==> ③ 等主报告（条件等待）"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
wait_file() {
  local f="$1" t="${2:-90}"
  if [ -x "$WAIT" ]; then
    bash "$WAIT" --cmd "$ADB shell \"test -f $f\"" --timeout "$t" --interval 3 || true
  else
    for _ in $(seq 1 30); do "$ADB" shell "test -f $f" >/dev/null 2>&1 && break; sleep 3; done
  fi
}
wait_file "$REPORT" 90
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ ★触发**真实 Activity 生命周期**（暂停 → 恢复）"
# 【★真机实测的两条形态（首版脚本踩过，记录下来防复发）】
#   ① `input keyevent KEYCODE_HOME` **不生效**（Android 新版对 input 注入要求 INJECT_EVENTS 权限
#      ——本仓 M3 已在点击场景踩过同一坑，这里又踩一次 ⇒ 别再用 input 驱动本装置）。
#   ② `am start -n <本 Activity>` 会触发一对真实的 **pause→resume**（重新启动回到前台），
#      日志实证：`G-39 壳转发 pause → JS 侧（次数 1）` 紧接 `resume（次数 2）`。
#   ⇒ 用 ②：它触发的是**系统生命周期回调**（不是脚本里直接调 rt.suspend()），证据力等同。
"$ADB" shell "am start -n $ACTIVITY" >/dev/null 2>&1 || true
wait_file "$SHELL_REPORT" 45   # onPause 后应写出壳转发报告（含 pause+resume 两条）
if ! "$ADB" shell "test -f $SHELL_REPORT" >/dev/null 2>&1; then
  # 兜底：某些 ROM 的 am start 到已在前台的 Activity 是 no-op ⇒ 先 HOME 回桌面再启动。
  # （HOME 键在部分 ROM 无效 ⇒ 用 monkey 触发 launcher 也失败时给出明确提示，不静默）
  "$ADB" shell "input keyevent KEYCODE_HOME" >/dev/null 2>&1 || true
  sleep 1
  "$ADB" shell "am start -n $ACTIVITY" >/dev/null 2>&1 || true
  wait_file "$SHELL_REPORT" 30
fi

echo "==> ⑤ 取回报告"
mkdir -p "$HERE/results"
"$ADB" pull "$REPORT" "$HERE/results/host-runtime.json" >/dev/null 2>&1 || { echo "✗ pull 主报告失败"; exit 1; }
"$ADB" pull "$SHELL_REPORT" "$HERE/results/host-shell.json" >/dev/null 2>&1 || {
  echo "⚠ 壳转发报告未取到（${SHELL_REPORT}）—— 判据会据此判红（生命周期未被壳转发）"; }

echo "==> ⑥ 判据"
python3 "$HERE/check-host-runtime.py" "$HERE/results/host-runtime.json" "$HERE/results/host-shell.json"
