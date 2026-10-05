#!/usr/bin/env bash
# hosts/harmony/run-superapp.sh —— ★★★批次 44（2026-10-05）：**superapp 真实应用**验证（鸿蒙端）
#
# 【要验证什么（用户目标「手机主屏图标点开 App 就能测完整体验」）】
#   ① 桌面点开（EntryAbility 无 scene）= 落 `pages/Superapp`（真实应用入口，非 Index 装置页）
#   ② superapp 启动 = 路由栈装配（screen.* 真内核树）→ 入口页上屏 → 底部 Tab 栏
#   ③ drive 模式（`--ps scene superapp-drive`）：切遍所有 tab → 证据落 `superapp.json`
#
# 前置：① node hosts/android/bridge/build-batch.mjs（含 bundle-superapp）
#      ② bash hosts/harmony/build-host-app.sh（含 gen-fixtures：bundle-superapp + app-screen-content）
#      ③ 设备已连接（签名已配）
# 用法：bash hosts/harmony/run-superapp.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
# ★沙箱 el2 映射路径（hdc 可读；与 run-vapor.sh 同款）
REPORT_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files/superapp.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

echo "==> 0. 前置"
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in
  *Connected*) ;;
  *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;;
esac
echo "    hap=${HAP##*/}  设备=$STATE"

echo "==> 1. 安装 + 清场 + 清日志 + 删旧报告"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "rm -f $REPORT_DEV" >/dev/null 2>&1 || true
if HDC shell "test -f $REPORT_DEV && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉（${REPORT_DEV}）——等待信号会命中陈旧文件，拒绝继续"; exit 1
fi

echo "==> 2. 启动（drive 模式：切遍 tab 后落 superapp.json）"
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-drive" 2>&1 | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }

echo "==> 3. 等**报告落盘**（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $REPORT_DEV && echo PROTEUS_REPORT_READY' | grep -q PROTEUS_REPORT_READY" --timeout 90 --interval 3; then
  echo "✗ 90s 内未见报告落盘（${REPORT_DEV}）" >&2
  HDC shell "hilog -x | grep -E 'SUPERAPP|cppcrash' | tail -8" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi
HDC shell 'hilog -x | grep SUPERAPP_REPORT_READY | tail -1' 2>/dev/null | sed 's/^/    /'

echo "==> 4. 取回报告 + 断言"
rm -f "$RESULTS/superapp.json"
if ! HDC file recv "$REPORT_DEV" "$RESULTS/superapp.json" >/dev/null 2>&1; then
  echo "✗ file recv 失败"; exit 1
fi
[ -s "$RESULTS/superapp.json" ] || { echo "✗ 报告为空"; exit 1; }
echo "    superapp.json $(wc -c < "$RESULTS/superapp.json" | tr -d ' ') 字节"
# ★★★视觉证据：设备截屏（「我的」末态高亮 = 切 tab 高亮的机器可读证据）
rm -f "$RESULTS/superapp.png"
if HDC shell "snapshot_display -f /data/local/tmp/superapp.jpeg" >/dev/null 2>&1 \
   && HDC file recv /data/local/tmp/superapp.jpeg "$RESULTS/superapp.jpeg" >/dev/null 2>&1; then
  # 转 PNG（便于统一查看；无 sips 时保留 jpeg）
  if command -v sips >/dev/null 2>&1; then
    sips -s format png "$RESULTS/superapp.jpeg" --out "$RESULTS/superapp.png" >/dev/null 2>&1 && rm -f "$RESULTS/superapp.jpeg"
  fi
  echo "    ✓ 视觉证据 $( [ -f "$RESULTS/superapp.png" ] && echo superapp.png || echo superapp.jpeg )"
else
  echo "    ⚠ 截图未取到"
fi
python3 - "$RESULTS/superapp.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
log = d.get('switch_log', [])
print(f"    ok={d.get('ok')} host={d.get('host_id')} current={d.get('current')} tabs={d.get('tabs')}")
allok = True
for row in log:
    flag = '✓' if row.get('ok') else '✗'
    if not row.get('ok'): allok = False
    print(f"    {flag} tap={row.get('tap')} → current={row.get('current')}")
sys.exit(0 if (d.get('ok') and allok and len(log) > 0) else 1)
PY
RC=$?
[ "$RC" = "0" ] && echo "  ✓ 鸿蒙 superapp 桌面入口验证通过" || { echo "  ✗ 断言失败"; exit "$RC"; }
