#!/usr/bin/env bash
# hosts/android/run-element-probe.sh —— ★★★决策 #1081：**元素查询通路**真机判据（Android）
#
# 【它证明什么】`#id` → 引擎 nodeId → **内核矩形**这条链在真机真的通了，且与内核 `readRects()`
#   交叉核对一致（不是"桥自证桥"）。详见 `runtime/ElementRectProbe.java` + `dev/ElementProbe.java`。
#
# 前置：① node hosts/android/bridge/build-batch.mjs（含 bundle-superapp：带 elementId 透传 + 索引）
#      ② bash hosts/android/build-and-run.sh --no-install（把 bundle 拷进 assets 并打包）
#      ③ 设备已连接
# 用法：bash hosts/android/run-element-probe.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
PKG="dev.proteus.layoutcore"
APK="$HERE/build/proteus-layoutcore.apk"
REPORT="/sdcard/Android/data/$PKG/files/element-probe.json"

[ -x "$ADB" ] || { echo "✗ 缺 adb（${ADB}）"; exit 2; }
[ -f "$APK" ] || { echo "✗ 缺 APK——先跑：bash hosts/android/build-and-run.sh --no-install"; exit 2; }
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
if ! printf '%s' "$APK_LIST" | grep -q "assets/bundle-superapp.js"; then
  echo "✗ APK 内无 assets/bundle-superapp.js —— 需重新构建（先 build-batch 再 build-and-run）"; exit 2
fi
"$ADB" shell true >/dev/null 2>&1 || { echo "✗ 无设备（adb devices）"; exit 2; }

echo "==> ① 安装（release 包）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2

WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

echo "==> ② 清旧报告 + 重启 + 等就绪 + 触发 element-probe"
"$ADB" shell "rm -f $REPORT" >/dev/null 2>&1 || true
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "am start -n $PKG/.MainActivity" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" \
  --timeout 30 --interval 1 --max-interval 3 || echo "  ⚠ 未见 run-receiver-ready（30s）——广播可能丢"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path element-probe -p $PKG" >/dev/null 2>&1

echo "==> ③ 等报告（条件等待）"
bash "$WAIT_SH" --cmd "\"$ADB\" shell test -f $REPORT" --timeout 90 --interval 2 || true
if ! "$ADB" shell "test -f $REPORT" >/dev/null 2>&1; then
  echo "✗ 报告未生成（${REPORT}）—— 看 adb logcat --pid=\$(pidof $PKG)"
  exit 1
fi

echo "==> ④ 取回报告 + 判据"
mkdir -p "$HERE/results"
"$ADB" pull "$REPORT" "$HERE/results/element-probe.json" >/dev/null 2>&1 || { echo "✗ adb pull 失败"; exit 1; }
python3 - "$HERE/results/element-probe.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(json.dumps(d, ensure_ascii=False, indent=2)[:2400])
fails = []
if not d.get('ok'): fails.append('ok != true')
if not d.get('cross_check_ok'): fails.append('cross_check_ok != true（element.rect 与内核 readRects 不一致）')
reg = d.get('registry')
try:
    r = json.loads(reg) if isinstance(reg, str) else reg
    if not r or not any(v for v in (r.get('screens') or {}).values()):
        fails.append(f'元素索引为空：{reg}')
except Exception as e:
    fails.append(f'registry 解析失败：{e}')
for k, want in (('not_found_probe', 'not-found'), ('pseudo_probe', 'unsupported')):
    v = d.get(k)
    try:
        o = json.loads(v) if isinstance(v, str) else v
    except Exception:
        o = {}
    if not (o and o.get('ok') is False and want in str(o.get('error', ''))):
        fails.append(f'{k} 未如实分档（期望 {want}）：{v}')
# ★#1082：class / 复合选择器必须**真的命中**（静态 class 已进产物）
for k in ('class_probe', 'compound_probe'):
    v = d.get(k)
    try:
        o = json.loads(v) if isinstance(v, str) else v
    except Exception:
        o = {}
    if not (o and o.get('ok') is True and o.get('nodeId', -1) >= 0):
        fails.append(f'{k} 应命中（class 选择器已支持）：{v}')
    elif not (o.get('width', 0) > 0 and o.get('height', 0) > 0):
        fails.append(f'{k} 命中但几何为 0（可疑）：{v}')
if fails:
    print('\n❌ 判据未过：')
    for f in fails: print('  -', f)
    sys.exit(1)
print('\n✅ 判据全过：静态 id → nodeId 索引 → 内核矩形（与 readRects 交叉核对）+ 两档诚实边界')
PY
