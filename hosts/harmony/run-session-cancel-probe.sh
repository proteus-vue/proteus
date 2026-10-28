#!/usr/bin/env bash
# hosts/harmony/run-session-cancel-probe.sh —— ★★★#1344 B-2c：会话内**真取消**鸿蒙真机判据
#
# 【它证明什么（B-2c 的全部意义）】
#   ① `abort()` 真的**打到了宿主**：宿主 `http.cancelStats.calls > 0`
#      （= `HMS_Rcp_CancelRequest` 被调用，不是只 reject 本地 Promise）
#   ② 宿主传输**真的中止**：慢响应远早于到期就结束（`settle_ms_after_abort` 很小）
#   ③ JS 侧错误码正确：`fetch.aborted`
#   ④ 会话态在请求/取消期间保留（`jsTicks > 1`）
#
# 【为什么这四条缺一不可（本轮真机踩出来的）】
#   第一版判据只看 ③④（JS 侧读数），把宿主 `HMS_Rcp_CancelRequest` 摘掉后
#   JS 侧读数**一模一样**、判据依然全绿 —— 典型假绿。
#   根因：JS 的 `abort()` 是**先本地 reject**（`capability-invoke.attachAbort`）⇒
#   JS 侧永远"看起来取消成功"。⇒ 必须验宿主层记账（①）。
#
# 【★本脚本同时做归因（`cancelStage`）】
#   `calls=0` 本身是**三义**的（帧没到 / 表里没该 reqId / RCP 库缺符号）。
#   宿主三个分支各记一个数（`calls` / `noInflight` / `unsupported`），
#   JS 侧 `abortDiag` 记 inPending/encoded/sent/error ⇒ 一次运行直接指出断在哪一层。
#
# 【完成信号 = 报告落盘】（零盲等：`wait_for.sh` 有界等待文件出现）
#
# 用法：bash hosts/harmony/run-session-cancel-probe.sh [--url=URL] [--ticks=N]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
HDC="$HERE/hdc.sh"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
BUNDLE="dev.proteus.host"
FILES_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files"
RESULTS="$HERE/results"
REPORT="$RESULTS/vm-session-cancel.json"

# 慢响应端点：默认 httpbin delay/10（10 秒才回）。timeout 设 30s ⇒ 自然结束要 10s，
# 而取消后应在毫秒级结束 ⇒ `stopped_early` 有区分度。
URL="https://httpbin.org/delay/10"
TICKS=400

for arg in "$@"; do
  case "$arg" in
    --url=*) URL="${arg#--url=}" ;;
    --ticks=*) TICKS="${arg#--ticks=}" ;;
    *) echo "未知参数：$arg（支持 --url=URL / --ticks=N）"; exit 2 ;;
  esac
done

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(bash "$HDC" list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=${STATE}  url=${URL}  ticks=${TICKS}"

echo "==> ① 安装 + 清场 + 清旧报告"
bash "$HDC" install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
bash "$HDC" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
bash "$HDC" shell "rm -f $FILES_DEV/vm-session-cancel.json" >/dev/null 2>&1 || true
bash "$HDC" shell "hilog -r" >/dev/null 2>&1 || true
rm -f "$REPORT"

echo "==> ② 唤醒屏幕（★锁屏时 aa start 报 10106102，实测踩过）"
bash "$HDC" shell "power-shell wakeup" >/dev/null 2>&1 || true

echo "==> ③ 启动（scene=superapp-session-http · vmMode=cancel）"
# ★★参数名是 `vmMode` 而不是 `mode`（`EntryAbility` 只把 `vmMode` 转进 AppStorage；
#   传 `mode` 会被**静默丢弃** ⇒ 场景按 `get` 分支跑，日志打 `SESSION_HTTP_DONE` 而不是
#   `SESSION_CANCEL_DONE`——首次真机就是踩了这个，看起来像"取消没生效"）。
# ★`url` 里含 `://`，`aa start --ps` 会原样透传，但不要加引号（引号会被当字符）。
START_OUT="$(bash "$HDC" shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-session-http --ps vmMode cancel --ps url $URL --ps vmRounds $TICKS" 2>&1)"
if ! printf '%s' "$START_OUT" | grep -qi "successfully"; then
  # ★失败时**必须打印原始回执**——不打印就只能猜（首版吃过：实际是 force-stop 后的启动竞态）
  echo "✗ 启动失败，原始回执：" >&2
  printf '%s\n' "$START_OUT" | sed 's/^/  /' >&2
  echo "  若提示 screen is locked ⇒ 请**解锁设备**后重跑。" >&2
  exit 1
