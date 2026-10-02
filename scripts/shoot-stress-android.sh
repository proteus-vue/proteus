#!/usr/bin/env bash
# 六端 SFC 压力夹具采集（Android 真机）——`StressSfcActivity` 渲染 **SFC 编译产物** → l4.sfc.android.png
#
# 【与 shoot-l4-android.sh 的差别】L4 采集的是**手写声明**夹具（L4Activity 的 Cmd）；
#   本脚本采集的是 **examples/pages/consistency-stress.vue 的编译产物**（真 SFC 链路）。
#   条件等待/防假绿/取景判据与 L4 同款（同一套纪律）。
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$ROOT/hosts/android/build/proteus-layoutcore.apk"
OUT="${PROTEUS_STRESS_OUT:-$ROOT/docs/generated/consistency-samples/sfc}"
REPORT="/sdcard/Android/data/$PKG/files/stress-scene.json"

mkdir -p "$OUT"

[ -x "$ADB" ] || { echo "FAIL: adb not found"; exit 2; }
[ -f "$APK" ] || { echo "FAIL: APK missing -- run hosts/android/build-and-run.sh --no-install"; exit 2; }

echo "==> 1. install"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

echo "==> 2. clear old report + launch StressSfcActivity"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/dev.proteus.layoutcore.StressSfcActivity" >/dev/null 2>&1

echo "==> 3. wait for report (bounded, real interval)"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
bash "$WAIT" --cmd "$ADB shell test -f $REPORT" --timeout 90 --interval 1 || true
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "FAIL: report not written within bounded wait ($REPORT)" >&2
  exit 1
fi

RPT="$("$ADB" shell "cat $REPORT" 2>/dev/null | tr -d '\r')"

# ★判据用 **python3 解析 JSON**（不用 sed 猜——首次实测的 bug：报告是 pretty-print 多行 JSON，
#   `"ok": true` 带空格 ⇒ `sed 's/.*"ok":\(true\|false\)/'` 匹配不到，OK 取到空串 ⇒ 假失败）。
PARSE="$(
python3 - "$RPT" <<'PY' 2>/dev/null || echo "PARSE_FAIL"
import json, sys
try:
    r = json.loads(sys.argv[1])
except Exception:
    print("PARSE_FAIL"); sys.exit(0)
payload = r.get("payload") or {}
js = payload.get("js") or {}

def num(d, k, missing):
    """取数值：**显式 None 检查**（不能用 `x or 兜底`——0 是合法值却 falsy，
    实测踩过：scroll_range=0 被 `or -1` 吃掉 ⇒ 判据误报"未接线"，正反馈证据反被埋没）。"""
    v = d.get(k)
    return int(v) if isinstance(v, (int, float)) else missing

print(json.dumps({
    "ok": bool(r.get("ok")),
    "on_draw": num(r, "on_draw", 0),
    "origin": [int(v) for v in (r.get("view_origin") or [-1, -1])],
    "inst_nodes": num(js, "inst_nodes", 0),
    "data_rows": num(js, "data_rows", 0),
    "inst_texts": num(js, "inst_texts", 0),
    "painted_colors": num(js, "painted_colors", 0),
    # ★★滚动边界判据（2026-10-02「安卓示例页面可一直上下滚」修复的证据字段）：
    #   scroll_range=0（内容装得下）⇒ 真实拖拽后 scroll_after_drag 必须恒 0。
    #   ★缺字段一律给**哨兵 ≠ 0**（-1 / -999）：探针没跑 = 判据不成立 = 必须红，
    #     绝不能因"字段缺失"而落进"=0 视为通过"的假绿。
    "scroll_range": num(r, "scroll_range", -1),
    "scroll_after_drag": num(r, "scroll_after_drag", -999),
    "drag_drive_count": num(r, "drag_drive_count", 0),
}))
PY
)"
getf() { printf '%s' "$PARSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('$1'))" 2>/dev/null; }
OK="$(getf ok)"; NDRAW="$(getf on_draw)"; ORIGIN="$(getf origin)"; INODES="$(getf inst_nodes)"; DROWS="$(getf data_rows)"

