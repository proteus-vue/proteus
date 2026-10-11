#!/usr/bin/env bash
# hosts/harmony/run-superapp.sh —— ★★★批次 44（2026-10-05）：**superapp 真实应用**验证（鸿蒙端）
#
# 【要验证什么（用户目标「手机主屏图标点开 App 就能测完整体验」）】
#   ① 桌面点开（EntryAbility 无 scene）= 落 `pages/Superapp`（真实应用入口，非 Index 装置页）
#   ② superapp 启动 = 路由栈装配（screen.* 真内核树）→ 入口页上屏 → 底部 Tab 栏
#   ③ drive 模式（`--ps scene superapp-drive`）：切遍所有 tab → 证据落 `superapp.json`
#
# 【★★★CSS 验收独立应用（`--css`，2026-10-08 · 对齐 Android `--css`）】
#   与 `build-host-app.sh --css` 配套：装的是 **dev.proteus.cssconf**（"CSS 验收"桌面图标），
#   应用工程 = css-conformance。产物/报告/证据名带 `cssconf-` 前缀，不覆盖 superapp 证据。
#
# 前置：① node hosts/android/bridge/build-batch.mjs（含 bundle-superapp）
#      ② bash hosts/harmony/build-host-app.sh [--css]（含 gen-fixtures：bundle-superapp + app-screen-content）
#      ③ 设备已连接（签名已配）
# 用法：bash hosts/harmony/run-superapp.sh          # 默认应用（superapp · dev.proteus.host）
#       bash hosts/harmony/run-superapp.sh --css    # CSS 验收独立应用（dev.proteus.cssconf）
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }

CSS=0
PUMP=""
PUMP_MS=2500
for arg in "$@"; do
  case "$arg" in
    --css) CSS=1 ;;
    # ★★★v-pump / 跳变驱动动画判据（本批）：`--pump=<page>[,<ms>]`——导航到该屏让泵跑一段 →
    #   报告里带 `anim_pump` 读数（宿主侧 pump_ticks/fired + native 会话 stats）+ 截屏。
    #   与 iOS `--pump=` / Android L3 检查同判据（★看内核受理/宿主真写，不看截屏像素——#793 纪律）。
    --pump=*) PUMP="${arg#--pump=}" ;;
    *) echo "✗ 未知参数：${arg}（支持 --css / --pump=<page>[,<ms>]）"; exit 2 ;;
  esac
done
if [ -n "$PUMP" ]; then
  _parts="${PUMP%%,*}"
  _rest="${PUMP#*,}"
  PUMP_PAGE="$_parts"
  [ "$_rest" != "$PUMP" ] && [ -n "$_rest" ] && PUMP_MS="$_rest"
  PUMP=1
fi

if [ "$CSS" = "1" ]; then
  BUNDLE="dev.proteus.cssconf"
  HAP_DIR="$HERE/host-app/entry/build/cssconf/outputs/default"
  REPORT_NAME="cssconf.json"
  SHOT_NAME="cssconf.png"
  LABEL="CSS 验收"
else
  BUNDLE="dev.proteus.host"
  HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
  REPORT_NAME="superapp.json"
  SHOT_NAME="superapp.png"
  LABEL="superapp"
fi
RESULTS="$HERE/results"
# ★沙箱 el2 映射路径（hdc 可读；与 run-vapor.sh 同款）——基路径按 bundleName 分目录
REPORT_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files/superapp.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

echo "==> 0. 前置（${LABEL} · ${BUNDLE}）"
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
if [ -z "$HAP" ]; then
  if [ "$CSS" = "1" ]; then
    echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh --css"
    echo "  （cssconf 需**专属签名**：bound 到 dev.proteus.cssconf 的 profile——见 build-host-app.sh 头部说明）"
  else
    echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"
  fi
  exit 2
fi
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

echo "==> 2. 启动（drive 模式：切遍 tab 后落 ${REPORT_NAME}）"
if [ "${PUMP:-}" = "1" ]; then
  # ★★★v-pump 场景（本批）：导航到 `<page>` → 泵/动画驱动跑 `PUMP_MS` → 落报告 + 截屏
  echo "    （pump 模式：page=${PUMP_PAGE} ms=${PUMP_MS}）"
  HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-pump-$PUMP_PAGE --ps ms $PUMP_MS" 2>&1 | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }
else
  HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-drive" 2>&1 | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }
fi

echo "==> 3. 等**报告落盘**（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $REPORT_DEV && echo PROTEUS_REPORT_READY' | grep -q PROTEUS_REPORT_READY" --timeout 90 --interval 3; then
  echo "✗ 90s 内未见报告落盘（${REPORT_DEV}）" >&2
  HDC shell "hilog -x | grep -E 'SUPERAPP|cppcrash' | tail -8" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi
