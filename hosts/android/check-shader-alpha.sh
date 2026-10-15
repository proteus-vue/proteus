#!/usr/bin/env bash
# hosts/android/check-shader-alpha.sh —— ★★★决策 #983 可回归诊断：**RuntimeShader 返回的 alpha 是否生效**
#
# 背景：#966 曾断言"本设备忽略 RuntimeShader 返回的 alpha"并据此绕开 shader alpha；#983 三重探针证伪
#   （真因 = glass.wgsl 把 alpha 硬编 1.0）。本脚本把该探针做成**可复跑门禁**，防结论漂移。
#
# 判据：设备上跑 `GlassAlphaProbe`（离屏 HardwareRenderer 画 3 种 alpha 形态）⇒ 日志出现
#   `PROBE-PASS`（alpha=0 透出底 / alpha=0.5 半透 / 圆覆盖率生效 三者全对）。
#
# 用法：bash hosts/android/check-shader-alpha.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"

[ -f "$APK" ] || { echo "✗ 缺 APK（先 bash hosts/android/build-and-run.sh --no-install）"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

"$ADB" install -r -t "$APK" >/dev/null 2>&1
"$ADB" shell am force-stop "$PKG"
"$ADB" logcat -c
"$ADB" shell am start -n "$PKG/.SuperappActivity" --es screen glass-nav --es alphaprobe 1 >/dev/null 2>&1

bash "$HERE/../../.agents/skills/ai-efficiency-rules/scripts/wait_for.sh" \
  --cmd "\"$ADB\" logcat -d | grep -qE 'proteus-alphaprobe.*PROBE-(PASS|FAIL)'" \
  --timeout 20 --interval 1 >/dev/null 2>&1 || true

LINE="$("$ADB" logcat -d | grep -E 'proteus-alphaprobe.*PROBE-(PASS|FAIL)' | tail -1)"
echo "$LINE"
case "$LINE" in
  *PROBE-PASS*) echo "✅ RuntimeShader 返回的 alpha **生效**（#966「设备忽略 alpha」不成立 · #983）"; exit 0 ;;
  *PROBE-FAIL*) echo "✗ 探针判定 alpha 未按预期生效——请核对 GlassAlphaProbe 与设备"; exit 1 ;;
  *) echo "✗ 未取到探针结果（看 adb logcat -s proteus-alphaprobe）"; exit 1 ;;
esac
