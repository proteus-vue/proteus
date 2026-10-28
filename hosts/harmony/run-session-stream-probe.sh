#!/usr/bin/env bash
# hosts/harmony/run-session-stream-probe.sh —— ★★★#1344 B-3：会话内**流式逐块回推**鸿蒙真机判据
#
# 【它证明什么（B-3 的全部意义）】
#   ① 会话模式下 `stream:true` **不再被前置拒绝**（宿主注册了 `setHttpStreamHandler`）
#   ② 数据**真的逐块**到达 JS 的 `onChunk`（不是末尾一次性给整包）
#   ③ `seq` 从 0 起**连续**（宿主按块编号；跳号即丢帧）
#   ④ 总字节数与服务端声明一致（块数对但内容缺也算失败）
#   ⑤ 流结束后照常结算：`ok:true` + `status:200`
#
# 【★为什么用本地 /stream 而不是公网】
#   公网端点不保证分块边界（可能把多行合成 1 个 TCP 段）⇒ "逐块"无法被证伪。
#   本地 `transfer-echo-server.mjs` 的 `/stream?chunks=N&size=B&delayMs=D` 按 N 次
#   `res.write` + 间隔写出 ⇒ 块数确定、且 `spread_ms > 0` 能证明"陆续到达"。
#
# 【★鸿蒙没有 adb reverse，但有 `hdc rport`】设备侧 `127.0.0.1:PORT` → 本机 PORT。
#
# 【完成信号 = 报告落盘】（`wait_for.sh` 有界等待，零盲等）
#
# 用法：bash hosts/harmony/run-session-stream-probe.sh [--chunks=N] [--size=B] [--delay-ms=D] [--port=P]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
HDC="$HERE/hdc.sh"
HAP_DIR="$HERE/host-app/entry/build/default/outputs/default"
BUNDLE="dev.proteus.host"
FILES_DEV="/data/app/el2/100/base/$BUNDLE/haps/entry/files"
RESULTS="$HERE/results"
REPORT="$RESULTS/vm-session-stream.json"
SERVER_LOG="$RESULTS/session-stream-server.log"

# ★默认参数：8 块 × 4 KiB = 32768 B，每块间隔 60ms ⇒ 总时长约 0.5s（远低于 tick 上界）
CHUNKS=8
SIZE=4096
DELAY_MS=60
PORT=9411

for arg in "$@"; do
  case "$arg" in
    --chunks=*) CHUNKS="${arg#--chunks=}" ;;
    --size=*) SIZE="${arg#--size=}" ;;
    --delay-ms=*) DELAY_MS="${arg#--delay-ms=}" ;;
    --port=*) PORT="${arg#--port=}" ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

EXPECT_BYTES=$((CHUNKS * SIZE))
URL="http://127.0.0.1:${PORT}/stream?chunks=${CHUNKS}&size=${SIZE}&delayMs=${DELAY_MS}"

[ -f "$WAIT" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
HAP="$(ls -t "$HAP_DIR"/*-signed.hap 2>/dev/null | head -1)"
[ -n "$HAP" ] || { echo "✗ 缺签名 hap——先跑 bash hosts/harmony/build-host-app.sh"; exit 2; }
STATE="$(bash "$HDC" list targets -v 2>/dev/null | head -1)"
case "$STATE" in *Connected*) ;; *) echo "✗ 无设备/未授权（${STATE}）"; exit 2 ;; esac
echo "==> hap=${HAP##*/}  设备=${STATE}"
echo "    ${CHUNKS} 块 × ${SIZE}B = ${EXPECT_BYTES}B，间隔 ${DELAY_MS}ms"

SERVER_PID=""
RPPORT_SET=0
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ "$RPPORT_SET" = "1" ] && bash "$HDC" rport rm "tcp:${PORT} tcp:${PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "==> ① 起本地 /stream 服务 + 建 rport（设备 127.0.0.1:${PORT} → 本机）"
mkdir -p "$RESULTS"
node "$ROOT/hosts/android/tools/transfer-echo-server.mjs" "$PORT" 127.0.0.1 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
if ! bash "$WAIT" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 本地服务未就绪（看 $SERVER_LOG）"; exit 3
fi
bash "$HDC" rport "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ hdc rport 失败"; exit 3; }
RPPORT_SET=1
echo "    服务就绪 + rport 已建"

