#!/usr/bin/env bash
# 六端 SFC 压力夹具采集（**小程序** · Skyline / WebView 双渲染器）
# ——渲染 `examples/pages/consistency-stress.vue` 的 **Proteus 编译器产物**（WXML）⇒ 第四条链。
#
# 【与 shoot-l4-fixtures.sh 的差别】L4 采的是 vc0 手写 wxml 夹具；本脚本采 examples 的
#   **编译产物**（dist/mp-weixin，与 Web/Android/iOS 同一份 SFC 源）。
#
# 【为什么复制到 .proteus/e2e-mp 副本】与 packages/cli/src/mp-e2e.ts 同一纪律：
#   产物目录是"移动目标"（重建即变）且 IDE 会写 private.config 等 ⇒ 用干净副本，
#   不污染 dist、也避开 IDE 的按路径缓存。
#
# 【条件等待（零盲等）】路由 = 目标页（automation_evaluate 查 getCurrentPages）+ 截图特征色命中。
#
# 用法：bash scripts/shoot-stress-mp.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WXIDE=${PROTEUS_WXIDE:-/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide}
SRC="$ROOT/examples/dist/mp-weixin"
REPLICA="$ROOT/examples/.proteus/e2e-mp"
OUT="${PROTEUS_STRESS_OUT:-$ROOT/docs/generated/consistency-samples/sfc}"
PAGE="pages/consistency-stress"

mkdir -p "$OUT"
[ -d "$SRC" ] || { echo "✗ 缺 MP 产物：$SRC（先跑：cd examples && npx tsx ../packages/cli/src/index.ts build --target skyline）"; exit 2; }

echo "==> ① 产物副本（干净状态——与 mp-e2e 同一纪律）"
rm -rf "$REPLICA"
mkdir -p "$(dirname "$REPLICA")"
cp -R "$SRC" "$REPLICA"

echo "==> ② 打开项目（fullMode）"
"$WXIDE" -c vc0 close_project_window --project "$REPLICA" >/dev/null 2>&1 || true
"$WXIDE" -c vc0 open_project_window --project "$REPLICA" --window-mode fullMode >/dev/null 2>&1 || true

route_of() {
  "$WXIDE" -c vc0 automation_evaluate --project "$REPLICA" \
    --fn-source "function(){ var ps=getCurrentPages(); return ps.length? ps[ps.length-1].route : '' }" 2>/dev/null \
    | tr -d '\n' | sed -n 's/.*"result": *"\([^"]*\)".*/\1/p'
}

echo "==> ③ 采集（Skyline——产物自带渲染器声明）"
page="$PAGE"
name="sfc.mp.skyline"
# ★两次 open_page（本仓实测）：首次触发编译、第二次在编译完成后真正切页——
#   单次调用时路由可能停在首页（编译尚未完成），并有界等待即可（下方循环）。
"$WXIDE" -c vc0 simulator_open_page --project "$REPLICA" --page "$page" >/dev/null 2>&1
"$WXIDE" -c vc0 simulator_open_page --project "$REPLICA" --page "$page" >/dev/null 2>&1
ok=""
for i in $(seq 1 120); do
  [ "$(route_of)" = "$page" ] || continue
  "$WXIDE" -c vc0 simulator_screenshot --project "$REPLICA" --path "$OUT/${name}.png" --optimize false >/dev/null 2>&1
  if node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/${name}.png" "47,111,237" "111,74,232" "27,27,33" >/dev/null 2>&1; then
    ok="$i"; break
  fi
done
if [ -n "$ok" ]; then
  echo "  [$name] 第 ${ok} 轮达成 → $(ls -l "$OUT/${name}.png" | awk '{print $5}')B"
else
  echo "  [$name] ✗ 有界轮询内未达成" >&2
  exit 1
fi
