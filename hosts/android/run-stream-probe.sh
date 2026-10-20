#!/usr/bin/env bash
# hosts/android/run-stream-probe.sh —— ★★★#1118：流式通道（S3）真机判据（Android）
#
# 【它证明什么（四件，缺一件都不算流式可用）】
#   ① **边读边推**：N 块逐块到达 JS（不是最后才给整包）；
#   ② **内容正确**：逐字节校验服务端确定序列（只数块数会漏掉"块数对但内容错位"）；
#   ③ **seq 连续**：无丢帧/乱序；
#   ④ **真背压**：宿主读线程**真的被队列满阻塞过**（`backpressure_waits > 0`）。
#      ★这一条最容易被跳过：本地回环太快 ⇒ 队列从不满 ⇒ 看不出有没有背压。
#        故用 `delayMs` 给服务端限速 + 消费侧人工拖慢（`--slow-ms`），把队列压满。
#
# 【★诚实边界】判据证明的是"背压机制真的会触发"；**不**证明"在特定网络下的吞吐曲线"
#   （那需要可控的限速链路与多轮统计，属后续项）。
#
# 用法：bash hosts/android/run-stream-probe.sh [port]
#   PROTEUS_STREAM_PROBE_CHUNKS / _SIZE / _DELAY_MS 可覆盖（默认 64 / 16384 / 0）
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8793}"
CHUNKS="${PROTEUS_STREAM_PROBE_CHUNKS:-256}"
SIZE="${PROTEUS_STREAM_PROBE_SIZE:-16384}"
DELAY_MS="${PROTEUS_STREAM_PROBE_DELAY_MS:-3}"
SLOW_MS="${PROTEUS_STREAM_PROBE_SLOW_MS:-5}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$ROOT/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/stream-probe.json"
LOCAL_REPORT="$HERE/results/stream-probe.json"
SERVER_LOG="$HERE/results/stream-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起本地服务（port ${PORT}）"
node "$HERE/tools/transfer-echo-server.mjs" "$PORT" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务未就绪（见 ${SERVER_LOG}）"; exit 3
fi
"$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }
echo "    服务就绪 + reverse 已建"

echo "==> ② 安装 + 触发 stream-probe（chunks=${CHUNKS} size=${SIZE} delay=${DELAY_MS}ms slow=${SLOW_MS}ms）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path stream-probe --es base 'http://127.0.0.1:${PORT}' --ei chunks ${CHUNKS} --ei size ${SIZE} --ei delay_ms ${DELAY_MS} --ei slow_ms ${SLOW_MS}" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path stream-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 240 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -20 || true
  tail -20 "$SERVER_LOG" || true
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 判定"
node - "$LOCAL_REPORT" "$CHUNKS" "$SIZE" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const wantChunks = Number(process.argv[3])
const wantSize = Number(process.argv[4])
const p = r.probe || {}
const h = r.host_stream_stats || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.ok === true, `整体 ok（probe.ok）`)
// ★不要求块数 = 服务端块数：块边界由 TCP 分片决定（实测服务端 256 块 ⇒ 宿主 768 块，数据仍完全正确）
add(Number(p.got_chunks) > 0, `逐块到达（${p.got_chunks} 块）`)
add(p.got_bytes === wantChunks * wantSize, `字节数 = ${wantChunks * wantSize}（实得 ${p.got_bytes}）`)
add(p.mismatches === 0, `内容逐字节正确（错位 ${p.mismatches} 处${p.first_mismatch ? '：' + p.first_mismatch : ''}）`)
add(p.seq_continuous === true, 'seq 连续无丢帧/乱序')
add(Number(h.chunks) > 0 && Number(h.chunks) === Number(p.got_chunks), `宿主推块数 = JS 收块数（${h.chunks}）`)
add(h.completed === true, '宿主正常完成（末帧已推）')
// ★★背压证据：读线程被队列满阻塞过 —— 没有这一条就只是"能流式"，不是"有背压"
add(Number(h.backpressure_waits) > 0, `真背压：读线程被队列满阻塞 ${h.backpressure_waits} 次（共 ${h.backpressure_ms}ms）`)
add(Number(h.max_queued) > 0, `队列曾达到深度 ${h.max_queued}`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：elapsed=${p.elapsed_ms}ms · max_gap=${p.max_gap_ms}ms · host=${JSON.stringify(h)}`)
if (bad) {
  console.log('\n  ★诊断：若 backpressure_waits=0 ⇒ 服务端没限速或消费侧没拖慢，队列从未满（**装置未测到**，不当作通过）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1500))
  process.exit(1)
}
console.log('\n✅ 流式通道真机生效（逐块到达 + 内容正确 + seq 连续 + 背压真的触发过）')
NODE
