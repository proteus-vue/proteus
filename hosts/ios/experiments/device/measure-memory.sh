#!/usr/bin/env bash
# hosts/ios/experiments/device/measure-memory.sh —— 内存的**进程隔离**测量
#
# 【为什么必须隔离】内存测量在同一进程里连测会被污染：
#   实测同一变体三轮 48→157→166 MB（累积未回收）、另有 -0.7 / 86 MB 离群。
#   根因是 ARC/图层的释放时机不可控 + 系统内存压力波动 ⇒ **必须每次启动只测一个变体**，
#   重复 N 次取中位（与方案 §9.2「杀进程重进、重复 5 次取均值」的要求一致）。
#
# 用法：bash hosts/ios/experiments/device/measure-memory.sh [轮数]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUNDS="${1:-5}"
BUNDLE_ID="dev.proteus.experiments"
UDID="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' | head -1)"
[ -n "$UDID" ] || { echo "✗ 未发现真机"; exit 2; }

echo "==> 先构建并安装（复用 run-device.sh 的构建产物）"
[ -d "$HERE/build/ProteusExperiments.app" ] || { echo "✗ 先跑一次 run-device.sh 生成 .app"; exit 2; }
xcrun devicectl device install app --device "$UDID" "$HERE/build/ProteusExperiments.app" >/dev/null

OUT="$HERE/results/memory-isolated.txt"
: > "$OUT"
for v in A B C D E F G H I J K; do
  echo "" | tee -a "$OUT"
  echo "--- 变体 $v ---" | tee -a "$OUT"
  for i in $(seq 1 "$ROUNDS"); do
    # ★每次都是全新进程（App 测完即 exit(0)）
    xcrun devicectl device process launch --device "$UDID" \
      --environment-variables "{\"PROTEUS_EXP_ONLY\":\"mem_$v\"}" "$BUNDLE_ID" >/dev/null 2>&1 || true
    sleep 4
    xcrun devicectl device copy from --device "$UDID" \
      --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" \
      --source Documents/experiments.json --destination "$HERE/results/mem-$v-$i.json" >/dev/null 2>&1 || true
    D=$(python3 -c "
import json
try:
    d=json.load(open('$HERE/results/mem-$v-$i.json'))
    print(d['exp8_isolated']['delta_mb'], d['exp8_isolated']['before_mb'])
except Exception: print('NA NA')
" 2>/dev/null)
    echo "  轮 $i: Δ=$D MB" | tee -a "$OUT"
  done
done

echo "" | tee -a "$OUT"
echo "==> 中位数汇总" | tee -a "$OUT"
python3 - "$HERE/results" "$ROUNDS" <<'PY' | tee -a "$OUT"
import json, statistics, sys, pathlib
res = pathlib.Path(sys.argv[1]); rounds = int(sys.argv[2])
for v, name in [('A','UIView+AutoLayout(共享文本)'), ('B','UIView+手算(共享文本)'), ('C','CALayer+手算(共享文本)'),
                ('D','UIView+手算(唯一文本)'), ('E','CALayer+手算(唯一文本)'),
                ('F','CALayer 仅色块(无文本)'), ('G','UIView 仅色块(无文本)'),
                ('H','★拍平:一行一layer(文本画进父)'),
                ('I','CALayer结构+UILabel文本'), ('J','CATextLayer+gray8Uint(P0-1)'),
                ('K','CATextLayer+opaque(P0-4)')]:
    vals = []
    for i in range(1, rounds+1):
        try:
            d = json.load(open(res/f'mem-{v}-{i}.json'))
            vals.append(d['exp8_isolated']['delta_mb'])
        except Exception: pass
    if vals:
        print(f"  {name:<22} 各轮 {vals}  中位 {statistics.median(vals):.1f} MB")
PY
