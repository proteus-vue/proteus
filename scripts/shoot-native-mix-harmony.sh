#!/usr/bin/env bash
# scripts/shoot-native-mix-harmony.sh —— ★矩阵 #10：原生组件混用（ArkUI 原生组件 + Proteus 自绘共存）
#
# 【要证明什么（与 Android check「native-host-verify.py 三件事」同族）】
#   ① **位置由 Rust 核心决定**：ArkUI 原生组件的 bounds == 核心 `nodeRect` 读出的几何
#      （×密度 + 页面 Stack 的状态栏偏移——偏移量可复算，见 Index.ets 的 NATIVE_MIX_Y_COMP 注释）
#   ② **原生组件真的在渲染**：截图在目标区取到原生色（不是空白/透明）
#   ③ **z-order 实测**：与原生组件**重叠**的自绘色块——屏幕上显示哪个（鸿蒙：ArkUI 原生在上）
#
# 【零盲等】场景就绪由页面主动上报 `PROTEUS_NATIVEMIX_READY`（wait_for 条件等待）。
# 用法：bash scripts/shoot-native-mix-harmony.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HERE="$ROOT/hosts/harmony"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
OUT="${PROTEUS_MIX_OUT:-$HERE/results}"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$OUT"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（$STATE）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE"

echo "==> ① 安装 + 清日志 + 启动原生混用场景"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true
# ★清旧产物 + 清日志（否则 wait_for 会命中**上一次会话**的 READY——实测踩过两次）
HDC shell "rm -f /data/local/tmp/mix-layout.json /data/local/tmp/native-mix.png" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene native-mix" >/dev/null 2>&1 | head -1
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_NATIVEMIX_READY'" --timeout 60 --interval 3 \
  || { echo "✗ 场景未就绪"; exit 1; }
SETUP_LINE="$(HDC shell 'hilog -x | grep PROTEUS_NATIVEMIX_SETUP | tail -1' 2>/dev/null | head -1)"
echo "    $SETUP_LINE"

echo "==> ② 取原生组件真实 bounds（dumpLayout——与核心几何对账）"
HDC shell 'uitest dumpLayout -p /data/local/tmp/mix-layout.json' >/dev/null 2>&1
HDC file recv /data/local/tmp/mix-layout.json "$OUT/native-mix-layout.json" >/dev/null 2>&1
[ -s "$OUT/native-mix-layout.json" ] || { echo "✗ layout 未取回"; exit 1; }

echo "==> ③ 截图（z-order 与渲染证据）"
HDC shell 'uitest screenCap -p /data/local/tmp/native-mix.png' >/dev/null 2>&1
HDC file recv /data/local/tmp/native-mix.png "$OUT/native-mix.png" >/dev/null 2>&1
[ -s "$OUT/native-mix.png" ] || { echo "✗ 截图未取回"; exit 1; }

echo "==> ④ 判据（三件事——与 Android native-host 同族）"
node "$ROOT/scripts/check-native-mix-harmony.mjs" "$OUT/native-mix-layout.json" "$OUT/native-mix.png"
