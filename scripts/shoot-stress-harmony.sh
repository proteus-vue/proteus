#!/usr/bin/env bash
# 六端 SFC 压力夹具采集（HarmonyOS 真机）——`--ps scene stress` 渲染 **SFC 编译产物** → sfc.harmony.png
#
# 【与 shoot-stress-android.sh 的关系】同一份夹具（examples/pages/consistency-stress.vue 的编译器
#   产物 → 构建期实例化 → fixtures/stress-44.json）、同一套纪律（条件等待/颜色探针/真实判据）。
#   渲染通路 = 鸿蒙宿主 RenderNode 直绘（`native.sfcStressCommands` → `renderCommands`）。
#
# 【零盲等】宿主在首帧上屏后主动上报 `PROTEUS_SFCSTRESS_FRAME`——本脚本条件等待它（wait_for.sh）。
#
# 【截图工具】uitest screenCap（PNG，无损）。★不用 snapshot_display：其只支持 .jpeg
#   （实测压缩伪影会把跨端像素差异率抬高约 0.9 个百分点，污染一致性报告）。
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HERE="$ROOT/hosts/harmony"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
OUT="${PROTEUS_STRESS_OUT:-$ROOT/docs/generated/consistency-samples/sfc}"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

mkdir -p "$OUT"
[ -f "$WAIT" ] || { echo "FAIL: 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

echo "==> 1. 前置"
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "FAIL: 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in
  *Connected*) ;;
  *) echo "FAIL: 无设备/未授权（${STATE}）——先跑 bash hosts/harmony/hdc.sh check"; exit 2 ;;
esac
echo "    hap=${HAP##*/}  设备=$STATE"

echo "==> 2. 安装 + 清场"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "FAIL: 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true

echo "==> 3. 压力场景启动（--ps scene stress）"
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene stress" 2>&1 | grep -qi "successfully" \
  || { echo "FAIL: aa start 失败"; exit 1; }

echo "==> 4. 等首帧上报（条件等待 ≤45s——零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_SFCSTRESS_FRAME'" --timeout 45 --interval 2; then
  echo "FAIL: 45s 内未见 PROTEUS_SFCSTRESS_FRAME" >&2
  HDC shell "hilog -x | grep -E 'SFCSTRESS|ProteusBench' | tail -6" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> 5. 抓读数（探针 + 上屏）"
PROBE_LINE="$(HDC shell 'hilog -x | grep "PROTEUS_SFCSTRESS {" | tail -1' 2>/dev/null | head -1)"
PROBE_JSON="$(printf '%s' "$PROBE_LINE" | sed -n 's/.*PROTEUS_SFCSTRESS //p')"
RENDERED_LINE="$(HDC shell 'hilog -x | grep PROTEUS_SFCSTRESS_RENDERED | tail -1' 2>/dev/null | head -1)"
RENDERED="$(printf '%s' "$RENDERED_LINE" | grep -oE 'nodes=[0-9]+' | head -1 | cut -d= -f2)"

# ★判据（机器判定——不靠肉眼）：
#   ① 探针 ok:true ② 节点 44 ③ 上屏 nodes ≥ 40（allow 少量因设备差异跳过的节点，但必须真上屏）
if [ -z "$PROBE_JSON" ]; then echo "FAIL: 无探针读数" >&2; exit 1; fi
P_OK="$(printf '%s' "$PROBE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ok"))' 2>/dev/null)"
P_NODES="$(printf '%s' "$PROBE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("nodes"))' 2>/dev/null)"
P_ANCHOR="$(printf '%s' "$PROBE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("anchor"))' 2>/dev/null)"
P_ROWS="$(printf '%s' "$PROBE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("first_row"))' 2>/dev/null)"
if [ "$P_OK" != "True" ]; then echo "FAIL: 探针 ok=${P_OK}（${PROBE_JSON}）" >&2; exit 1; fi
if [ "${P_NODES:-0}" -lt 44 ]; then echo "FAIL: 探针节点数 $P_NODES ≠ 44" >&2; exit 1; fi
if [ -z "$RENDERED" ] || [ "$RENDERED" -lt 40 ]; then
  echo "FAIL: 上屏节点数 ${RENDERED:-无}（应 ≥40）" >&2; exit 1; fi

echo "==> 6. 截图（uitest screenCap，PNG 无损）"
HDC shell 'uitest screenCap -p /data/local/tmp/sfc-harmony.png' >/dev/null 2>&1
HDC file recv /data/local/tmp/sfc-harmony.png "$OUT/sfc.harmony.png" >/dev/null 2>&1
[ -s "$OUT/sfc.harmony.png" ] || { echo "FAIL: 截图未取回" >&2; exit 1; }

echo "==> 7. 特征色探针（防空白/错误页）"
node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/sfc.harmony.png" "47,111,237" "111,74,232" "27,27,33" >/dev/null 2>&1 \
  || { echo "FAIL: 特征色未命中（空白/错误截图？）" >&2; exit 1; }

# 落盘读数（与 sfc.android.json 同定位——供报告端核对；含原始探针行）
python3 - "$PROBE_JSON" "$RENDERED" "$RENDERED_LINE" "$OUT/sfc.harmony.json" <<'PY'
import json, sys
probe = json.loads(sys.argv[1])
out = {
    "ok": bool(probe.get("ok")),
    "end": "harmony",
    "renderer": "RenderNode 直绘（OH_ArkUI_RenderNodeUtils）",
    "nodes": probe.get("nodes"),
    "rects": probe.get("rects"),
    "built": probe.get("built"),
    "layout_ms": probe.get("layout_ms"),
    "anchor_rect": probe.get("anchor"),
    "first_row_rect": probe.get("first_row"),
    "rendered_nodes": int(sys.argv[2]),
    "rendered_line": sys.argv[3].strip(),
    "note": probe.get("note"),
}
json.dump(out, open(sys.argv[4], "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: out[k] for k in ("ok", "nodes", "anchor_rect", "first_row_rect", "rendered_nodes")}, ensure_ascii=False))
PY

echo "  [sfc.harmony] nodes=$P_NODES anchor=$P_ANCHOR first_row=$P_ROWS rendered=$RENDERED size=$(ls -l "$OUT/sfc.harmony.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/sfc.harmony.png" | awk '{print substr($1,1,12)}')"
echo "✅ sfc.harmony 采集完成：$OUT/sfc.harmony.png + sfc.harmony.json"