if [ "$PARSE" = "PARSE_FAIL" ] || [ "$OK" != "True" ]; then
  echo "FAIL: report ok=$OK (see $REPORT)" >&2
  printf '%s\n' "$RPT" | head -30 >&2
  exit 1
fi
if [ -z "$NDRAW" ] || [ "$NDRAW" -le 0 ] 2>/dev/null; then
  echo "FAIL: on_draw=$NDRAW (first frame not drawn)" >&2
  exit 1
fi
# 取景判据（与 L4 同款——系统栏占位会让六端取景不对齐）
if [ "$ORIGIN" != "[0, 0]" ]; then
  echo "FAIL: view_origin=$ORIGIN (expected [0, 0] -- system bars occupying space?)" >&2
  exit 1
fi
# SFC 渲染证据（机器判据：节点数/数据行数——渲染了真产物而非空树）
if [ -z "$INODES" ] || [ "$INODES" -le 0 ] 2>/dev/null; then
  echo "FAIL: inst_nodes=$INODES (SFC 实例化未产出节点)" >&2
  exit 1
fi
if [ -z "$DROWS" ] || [ "$DROWS" -le 0 ] 2>/dev/null; then
  echo "FAIL: data_rows=$DROWS (SFC 数据快照为空)" >&2
  exit 1
fi
# ★★滚动边界判据（2026-10-02 —— 用户实测「示例页面可以一直上下滚动」的修复门禁）：
#   探针在 App 内注入**真实 MotionEvent 序列**（手指上移拖拽）走生产通路；
#   内容页（装得下）必须 ⇒ range 已设置(≠-1) ∧ 拖拽后 scroll_after_drag == 0。
#   若此处红：说明钳制未生效（页面又变成可无限滚）——正是用户报的缺陷形态，必须拦下。
SRANGE="$(getf scroll_range)"; SAFTER="$(getf scroll_after_drag)"; DDRIVE="$(getf drag_drive_count)"
if [ -z "$SRANGE" ] || [ "$SRANGE" = "-1" ] 2>/dev/null; then
  echo "FAIL: scroll_range=${SRANGE}（未设置内容滚动范围——钳制未接线）" >&2
  exit 1
fi
if [ "$SAFTER" != "0" ]; then
  echo "FAIL: scroll_after_drag=${SAFTER}（真实拖拽后内容被滚走——内容页应不可滚！）" >&2
  exit 1
fi
if [ -z "$DDRIVE" ] || [ "$DDRIVE" -le 0 ] 2>/dev/null; then
  echo "FAIL: drag_drive_count=${DDRIVE}（拖拽探针未走生产通路——判据不可信）" >&2
  exit 1
fi

echo "==> 4. screenshot"
"$ADB" exec-out screencap -p > "$OUT/sfc.android.png" 2>/dev/null || true
[ -s "$OUT/sfc.android.png" ] || { echo "FAIL: screenshot not captured" >&2; exit 1; }

echo "==> 5. probe colors"
node "$ROOT/scripts/probe-png-colors.mjs" "$OUT/sfc.android.png" "47,111,237" "111,74,232" "27,27,33" >/dev/null 2>&1 \
  || { echo "FAIL: probe colors missed (blank/error screenshot?)" >&2; exit 1; }

echo "$RPT" > "$OUT/sfc.android.json"
echo "  [sfc.android] inst_nodes=$INODES data_rows=$DROWS on_draw=$NDRAW scroll_range=$SRANGE scroll_after_drag=$SAFTER drives=$DDRIVE size=$(ls -l "$OUT/sfc.android.png" | awk '{print $5}')B sha=$(shasum -a 256 "$OUT/sfc.android.png" | awk '{print substr($1,1,12)}')"
