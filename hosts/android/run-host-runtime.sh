#!/usr/bin/env bash
# hosts/android/run-host-runtime.sh —— ★★G-39 宿主运行时真机跑（含**真实系统事件驱动**）
#
# 【要证明什么】见 hosts/android/check-host-runtime.py 头注（A~K 组判据）。
# 【与其它 run-*.sh 的关键差别】本脚本**主动驱动真实系统事件**，验证"壳把系统事件交给 runtime"：
#   · ④ 应用级系统事件（用户「保险点儿」）：
#       memory-warning ← `am send-trim-memory`（真 ComponentCallbacks2.onTrimMemory）
#       theme-change   ← `cmd uimode night yes`（真 onConfigurationChanged → uiMode）
#       resize         ← `wm user-rotation lock N`（真旋转 → screenWidthDp 变化）
#     ★每个都给"条件等待"（logcat ASCII 标记 `push-ok <evt>`——Java 侧只在**推入 JS 后**打印）
#   · ⑤ 真实 Activity 生命周期（pause→resume，`am start` 重入前台）
#   · ⑥ 真未捕获异常（`dev.proteus.CRASH` → 后台线程抛 → 全局钩子 → JS 回执 → **进程真死**）；
#     证据在**死前**由 Java 侧落盘为 host-app-events.json（K 组三链对齐的唯一证据源）。
#
# 【★为什么音频事件没驱动】BECOMING_NOISY / HEADSET_PLUG 是**保护广播**——adb shell 注入
#   被系统拒绝（SecurityException，本机实测）⇒ K 组按"接收器已注册"验（诚实标注，不假装）。
#
# 前置：① bash hosts/android/build-and-run.sh --no-install（构建 APK + bundle 入 assets）
#      ② 设备已连接
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
REPORT_DIR="/sdcard/Android/data/$PKG/files"
REPORT="$REPORT_DIR/host-runtime.json"
SHELL_REPORT="$REPORT_DIR/host-shell.json"
EVIDENCE="$REPORT_DIR/host-app-events.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
[ -f "$BUNDLE" ] || { echo "✗ 缺 bundle——先跑：node hosts/android/bridge/build-batch.mjs"; exit 2; }
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
if ! printf '%s' "$APK_LIST" | grep -q "assets/bundle-host-runtime.js"; then
  echo "✗ APK 内无 assets/bundle-host-runtime.js —— 需重新构建"
  exit 2
fi
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
# ★wait_for.sh 是「有条件等待」的唯一原语（check-no-blind-wait 门禁）——**没有盲等回退**
[ -x "$WAIT" ] || { echo "✗ 缺 wait_for.sh（${WAIT}）——本脚本禁止盲等，须用条件等待"; exit 2; }
# 条件等待：文件存在（adb shell test -f）
wait_file() {
  local f="$1" t="${2:-90}"
  bash "$WAIT" --cmd "\"$ADB\" shell test -f $f" --timeout "$t" --interval 2 --max-interval 5
}
# 条件等待：logcat 出现标记（可指定 tag；默认 lifecycle——`attempt`/`push-ok` 见 HostLifecycleEvents）
wait_log() {
  local pat="$1" t="${2:-20}" tag="${3:-proteus-lifecycle}"
  bash "$WAIT" --cmd "\"$ADB\" logcat -d -s '$tag:I' | grep -q -- \"$pat\"" \
    --timeout "$t" --interval 1 --max-interval 3
}

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 清旧产物 + 清 logcat + 重启 + 等就绪 + 触发 host-runtime"
"$ADB" shell "rm -f $REPORT $SHELL_REPORT $EVIDENCE" >/dev/null 2>&1 || true
# ★logcat 必须清：wait_log 是"缓冲区里出现过该标记即就绪"，不清会把上一轮的标记当成本轮证据
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $ACTIVITY" >/dev/null 2>&1
# ★条件等待（替代原 `sleep 3`）：等 Activity 自己上报 "run-receiver-ready"（广播接收器已注册）
wait_log "run-receiver-ready" 30 proteus || echo "  ⚠ 未见 run-receiver-ready（30s）——广播可能丢，判据会如实红"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path host-runtime -p $PKG" >/dev/null 2>&1

echo "==> ③ 等主报告（条件等待）"
wait_file "$REPORT" 90 || true
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ ★驱动真实系统事件（真回调 → 壳推送 → 总线；每步条件等待 push-ok 标记）"
PID="$("$ADB" shell pidof -s $PKG 2>/dev/null | tr -d '\r')"
if [ -z "$PID" ]; then
  echo "  ⚠ 取不到 PID（应用已退出？）——驱动将失败，K 组判据会如实判红"
