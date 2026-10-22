#!/usr/bin/env bash
# hosts/ios/run-ws-probe.sh —— ★★★决策 #1093：C27 WebSocket **端到端真机判据**（iOS）
#
# 【它证明什么（缺一即红）】`ws.open` 真的连上 · 文本往返 · **二进制往返** · 大消息（>125B）
#   · 对端关闭的 close code。与 Android `run-ws-probe.sh` 同口径（同一探针状态机）。
#
# 【★与 Android 的关键差异：没有 adb reverse】
#   Android 用 `adb reverse tcp:PORT` 把设备的 127.0.0.1:PORT 映射回本机；
#   iOS 真机没有等价通道 ⇒ 必须让设备经**局域网 IP** 访问本机的 echo 服务，
#   且 echo 服务要绑 `0.0.0.0`（不是 127.0.0.1）。URL 经 `PROTEUS_WS_PROBE_URL` 环境变量注入。
#
# 前置：① 设备已连接（xcrun devicectl list devices）
#      ② `bash hosts/ios/run-selfdraw.sh --superapp --drive` 能正常跑（签名/安装链路可用）
# 用法：bash hosts/ios/run-ws-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# ★Xcode 在非默认位置（26.5 才带 devicectl）——必须 source 解析器，不能依赖 xcode-select
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8787}"
LOCAL_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/ws-probe-server-ios.log"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

# ① 取本机局域网 IP（设备要能访问到）
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then
  echo "✗ 取不到本机局域网 IP（en0/en1）——iOS 真机需要经局域网访问 echo 服务"; exit 2
fi
WS_URL="ws://${LAN_IP}:${PORT}"
echo "==> echo 服务 URL（设备侧访问）：$WS_URL"

mkdir -p "$HERE/results"
rm -f "$LOCAL_REPORT" "$SERVER_LOG"

echo "==> ① 起 echo 服务（绑 0.0.0.0，设备经局域网访问）"
node "$ROOT/hosts/android/tools/ws-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ echo 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> ② 构建 + 安装 + 启动（superapp --drive，注入 PROTEUS_WS_PROBE_URL）"
# ★走既有 run-selfdraw.sh（签名/安装/自退链路都在里面，不另写一份）
#   —— 环境变量经 devicectl 的 --environment-variables 传给 App。
PROTEUS_WS_PROBE_URL="$WS_URL" bash "$HERE/run-selfdraw.sh" --superapp --drive 2>&1 | tail -20
RC=${PIPESTATUS[0]}

if [ ! -f "$LOCAL_REPORT" ]; then
  echo "✗ 报告未取回（${LOCAL_REPORT}）"; exit 4
fi

echo "==> ③ 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const p = process.argv[2]
let r
try { r = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { console.error(`✗ 报告非 JSON：${e.message}`); process.exit(1) }
let probe = r.ws_probe
if (typeof probe === 'string') { try { probe = JSON.parse(probe) } catch { probe = null } }
const checks = [
  ['探针已注入（PROTEUS_WS_PROBE_URL）', r.ws_url !== undefined],
  ['ws.open 受理', probe && probe.connect_ok === true],
  ['open 事件到达', probe && probe.open_ok === true],
  ['文本 echo 往返', probe && probe.echo_ok === true],
  ['二进制 echo 往返', probe && probe.binary_ok === true],
  ['大消息（300B）往返', probe && probe.big_ok === true],
  ['close 事件（code）', probe && probe.close_ok === true],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad++ }
console.log('  读数：' + JSON.stringify({
  rounds: r.ws_probe_rounds, phase: r.ws_probe_last_phase,
  echo: probe && probe.echo, binary: probe && probe.binary,
  big_len: probe && probe.big_len, close_code: probe && probe.close_code,
  error: probe && probe.error,
}))
process.exit(bad === 0 ? 0 : 1)
NODE
RC2=$?

if [ $RC2 -eq 0 ]; then
  echo "✅ iOS WebSocket 真机判据通过"
else
  echo "❌ iOS WebSocket 真机判据失败（run-selfdraw rc=${RC}）"
  echo "   报告：${LOCAL_REPORT} · 服务日志：${SERVER_LOG}"
fi
exit $RC2
