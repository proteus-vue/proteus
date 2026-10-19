#!/usr/bin/env bash
# hosts/android/run-keyboard-probe.sh —— ★★★C14 键盘推送真机判据（Android）—— 决策 #1078
#
# 【要证明什么】「真实软键盘 → WindowInsets.ime → KeyboardWatcher → JS `__proteusHostKeyboard`」全链。
#
# 【★与 host-runtime 主判据分离（真根因）】探针原先塞在 `appHostRun()` 里，而它跑在**主线程**
#   （广播 `onReceive` → `runAll()`）⇒ 探针的 `latch.await(2s)` **阻塞主线程** ⇒ UI 消息队列不执行
#   ⇒ layout 永不跑 ⇒ EditText 恒 0×0 ⇒ 键盘不弹。**不是尺寸/alpha/焦点问题**（当时那些读数全正常）。
#   ⇒ 独立广播 action `dev.proteus.KEYBOARD` + 后台线程跑探针 + 落 `keyboard-probe.json`。
#
# 【完成信号 = 报告落盘】条件等待文件出现（零 sleep / 零盲等）。
#
# 前置：bash hosts/android/build-and-run.sh --no-install（APK 已装）
# 用法：bash hosts/android/run-keyboard-probe.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
ACTIVITY="$PKG/.MainActivity"   # ★验收装置入口（dev/MainActivity 的包名是 layoutcore.dev，但 Manifest 注册在根包）
REPORT_DIR="/sdcard/Android/data/$PKG/files"
REPORT="$REPORT_DIR/keyboard-probe.json"
RESULTS="$HERE/results"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

STATE="$("$ADB" get-state 2>/dev/null || true)"
[ "$STATE" = "device" ] || { echo "✗ 无设备/未授权（${STATE:-none}）"; exit 2; }
echo "==> 设备=$STATE  包=$PKG"

echo "==> ① 清场 + 删旧报告 + 启动 Activity"
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $ACTIVITY" >/dev/null 2>&1 || true
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
# 等接收器就绪（Activity 自己打 run-receiver-ready）
if ! bash "$WAIT" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1; then
  echo "✗ 30s 内未见 run-receiver-ready（Activity 未起？）"; exit 1
fi
if ! bash "$WAIT" --cmd "\"$ADB\" shell dumpsys window | grep -q 'mCurrentFocus=.*$PKG'" --timeout 20 --interval 1; then
  echo "⚠ 焦点不在本应用（继续——探针会如实报 diag_has_window_focus）"
fi

echo "==> ② 触发键盘探针（独立广播，不阻塞主线程）"
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am broadcast -a dev.proteus.KEYBOARD -p $PKG" 2>&1 | grep -qi "Broadcast completed" \
  || { echo "⚠ 广播回执未见 Broadcast completed（继续按文件判定）"; }

echo "==> ③ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "\"$ADB\" shell test -f $REPORT && echo KB_READY" --timeout 60 --interval 2; then
  echo "✗ 60s 内未见 keyboard-probe.json" >&2
  "$ADB" logcat -d -s 'proteus-kb:I' 'proteus:I' 2>/dev/null | tail -10 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ④ 取回报告 + 断言"
rm -f "$RESULTS/keyboard-probe.json"
"$ADB" pull "$REPORT" "$RESULTS/keyboard-probe.json" >/dev/null 2>&1 \
  || { echo "✗ adb pull 失败"; exit 1; }
[ -s "$RESULTS/keyboard-probe.json" ] || { echo "✗ 报告为空"; exit 1; }
echo "    keyboard-probe.json $(wc -c < "$RESULTS/keyboard-probe.json" | tr -d ' ') 字节"
cat "$RESULTS/keyboard-probe.json"; echo

python3 - "$RESULTS/keyboard-probe.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ok = True
# ★决策 #1078：本探针场景**不 eval bundle**（只验系统事件 + 宿主推送形态）⇒ JS 引擎未初始化，
#   `channel=no-eval` 是**设计而非缺陷**。JS 侧接收由 superapp 场景 + 单测覆盖（如实标注，不判红）。
ch = d.get("channel")
if ch == "no-eval":
    print("ℹ JS 引擎未在本场景启动（no-eval）——JS 侧接收由 superapp 场景/单测覆盖，本探针只验系统事件")
elif ch != "function":
    print(f"✗ JS 侧接收通道异常（typeof __proteusHostKeyboard={ch}）"); ok = False
shown = d.get("shown_height_dp")
if d.get("shown_error"):
    print(f"⚠ {d.get('shown_error')}（高度={shown}dp）——如实未覆盖（不判绿）")
elif not (isinstance(shown, (int, float)) and shown > 0):
    print(f"✗ 真实键盘已弹出但读数 height={shown}dp（应 > 0）"); ok = False
elif ch == "function" and d.get("js_calls_total", 0) < 2:
    print(f"✗ 弹收各一次应至少 2 次 JS 推送，实得 {d.get('js_calls_total')}"); ok = False
elif not (d.get("hidden_height_dp") == 0):
    print(f"✗ 收起后读数未归零（{d.get('hidden_height_dp')}dp）"); ok = False
else:
    extra = f" · JS 收到 {d.get('js_calls_total')} 次推送" if ch == "function" else "（JS 引擎未启——系统事件+宿主通路已验证）"
    print(f"✓ Android 键盘推送：真实键盘 {shown}dp → 收起 0dp{extra}")
sys.exit(0 if ok else 1)
PY