fi
# ★反假绿：确认场景真的进了 cancel 分支（否则一次 get 分支的成功会冒充 B-2c 通过）
if ! bash "$WAIT" --cmd "bash '$HDC' shell 'hilog -x | grep -q SESSION_CANCEL' | grep -qv ''" --timeout 20 --interval 2; then
  echo "⚠ 20s 内未见 SESSION_CANCEL 日志 —— vmMode 可能又没透传（检查 WANT_PARAMS 那行）" >&2
  bash "$HDC" shell "hilog -x | grep -E 'WANT_PARAMS' | tail -2" 2>&1 | sed 's/^/  /' >&2
fi

echo "==> ④ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HDC' shell 'test -f $FILES_DEV/vm-session-cancel.json && echo CANCEL_READY' | grep -q CANCEL_READY" --timeout 120 --interval 3; then
  echo "✗ 120s 内未见 vm-session-cancel.json" >&2
  bash "$HDC" shell "hilog -x | grep -E 'SESSION_CANCEL|SESSION_HTTP|cppcrash|SIGSEGV' | tail -15" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ⑤ 取回报告"
bash "$HDC" file recv "$FILES_DEV/vm-session-cancel.json" "$REPORT" >/dev/null 2>&1 \
  || { echo "✗ file recv 失败"; exit 1; }
[ -s "$REPORT" ] || { echo "✗ 报告为空"; exit 1; }
echo "    vm-session-cancel.json $(wc -c < "$REPORT" | tr -d ' ') 字节"
cat "$REPORT"; echo

echo "==> ⑥ 判据 + 归因"
python3 - "$REPORT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ok = True
def chk(cond, msg):
    global ok
    print(("  ✅ " if cond else "  ❌ ") + msg)
    if not cond:
        ok = False

def num(k):
    v = d.get(k)
    return v if isinstance(v, (int, float)) else -1

checks = d.get("checks") or {}
try:
    probe = json.loads(d.get("probeResult") or "{}")
except Exception:
    probe = {}

host_calls = num("hostCancelCalls")
host_no_inflight = num("hostCancelNoInflight")
host_unsupported = num("hostCancelUnsupported")
js_ticks = num("jsTicks")
settle = probe.get("settle_ms_after_abort")
diag = probe.get("abortDiag") or {}

chk(probe.get("error_code") == "fetch.aborted", f"JS 错误码 = fetch.aborted（实得 {probe.get('error_code')}）")
chk(probe.get("stopped_early") is True, f"abort 后立即结算（settle_ms={settle}，应 < 2000）")
chk(host_calls > 0, f"★宿主真调了 HMS_Rcp_CancelRequest（cancelStats.calls={host_calls}）")
chk(js_ticks > 1, f"会话态保留（jsTicks={js_ticks}）")

print()
print("── 归因（calls=0 时直接读这一行）──")
print(f"   cancelStage         = {d.get('cancelStage')}")
print(f"   hostCallCancelStats = calls={host_calls} noInflight={host_no_inflight} unsupported={host_unsupported}")
print(f"   jsAbortDiag         = {json.dumps(diag, ensure_ascii=False)}")
print(f"   pendingCount(abort后) = {probe.get('pendingCount')}")

sys.exit(0 if ok else 1)
PY
RC=$?
echo ""
if [ "$RC" = "0" ]; then
  echo "════════ B-2c 通过：abort 真的打到了宿主，传输真的中止 ════════"
else
  echo "════════ B-2c 未通过 —— 看上方归因行定位断在哪一层 ════════"
fi
exit "$RC"
