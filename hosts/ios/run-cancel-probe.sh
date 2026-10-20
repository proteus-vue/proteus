#!/usr/bin/env bash
# hosts/ios/run-cancel-probe.sh —— ★★★#1121：**取消通道**（S3 回收维度）真机判据（iOS）
#
# 【与 Android 同判据】① JS reject 且码为 `fetch.aborted` ② 后续块停止 ③ 宿主 hits>0。
# 【差异】没有 adb reverse ⇒ 服务绑 0.0.0.0，设备经局域网 IP 访问。
#
# 用法：bash hosts/ios/run-cancel-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8799}"
CHUNKS="${PROTEUS_CANCEL_PROBE_CHUNKS:-128}"
SIZE="${PROTEUS_CANCEL_PROBE_SIZE:-16384}"
DELAY_MS="${PROTEUS_CANCEL_PROBE_DELAY_MS:-20}"
LOCAL_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/cancel-probe-server-ios.log"
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

echo "==> 构建 + 安装 + 启动（superapp --cancel-probe，delay=${DELAY_MS}ms）"
bash "$HERE/run-selfdraw.sh" --superapp "--cancel-probe=${BASE},${CHUNKS},${SIZE},${DELAY_MS}" 2>&1 | tail -12

[ -f "$LOCAL_REPORT" ] || { echo "✗ 报告未取回（${LOCAL_REPORT}）"; exit 4; }

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
let p = r.cancel_probe
if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
p = p || {}
const h = r.host_cancel_stats || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(r.cancel_base !== undefined, '探针已注入（--cancel-probe）')
add(p.ok === true, '整体 ok（probe.ok）')
add(p.rejected === true, '★JS 侧被 reject（取消生效）')
add(p.aborted_code_ok === true, `★错误码是 fetch.aborted（实得 ${p.error_code || p.error_message || '空'}）`)
add(p.aborted_at === 4, `在第 4 块取消（实得 ${p.aborted_at}）`)
add(p.chunks_stopped === true, `★后续块不再到达（${p.chunks_at_abort} → ${p.chunks_after_wait}）`)
// ★判据强度如实标注：App 引擎都没有 setTimeout ⇒ 真机上没有"等待窗口"，
//   所以本端 chunks_stopped 只等于"取消后没再收到块"；**补充证据**是宿主 hits>0。
if (p.observe_skipped) console.log(`  ℹ ${p.observe_skipped}`)
add(Number(h.hits) >= 1, `★宿主 http.cancel 命中（hits=${h.hits} / calls=${h.calls}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：host=${JSON.stringify(h)} · elapsed=${p.elapsed_ms}ms`)
if (bad) {
  console.log('\n  ★诊断：hits=0 ⇒ 取消没打到宿主（在途表未注册或 reqId 不匹配）')
  console.log('    chunks_stopped=false ⇒ 宿主仍在推')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1500))
  process.exit(1)
}
console.log('\n✅ iOS 取消通道真机生效（JS reject + 后续块停止 + 宿主真的中止了传输）')
NODE
