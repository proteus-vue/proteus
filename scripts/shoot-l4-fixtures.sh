#!/usr/bin/env bash
# L4 真实截图采集：两端 L4 夹具页（--optimize false = 原始 PNG）
#
# ★退出条件（不盲等、也不判"哈希稳定"）：
#   实测教训 ①：首版"连续两次截图 SHA 相同即稳定"——**旧页面**（编译中）的哈希同样稳定，
#   于是 3 秒内就把上一次打开的 skyline-geom 截了下来（silent wrong-page 假绿）。
#   实测教训 ②：`simulator_open_page` 返回 success 只表示"触发编译并打开"，
#   页面切换完成时刻**不可由返回值判定**——必须查运行时路由。
#   实测教训 ③（曾导致误判）：切换后模拟器**先黑屏、再渲染**——两次黑屏的哈希同样相同，
#   旧判据于是把**黑屏**存盘；当时误归因为「min-height:100vh / 内联 style 的 Skyline 样式坑」
#   并写进了夹具注释。A/B 复测（新判据下把两处逐一放回）**双双证伪**：二者都正常渲染。
#   ⇒ 判据 = 「当前路由 == 目标页」（automation_evaluate 查 getCurrentPages）
#          且「截图上命中 L4 特征色」（scripts/probe-png-colors.mjs）。
#   两者都满足才落盘；有界轮询（每轮一次真实工具调用，天然有节奏，无 sleep）。
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WXIDE=${PROTEUS_WXIDE:-/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide}
PROJ=${PROTEUS_L4_PROJ:-$ROOT/spike/vc0-skyline-geom}
OUT=${PROTEUS_L4_OUT:-$ROOT/docs/generated/consistency-samples/pixels}
mkdir -p "$OUT"

# ① 静态前置：两端夹具 wxml/wxss **逐字一致**（结构同构是同构比较的前提；
#    改了一端忘另一端 ⇒ 这里当场红，不浪费一次真机采集）
for f in index.wxml index.wxss; do
  if ! diff -q "$PROJ/pages/l4-skyline/$f" "$PROJ/pages/l4-webview/$f" >/dev/null 2>&1; then
    echo "✗ 夹具不同构：两个 l4 页的 $f 不一致（diff 见下）" >&2
    diff "$PROJ/pages/l4-skyline/$f" "$PROJ/pages/l4-webview/$f" >&2 || true
    exit 2
  fi
done

if [ "${PROTEUS_L4_CLEAN:-0}" = "1" ]; then
  "$WXIDE" -c vc0 close_project_window --project "$PROJ" >/dev/null 2>&1 || true
  "$WXIDE" -c vc0 debug_clear_cache --project "$PROJ" --action cleanCompileCache >/dev/null 2>&1 || true
fi
"$WXIDE" -c vc0 open_project_window --project "$PROJ" --window-mode fullMode >/dev/null 2>&1 || true

route_of() {
  "$WXIDE" -c vc0 automation_evaluate --project "$PROJ" \
    --fn-source "function(){ var ps=getCurrentPages(); return ps.length? ps[ps.length-1].route : '' }" 2>/dev/null \
    | tr -d '\n' | sed -n 's/.*"result": *"\([^"]*\)".*/\1/p'
}

fail=0
for pair in "pages/l4-skyline/index l4.skyline" "pages/l4-webview/index l4.webview"; do
  set -- $pair; page="$1"; name="$2"
  "$WXIDE" -c vc0 simulator_open_page --project "$PROJ" --page "$page" >/dev/null 2>&1
  done_ok=""
  for i in $(seq 1 80); do
    [ "$(route_of)" = "$page" ] || continue
    "$WXIDE" -c vc0 simulator_screenshot --project "$PROJ" --path "$OUT/${name}.png" --optimize false >/dev/null 2>&1
    if node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/${name}.png" "47,111,237" "124,92,255" "255,154,108" "42,63,102" >/dev/null 2>&1; then
      done_ok="$i"; break
    fi
  done
  if [ -n "$done_ok" ]; then
    echo "  [$name] 第 ${done_ok} 轮达成（路由+特征色）→ $(ls -l "$OUT/${name}.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/${name}.png" | awk '{print substr($1,1,12)}')"
  else
    echo "  [$name] ✗ 有界轮询内未达成（路由未切到 $page 或特征色不命中）" >&2
    fail=1
  fi
done

# 防"同一页被截两次"：两端是不同渲染器，截图不应逐字节相同
if [ -f "$OUT/l4.skyline.png" ] && [ -f "$OUT/l4.webview.png" ]; then
  s1=$(shasum -a 256 "$OUT/l4.skyline.png" | awk '{print $1}')
  s2=$(shasum -a 256 "$OUT/l4.webview.png" | awk '{print $1}')
  if [ "$s1" = "$s2" ]; then
    echo "  ✗ 两端截图 SHA-256 相同（同一页被截两次？）" >&2
    fail=1
  fi
fi
exit $fail
