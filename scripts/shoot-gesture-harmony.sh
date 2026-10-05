#!/usr/bin/env bash
# scripts/shoot-gesture-harmony.sh —— ★矩阵 #7：鸿蒙手势采集（真注入 → 样本 → 中立识别器分类）
#
# 【链路】uitest uiInput（**系统输入栈真注入**）→ ArkTS `.onTouch`（真触摸链，含真时间戳）
#   → 样本落盘 JSONL（含每段 down 点的核心 hitTest 结果）→ `classify-gesture-harmony.mjs`
#   （喂 `packages/gesture` 三端中立识别器）→ 判据 8 条。
#
# 【零盲等】每步条件等待（wait_for.sh）：场景就绪 / 样本出现。
# 用法：bash scripts/shoot-gesture-harmony.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HERE="$ROOT/hosts/harmony"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
SAMPLES_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files/touch-samples.jsonl"
OUT="$HERE/results"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$OUT"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE"

echo "==> ① 安装 + 清旧样本 + 启动手势场景"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $SAMPLES_DEV" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene gesture" >/dev/null 2>&1 | head -1
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_GESTURE_HITPREP'" --timeout 40 --interval 3 \
  || { echo "✗ 手势场景未就绪"; exit 1; }
echo "    场景就绪（命中树已建）"

echo "==> ② 真注入三种手势（系统输入栈）"
HDC shell 'uitest uiInput click 660 700' >/dev/null 2>&1        # → tap（时长 ~100ms）
HDC shell 'uitest uiInput longClick 660 1200' >/dev/null 2>&1    # → longpress（时长 ~1.5s）
HDC shell 'uitest uiInput swipe 660 1600 660 900 3000' >/dev/null 2>&1  # → swipe-up（velocity 3000）

echo "==> ③ 等样本（条件等待 ≤20s）"
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $SAMPLES_DEV'" --timeout 20 --interval 2 \
  || { echo "✗ 样本文件未出现"; exit 1; }
# 三段的样本都到齐（最后一个 up 之后）——按行数下限等待（tap 2 + longpress 2 + swipe ≥10）
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell '[ \$(wc -l < $SAMPLES_DEV) -ge 12 ]'" --timeout 20 --interval 2 \
  || echo "    ⚠ 样本行数偏少（继续，判据会如实报）"

echo "==> ④ 取回 + 分类（三端中立识别器）"
HDC file recv "$SAMPLES_DEV" "$OUT/touch-samples.jsonl" >/dev/null 2>&1
[ -s "$OUT/touch-samples.jsonl" ] || { echo "✗ 样本未取回"; exit 1; }
node "$ROOT/scripts/classify-gesture-harmony.mjs" "$OUT/touch-samples.jsonl" "$OUT/gesture.json"
