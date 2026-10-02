#!/usr/bin/env bash
# 六端 SFC 压力夹具采集（iOS **真机**）——`--stress` 模式渲染 SFC 编译产物 → sfc.ios-device.png
#
# 【与 shoot-stress-ios-sim.sh 的差别】模拟器走 `simctl io screenshot`；真机 devicectl 没有
#   截图能力 ⇒ 走 App 内渲染自存（`SelfDrawView.snapshot` = CoreAnimation 同一光栅化路径），
#   由 `run-selfdraw.sh --stress` 取回。本脚本**不重复实现构建/签名/安装/启动**——
#   那整条链在 `hosts/ios/run-selfdraw.sh` 里已真机验证过（零轮询完成信号、新鲜度断言、
#   build_id 断言），直接以 `--stress` 模式复用；这里只做「入库 + 防假绿探针」。
#
# 【★bundle id 复用 dev.proteus.experiments（设备上已装的 Morpheus）】
#   免费开发者账号在设备上最多 3 个 dev.proteus.* 应用（实测设备已有 layoutcore/certprobe
#   /experiments/calayer 多个描述文件与安装位）⇒ 新增 id 装不下；选 experiments：
#   其描述文件有效（exp 2026-10-08）、且**覆盖安装不增计数**。换 id：
#   `PROTEUS_STRESS_IOS_BUNDLE_ID=dev.proteus.xxx bash scripts/shoot-stress-ios-device.sh`。
#
# 【完成信号（零盲等）】宿主 `PROTEUS_EXIT_AFTER_REPORT=1` ⇒ 报告与 PNG 落盘后进程自退；
#   `devicectl launch --console` **返回即完成**（run-selfdraw.sh 既有机制）。
#
# 用法：bash scripts/shoot-stress-ios-device.sh [UDID]
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${PROTEUS_STRESS_OUT:-$ROOT/docs/generated/consistency-samples/sfc}"
IOS="$ROOT/hosts/ios"
BUNDLE_ID="${PROTEUS_STRESS_IOS_BUNDLE_ID:-dev.proteus.experiments}"
mkdir -p "$OUT"

echo "==> ① 构建 + 安装 + 启动 + 取回（复用 run-selfdraw.sh --stress；含新鲜度/build_id 断言）"
# ★bundle id 经环境变量注入（run-selfdraw.sh 的既有开关）；其余参数（如 UDID）原样透传。
PROTEUS_BUNDLE_ID="$BUNDLE_ID" bash "$IOS/run-selfdraw.sh" --stress "$@" || {
  echo "✗ run-selfdraw.sh --stress 失败（看上方输出定位：构建/签名/安装/启动/断言）" >&2
  exit 1
}

SNAP="$IOS/results/stress-sfc.png"
RPT="$IOS/results/stress-sfc.json"
[ -s "$SNAP" ] || { echo "✗ 缺截图：$SNAP" >&2; exit 2; }
[ -s "$RPT" ] || { echo "✗ 缺报告：$RPT" >&2; exit 2; }

echo "==> ② 报告机器判据（渲染证据——与 Android 侧同口径）"
PARSE="$(
python3 - "$RPT" <<'PY' 2>/dev/null || echo "PARSE_FAIL"
import json, sys
try:
    r = json.load(open(sys.argv[1]))
except Exception:
    print("PARSE_FAIL"); sys.exit(0)
jr = r.get("js_report") or {}
print(json.dumps({
    "ok": bool(r.get("ok")),
    "snap": r.get("snapshot_ok"),
    "inst_nodes": int(jr.get("inst_nodes") or 0),
    "data_rows": int(jr.get("data_rows") or 0),
    "viewport": jr.get("viewport") or "",
    "build_id": jr.get("build_id") or "",
}))
PY
)"
if [ "$PARSE" = "PARSE_FAIL" ] || [ "$(printf '%s' "$PARSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok'))" 2>/dev/null)" != "True" ]; then
  echo "✗ 报告 ok!=true 或解析失败：$PARSE" >&2
  printf '%s\n' "$PARSE" >&2
  exit 3
fi
getf() { printf '%s' "$PARSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('$1'))" 2>/dev/null; }
INODES="$(getf inst_nodes)"; DROWS="$(getf data_rows)"; VP="$(getf viewport)"; BID="$(getf build_id)"
[ -n "$INODES" ] && [ "$INODES" -gt 0 ] 2>/dev/null || { echo "✗ inst_nodes=${INODES}（SFC 实例化未产出节点）" >&2; exit 3; }
[ -n "$DROWS" ] && [ "$DROWS" -gt 0 ] 2>/dev/null || { echo "✗ data_rows=${DROWS}（SFC 数据快照为空）" >&2; exit 3; }

echo "==> ③ 入库 + 防假绿（特征色探针）"
cp "$SNAP" "$OUT/sfc.ios-device.png"
cp "$RPT" "$OUT/sfc.ios-device.json"
node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/sfc.ios-device.png" "47,111,237" "111,74,232" "27,27,33" >/dev/null 2>&1 \
  || { echo "✗ 特征色未命中（截图无效：黑屏/错页？）" >&2; exit 4; }

echo "  [sfc.ios-device] inst_nodes=$INODES data_rows=$DROWS viewport=$VP build_id=$BID"
echo "  [sfc.ios-device] $(ls -l "$OUT/sfc.ios-device.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/sfc.ios-device.png" | awk '{print substr($1,1,12)}')"
