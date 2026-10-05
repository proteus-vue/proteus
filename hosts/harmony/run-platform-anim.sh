#!/usr/bin/env bash
# hosts/harmony/run-platform-anim.sh —— ★矩阵 #15：平台零参与动画（MA0-RT 鸿蒙腿）
#
# 【判据（与 Android **共用** check-platform-anim.py）】A1 贝塞尔来自内核 · A2 model 逐帧推进 ·
#   A3 终态精确（tx=120/alpha=0.5）· A4 主线程零参与绘制（draw_delta=0）。
# 【鸿蒙形态与 Android 差异（如实）】Android 走 ViewPropertyAnimator（RenderThread 自主插值）；
#   鸿蒙 C-API 无同形入口 ⇒ 帧回调（VSync）逐帧写 RenderNode 变换属性——应用层零绘制/零布局成立，
#   "插值完全归平台"无等价物（见 proteus_render.cpp 头注）。
# 零盲等：页面主动落盘报告后本脚本条件等待文件出现。
# 用法：bash hosts/harmony/run-platform-anim.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
REPORT_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files/platform-anim.json"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$RESULTS"

HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=$STATE"

HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $REPORT_DEV" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene bench" >/dev/null 2>&1 | head -1

echo "==> 等报告落盘（条件等待 ≤60s——零盲等）"
# ★★等待判据必须是**字符串回显**（2026-10-03）：`hdc shell` **不回传远端退出码**
#   （实测 `test -f /nonexistent` 仍返回 0）⇒ 按退出码等待会"waited 0s 立刻通过"，
#   随后 recv 报 ENOENT（症状离根因极远）。同族缺陷已在 run-vapor.sh 上修过。
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $REPORT_DEV && echo PROTEUS_ANIM_READY' | grep -q PROTEUS_ANIM_READY" --timeout 60 --interval 3; then
  echo "✗ 60s 内未见 $REPORT_DEV" >&2
  HDC shell "hilog -x | grep -E 'PLATFORMANIM|cppcrash' | tail -8" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi
# ★★先删本地旧件 + **查 recv 输出**（`recv >/dev/null 2>&1` 吞失败 + 只查 `-s` ⇒ 本地旧报告
#   让检查**假通过** ⇒ 判据跑上一轮数据；本仓实测见 run-vapor.sh 注释）
rm -f "$RESULTS/platform-anim.json"
RECV_OUT="$(HDC file recv "$REPORT_DEV" "$RESULTS/platform-anim.json" 2>&1)"
if [ ! -s "$RESULTS/platform-anim.json" ]; then
  echo "✗ 报告未取回（${REPORT_DEV}）：$(echo "$RECV_OUT" | head -2 | tr '\n' ' ')"
  exit 1
fi

echo "==> 判据（与 Android 共用 check-platform-anim.py）"
python3 "$ROOT/hosts/android/check-platform-anim.py" "$RESULTS/platform-anim.json"
