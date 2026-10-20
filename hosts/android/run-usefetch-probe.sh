#!/usr/bin/env bash
# hosts/android/run-usefetch-probe.sh —— ★★★#1122：**走 `useFetch` 门面**的真机判据（Android）
#
# 【它证明什么（这层此前完全缺失）】
#   此前所有探针都打底层（`invokeHostStream` / `createAppDownload` …）⇒
#   "底层 S3 做完、`useFetch` 门面只透传 6 字段"这类缺口**全绿**。
#   本判据只走 `createCapabilityHooks(...).useFetch`——业务真正看到的那个面。
#
# 【三条】① 流式（onChunk 逐块到达）② 取消（fetch.aborted + 块停止）③ status/headers 都在。
#
# 用法：bash hosts/android/run-usefetch-probe.sh [port]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8800}"
CHUNKS="${PROTEUS_UF_CHUNKS:-128}"
SIZE="${PROTEUS_UF_SIZE:-16384}"
DELAY_MS="${PROTEUS_UF_DELAY_MS:-20}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/usefetch-probe.json"
LOCAL_REPORT="$HERE/results/usefetch-probe.json"
SERVER_LOG="$HERE/results/usefetch-probe-server.log"
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

echo "==> ② 安装 + 触发 usefetch-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path usefetch-probe --es base 'http://127.0.0.1:${PORT}' --ei chunks ${CHUNKS} --ei size ${SIZE} --ei delay_ms ${DELAY_MS}" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path usefetch-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -20 || true
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const p = r.probe || {}
const h = r.host_cancel_stats || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.ok === true, '整体 ok（probe.ok）')
add(p.has_status === true, `★返回值带 status（实得 ${p.stream_status}）——此前被丢弃`)
add(p.has_headers === true, '★返回值带 headers——此前被丢弃')
add(Number(p.streamed_chunks) >= 1, `★流式逐块到达（${p.streamed_chunks} 块）——证明 onChunk 下到了宿主`)
add(p.stream_seq_ok === true, '流式块序号连续')
add(p.cancel_aborted_at === 4, `在第 4 块取消（实得 ${p.cancel_aborted_at}）`)
add(p.cancel_code_ok === true, `★取消码为 fetch.aborted（实得 ${p.cancel_err || '空'}）`)
add(Number(h.hits) >= 1, `★宿主 http.cancel 命中（hits=${h.hits}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({ streamed: p.streamed_chunks, status: p.stream_status, cancel_at: p.cancel_aborted_at })}`)
if (bad) {
  console.log('\n  ★诊断：has_status=false ⇒ 门面仍只回 data；streamed_chunks=0 ⇒ onChunk 没传下去')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1600))
  process.exit(1)
}
console.log('\n✅ useFetch 门面真机生效（流式 + 取消 + status/headers 全部到位）')
NODE