else
  echo "    · memory-warning ← am send-trim-memory $PID RUNNING_LOW"
  "$ADB" shell "am send-trim-memory $PID RUNNING_LOW" >/dev/null 2>&1 || true
  wait_log "push-ok memory-warning" 15 || echo "      ⚠ 未见 push-ok memory-warning（判据会红）"

  echo "    · theme-change ← cmd uimode night no → yes（两步：保证必然发生一次真实变化，且终态=dark）"
  # ★为什么要两步：设备当前生效主题未知（auto 可能解析成 dark）——只发一次 yes 可能**无变化** ⇒
  #   无配置回调 ⇒ 判据红。先 no（强制 light）再 yes（强制 dark）：无论如何至少一次变化，
  #   且**最后一次一定是 dark**（判据对 lastPayload.theme=='dark' 做内容断言）。
  "$ADB" shell "cmd uimode night no" >/dev/null 2>&1 || true
  wait_log "push-ok theme-change" 12 || true
  "$ADB" shell "cmd uimode night yes" >/dev/null 2>&1 || true
  wait_log "push-ok theme-change" 12 || echo "      ⚠ 未见 push-ok theme-change（判据会红）"

  # ★旋转：先试 lock 0；若当前已是 0（无变化）再锁 1——两次覆盖"当前任意方向都能产生一次变化"
  echo "    · resize ← wm user-rotation lock 0（必要时再 lock 1）"
  "$ADB" shell "wm user-rotation lock 0" >/dev/null 2>&1 || true
  if ! wait_log "push-ok resize" 8; then
    "$ADB" shell "wm user-rotation lock 1" >/dev/null 2>&1 || true
    wait_log "push-ok resize" 15 || echo "      ⚠ 未见 push-ok resize（判据会红）"
  fi
fi

echo "==> ⑤ ★触发**真实 Activity 生命周期**（暂停 → 恢复）"
# 【★真机实测的两条形态（首版脚本踩过，记录下来防复发）】
#   ① `input keyevent KEYCODE_HOME` **不生效**（Android 新版对 input 注入要求 INJECT_EVENTS 权限
#      ——本仓 M3 已在点击场景踩过同一坑，这里又踩一次 ⇒ 别再用 input 驱动本装置）。
#   ② `am start -n <本 Activity>` 会触发一对真实的 **pause→resume**（重新启动回到前台），
#      日志实证：`G-39 壳转发 pause → JS 侧（次数 1）` 紧接 `resume（次数 2）`。
#   ⇒ 用 ②：它触发的是**系统生命周期回调**（不是脚本里直接调 rt.suspend()），证据力等同。
"$ADB" shell "am start -n $ACTIVITY" >/dev/null 2>&1 || true
wait_file "$SHELL_REPORT" 45 || true   # onPause 后应写出壳转发报告（含 pause+resume 两条）
if ! "$ADB" shell "test -f $SHELL_REPORT" >/dev/null 2>&1; then
  # 兜底：某些 ROM 的 am start 到已在前台的 Activity 是 no-op ⇒ 先 HOME 回桌面再启动。
  # ★条件等待替代盲等：等 HOME 真生效（Activity 进入 stopped——`mResumedActivity` 不再是本包）
  "$ADB" shell "input keyevent KEYCODE_HOME" >/dev/null 2>&1 || true
  bash "$WAIT" --cmd "\"$ADB\" shell dumpsys activity activities | grep -q \"ResumedActivity\" \
    && ! \"$ADB\" shell dumpsys activity activities | grep \"ResumedActivity\" | grep -q \"$PKG\"" \
    --timeout 10 --interval 1 || true
  "$ADB" shell "am start -n $ACTIVITY" >/dev/null 2>&1 || true
  wait_file "$SHELL_REPORT" 30 || true
fi

echo "==> ⑥ ★触发真未捕获异常（K 证据：error 链；进程将真的崩溃）"
# 【为什么不用 `am crash`】它是 native 信号（SIGSEGV），**不经过 Java 未捕获钩子**——
#   而 App.onError 对应的正是 Java 钩子。本动作抛真 Java 异常 → 真钩子 → JS 回执 → 证据落盘。
"$ADB" shell "am broadcast -a dev.proteus.CRASH -p $PKG" >/dev/null 2>&1 || true
wait_file "$EVIDENCE" 20 || true
if ! "$ADB" shell "test -f $EVIDENCE" >/dev/null 2>&1; then
  echo "  ⚠ 证据文件未落盘（${EVIDENCE}）—— K 组判据会如实判红（不静默）"
fi

echo "==> ⑦ 还原设备设置（主题/旋转——★在崩溃之后：进程已死，不会再产生回调污染证据）"
"$ADB" shell "cmd uimode night auto" >/dev/null 2>&1 || true
"$ADB" shell "wm user-rotation free" >/dev/null 2>&1 || true

echo "==> ⑧ 取回报告（主报告 + 壳转发 + K 证据）"
mkdir -p "$HERE/results"
# ★先删**本地**旧产物：若本轮 pull 失败，本地残留会让判据读上一轮的文件（假绿）
rm -f "$HERE/results/host-runtime.json" "$HERE/results/host-shell.json" "$HERE/results/host-app-events.json"
"$ADB" pull "$REPORT" "$HERE/results/host-runtime.json" >/dev/null 2>&1 || { echo "✗ pull 主报告失败"; exit 1; }
"$ADB" pull "$SHELL_REPORT" "$HERE/results/host-shell.json" >/dev/null 2>&1 || {
  echo "⚠ 壳转发报告未取到（${SHELL_REPORT}）—— 判据会据此判红（生命周期未被壳转发）"; }
"$ADB" pull "$EVIDENCE" "$HERE/results/host-app-events.json" >/dev/null 2>&1 || {
  echo "⚠ K 证据未取到（${EVIDENCE}）—— 判据会据此判红（应用事件源未被真驱动）"; }

echo "==> ⑨ 判据"
python3 "$HERE/check-host-runtime.py" "$HERE/results/host-runtime.json" "$HERE/results/host-shell.json"
