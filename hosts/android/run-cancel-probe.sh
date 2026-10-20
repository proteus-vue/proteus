#!/usr/bin/env bash
# hosts/android/run-cancel-probe.sh —— ★★★#1121：**取消通道**（S3 回收维度）真机判据（Android）
#
# 【它证明什么（缺一不算取消可用）】
#   ① JS 侧以 `fetch.aborted` reject；
#   ② **后续块不再到达**（只验 reject 太弱：宿主若还在推，回调会被已删 pending 丢弃 ⇒ 看起来"没块了"）；
#   ③ 宿主 `http.cancel` 记账 `hit=true`（取消真的打到宿主）。
#
# 【★为什么服务端要慢（delayMs=20）】太快的话请求在你取消前就结束了 —— 取消窗口根本不存在。
#
# 用法：bash hosts/android/run-cancel-probe.sh [port]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8798}"
CHUNKS="${PROTEUS_CANCEL_PROBE_CHUNKS:-128}"
SIZE="${PROTEUS_CANCEL_PROBE_SIZE:-16384}"
DELAY_MS="${PROTEUS_CANCEL_PROBE_DELAY_MS:-20}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/cancel-probe.json"
LOCAL_REPORT="$HERE/results/cancel-probe.json"
SERVER_LOG="$HERE/results/cancel-probe-server.log"
mkdir -p "$HERE/results"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

echo "==> ① 起本地服务（port ${PORT}，慢速流 delay=${DELAY_MS}ms）"
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

echo "==> ② 安装 + 触发 cancel-probe"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path cancel-probe --es base 'http://127.0.0.1:${PORT}' --ei chunks ${CHUNKS} --ei size ${SIZE} --ei delay_ms ${DELAY_MS}" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path cancel-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 120 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -20 || true
  tail -10 "$SERVER_LOG" || true
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
add(p.rejected === true, '★JS 侧被 reject（取消生效）')
add(p.aborted_code_ok === true, `★错误码是 fetch.aborted（实得 ${p.error_code || p.error_message || '空'}）`)
add(p.aborted_at === 4, `在第 4 块取消（实得 ${p.aborted_at}）`)
add(p.chunks_stopped === true, `★后续块不再到达（取消时 ${p.chunks_at_abort} → 等待后 ${p.chunks_after_wait}）`)
add(Number(h.hits) >= 1, `★宿主 http.cancel 命中（hits=${h.hits} / calls=${h.calls}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：host=${JSON.stringify(h)} · elapsed=${p.elapsed_ms}ms`)
if (bad) {
  console.log('\n  ★诊断：hits=0 ⇒ 取消没打到宿主（在途表未注册或 reqId 不匹配）')
  console.log('    chunks_stopped=false ⇒ 宿主仍在推（JS 侧只是把块丢了）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1500))
  process.exit(1)
}
console.log('\n✅ 取消通道真机生效（JS reject + 后续块停止 + 宿主真的中止了传输）')
NODE
