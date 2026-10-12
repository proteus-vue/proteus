#!/usr/bin/env bash
# hosts/harmony/shoot-glass-scroll.sh —— ★★★玻璃滚动录屏（决策 #843 · 观感取证）
#
# 【做什么】启动鸿蒙 `--ps scene glass-demo`（内容**连续自动滚动**经过固定玻璃），宿主端连拍屏幕帧，
#   用 ffmpeg 合成 MP4 —— 展示"内容经过液态玻璃"的**动态折射**观感（静态截图看不出）。
#
# 【为什么连拍而非设备录屏】鸿蒙无应用态录屏命令（`screenrecorder` 不存在）；可用的是 `snapshot_display`
#   （单帧截图 ≈0.38s/帧）。⇒ 连拍 N 帧 + ffmpeg 合成。为让"每帧位移小、视频平滑"，演示场景的滚动
#   已调慢（每帧 +1vp / 0..1500vp 循环）。
#
# 【零盲等】等被测对象**主动上报** `PROTEUS_GLASS_DEMO`（有界条件等待）；连拍循环由 snapshot 自身耗时驱动。
#
# 用法：bash hosts/harmony/shoot-glass-scroll.sh [帧数] [输出mp4] [回放fps]
#   缺省：60 帧 · hosts/harmony/results/glass-scroll.mp4 · 20fps
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
BUNDLE="dev.proteus.host"
HAP="$HERE/host-app/entry/build/default/outputs/default/entry-default-signed.hap"

FRAMES="${1:-60}"
OUT="${2:-$HERE/results/glass-scroll.mp4}"
FPS="${3:-20}"

TARGETS="$(HDC list targets 2>/dev/null | tr -d '\r' | grep -v '^\s*$' || true)"
case "$TARGETS" in "" | *"[Empty]"* | *Unauthorized*) echo "ℹ 无设备——退出"; exit 0 ;; esac

command -v ffmpeg >/dev/null 2>&1 || { echo "✗ 缺 ffmpeg（brew install ffmpeg）"; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> 1. 安装 + 启动 glass-demo（连续自动滚动）"
HDC install "$HAP" >/dev/null 2>&1 || true
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene glass-demo" >/dev/null 2>&1 || { echo "✗ aa start 失败"; exit 3; }
# 零盲等：条件等被测对象上报
if [ -x "$WAIT_SH" ]; then
  bash "$WAIT_SH" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_GLASS_DEMO'" --timeout 30 --interval 2 >/dev/null 2>&1 \
    || { echo "✗ 未等到 PROTEUS_GLASS_DEMO"; exit 3; }
fi
# 再等到"玻璃 pass 就绪"（自绘 + Vulkan 收到首帧后画面才是玻璃态）
bash "$WAIT_SH" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_SELF_DRAW'" --timeout 15 --interval 1 >/dev/null 2>&1 || true

echo "==> 2. 连拍 $FRAMES 帧（snapshot_display ≈0.38s/帧）"
for i in $(seq -w 1 "$FRAMES"); do
  HDC shell "snapshot_display -f /data/local/tmp/gs_$i.jpeg" >/dev/null 2>&1
done
echo "==> 3. 拉回本机"
for i in $(seq -w 1 "$FRAMES"); do
  HDC file recv "/data/local/tmp/gs_$i.jpeg" "$WORK/gs_$i.jpeg" >/dev/null 2>&1 || true
done
GOT="$(ls "$WORK"/gs_*.jpeg 2>/dev/null | wc -l | tr -d ' ')"
[ "$GOT" -gt 1 ] || { echo "✗ 只拉到 $GOT 帧"; exit 4; }

echo "==> 4. ffmpeg 合成（$GOT 帧 · ${FPS}fps · h264）"
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -framerate "$FPS" -pattern_type glob -i "$WORK/gs_*.jpeg" \
  -vf "scale=540:-2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT" >/dev/null 2>&1 \
  || { echo "✗ ffmpeg 失败"; exit 5; }
echo "✅ 录屏：${OUT}（$GOT 帧 · ${FPS}fps · $(du -h "$OUT" | cut -f1)）"
