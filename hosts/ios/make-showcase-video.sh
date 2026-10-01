#!/usr/bin/env bash
# hosts/ios/make-showcase-video.sh —— ★炫技场录屏 → **网页格式**（一次性转码 + 自检）
#
# 【产物与用途】`hosts/ios/results/showcase.mp4`（ReplayKit 真机原片，~1170×2532@60fps）
#   → `website/public/morpheus-showcase.mp4`（H.264 · faststart · 60fps 保留 · 宽度 585）
#   —— 官网炫技场用它循环播放（poster 用既有截图，reduced-motion 时只显 poster）。
#
# 【为什么这么压（三个取舍都是实测的）】
#   · **保 60fps**：这一场要展示的就是"丝滑不掉帧"——降到 30fps 等于自毁论点（宁可体积大点）；
#   · **宽度 586（≈0.5×，偶数——yuv420p 要求宽高皆为偶数）**：官网展示宽度 ~320pt（2× 屏也就 640）⇒ 585 足够清晰，
#     而原片 1170 宽在网页上是纯浪费（体积约 2×）；
#   · **crf 27 + faststart**：暗底 + 色块内容压得动；faststart 让浏览器边下边播（不等整段）。
#
# 【自检（红线）】产物必须：① 能解码（ffprobe）② 时长 ≥ 30s ③ 体积 ≤ 12MB（GitHub Pages 友好）。
#   任一不满足 ⇒ exit 1（不静默产出半个/超大的资产）。
#
# 用法：bash hosts/ios/make-showcase-video.sh [输入mp4] [输出mp4]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SRC="${1:-$HERE/results/showcase.mp4}"
OUT="${2:-$ROOT/website/public/morpheus-showcase.mp4}"
MAX_MB=12
# ★时长下限：一场完整演出实测 ≈29s（12 幕一幕到底，2026-09-30 真机）
#   真判据不是这个数——是与**真机报告的 elapsed_ms 对账**（见下方自检；这里只是兜底下限）
MIN_SECONDS=25

command -v ffmpeg >/dev/null || { echo "✗ 缺 ffmpeg（brew install ffmpeg）"; exit 2; }
command -v ffprobe >/dev/null || { echo "✗ 缺 ffprobe"; exit 2; }
[ -f "$SRC" ] || { echo "✗ 找不到录屏原片：$SRC"; echo "  ⇒ 先录：bash hosts/ios/run-selfdraw.sh --showcase --record"; exit 2; }

echo "==> 转码（60fps 保留 · 宽 586 · crf 27 · faststart）"
echo "    输入：${SRC}（$(du -h "$SRC" | cut -f1)）"
# ★★源片判据（2026-10-01 加）：录屏原片必须**接近满帧**——上一版全场 55% 时间静止、
#   29.06s 里只有 896 真实帧（≈30.8fps 等效，含 19 段 200ms–1.45s 的空洞）：
#   根因是"静止时 ReplayKit 不产帧 + 双帧驱动 ⇒ 动画 2× 速播完"。
#   ⇒ 转码前先量源片等效帧率：低于 52 ⇒ 判红（说明演出有长静帧或录屏丢帧，先修再转）。
python3 - "$SRC" <<'PY'
import subprocess, sys, json
src = sys.argv[1]
def probe(args):
    r = subprocess.run(['ffprobe', '-v', 'error'] + args + [src], capture_output=True, text=True)
    return r.stdout
info = json.loads(probe(['-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'json']))
nb = int(info['streams'][0].get('nb_frames') or 0)
dur = float(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0']).strip() or 0)
fps_eq = nb / dur if dur > 0 else 0
pts = [float(x) for x in probe(['-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0']).replace(',', ' ').split() if x.strip()]
gaps = [round((pts[i+1]-pts[i])*1000, 1) for i in range(len(pts)-1) if pts[i+1]-pts[i] > 0.05]
print(f"    源片：{nb} 帧 / {dur:.1f}s ⇒ 等效 {fps_eq:.1f} fps · >50ms 空洞 {len(gaps)} 段（合计 {sum(gaps)/1000:.1f}s）")
if fps_eq < 52:
    print(f"✗ 源片等效帧率 {fps_eq:.1f} < 52——演出存在长静帧或录屏丢帧；先修演出/录制再转码（不要转一个'静止为主'的片子）")
    sys.exit(1)
PY
ffmpeg -y -loglevel error -i "$SRC" \
  -vf "scale=586:-2:flags=lanczos" \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -r 60 -movflags +faststart -an \
  "$OUT"

echo "==> 自检"
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")"
SIZE_BYTES="$(stat -f%z "$OUT")"
SIZE_MB=$(( SIZE_BYTES / 1024 / 1024 ))
WIDTH="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 "$OUT")"
echo "    产物：${OUT} · ${SIZE_MB}MB · 时长 ${DUR}s · ${WIDTH}（宽,高,帧率）"
RC=0
# ★★判据（不只是"够长"）：视频时长必须与**真机报告里那一轮的 elapsed_ms 对账**——
#   "网站上的视频 = 被测的那次运行"要靠这个等式成立，而不是靠人眼看。
#   （报告缺失/无 elapsed 时才退回 MIN_SECONDS 下限。）
REPORT="$HERE/results/showcase.json"
python3 - "$DUR" "$SIZE_MB" "$MAX_MB" "$MIN_SECONDS" "$REPORT" <<'PY' || RC=$?
import json, os, sys
dur, size, max_mb, min_s, report = float(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
bad = []
if size > max_mb:
    bad.append(f"体积 {size}MB > {max_mb}MB（提高 crf 或降宽度重压）")
measured = None
if os.path.exists(report):
    with open(report, encoding="utf-8") as f:
        d = json.load(f)
    ms = (d.get("host_perf") or {}).get("elapsed_ms")
    if isinstance(ms, (int, float)) and ms > 0:
        measured = ms / 1000.0
if measured is None:
    if dur < min_s:
        bad.append(f"时长 {dur:.1f}s < {min_s}s（录屏被截断？；且无报告可对账）")
    else:
        print(f"    （无报告 elapsed 可对账；按兜底下限 {min_s}s 判过）")
else:
    lo, hi = measured * 0.85, measured * 1.15
    if not (lo <= dur <= hi):
        bad.append(f"视频时长 {dur:.1f}s 与真机报告 elapsed {measured:.1f}s 对不上（允许 ±15%）——录屏与报告不是同一轮？")
    else:
        print(f"    ✓ 与真机报告对账：视频 {dur:.1f}s ≈ 本轮 elapsed {measured:.1f}s（±15%）")
if bad:
    print("✗ " + "；".join(bad))
    sys.exit(1)
PY
[ "$RC" = "0" ] || exit 1
echo "✅ 网页视频就绪：website/public/morpheus-showcase.mp4"
