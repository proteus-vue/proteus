#!/usr/bin/env bash
# hosts/android/run-superapp.sh —— ★★★批次 43：**真实 superapp 运行**（App 端，Android）
#
# 【与 run-app-stack.sh 的区别（用户 2026-10-05「不要装置级别了，要真实的独立应用了」）】
#   run-app-stack.sh 跑的是**验收场景**（压测栈 + 探针读数，跑完自报后退出）。
#   本脚本跑的是**真实应用启动路径**：读 bundle-superapp.js → 装配 App 导航（路由栈 + 宿主真建树）
#   → 进入入口 tab → 导航（switchTab/push/back）——产出 `superapp.json` 读数。
#
# 前置：① node hosts/android/bridge/build-batch.mjs（含 bundle-superapp）
#      ② bash hosts/android/build-and-run.sh --no-install（把 bundle 拷进 assets 并打包）
#      ③ 设备已连接
# 用法：bash hosts/android/run-superapp.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
REPORT="/sdcard/Android/data/$PKG/files/superapp.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
if ! printf '%s' "$APK_LIST" | grep -q "assets/bundle-superapp.js"; then
  echo "✗ APK 内无 assets/bundle-superapp.js —— 需重新构建（先 build-batch 再 build-and-run）"
  exit 2
fi
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

echo "==> ② 清旧报告 + 重启 + 等就绪 + 触发 superapp"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "monkey -p $PKG -c android.intent.category.LAUNCHER 1" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" \
  --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready（30s）——广播可能丢"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path superapp -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（条件等待）"
bash "$WAIT_SH" --cmd "\"$ADB\" shell test -f $REPORT" --timeout 60 --interval 2 || true
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ 取回报告"
mkdir -p "$HERE/results"
rm -f "$HERE/results/superapp.json"
"$ADB" pull "$REPORT" "$HERE/results/superapp.json" >/dev/null 2>&1 || { echo "✗ adb pull 失败"; exit 1; }
echo "  ✓ superapp.json："
python3 - "$HERE/results/superapp.json" <<'PY' 2>/dev/null || cat "$HERE/results/superapp.json"
import json, sys
d = json.load(open(sys.argv[1]))
print(f"    ok={d.get('ok')} boot_ok={d.get('boot_ok')} current_after_boot={d.get('current')}")
for k in ('boot_state', 'after_push_verify', 'after_switch_messages', 'after_back'):
    v = d.get(k)
    if isinstance(v, str):
        try: v = json.loads(v)
        except Exception: pass
    if isinstance(v, dict):
        print(f"    {k}: depth={v.get('depth')} current={v.get('current')} stack={v.get('stack')}")
print(f"    host_stats={d.get('host_stats')}")
PY
