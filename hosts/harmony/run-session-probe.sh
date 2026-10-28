#!/usr/bin/env bash
# hosts/harmony/run-session-probe.sh —— ★★★#1344 B-1：**会话式 VM** 真机判据
#
# 【它证明什么（B 阶段最关键的一条）】
#   ① **会话跨调用存活**：open 后连 tick N 拍，JS 侧 `__proteusSessionTicks` 必须 == N。
#      一次性 VM 下每次 tick 都是新上下文 ⇒ 计数器恒为 1（这正是当前生产路径的病根，决策 #1343）。
#   ② **回推链通了**：ArkTS 塞假 PRSP 帧 → tick → JS 的 `__proteusHostResolveBytes` 收到
#      ⇒ 证明"网络线程入队 → tick 搬运 → JS 结算"这条异步通路真的成立。
#   ③ **boot 成功**：整包 Vue runtime 在会话里 boot（`boot:"booted"`）。
#   ④ **无泄漏**：N 拍后堆不线性漂移。
#
# 【诚实边界】本场景**不做真实网络请求**（只用假帧证明搬运链）；真 HTTP + cancel/stream 属下一步。
#
# 用法：bash hosts/harmony/run-session-probe.sh [--ticks=100]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
HDC="$HERE/hdc.sh"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
BUNDLE="dev.proteus.host"

TICKS=100
for arg in "$@"; do
  case "$arg" in
    --ticks=*) TICKS="${arg#--ticks=}" ;;
    *) echo "未知参数：$arg（支持 --ticks=N）"; exit 2 ;;
  esac
done

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(bash "$HDC" list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=${STATE}  ticks=${TICKS}"

echo "==> ① 安装 + 清场"
bash "$HDC" install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
bash "$HDC" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
bash "$HDC" shell "hilog -r" >/dev/null 2>&1 || true

echo "==> ② 唤醒屏幕（★锁屏时 aa start 会报 10106102，实测踩过）"
bash "$HDC" shell "power-shell wakeup" >/dev/null 2>&1 || true

echo "==> ③ 启动（scene=superapp-session · ticks=${TICKS}）"
if ! bash "$HDC" shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-session --ps vmRounds ${TICKS}" 2>&1 | grep -qi "successfully"; then
  echo "✗ 启动失败。若提示 screen is locked ⇒ 请**解锁设备**后重跑。"
  bash "$HDC" shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-session" 2>&1 | tail -3 | sed 's/^/  /'
  exit 1
fi

echo "==> ④ 等判据日志（完成信号 = SESSION_DONE；零轮询条件等待）"
if ! bash "$WAIT" --cmd "bash '$HDC' shell \"hilog -x | grep -c 'SESSION_DONE'\" | grep -qv '^0$'" --timeout 120 --interval 2; then
  echo "✗ 120s 内未见 SESSION_DONE —— 可能崩在会话里（查下面）" >&2
  bash "$HDC" shell "hilog -x | grep -iE 'ProteusSession|SESSION_|cppcrash|SIGSEGV' | tail -20" 2>&1 | sed 's/^/  /' >&2
  exit 3
fi

echo "==> ⑤ 判定"
LOG="$(bash "$HDC" shell "hilog -x | grep -E 'SESSION_(OPEN|DONE|START|REPORT)' | tail -10" 2>&1)"
printf '%s\n' "$LOG" | sed 's/^/  /'

DONE_LINE="$(printf '%s\n' "$LOG" | grep 'SESSION_DONE' | tail -1)"
if [ -z "$DONE_LINE" ]; then echo "✗ 没有 SESSION_DONE"; exit 1; fi

PASS=0
TOTAL=0
chk() { TOTAL=$((TOTAL + 1)); if [ "$1" = "1" ]; then PASS=$((PASS + 1)); echo "  ✅ $2"; else echo "  ❌ $2"; fi; }

printf '%s' "$DONE_LINE" | grep -q 'ok=true' && chk 1 "整体 ok（SESSION_DONE ok=true）" || chk 0 "整体 ok（SESSION_DONE ok=true）"
# jsTicks=a/b —— 必须 a == b
JT="$(printf '%s' "$DONE_LINE" | sed -n 's/.*jsTicks=\([0-9]*\)\/\([0-9]*\).*/\1 \2/p')"
A="${JT%% *}"; B="${JT##* }"
[ -n "$A" ] && [ "$A" = "$B" ] && [ "$A" != "0" ] && chk 1 "★★★会话跨调用存活：jsTicks=${A}/${B}（一次性 VM 下会是 1）" || chk 0 "★★★会话跨调用存活：jsTicks=${A:-?}/${B:-?}"
printf '%s' "$DONE_LINE" | grep -qE 'frames=[1-9]' && chk 1 "回推帧入队成功（frames>0）" || chk 0 "回推帧入队成功（frames>0）"
printf '%s' "$DONE_LINE" | grep -q 'heapOk=true' && chk 1 "堆未线性漂移（heapOk=true）" || chk 0 "堆未线性漂移（heapOk=true）"

echo ""
echo "════════ ${PASS}/${TOTAL} 通过 ════════"
[ "$PASS" = "$TOTAL" ] || exit 1
echo "★ 会话式 VM 判据通过 ⇒ 异步回推有接收方 ⇒ cancel/stream/WS 的技术前提成立（下一步落地）。"
