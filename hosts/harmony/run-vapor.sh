#!/usr/bin/env bash
# hosts/harmony/run-vapor.sh —— ★★★鸿蒙 Vapor 设备端链（矩阵 #14）：JSVM eval **同一份** bundle-vapor.js
#
# 【与 Android run-vapor.sh 的关系】**同一份判据**（`check-vapor-device.py`）、**同一份材料**
#   （`bundle-vapor.js` + `vapor-artifacts.json`——由 gen-fixtures.mjs 从 android 侧同源复制）：
#   唯一的差别是宿主：Android 走 QuickJS(JNI)、鸿蒙走 **JSVM(V8) C API**。
#
# 【链路（零移植）】rawfile bundle-vapor.js → C++ `vaporProbe`（JSVM 建 VM/Env + 注入
#   `globalThis.proteusHost` 四方法）→ `__proteusVaporRun`（设备端实例化 + 订阅驱动增量）
#   → 宿主 mount/applyOps（Rust 核）→ 报告落盘（沙箱 el2 映射路径，hdc 可读）。
#
# 【零盲等】探针跑完主动上报 `PROTEUS_VAPOR_DONE`——本脚本条件等待它（wait_for.sh）。
# 前置：bash hosts/harmony/build-host-app.sh（含 gen-fixtures 同源复制）
# 用法：bash hosts/harmony/run-vapor.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HDC() { bash "$HERE/hdc.sh" "$@"; }
BUNDLE="dev.proteus.host"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
RESULTS="$HERE/results"
# ★沙箱 el2 映射路径（hdc 可读；应用内 filesDir 的另一侧视图——实测 `数据文件` 实测验证）
REPORT_DEV="/data/app/el2/100/base/dev.proteus.host/haps/entry/files/vapor.json"
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

echo "==> 1. 安装 + 清场 + **清日志缓冲** + 删除旧报告"
HDC install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
HDC shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
# ★★清日志缓冲（与 Android `adb logcat -c` 同义）——【为什么必须（本仓实测的陈旧信号隐患）】
#   等待是 `grep PROTEUS_VAPOR_DONE`，而 hilog 缓冲可跨分钟保留**上一次运行**的 DONE 行
#   ⇒ 不清缓冲时等待会**立刻返回陈旧信号**（"看起来跑完了"）；旧报告同理。
HDC shell "hilog -r" >/dev/null 2>&1 || true
HDC shell "rm -f $REPORT_DEV" >/dev/null 2>&1 || true
# ★删不掉就报错（否则下一步"等文件"会立刻命中**旧报告** ⇒ 假通过）
if HDC shell "test -f $REPORT_DEV && echo STILL_EXISTS" 2>/dev/null | grep -q STILL_EXISTS; then
  echo "✗ 旧报告删不掉（${REPORT_DEV}）——等待信号会命中陈旧文件，拒绝继续"; exit 1
fi

echo "==> 2. 启动（探针随页面 onAppear 自动跑）"
HDC shell "aa start -a EntryAbility -b $BUNDLE --ps scene bench" 2>&1 | grep -qi "successfully" || { echo "✗ 启动失败"; exit 1; }

echo "==> 3. 等**报告落盘**（完成信号 = 文件存在；探针先落盘、后打 DONE——零盲等）"
# ★判据为什么从"等 DONE 日志行"改成"等文件"（本仓实测）：DONE 行要**二次 shell 查询**，
#   实测出现过 wait 命中后紧接着查询为空（hilog 缓冲/传输抖动）⇒ 脚本以空串走 ok=0 分支**误判失败**；
#   而报告文件由探针**成功与失败路径都写盘**（同一写盘块）⇒ 文件存在即"探针跑完了"的充分信号。
# ★★必须用**字符串回显**而不是 `test -f` 的退出码（第二次实测抓出的装置缺陷）：**hdc shell
#   不传远端退出码**（实测：远端 `test -f /nonexistent-xyz` ⇒ hdc 仍返回 0）⇒ 按退出码等待
#   会"waited 0s 立刻通过"，随后 `file recv` 报 ENOENT（症状离根因极远）。
if ! bash "$WAIT" --cmd "bash '$HERE/hdc.sh' shell 'test -f $REPORT_DEV && echo PROTEUS_REPORT_READY' | grep -q PROTEUS_REPORT_READY" --timeout 90 --interval 3; then
  echo "✗ 90s 内未见报告落盘（${REPORT_DEV}）" >&2
  HDC shell "hilog -x | grep -E 'VAPOR|cppcrash' | tail -8" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi
# DONE 行仅作**信息输出**（best-effort，不作门禁——门禁是下面的报告判据）
DONE_LINE="$(HDC shell 'hilog -x | grep PROTEUS_VAPOR_DONE | tail -1' 2>/dev/null | head -1)"
[ -n "$DONE_LINE" ] && echo "    $DONE_LINE"

echo "==> 4. 取回报到"
# ★★先删本地旧文件 + **检查 recv 退出码**（本仓实测的第二个陈旧信号缺陷）：
#   原写法 `recv >/dev/null 2>&1` 吞掉失败 + 只查 `-s`（非空）⇒ 本地旧报告让检查**假通过**
#   ⇒ 判据跑在**上一次**的报告上（实测：设备端 text_probe 已就绪，判据却一直红）。
#   Android 版（run-vapor.sh）本来就是"先 rm + 查退出码"——鸿蒙侧漏了这两点。
rm -f "$RESULTS/vapor.json"
RECV_OUT="$(HDC file recv "$REPORT_DEV" "$RESULTS/vapor.json" 2>&1)"
# ★判据 = **本地文件非空**（recv 的输出串不作判据：hdc 的措辞可能变，且曾把 trace 混进管道）
if [ ! -s "$RESULTS/vapor.json" ]; then
  echo "✗ 报告取回失败（${REPORT_DEV}）：$(echo "$RECV_OUT" | head -2 | tr '\n' ' ')"
  exit 1
fi
echo "    vapor.json $(wc -c < "$RESULTS/vapor.json" | tr -d ' ') 字节" 

echo "==> 5. 判据（与 Android 共用 check-vapor-device.py；按 host_id 分档）"
python3 "$ROOT/hosts/android/check-vapor-device.py" "$RESULTS/vapor.json"
