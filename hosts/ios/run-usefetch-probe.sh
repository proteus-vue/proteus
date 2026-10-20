#!/usr/bin/env bash
# hosts/ios/run-usefetch-probe.sh —— ★★★#1126：**走 `useFetch` 门面**的真机判据（iOS）
#
# 【为什么单独一条（#1122 的诚实边界①）】
#   #1122 把 useFetch 门面打开并真机验证，但**只在 Android 跑过**。
#   iOS 的底层（流式/落盘/上传/取消）在 #1118-#1121 都验过，但**门面这条路 iOS 没单独跑**。
#   ★本脚本补上这个洞：与 Android `run-usefetch-probe.sh` **同判据、同参数**。
#
# 【判据三条】① 流式（onChunk 逐块到达）② 取消（fetch.aborted）③ status/headers 都在。
#
# 用法：bash hosts/ios/run-usefetch-probe.sh [port]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8801}"
CHUNKS="${PROTEUS_UF_CHUNKS:-128}"
SIZE="${PROTEUS_UF_SIZE:-16384}"
DELAY_MS="${PROTEUS_UF_DELAY_MS:-20}"
LOCAL_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/usefetch-probe-server-ios.log"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then echo "✗ 取不到本机局域网 IP"; exit 2; fi
BASE="http://${LAN_IP}:${PORT}"
echo "==> 服务基址（设备侧）：$BASE"

mkdir -p "$HERE/results"
rm -f "$LOCAL_REPORT" "$SERVER_LOG"

node "$ROOT/hosts/android/tools/transfer-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    服务已就绪"

echo "==> 构建 + 安装 + 启动（superapp --usefetch-probe）"
bash "$HERE/run-selfdraw.sh" --superapp "--usefetch-probe=${BASE},${CHUNKS},${SIZE},${DELAY_MS}" 2>&1 | tail -12

[ -f "$LOCAL_REPORT" ] || { echo "✗ 报告未取回（${LOCAL_REPORT}）"; exit 4; }

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
let p = r.usefetch_probe
if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
p = p || {}
const h = r.host_cancel_stats || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(r.usefetch_base !== undefined, '探针已注入（--usefetch-probe）')
add(p.ok === true, '整体 ok（probe.ok）')
add(p.has_status === true, `★返回值带 status（实得 ${p.stream_status}）`)
add(p.has_headers === true, '★返回值带 headers')
add(Number(p.streamed_chunks) >= 1, `★流式逐块到达（${p.streamed_chunks} 块）`)
add(p.stream_seq_ok === true, '流式块序号连续')
add(p.cancel_aborted_at === 4, `在第 4 块取消（实得 ${p.cancel_aborted_at}）`)
add(p.cancel_code_ok === true, `★取消码为 fetch.aborted（实得 ${p.cancel_err || p.cancel_code || '空'}）`)
add(Number(h.hits) >= 1, `★宿主 http.cancel 命中（hits=${h.hits}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({ streamed: p.streamed_chunks, status: p.stream_status, cancel_at: p.cancel_aborted_at })}`)
if (bad) {
  console.log('\n  ★诊断：has_status=false ⇒ 门面仍只回 data；streamed_chunks=0 ⇒ onChunk 没传下去')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1600))
  process.exit(1)
}
console.log('\n✅ iOS useFetch 门面真机生效（流式 + 取消 + status/headers 全部到位）')
NODE
