#!/usr/bin/env bash
# scripts/shoot-perfetto-harmony.sh —— ★矩阵 #22：鸿蒙帧率追踪（hitrace = Perfetto 同族）
#
# 【要证明什么（与 Android 的 Perfetto 接入同族）】
#   ① 设备侧 trace 工具可用（`hitrace`——OpenHarmony 的 ftrace/dump 前端）
#   ② **活动期真的采到帧**（App 启动 + 探针链期间采 trace，帧标记数 > 0）
#   ③ **帧区间可算**（FrameS-BeginScene 序列 → 间隔 → p50/p95/fps——与 iOS 帧统计同口径）
#   ④ 帧节奏合理（p50 在 8–40ms 带内：60Hz 屏理论 16.67ms）
#
# 【与 Android Perfetto 的诚实差异】Android 走 perfetto（Atrace + gfxinfo 系统帧统计，
#   帧区间由系统直接给）；鸿蒙 `hitrace` 输出的是 **ftrace 文本**（tracing_mark_write 标记），
#   本脚本从标记序列算帧区间——**量纲同、来源同族（都是系统级 trace）、解析层不同**。
#
# 用法：bash scripts/shoot-perfetto-harmony.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HERE="$ROOT/hosts/harmony"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
OUT="${PROTEUS_TRACE_OUT:-$HERE/results}"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
TRACE_DEV="/data/local/tmp/proteus-active.htrace"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$OUT"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（$STATE）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE"

echo "==> ① 安装 + 清场"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $TRACE_DEV" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true

echo "==> ② 采活动期 trace（trace 后台跑 ≤10s；同时启动 App——探针链活动期落在窗口内）"
# ★一条 shell 命令内完成"起 trace → 起 app → 等 trace 结束"：
#   用 `&` 后台 trace + 内建 `wait`（**零轮询**——wait 是条件等待的系统原语，非盲等）
HDC shell "hitrace -b 32768 -t 10 -o $TRACE_DEV graphic ace animation >/dev/null 2>&1 &
aa start -a EntryAbility -b $BUNDLE >/dev/null 2>&1
wait
echo trace_done" >/dev/null 2>&1
echo "    trace 采集完成"

echo "==> ③ 等 App 主报告（条件等待——确认活动期与 trace 窗口重叠）"
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_SCROLL_CORE frames'" --timeout 90 --interval 3 \
  || echo "    ⚠ 未见滚动探针完成（trace 仍在，判据会如实报）"

echo "==> ④ 分析 trace（帧标记 → 帧区间统计）"
# ★大 trace 不整体取回：设备侧 grep 出帧标记行（含时间戳）→ 取回小样本解析
HDC shell "grep 'FrameS-BeginScene' $TRACE_DEV" > "$OUT/trace-frames.txt" 2>/dev/null
FRAMES=$(wc -l < "$OUT/trace-frames.txt" | tr -d ' ')
echo "    帧标记行：$FRAMES"
[ "$FRAMES" -gt 0 ] || { echo "✗ trace 里没有帧标记（活动期未覆盖？）"; exit 1; }

node "$ROOT/scripts/parse-perfetto-harmony.mjs" "$OUT/trace-frames.txt" "$OUT/perfetto.json"
