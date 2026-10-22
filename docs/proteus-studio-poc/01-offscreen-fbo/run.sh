#!/usr/bin/env bash
# run.sh —— PoC A 复跑脚本（决策 #1167）
#   生成确定性测试片 → 编译 harness → 跑 N 秒 → 落读数到 results/
#
# 用法：
#   bash run.sh                 # 默认 720p30 / 60s
#   bash run.sh 30              # 30s
#   bash run.sh --baseline 60   # P4 基线：同片同解码器，但不渲染不上传（只量解码）
#   FFMPEG_PREFIX=/opt/homebrew/opt/ffmpeg bash run.sh
#
# 退出码：0 产出读数 / 2 环境缺失 / 3 参数问题
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="harness"
if [ "${1:-}" = "--baseline" ]; then MODE="baseline"; shift; fi
SECONDS_RUN="${1:-60}"
CLIP="${POC_CLIP:-/tmp/proteus-poc/720p30.mp4}"
OUTDIR="$HERE/results"
mkdir -p "$OUTDIR" "$(dirname "$CLIP")"

# ── 1. 测片：合成源，参数固定 ⇒ 每次内容相同（可跨机比较）
if [ ! -f "$CLIP" ]; then
  echo "▸ 生成 720p30 测试片（testsrc2，70s，H.264 6Mbps）…"
  ffmpeg -y -loglevel error \
    -f lavfi -i testsrc2=size=1280x720:rate=30 -t 70 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -b:v 6M -g 60 -movflags +faststart \
    "$CLIP" || { echo "✗ ffmpeg 生成测片失败"; exit 2; }
fi

# ── 2. ffmpeg 开发前缀（要 libavcodec/libswscale 的头与库）
if [ -z "${FFMPEG_PREFIX:-}" ]; then
  if command -v brew >/dev/null 2>&1; then
    FFMPEG_PREFIX="$(brew --prefix ffmpeg 2>/dev/null || true)"
  fi
fi
if [ -z "${FFMPEG_PREFIX:-}" ] || [ ! -f "$FFMPEG_PREFIX/include/libavcodec/avcodec.h" ]; then
  echo "✗ 找不到 ffmpeg 开发头文件。设 FFMPEG_PREFIX=<ffmpeg 前缀> 再跑。"
  exit 2
fi
echo "▸ ffmpeg: $FFMPEG_PREFIX"
export DYLD_LIBRARY_PATH="$FFMPEG_PREFIX/lib:${DYLD_LIBRARY_PATH:-}"

# ── 3. P4 基线：同片、同解码器，只解码不渲染（判据 1.3× 的分母）
if [ "$MODE" = "baseline" ]; then
  echo "▸ 基线（-f null，只解码不上屏）：${SECONDS_RUN}s"
  /usr/bin/time -p "$FFMPEG_PREFIX/bin/ffmpeg" -v error -hwaccel videotoolbox \
    -i "$CLIP" -t "$SECONDS_RUN" -f null - 2>&1 | tail -6
  exit 0
fi

# ── 4. 编译
BIN="$OUTDIR/fbo_harness"
cc -O2 -DGL_SILENCE_DEPRECATION -Wall -Wextra -Wno-unused-parameter \
  -o "$BIN" "$HERE/fbo_harness.c" \
  -I"$FFMPEG_PREFIX/include" -L"$FFMPEG_PREFIX/lib" \
  -lavformat -lavcodec -lavutil -lswscale \
  -framework OpenGL -framework VideoToolbox -framework CoreVideo \
  || { echo "✗ 编译失败"; exit 2; }

# ── 5. 跑
JSON="$OUTDIR/readout-$(date +%Y%m%d-%H%M%S).json"
echo "▸ 测量 ${SECONDS_RUN}s（前 2s 预热不计）…"
"$BIN" --file "$CLIP" --seconds "$SECONDS_RUN" --json "$JSON"
RC=$?
echo "▸ 读数：$JSON"
exit $RC
