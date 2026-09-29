#!/usr/bin/env bash
# hosts/ios/measure-paint-hint.sh —— I3 的真机 A/B 内存复测（hint 开 vs 关）
#
# 【为什么必须是 A/B 配对，而不是"设了 hint 之后的绝对值"】
#   绝对值里混着场景固有占用（节点/层/字体缓存）——那些与 hint 无关。
#   只有同机、同场景、同轨迹下的两个变体配对，差值才是 hint 的净贡献。
#   （本仓纪律：没有对照的"达标/不达标"同样不可信。）
#
# 【变体怎么切】宿主读环境变量 PROTEUS_PAINT_HINT：
#   · 默认（不设）= 按判据设 contentsFormat（生产行为）
#   · off = 完全不设（系统默认格式，即"优化前"的形态）
#
# 【判据】
#   ① 两个变体都跑出报告，且关闭态报告里 paint_hint_disabled 为 true（装置自证）
#   ② 开启态紧凑层数 > 0（接线真的生效）
#   ③ 报出中位差值（不预设方向）
#
# 【诚实边界】只测进程物理占用峰值；含系统缓存波动 ⇒ 多轮取中位 + 附全部原始值。
# 用法：bash hosts/ios/measure-paint-hint.sh [轮数=5]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$HERE/lib/xcode-env.sh"

ROOT="$(cd "$HERE/../.." && pwd)"
ROUNDS="${1:-5}"
BUNDLE_ID="${PROTEUS_BUNDLE_ID:-cn.shxuxi.proteus.experiments}"
RESULTS="$HERE/results"
mkdir -p "$RESULTS"

UDID="$(xcrun devicectl list devices 2>/dev/null | grep -v simulated | sed -n 's/.*\([0-9A-F]\{8\}-[0-9A-F]\{4\}-[0-9A-F]\{4\}-[0-9A-F]\{4\}-[0-9A-F]\{12\}\).*/\1/p' | head -1)"
if [ -z "$UDID" ]; then
  echo "未发现真机"; exit 2
fi
echo "==> 设备 ${UDID} · 每变体 ${ROUNDS} 轮"
echo "==> 诚实边界：读数是进程物理占用峰值（含系统缓存波动）⇒ 取中位并附原始值；不预设方向"

APP="$HERE/build-selfdraw/ProteusSelfDraw.app"
BIN="$APP/ProteusSelfDraw"
if [ ! -f "$BIN" ]; then
  echo "缺二进制（先跑 bash hosts/ios/run-selfdraw.sh）"; exit 2
fi
if [ -n "$(find "$HERE/ProteusHost" -name '*.swift' -newer "$BIN" 2>/dev/null | head -1)" ]; then
  echo "宿主源码比二进制新（产物陈旧）⇒ 先跑 bash hosts/ios/run-selfdraw.sh"; exit 3
fi
if ! xcrun devicectl device install app --device "$UDID" "$APP" >/dev/null 2>&1; then
  echo "安装失败"; exit 4
fi

run_variant() {
  local variant="$1"
  local round="$2"
  local out="$RESULTS/paint-hint-$variant-r$round.json"
  rm -f "$out"
  xcrun devicectl device process terminate --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  if [ "$variant" = "off" ]; then
    xcrun devicectl device process launch --device "$UDID" --environment-variables '{"PROTEUS_PAINT_HINT":"off"}' "$BUNDLE_ID" >/dev/null 2>&1 || true
  else
    xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  fi
  local n=0
  while [ "$n" -lt 60 ]; do
    xcrun devicectl device copy from --device "$UDID" --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" --source "Documents/selfdraw-report.json" --destination "$out" >/dev/null 2>&1 || true
    if [ -s "$out" ] && node "$HERE/lib/has-paint-hint-field.mjs" "$out"; then
      return 0
    fi
    if [ -s "$out" ]; then rm -f "$out"; fi
    n=$((n + 1))
    sleep 2
  done
  echo "    第 $round 轮未取到报告"
  return 1
}

for v in on off; do
  echo "── 变体 $v ──"
  i=1
  while [ "$i" -le "$ROUNDS" ]; do
    if run_variant "$v" "$i"; then
      node "$HERE/lib/read-paint-hint-round.mjs" "$RESULTS/paint-hint-$v-r$i.json" "$i" || true
    fi
    i=$((i + 1))
  done
done

echo ""
echo "==> 汇总"
python3 "$HERE/lib/summarize-paint-hint.py" "$RESULTS" "$ROUNDS"
