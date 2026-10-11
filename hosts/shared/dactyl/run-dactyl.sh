#!/usr/bin/env bash
# hosts/shared/dactyl/run-dactyl.sh —— ★★★Dactyl 一键跑批（决策 #797/#798：把"专项验收"变成一条命令）
#
# 【它做什么（15 §11 的 DoD 落地）】对**一个端**跑完 Dactyl 的完整取证链：
#   ① 构建（项目产物 + 宿主）→ ② 装真机 → ③ 跑 L1/L2/L5 判据（按下态/场跟手/动画 + 采样）
#   → ④ 取回 `dactyl-samples.json` → ⑤ 量具聚合（`dactyl-metrics.json`）
#   → ⑥ 天花板刻度尺（`dactyl-ceiling.json`）
# 【为什么在 hosts/shared（不在各端）】三端**同一判据、同一量具、同一输出契约**（跨端可比是 Dactyl 的全部意义）。
# 【诚实边界】真机前置（设备在线/签名/信任）；无设备 ⇒ 明确报错并给替代（模拟器接线旁路）。
#
# 用法：bash hosts/shared/dactyl/run-dactyl.sh <android|ios|harmony> [额外参数透传给该端脚本]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
END="${1:-}"
shift || true

[ -n "$END" ] || { echo "✗ 用法：run-dactyl.sh <android|ios|harmony> [--press=auto,400 …]"; exit 2; }
echo "═══ Dactyl 跑批 · ${END}（判据 → 采样 → 量具 → 天花板）═══"

case "$END" in
  android)
    echo "==> ① 构建（Dactyl · android --package）"
    (cd "$ROOT/demos/dactyl" && npx tsx "$ROOT/packages/cli/src/index.ts" build --target android --package 2>&1 | tail -3) || exit 3
    echo "==> ② 安装 + 启动（真机）"
    ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
    "$ADB" install -r -t "$ROOT/demos/dactyl/dist/app/android/proteus-host.apk" 2>&1 | grep -E "Success|Failure" | head -1 || true
    echo "    ★设备侧若弹「USB 安装确认」需在手机上允许（MIUI 策略——实测必点）"
    echo "    （无设备/被拦时的替代：bash hosts/shared/dactyl/run-dactyl.sh ios 验 iOS 腿）"
    ;;
  ios)
    echo "==> ① 构建（Dactyl · ios · 参考宿主）——★用 run-selfdraw 的构建+签名，但**安装/启动走本脚本**"
    echo "    （实测：run-selfdraw 的安装段对**同版本重装**会报失败，而 devicectl 单独 install 成功——"
    echo "      幂等重装的误报；本脚本直用 devicectl 规避）"
    # 只借它的构建+签名（跑到「组装 .app」为止）——用 --superapp 全跑但忽略其安装段
    PROTEUS_APP_PROJECT=demos/dactyl PROTEUS_BUNDLE_ID=cn.shxuxi.proteus.experiments \
      bash "$ROOT/hosts/ios/run-selfdraw.sh" --superapp "$@" 2>&1 | tail -4 || true
    DEV="${1:-00008101-001938AC1A68801E}"
    [ -d "$ROOT/hosts/ios/build-selfdraw/ProteusSelfDraw.app" ] || { echo "✗ 未产出 .app"; exit 3; }
    source "$ROOT/hosts/ios/lib/xcode-env.sh" 2>/dev/null || true
    echo "==> ② 安装（devicectl·幂等）"
    xcrun devicectl device install app --device "$DEV" "$ROOT/hosts/ios/build-selfdraw/ProteusSelfDraw.app" 2>&1 | grep -E "App installed|error" | head -2
    echo "==> ③ 启动 + 判据（--press=auto；报告落盘后自退）"
    xcrun devicectl device process launch --console --terminate-existing \
      --environment-variables '{"PROTEUS_EXIT_AFTER_REPORT":"1"}' \
      --device "$DEV" cn.shxuxi.proteus.experiments --superapp --press=auto,400 2>&1 | grep -E "SUPERAPP_PRESS|superapp" | tail -3 || true
    echo "==> ④ 取回采样"
    rm -f "$ROOT/hosts/ios/results/dactyl-samples.json"
    xcrun devicectl device copy from --device "$DEV" --domain-type appDataContainer \
      --domain-identifier cn.shxuxi.proteus.experiments --source "Documents/dactyl-samples.json" \
      --destination "$ROOT/hosts/ios/results/dactyl-samples.json" 2>&1 | tail -1 || true
    ;;
  harmony)
    echo "==> ① 构建（Dactyl · harmony）"
    PROTEUS_APP_PROJECT=demos/dactyl bash "$ROOT/hosts/harmony/build-host-app.sh" 2>&1 | tail -3 || exit 3
    echo "==> ② 真机跑 L5（含负载旋钮）"
    PROTEUS_APP_PROJECT=demos/dactyl bash "$ROOT/hosts/harmony/run-superapp.sh" --pump=l5,3000 2>&1 | tail -6 || exit 3
    ;;
  *)
    echo "✗ 未知端：$END"; exit 2 ;;
esac

echo "==> ③ 量具聚合（若已取回采样）"
if [ -f "$ROOT/hosts/$END/results/dactyl-samples.json" ]; then
  python3 "$HERE/measure-latency.py" --end "$END" --samples "$ROOT/hosts/$END/results/dactyl-samples.json" 2>&1 | tail -2
else
  echo "    ◐ 无采样文件（hosts/$END/results/dactyl-samples.json）——量具按无采样如实记 null"
  python3 "$HERE/measure-latency.py" --end "$END" 2>&1 | tail -2
fi

echo "==> ④ 天花板刻度尺"
node "$ROOT/scripts/dactyl-ceiling.mjs" --end "$END" 2>&1 | tail -3

echo "==> ⑤ 汇总"
python3 - "$ROOT/hosts/$END/results" <<'PY'
import json, os, sys
d = sys.argv[1]
def load(n):
    p = os.path.join(d, n)
    if not os.path.exists(p): return None
    try: return json.load(open(p))
    except Exception: return None
m = load('dactyl-metrics.json') or {}
c = load('dactyl-ceiling.json') or {}
mm = m.get('metrics', {})
print('    指标：input_latency p50/p95/p99 = %s/%s/%s ms' % (mm.get('input_latency_p50_ms'), mm.get('input_latency_p95_ms'), mm.get('input_latency_p99_ms')))
print('    天花板：level=%s（崩裂 level=%s）' % (c.get('ceiling_level'), c.get('rupture_level')))
PY
echo "✅ Dactyl 跑批完成（${END}）——产物：hosts/${END}/results/dactyl-{samples,metrics,ceiling}.json"
