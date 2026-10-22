#!/usr/bin/env bash
# hosts/harmony/run-keyboard-probe.sh —— ★★★C14 键盘推送真机判据（鸿蒙）—— 决策 #1077
#
# 【要证明什么】「真实系统键盘 → `window.on('keyboardHeightChange')` → `--pf-keyboard-height`」全链。
#   ★诚实边界（一次性 VM，决策 #540）：鸿蒙 superapp 每次渲染新建 VM、跑完即销毁 ⇒ 键盘事件到达时
#   **没有存活的 JS 环境**。本探针证明的是「系统真的发 keyboardHeightChange」+「env 真的更新」；
#   JS 侧的接收（`__proteusHostKeyboard`）由"C++ 在下次渲染的 VM 内注入"覆盖（单测 + 注入路径）。
#
# 【完成信号 = 报告落盘】App 侧 `superapp-keyboard` 场景落 `<filesDir>/keyboard-probe.json`；
#   本脚本条件等待文件出现（零 sleep / 零盲等）。
#
# 前置：bash hosts/harmony/build-host-app.sh（含签名）
# 用法：bash hosts/harmony/run-keyboard-probe.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }

BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
FILES_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files"
REPORT_DEV="$FILES_DEV/keyboard-probe.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE"

echo "==> ① 安装 + 清场 + 删旧报告"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "rm -f $REPORT_DEV" >/dev/null 2>&1 || true
if HDC shell "test -f $REPORT_DEV && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉（${REPORT_DEV}）——等待信号会命中陈旧文件，拒绝继续"; exit 1
fi

echo "==> ② 启动（scene=superapp-keyboard）"
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-keyboard" 2>&1 \
  | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }

echo "==> ③ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $REPORT_DEV && echo PROTEUS_KEYBOARD_PROBE_READY' | grep -q PROTEUS_KEYBOARD_PROBE_READY" --timeout 60 --interval 2; then
  echo "✗ 60s 内未见 keyboard-probe.json" >&2
  HDC shell "hilog -x | grep -E 'KEYBOARD|keyboard' | tail -10" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ④ 取回报告 + 断言"
rm -f "$RESULTS/keyboard-probe.json"
HDC file recv "$REPORT_DEV" "$RESULTS/keyboard-probe.json" >/dev/null 2>&1 \
  || { echo "✗ file recv 失败"; exit 1; }
[ -s "$RESULTS/keyboard-probe.json" ] || { echo "✗ 报告为空"; exit 1; }
echo "    keyboard-probe.json $(wc -c < "$RESULTS/keyboard-probe.json" | tr -d ' ') 字节"
cat "$RESULTS/keyboard-probe.json"; echo

python3 - "$RESULTS/keyboard-probe.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ok = True
if d.get("watch_installed") is not True:
    print("✗ keyboardHeightChange 监听未装"); ok = False
shown = d.get("shown_height_vp")
if not (isinstance(shown, (int, float)) and shown > 0):
    print(f"✗ 真实键盘已弹出但读数 height={shown}vp（应 > 0）：{d.get('shown_error') or ''}"); ok = False
envv = d.get("env_keyboard")
if not (isinstance(envv, (int, float)) and envv > 0):
    print(f"✗ --pf-keyboard-height 未同步（{envv}）——env 通路断了"); ok = False
if d.get("hidden_ok") is not True:
    print(f"✗ 收起后读数未归零（{d.get('hidden_height_vp')}vp）"); ok = False
if ok:
    print(f"✓ 鸿蒙键盘推送：真实键盘 {shown}vp → env={envv} → 收起 {d.get('hidden_height_vp')}vp")
    print("  ★诚实边界：一次性 VM ⇒ JS 侧接收由渲染时注入覆盖（本探针证明系统事件 + env 通路）")
sys.exit(0 if ok else 1)
PY
