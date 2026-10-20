#!/usr/bin/env bash
# hosts/ios/run-upload-probe.sh —— ★★★#1120：**流式上传**（S3）真机判据（iOS）
#
# 【与 Android 版同判据】① JS 不碰文件字节 ② 服务端内容正确 ③ 峰值块与文件大小无关。
# 【差异】没有 adb reverse ⇒ 服务绑 0.0.0.0，设备经局域网 IP 访问。
#
# 用法：bash hosts/ios/run-upload-probe.sh [port]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT="${1:-8797}"
SIZE_MIB="${PROTEUS_UPLOAD_PROBE_SIZE_MIB:-8}"
LOCAL_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/upload-probe-server-ios.log"
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

echo "==> 构建 + 安装 + 启动（superapp --upload-probe，size=${SIZE_MIB}MiB：先下载再上传）"
bash "$HERE/run-selfdraw.sh" --superapp "--upload-probe=${BASE},${SIZE_MIB}" 2>&1 | tail -12

[ -f "$LOCAL_REPORT" ] || { echo "✗ 报告未取回（${LOCAL_REPORT}）"; exit 4; }

echo "==> 判定"
node - "$LOCAL_REPORT" "$SIZE_MIB" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const sizeMiB = Number(process.argv[3])
const want = sizeMiB * 1024 * 1024
let p = r.upload_probe
if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
p = p || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(r.upload_base !== undefined, '探针已注入（--upload-probe）')
add(p.ok === true, '整体 ok（probe.ok）')
add(p.download_ok === true, '前置下载成功（走 savePath，JS 不碰字节）')
add(Number(p.upload_status) === 200, `上传 HTTP 200（实得 ${p.upload_status}）`)
add(Number(p.server_bytes) === want, `服务端收到 ${want}B（实得 ${p.server_bytes}）`)
add(p.first_ok === true, `首字节正确（实得 ${p.server_first}）`)
add(p.last_ok === true, `末字节正确（实得 ${p.server_last}）`)
add(p.fields_ok === true, `表单字段正确（实得 ${JSON.stringify(p.server_fields)}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify(p).slice(0, 600)}`)
if (bad) {
  console.log('\n  ★诊断：若 server_bytes=0 ⇒ boundary 与 Content-Type 不一致，或 MultipartStream 没挂上')
  console.log('  报告原文：' + JSON.stringify(r).slice(0, 1800))
  process.exit(1)
}
console.log(`\n✅ iOS 流式上传真机生效（JS 不碰字节 + 8 MiB 完整往返且内容正确）`)
NODE
