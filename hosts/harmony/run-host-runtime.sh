#!/usr/bin/env bash
# hosts/harmony/run-host-runtime.sh —— ★矩阵 #18：宿主运行时（G-39）鸿蒙腿
#
# 【与 Android/iOS 的关系】**同一份 bundle**（hosts/shared/bridge/entry-host-runtime.ts 的两端构建产物）、
#   **同一份判据**（check-host-runtime.py）。鸿蒙零移植：JSVM(V8) eval 同一份 IIFE。
#
# 【真生命周期驱动（C 组）】**真事件源 = Ability 生命周期**：
#   · `uinput -K -d 1 -u 1`（HOME 键，码 1）→ onBackground → JS `__proteusHostShellLifecycle('pause')`
#   · `aa start` 再次拉起 → onForeground → `('resume')`
#   ——与 Android 的 `input keyevent HOME` 同法（脚本驱动、可复现）。
#
# 【零盲等】每个阶段条件等待对应上报（wait_for.sh）。
# 用法：bash hosts/harmony/run-host-runtime.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
FILES_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（$STATE）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE"

echo "==> ① 安装 + 清场 + 启动"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $FILES_DEV/host-runtime.json $FILES_DEV/host-shell.json" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene bench" >/dev/null 2>&1 | head -1

echo "==> ② 等主报告（探针主动上报 ≤90s——零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_HOSTRT_DONE'" --timeout 90 --interval 3; then
  echo "✗ 90s 内未见 PROTEUS_HOSTRT_DONE" >&2
  HDC shell "hilog -x | grep -E 'HOSTRT|cppcrash' | tail -8" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ③ 真生命周期：HOME 键 → onBackground → pause 转发"
HDC shell 'uinput -K -d 1 -u 1' >/dev/null 2>&1
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q \"SHELL_EVENT pause\"'" --timeout 20 --interval 2 \
  || { echo "✗ pause 未转发（键码 1 不对？）" >&2; exit 1; }

echo "==> ④ 回前台 → onForeground → resume 转发"
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene bench" >/dev/null 2>&1
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q \"SHELL_EVENT resume\"'" --timeout 20 --interval 2 \
  || { echo "✗ resume 未转发" >&2; exit 1; }

echo "==> ⑤ 取回两份报告"
HDC file recv "$FILES_DEV/host-runtime.json" "$RESULTS/host-runtime.json" >/dev/null 2>&1
HDC file recv "$FILES_DEV/host-shell.json" "$RESULTS/host-shell.json" >/dev/null 2>&1
[ -s "$RESULTS/host-runtime.json" ] || { echo "✗ 主报告未取回"; exit 1; }
[ -s "$RESULTS/host-shell.json" ] || { echo "✗ 壳报告未取回"; exit 1; }

echo "==> ⑥ 判据（与 Android/iOS 共用 check-host-runtime.py；J/K 按能力面分档）"
python3 "$ROOT/hosts/android/check-host-runtime.py" "$RESULTS/host-runtime.json" "$RESULTS/host-shell.json"
