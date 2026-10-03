#!/usr/bin/env bash
# hosts/harmony/run-vapor-list.sh —— ★★Vapor 长列表虚拟化（鸿蒙腿；矩阵 #14 续 · #5）
#
# 【与 Android run-vapor-list.sh 的关系】**同一份 bundle**（零移植）+ **同一份判据**
#   （`hosts/android/check-vapor-list.py`）：1000 行 · 物化有界 · 回顶恒等 · 复用池在动。
# 用法：bash hosts/harmony/run-vapor-list.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/hosts/harmony"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
REPORT_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files/vapor-list.json"
OUT="$HERE/results"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$OUT"
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(HDC list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（$STATE）"; exit 2 ;; esac

HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
HDC shell "rm -f $REPORT_DEV" >/dev/null 2>&1 || true
# ★★新鲜度判据（本仓实测两轮踩坑）：
#   ① 删文件后立刻 `test -f` 可能仍为真（**文件系统视图延迟**）⇒ wait_for 命中旧文件
#      （`waited 0s`），随后 recv 失败；
#   ② `test ! -f` 作 wait_for 判据也命中了（语义/转义歧义）。
#   ⇒ 改用**日志行作完成信号**（与其它采集脚本同款：让被测对象主动上报）——
#     `PROTEUS_VAPOR_DONE` 是**本次运行**写的行（先清日志 ⇒ 只可能是新的）。
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene vapor-list" >/dev/null 2>&1 | head -1

bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'hilog -x | grep -q PROTEUS_VAPOR_DONE'" --timeout 150 --interval 5 \
  || { echo "✗ 未见 PROTEUS_VAPOR_DONE（150s）"; exit 1; }
# ★等文件在**映射视图**里可见（应用写沙箱路径后，el2 映射视图有延迟——实测：
#   日志已报 SAVED 但直接 recv 失败；条件等待"文件可见"后即成功）。
#   ★★判据必须是**字符串回显**：`hdc shell` **不回传远端退出码**（实测 `test -f /nonexistent`
#     仍返回 0）⇒ 按退出码等待会"waited 0s 立刻通过"，随后 recv 报 ENOENT（症状离根因极远）。
bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $REPORT_DEV && echo PROTEUS_LIST_READY' | grep -q PROTEUS_LIST_READY" --timeout 30 --interval 2 >/dev/null 2>&1
# ★★先删本地旧件 + **查 recv 输出**（本仓实测：`recv >/dev/null 2>&1` 吞失败 + 只查 `-s`
#   ⇒ 本地旧报告让检查**假通过** ⇒ 判据跑上一轮数据）
rm -f "$OUT/vapor-list.json"
RECV_OUT="$(HDC file recv "$REPORT_DEV" "$OUT/vapor-list.json" 2>&1)"
if [ ! -s "$OUT/vapor-list.json" ]; then
  echo "✗ 报告未取回（${REPORT_DEV}）：$(echo "$RECV_OUT" | head -2 | tr '\n' ' ')"
  exit 1
fi
python3 "$ROOT/hosts/android/check-vapor-list.py" "$OUT/vapor-list.json"
