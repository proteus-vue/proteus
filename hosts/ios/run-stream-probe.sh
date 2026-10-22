#!/usr/bin/env bash
# hosts/ios/run-stream-probe.sh —— ★★★#1118：流式通道（S3）真机判据（iOS）
#
# 【与 Android 版的差异】没有 adb reverse ⇒ 服务绑 0.0.0.0，设备经**局域网 IP** 访问。
#
# 【判据与 Android 逐项同义】
#   ① 逐块到达 ② 字节数正确 ③ **按全局偏移**逐字节校验（块边界由 TCP 分片决定，不是契约）
#   ④ seq 连续 ⑤ 宿主记账：块数对齐 + completed ⑥ **真背压**（backpressure_waits > 0）
#
# 用法：bash hosts/ios/run-stream-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8794}"
CHUNKS="${PROTEUS_STREAM_PROBE_CHUNKS:-256}"
SIZE="${PROTEUS_STREAM_PROBE_SIZE:-16384}"
DELAY_MS="${PROTEUS_STREAM_PROBE_DELAY_MS:-3}"
SLOW_MS="${PROTEUS_STREAM_PROBE_SLOW_MS:-5}"
# ★★#1148：读数必须落成**独立**证据文件（原写 superapp.json = 任何一次 superapp 运行都会覆盖它
#   ⇒ #1118 的 iOS 11/11 读数**根本没留下可复核产物**，commit 里只有一行文字声明）。
#   对齐 Android 侧同名文件（hosts/android/results/stream-probe.json），两端同形态。
LOCAL_REPORT="$HERE/results/stream-probe.json"
SERVER_LOG="$HERE/results/stream-probe-server-ios.log"
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

echo "==> 构建 + 安装 + 启动（superapp --stream-probe，chunks=${CHUNKS} delay=${DELAY_MS}ms slow=${SLOW_MS}ms）"
# ★不带 `--drive`（与 run-fetch-limit-probe.sh 同款）：探针分支自己控制收尾与自退；
#   带上 `--drive` 时 steps 会与探针抢收尾（宿主已把 tapMode 判断挪到探针之后，但这里保持最小耦合）
bash "$HERE/run-selfdraw.sh" --superapp "--stream-probe=${BASE},${CHUNKS},${SIZE},${DELAY_MS},${SLOW_MS}" 2>&1 | tail -12

# run-selfdraw 的产物是 superapp.json（通用报告名）——原样留一份为**独立证据**，供事后复核。
SUPERAPP_REPORT="$HERE/results/superapp.json"
[ -f "$SUPERAPP_REPORT" ] || { echo "✗ 报告未取回（${SUPERAPP_REPORT}）"; exit 4; }
cp -f "$SUPERAPP_REPORT" "$LOCAL_REPORT"
echo "    证据已落盘：$LOCAL_REPORT"

echo "==> 判定"
node - "$LOCAL_REPORT" "$CHUNKS" "$SIZE" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const wantChunks = Number(process.argv[3])
const wantSize = Number(process.argv[4])
let p = r.stream_probe
if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
p = p || {}
const h = r.host_stream_stats || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(r.stream_base !== undefined, '探针已注入（--stream-probe）')
add(p.ok === true, `整体 ok（probe.ok）`)
add(Number(p.got_chunks) > 0, `逐块到达（${p.got_chunks} 块；服务端发了 ${wantChunks} 块）`)
add(Number(p.got_bytes) === wantChunks * wantSize, `字节数 = ${wantChunks * wantSize}（实得 ${p.got_bytes}）`)
add(Number(p.mismatches) === 0, `内容逐字节正确（错位 ${p.mismatches} 处${p.first_mismatch ? '：' + p.first_mismatch : ''}）`)
add(p.seq_continuous === true, 'seq 连续无丢帧/乱序')
add(Number(h.chunks) > 0 && Number(h.chunks) === Number(p.got_chunks), `宿主推块数 = JS 收块数（${h.chunks}）`)
add(h.completed === true, '宿主正常完成（末帧已推）')
add(Number(h.bytes) === wantChunks * wantSize, `宿主记账字节 = ${wantChunks * wantSize}（实得 ${h.bytes}）`)
add(Number(h.backpressure_waits) > 0, `真背压：delegate 队列阻塞 ${h.backpressure_waits} 次（共 ${h.backpressure_ms}ms）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：elapsed=${p.elapsed_ms}ms · max_gap=${p.max_gap_ms}ms · host=${JSON.stringify(h)}`)
if (bad) {
  console.log('\n  ★诊断：backpressure_waits=0 ⇒ 消费侧没拖慢或服务端没限速（装置未测到，不当作通过）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1500))
  process.exit(1)
}
console.log('\n✅ iOS 流式通道真机生效（逐块到达 + 内容正确 + seq 连续 + 背压真的触发过）')
NODE
