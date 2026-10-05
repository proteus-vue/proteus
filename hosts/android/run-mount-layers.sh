#!/usr/bin/env bash
# hosts/android/run-mount-layers.sh —— ★★★GP3-c 三层挂载（自绘端）真机跑（可复跑 · 条件等待）
#
# 【验什么】对照任务卡 GP3-c 验收：
#   ① 不申请敏感权限即用（manifest 零 uses-permission）
#   ② 层容器真建 + **树序 = 层序**（内核无 z-order ⇒ 树序是真源）
#   ③ ★已知缺口如实记账（destroy 后 global 层随屏销毁——当前树模型下）
#
# 【为什么 GP3-c 是"宿主编译 + 静态判据"为主、真机为辅】
#   三层容器是**宿主在建屏树时按契约建的静态结构**（不是运行期行为）⇒
#   零设备编译检查（check:android-host-compile）+ 契约单测已覆盖绝大部分；
#   真机这一跑证明的是"端上真建出来了 + 内核真的按树序排"。
#
# 前置：① bash hosts/android/build-and-run.sh --no-install（编译 + 打包）
#      ② 设备已连接
# 用法：bash hosts/android/run-mount-layers.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
REPORT="/sdcard/Android/data/$PKG/files/mount-layers.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 安装"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> ② 清旧报告 + 重启 + 等就绪 + 触发 mount-layers"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/.MainActivity" >/dev/null 2>&1
# ★条件等待（替代 sleep）：等 Activity 上报 run-receiver-ready
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh（${WAIT_SH}）——本脚本禁止盲等"; exit 2; }
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" \
  --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready（30s）——广播可能丢"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path mount-layers -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（条件等待）"
bash "$WAIT_SH" --cmd "\"$ADB\" shell test -f $REPORT" --timeout 60 --interval 2 || true
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ 取回报告（先删本地旧件，防 pull 失败读上轮）"
mkdir -p "$HERE/results"
rm -f "$HERE/results/mount-layers.json"
"$ADB" pull "$REPORT" "$HERE/results/mount-layers.json" >/dev/null 2>&1 || { echo "✗ adb pull 失败"; exit 1; }

echo "==> ⑤ 判据"
python3 "$HERE/check-mount-layers.py" "$HERE/results/mount-layers.json"
