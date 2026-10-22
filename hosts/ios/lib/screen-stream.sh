#!/usr/bin/env bash
# hosts/ios/lib/screen-stream.sh —— ★★★Studio G3：屏幕流的**常驻启动**（决策 #1190）
#
# 【为什么单独一个文件】`run-selfdraw.sh` 已到 1000 行上限（`check:file-size` 硬判据），
#   而屏幕流这块是**独立职责**（把 App 以常驻形态拉起来，不收报告、不阻塞），抽出来两边都干净。
#
# 【被谁调用】`run-selfdraw.sh` 的默认（selfdraw）分支，带 `--stream=host:port` 时。
#
# 【为什么刻意不同时做三件事】
#   ① 不加 `--console`：它会阻塞到 App 退出 ⇒ 脚本永不返回；
#   ② 不设 `PROTEUS_EXIT_AFTER_REPORT`：落报告即退 ⇒ 流刚起来就断；
#   ③ 日志写文件（`--console` 才有的实时输出，用后台重定向代替）。
set -euo pipefail

# `--stream=host:port` 的值（空 = 不启屏幕流）。★必须用 `${x:-}` 形式：本文件是在
#   run-selfdraw.sh **解析完参数之后**才 source 的，写 `STREAM_ARG=""` 会把已解析的值清空
#   （真跑才暴露的静默 bug：`--stream` 看着生效，实际传空 ⇒ 宿主不启动推流）。
STREAM_ARG="${STREAM_ARG:-}"

# ios_stream_launch <here> <udid> <bundle_id> <host:port>
ios_stream_launch() {
  local here="$1" udid="$2" bundle="$3" target="$4"
  local log="$here/results/screen-stream.log"
  mkdir -p "$here/results"
  echo "    屏幕流常驻：PROTEUS_SCREEN_STREAM=$target"
  echo "    ★设备将弹「录制屏幕」授权窗——请点【允许】，否则无任何帧"
  echo "    Mac 侧接收：nc -l ${target##*:} | ffplay -f h264 -"
  echo "    日志：${log}"
  nohup xcrun devicectl device process launch --console --terminate-existing \
    --environment-variables "{\"PROTEUS_SCREEN_STREAM\":\"$target\"}" \
    --device "$udid" "$bundle" --selfdraw > "$log" 2>&1 &
  disown 2>/dev/null || true
  echo "    已在后台启动（PID $!）；本脚本立即返回，不再等报告"
}
