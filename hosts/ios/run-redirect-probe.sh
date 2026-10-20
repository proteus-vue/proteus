#!/usr/bin/env bash
# hosts/ios/run-redirect-probe.sh —— ★★★#1134：**重定向拦截**真机判据（iOS）
#
# 【与 Android 同判据】① manual 拿到 302+Location ② 两跳回调 2 次 ③ stop 只调 1 次
#   ④ 环超额 ⇒ tooManyRedirects ⑤ **跨域剥离 Authorization（服务端视角取证）**。
# 【差异】没有 adb reverse ⇒ 服务绑 0.0.0.0，设备经局域网 IP 访问**两个端口**（造跨域）。
#
# 用法：bash hosts/ios/run-redirect-probe.sh [portA] [portB]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

PORT_A="${1:-8801}"
PORT_B="${2:-8802}"
MAX_REDIRECTS="${PROTEUS_REDIRECT_PROBE_MAX:-2}"
# ★iOS 报告是**单槽** `superapp.json`（探针读数在 `redirect_probe` 字段里，不是独立文件）
LOCAL_REPORT="$HERE/results/superapp.json"
SERVER_LOG="$HERE/results/redirect-probe-server-ios.log"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then echo "✗ 取不到本机局域网 IP"; exit 2; fi
BASE="http://${LAN_IP}:${PORT_A}"
CROSS="http://${LAN_IP}:${PORT_B}"
echo "==> 服务基址（设备侧）：A=$BASE B=$CROSS —— 两个 origin，可验跨域剥离"

mkdir -p "$HERE/results"
rm -f "$LOCAL_REPORT" "$SERVER_LOG"

node "$ROOT/hosts/android/tools/redirect-echo-server.mjs" "$PORT_A" "$PORT_B" 0.0.0.0 > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_A}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务 A 未就绪（见 ${SERVER_LOG}）"; exit 3
fi
if ! bash "$WAIT_SH" --port "127.0.0.1:${PORT_B}" --timeout 15 --interval 1 --max-interval 2; then
  echo "✗ 服务 B 未就绪（见 ${SERVER_LOG}）"; exit 3
fi
echo "    两个服务已就绪"

echo "==> 构建 + 安装 + 启动（superapp --redirect-probe，max=${MAX_REDIRECTS}）"
bash "$HERE/run-selfdraw.sh" --superapp "--redirect-probe=${BASE},${CROSS},${MAX_REDIRECTS}" 2>&1 | tail -12

[ -f "$LOCAL_REPORT" ] || { echo "✗ 报告未取回（${LOCAL_REPORT}）"; exit 4; }

echo "==> 判定"
node - "$LOCAL_REPORT" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
// iOS 的报告是单槽（`superapp.json`）⇒ 探针读数在 `redirect_probe` 字符串里
let p = r.probe
if (!p && typeof r.redirect_probe === 'string') {
  try { p = JSON.parse(r.redirect_probe) } catch { p = null }
}
if (!p) { console.log('✗ 报告里没有 redirect_probe 读数：' + JSON.stringify(r).slice(0, 800)); process.exit(1) }

const chk = []
const add = (ok, msg) => chk.push([ok, msg])
add(p.ok === true, '整体 ok（probe.ok）')
add(p.manual_status === 302, `★manual 拿到 302（实得 ${p.manual_status}）——不是跳到终点`)
add(p.manual_has_location === true, `★响应带 Location（实得 ${p.manual_location || '空'}）`)
add(p.hop_count === 2, `★两跳链回调 2 次（实得 ${p.hop_count}）`)
add(p.hop_from_to_ok === true, '每跳 from/to 都可读且不同')
add(p.hop_final_ok === true, '逐跳跟随后成功到终点')
add(p.stop_ok === true, `★stop ⇒ fetch.redirectStopped（实得 ${p.stop_code}）`)
add(p.stop_single_call === true, `★stop 后不再调回调（实得 ${p.stop_calls} 次）`)
add(p.limit_ok === true, `★限额拦住环 ⇒ fetch.tooManyRedirects（实得 ${p.limit_code}）`)
add(p.cross_stripped === true, `★★跨域剥离 Authorization（服务端终点收到 "${p.cross_final_auth ?? ''}"）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  读数：${JSON.stringify({
  manual: p.manual_status,
  hops: p.hop_count,
  stop: p.stop_code,
  limit: p.limit_code,
  cross_auth: p.cross_final_auth,
})}`)
if (bad) {
  console.log('\n  ★诊断：manual_status=200 ⇒ 宿主仍跟随（willPerformHTTPRedirection 未生效）；')
  console.log('          cross_final_auth 非空 ⇒ ★凭据泄露到第三方域（安全缺陷，必修）')
  console.log('  报告原文：' + JSON.stringify(p).slice(0, 1600))
  process.exit(1)
}
console.log('\n✅ 重定向可拦（iOS：manual / 逐跳拦截 / 限额 / 跨域剥离凭据 全部到位）')
NODE