HDC shell 'hilog -x | grep SUPERAPP_REPORT_READY | tail -1' 2>/dev/null | sed 's/^/    /'

echo "==> 4. 取回报告 + 断言"
rm -f "$RESULTS/$REPORT_NAME"
if ! HDC file recv "$REPORT_DEV" "$RESULTS/$REPORT_NAME" >/dev/null 2>&1; then
  echo "✗ file recv 失败"; exit 1
fi
[ -s "$RESULTS/$REPORT_NAME" ] || { echo "✗ 报告为空"; exit 1; }
echo "    $REPORT_NAME $(wc -c < "$RESULTS/$REPORT_NAME" | tr -d ' ') 字节"
# ★★★视觉证据：设备截屏（「我的」末态高亮 = 切 tab 高亮的机器可读证据）
rm -f "$RESULTS/$SHOT_NAME"
if HDC shell "snapshot_display -f /data/local/tmp/$SHOT_NAME.jpeg" >/dev/null 2>&1 \
   && HDC file recv /data/local/tmp/$SHOT_NAME.jpeg "$RESULTS/$SHOT_NAME.jpeg" >/dev/null 2>&1; then
  # 转 PNG（便于统一查看；无 sips 时保留 jpeg）
  if command -v sips >/dev/null 2>&1; then
    sips -s format png "$RESULTS/$SHOT_NAME.jpeg" --out "$RESULTS/$SHOT_NAME" >/dev/null 2>&1 && rm -f "$RESULTS/$SHOT_NAME.jpeg"
  fi
  echo "    ✓ 视觉证据 $( [ -f "$RESULTS/$SHOT_NAME" ] && echo "$SHOT_NAME" || echo "$SHOT_NAME.jpeg" )"
else
  echo "    ⚠ 截图未取到"
fi
python3 - "$RESULTS/$REPORT_NAME" "${PUMP:-0}" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
pump_mode = sys.argv[2] == '1'
log = d.get('switch_log', [])
print(f"    ok={d.get('ok')} host={d.get('host_id')} current={d.get('current')} tabs={d.get('tabs')}")
if pump_mode:
    # ★★★v-pump / 跳变驱动动画判据（本批）：宿主侧 pump_ticks/fired > 0（泵真的在跑且真写数据源）
    #   + native 会话 anim.starts > 0（v-animate/<Transition> 真的交给宿主动画通道）
    #   ★判据纪律（同 #793）：看**内核受理 / 宿主真写**，不看截屏像素。
    ap = d.get('anim_pump') or {}
    host = ap.get('host') or {}
    native = ap.get('native') or {}
    pump_s = native.get('pump') or {}
    print(f"    pump：host_ticks={host.get('pump_ticks')} fired={host.get('pump_fired')} "
          f"interval={host.get('pump_interval_ms')} batch={host.get('batch_frames')} eval_ms={host.get('last_eval_ms')}")
    print(f"    native：pump_ticks={pump_s.get('ticks')} fired={pump_s.get('fired')} "
          f"anim.starts={native.get('starts')} attaches={native.get('attaches')} ticks={native.get('ticks')}")
    print(f"    anim：host_attaches={host.get('anim_attaches')} host_ticks={host.get('anim_ticks')} "
          f"host_applied={host.get('anim_applied')} host_starts={host.get('anim_starts')}")
    ok = True
    if not (host.get('pump_ticks', 0) and host.get('pump_fired', 0)):
        print('✗ 泵驱动未生效（宿主 pump_ticks/pump_fired）——接线失败'); ok = False
    if not (pump_s.get('fired', 0) or pump_s.get('ticks', 0)):
        print('✗ native 会话未记录泵节拍——接线失败'); ok = False
    if not native.get('starts', 0):
        print('✗ v-animate/<Transition> 未走到宿主 animStart（native.starts=0）——接线失败'); ok = False
    if not host.get('anim_applied', 0):
        print('✗ 动画视觉未写到渲染层（anim_applied=0）——接线失败'); ok = False
    if ok: print('✅ 泵驱动 + 跳变驱动动画（鸿蒙）判据通过')
    sys.exit(0 if ok else 1)
allok = True
for row in log:
    flag = '✓' if row.get('ok') else '✗'
    if not row.get('ok'): allok = False
    print(f"    {flag} tap={row.get('tap')} → current={row.get('current')}")
sys.exit(0 if (d.get('ok') and allok and len(log) > 0) else 1)
PY
RC=$?
if [ "${PUMP:-}" = "1" ]; then
  [ "$RC" = "0" ] && echo "  ✓ 鸿蒙 v-pump / 跳变驱动动画验证通过" || { echo "  ✗ v-pump 判据失败"; exit "$RC"; }
else
  [ "$RC" = "0" ] && echo "  ✓ 鸿蒙 $LABEL 桌面入口验证通过" || { echo "  ✗ 断言失败"; exit "$RC"; }
fi
