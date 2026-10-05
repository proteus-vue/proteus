#!/usr/bin/env bash
# hosts/android/run-superapp-launcher.sh —— ★★★批次 44（2026-10-05）：**桌面图标入口**验证（Android）
#
# 【要验证什么（用户目标「手机主屏图标点开 App 就能测完整体验」）】
#   ① 桌面图标（launcher intent-filter）指向 `.SuperappActivity`（不再是"运行 4050 测试"按钮页）
#   ② 点开 = superapp 真实应用启动：路由栈装配（screen.* 宿主真建树）→ 入口页真上屏 → 底部 Tab 栏
#   ③ `--drive`：用**真 MotionEvent** 逐个点 Tab（`root.dispatchTouchEvent` → 平台触摸栈）→ 重绘
#      ⇒ 证据落 `superapp-launcher.json`（判据读 `switch_log` + `state.current`）。
#
# 前置：① node hosts/android/bridge/build-batch.mjs（含 bundle-superapp）
#      ② bash hosts/android/build-and-run.sh --no-install（含 assets/app-screen-content.json）
#      ③ 设备已连接
# 用法：bash hosts/android/run-superapp-launcher.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
ACTIVITY="$PKG/.SuperappActivity"
APK="$HERE/build/proteus-layoutcore.apk"
REPORT="/sdcard/Android/data/$PKG/files/superapp-launcher.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 桌面图标归属自检（launcher intent 应指向 SuperappActivity）"
# 用 `cmd package resolve-activity` 解析 MAIN/LAUNCHER 意图 —— 证明"图标点开跑的是 superapp"
RESOLVED="$("$ADB" shell "cmd package resolve-activity --brief -c android.intent.category.LAUNCHER $PKG" 2>/dev/null | tail -1)"
echo "    launcher → $RESOLVED"
case "$RESOLVED" in
  *SuperappActivity*) echo "  ✓ 桌面图标指向 SuperappActivity（superapp 真实应用）" ;;
  *) echo "  ✗ 桌面图标未指向 SuperappActivity —— launcher 接线不对"; exit 1 ;;
esac

echo "==> ③ 清旧报告 + 重启 + 驱动切 tab"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" logcat -c >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
# ★--es drive 1：Activity 内用真 MotionEvent 逐个点 Tab
"$ADB" shell "am start -n $ACTIVITY --es drive 1" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q SUPERAPP_LAUNCHER_REPORT_READY" \
  --timeout 40 --interval 1 --max-interval 3 || echo "  ⚠ 未见 SUPERAPP_LAUNCHER_REPORT_READY（40s）"

echo "==> ④ 等报告（条件等待）"
bash "$WAIT_SH" --cmd "\"$ADB\" shell test -f $REPORT" --timeout 30 --interval 2 || true
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat -s proteus:I"
  "$ADB" logcat -d -s 'proteus:I' | tail -20 | sed 's/^/  /'
  exit 1
fi

echo "==> ⑤ 取回报告 + 断言"
mkdir -p "$HERE/results"
rm -f "$HERE/results/superapp-launcher.json"
"$ADB" pull "$REPORT" "$HERE/results/superapp-launcher.json" >/dev/null 2>&1 || { echo "✗ adb pull 失败"; exit 1; }
python3 - "$HERE/results/superapp-launcher.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ok = d.get('ok')
state = d.get('state', {})
log = d.get('switch_log', [])
print(f"    ok={ok} mode={d.get('mode')} rendered_page={state.get('current')}")
print(f"    tabs={state.get('tabs')}  boot depth={state.get('depth')}")
allok = True
for row in log:
    flag = '✓' if row.get('ok') else '✗'
    if not row.get('ok'): allok = False
    print(f"    {flag} tap={row.get('tap')} → current={row.get('current')}")
print(f"    host_stats={d.get('host_stats')}")
sys.exit(0 if (ok and allok) else 1)
PY
RC=$?
[ "$RC" = "0" ] && echo "  ✓ Android superapp 桌面入口验证通过" || { echo "  ✗ 断言失败"; exit "$RC"; }