echo "==> ② 安装 + 清场 + 清旧报告"
bash "$HDC" install "$HAP" 2>&1 | grep -qiE "successfully|Success" || { echo "✗ 安装失败"; exit 1; }
bash "$HDC" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
bash "$HDC" shell "rm -f $FILES_DEV/vm-session-stream.json" >/dev/null 2>&1 || true
bash "$HDC" shell "hilog -r" >/dev/null 2>&1 || true
rm -f "$REPORT"

echo "==> ③ 唤醒屏幕"
bash "$HDC" shell "power-shell wakeup" >/dev/null 2>&1 || true

echo "==> ④ 启动（scene=superapp-session-http · vmMode=stream）"
# ★★★装置缺陷修复（首轮真机抓出）：URL 里的 `&` 是 **shell 的后台运算符** ——
#   不加引号时 `...?chunks=8&size=4096&delayMs=60` 会被截成 `...?chunks=8`，
#   剩余部分变成后台命令 ⇒ 服务端收到的是**缺省参数**（测得 131072B 而非 32768B）。
#   ⇒ URL 必须**整体加引号**再交给 `aa start`（hdc shell 那一层也要引号）。
START_OUT="$(bash "$HDC" shell "aa start -a EntryAbility -b $BUNDLE --ps scene superapp-session-http --ps vmMode stream --ps vmRounds 400 --ps url '$URL'" 2>&1)"
if ! printf '%s' "$START_OUT" | grep -qi "successfully"; then
  echo "✗ 启动失败，原始回执：" >&2
  printf '%s\n' "$START_OUT" | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ⑤ 等报告落盘（完成信号 = 文件存在；零盲等）"
if ! bash "$WAIT" --cmd "bash '$HDC' shell 'test -f $FILES_DEV/vm-session-stream.json && echo STREAM_READY' | grep -q STREAM_READY" --timeout 120 --interval 3; then
  echo "✗ 120s 内未见 vm-session-stream.json" >&2
  bash "$HDC" shell "hilog -x | grep -E 'SESSION_STREAM|SESSION_HTTP|cppcrash' | tail -15" 2>&1 | sed 's/^/  /' >&2
  exit 1
fi

echo "==> ⑥ 取回报告"
bash "$HDC" file recv "$FILES_DEV/vm-session-stream.json" "$REPORT" >/dev/null 2>&1 \
  || { echo "✗ file recv 失败"; exit 1; }
[ -s "$REPORT" ] || { echo "✗ 报告为空"; exit 1; }
echo "    vm-session-stream.json $(wc -c < "$REPORT" | tr -d ' ') 字节"
cat "$REPORT"; echo

echo "==> ⑦ 判据"
EXPECT_BYTES="$EXPECT_BYTES" python3 - "$REPORT" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
expect = int(os.environ.get('EXPECT_BYTES', '0'))
ok = True
def chk(cond, msg):
    global ok
    print(("  ✅ " if cond else "  ❌ ") + msg)
    if not cond:
        ok = False

try:
    probe = json.loads(d.get('probeResult') or '{}')
except Exception:
    probe = {}

chunks = probe.get('chunks', -1)
bytes_ = probe.get('bytes', -1)
seq_ok = probe.get('seq_ok') is True
status = probe.get('status', -1)
spread = probe.get('spread_ms', -1)
ok_flag = probe.get('ok') is True

chk(ok_flag, f"最终结算 ok=true（实得 {probe.get('ok')}，err={probe.get('error_code')}）")
chk(status == 200, f"status = 200（实得 {status}）")
chk(isinstance(chunks, int) and chunks > 1, f"★★真的多块（chunks={chunks}，1 块=整包一次性给）")
chk(seq_ok, f"seq 从 0 起连续（seq_ok={seq_ok}, last_seq={probe.get('last_seq')}）")
chk(bytes_ == expect, f"总字节 = {expect}（实得 {bytes_}）")
chk(isinstance(spread, (int, float)) and spread > 0, f"块分散到达（spread_ms={spread}，>0 才说明不是末尾整包）")
chk(d.get('jsTicks', 0) > 1, f"会话态保留（jsTicks={d.get('jsTicks')}）")

print()
print("── 读数 ──")
print(f"   chunks={chunks} bytes={bytes_} seqOk={seq_ok} status={status} spreadMs={spread}")
print(f"   pushedFrames={d.get('pushed')} jsTicks={d.get('jsTicks')}")
sys.exit(0 if ok else 1)
PY
RC=$?
echo ""
if [ "$RC" = "0" ]; then
  echo "════════ B-3 通过：宿主逐块回推，JS 逐块消费 ════════"
else
  echo "════════ B-3 未通过 ════════"
fi
exit "$RC"
