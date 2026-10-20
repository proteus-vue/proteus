#!/usr/bin/env bash
# hosts/android/run-upload-probe.sh —— ★★★#1120：**流式上传**（S3）真机判据（Android）
#
# 【它证明什么（缺一不算 S3）】
#   ① **JS 侧不碰文件字节**：走 `upload` meta（宿主自读文件），不调 `fs.readBytes`；
#   ② **服务端收到的内容正确**：字节数 / first / last / 采样摘要；
#   ③ **宿主记账** `peak_chunk_bytes` ≈ 16 KiB，与文件总大小**无关**。
#
# 【★大文件怎么来的】先下载一份（走 #1119 的 `savePath`，JS 不碰字节），再上传它——
#   这两件事拼起来才是完整的"大文件迁移"链路。★`fs.writeBytes` 造不出 8 MiB 文件（number[] 会 OOM）。
#
# 用法：bash hosts/android/run-upload-probe.sh [port]
#   PROTEUS_UPLOAD_PROBE_SIZE_MIB 可覆盖（默认 8）
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PORT="${1:-8796}"
SIZE_MIB="${PROTEUS_UPLOAD_PROBE_SIZE_MIB:-8}"
PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
REPORT="/sdcard/Android/data/$PKG/files/upload-probe.json"
LOCAL_REPORT="$HERE/results/upload-probe.json"
SERVER_LOG="$HERE/results/upload-probe-server.log"
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

echo "==> ② 安装 + 触发 upload-probe（size=${SIZE_MIB}MiB：先下载再上传）"
"$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -2
"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
"$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1
if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
  echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; exit 4
fi
"$ADB" shell "am start -n $PKG/.MainActivity --es path upload-probe --es base 'http://127.0.0.1:${PORT}' --ei size_mib ${SIZE_MIB}" >/dev/null 2>&1
bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3 \
  || echo "  ⚠ 未见 run-receiver-ready（30s）"
"$ADB" shell "am broadcast -a dev.proteus.RUN --es path upload-probe -p $PKG" >/dev/null 2>&1

if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 300 --interval 1 --max-interval 3; then
  echo "✗ 报告未生成——看 logcat / 服务日志"
  "$ADB" logcat -d -s 'proteus:I' | tail -20 || true
  tail -10 "$SERVER_LOG" || true
  exit 4
fi

"$ADB" pull "$REPORT" "$LOCAL_REPORT" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; exit 4; }

echo "==> ③ 判定"
node - "$LOCAL_REPORT" "$SIZE_MIB" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const sizeMiB = Number(process.argv[3])
const want = sizeMiB * 1024 * 1024
const p = r.probe || {}
const h = r.host_upload_stats || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(String(r.probe_kick || '').includes('started'), '探针已启动')
add(p.ok === true, '整体 ok（probe.ok）')
add(p.download_ok === true, '前置下载成功（走 savePath，JS 不碰字节）')
add(Number(p.upload_status) === 200, `上传 HTTP 200（实得 ${p.upload_status}）`)
add(Number(p.server_bytes) === want, `服务端收到 ${want}B（实得 ${p.server_bytes}）`)
add(p.first_ok === true, `首字节正确（实得 ${p.server_first}）`)
add(p.last_ok === true, `末字节正确（实得 ${p.server_last}）`)
add(p.fields_ok === true, `表单字段正确（实得 ${JSON.stringify(p.server_fields)}）`)
add(Number(h.file_bytes) === want, `宿主记账文件字节 = ${want}（实得 ${h.file_bytes}）`)
add(h.completed === true, '宿主上传正常完成')
// ★核心：内存只与块大小相关
add(Number(h.peak_chunk_bytes) > 0 && Number(h.peak_chunk_bytes) <= 128 * 1024,
  `★峰值块 ${h.peak_chunk_bytes}B ≤ 128 KiB（与 ${sizeMiB} MiB 文件**无关**）`)
add(Number(h.chunks) > 1, `边读边发（${h.chunks} 块）`)
add(Number(h.total_bytes) > want, `multipart 总长 ${h.total_bytes} > 文件 ${want}（含头部与结尾）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：host=${JSON.stringify(h)}`)
if (bad) {
  console.log('\n  ★诊断：若 server_bytes=0 ⇒ boundary 与 Content-Type 不一致；')
  console.log('    若 peak_chunk_bytes ≈ 文件大小 ⇒ 宿主在攒整包（不是边读边发）')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1800))
  process.exit(1)
}
console.log(`\n✅ 流式上传真机生效（JS 不碰字节 + 峰值块 ${h.peak_chunk_bytes}B 与 ${sizeMiB} MiB 文件无关）`)
NODE
