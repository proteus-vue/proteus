#!/usr/bin/env bash
# hosts/ios/run-transport-probe.sh —— ★★★#1155：**传输层事实取证**（iOS）
#
# 【为什么两端都要跑】"三端同一份语义"要求我们**知道差异**而不是假设一致：
#   · Android 的 `HttpURLConnection`（AOSP 底层 okhttp）默认**不协商 h2**；
#   · iOS 的 `URLSession` 默认**协商 h2 + 复用连接池**。
#   ⇒ 若确实如此，那"HTTP/2"对 App 端而言是**端差异**（不是"都没做"），而连接复用是两端都已具备。
#   ★这直接影响 P1 的工程量判断：要的是"补齐差异端"，不是"三端一起换栈"。
#
# 用法：bash hosts/ios/run-transport-probe.sh [rounds]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

ROUNDS="${1:-3}"
LOCAL_REPORT="$HERE/results/transport-probe.json"
SUPERAPP_REPORT="$HERE/results/superapp.json"
GEN_DIR="$HERE/results/h2-certs"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
mkdir -p "$HERE/results" "$GEN_DIR"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then echo "✗ 取不到本机局域网 IP"; exit 2; fi

pick_free_port() {
  local p="$1"
  while [ "$p" -lt $(( $1 + 100 )) ]; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || { printf '%s' "$p"; return 0; }
    p=$((p + 1))
  done
  return 1
}
PORT="$(pick_free_port 9300)" || { echo "✗ 找不到空闲端口"; exit 3; }

rm -f "$LOCAL_REPORT" "$SUPERAPP_REPORT" "$GEN_DIR"/*.crt "$GEN_DIR"/*.key 2>/dev/null || true
echo "==> ① 起 h2 服务（port ${PORT}，SAN 含 ${LAN_IP}）"
node "$ROOT/hosts/android/tools/h2-echo-server.mjs" "$PORT" "--gen-dir=$GEN_DIR" "--san=DNS:localhost,IP:127.0.0.1,IP:${LAN_IP}" > "$HERE/results/transport-probe-server-ios.log" 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; }
trap cleanup EXIT

bash "$WAIT_SH" --port "127.0.0.1:${PORT}" --timeout 20 --interval 1 --max-interval 2 \
  || { echo "✗ 服务未就绪"; exit 3; }
PIN="$(curl -sk "https://127.0.0.1:${PORT}/__pin" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).spki||''))}catch{}})" | tr -d '\r\n')"
[ -n "$PIN" ] || { echo "✗ 取不到 SPKI 指纹"; exit 3; }
echo "    服务就绪；pin=${PIN}"

echo "==> ② 构建 + 安装 + 启动（superapp --transport-probe）"
bash "$HERE/run-selfdraw.sh" --superapp "--transport-probe=https://${LAN_IP}:${PORT},${PIN},${ROUNDS}" 2>&1 \
  | grep -viE "^warning|unused variable" | tail -8

[ -f "$SUPERAPP_REPORT" ] || { echo "✗ 报告未取回（${SUPERAPP_REPORT}）"; exit 4; }
cp -f "$SUPERAPP_REPORT" "$LOCAL_REPORT"
echo "    证据已落盘：$LOCAL_REPORT"

echo "==> ③ 取证结论（以**服务端记账**为准）"
node - "$LOCAL_REPORT" "$ROUNDS" <<'NODE'
const fs = require('fs')
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const rounds = Number(process.argv[3])
let p = r.transport_probe
if (typeof p === 'string') { try { p = JSON.parse(p) } catch { p = null } }
p = p || {}
const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(p.first_ok === true, `首轮请求成功〔err=${p.req_error || '-'}〕`)
add(Array.isArray(p.client_protos) && p.client_protos.length === rounds, `客户端收到 ${p.client_protos?.length}/${rounds} 次响应`)

const protos = p.server_protocols || {}
const reqs = Number(p.server_requests || 0)
const conns = Number(p.server_connections || 0)
// ★iOS 的判据与 Android **不同**：这里只断言"拿到了读数"，不预设它必须是 h2 或必须复用
//   —— 那是**取证结论**（记录到证据文件），不是"通过/失败"。
add(reqs > 0 && conns > 0, `服务端记账可用（请求 ${reqs} / TCP 连接 ${conns}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }
console.log(`\n  取证读数：${JSON.stringify({
  客户端看到的协议: p.client_protos,
  客户端看到的连接身份: p.client_peers,
  服务端协议分布: protos,
  服务端请求数: reqs,
  服务端TCP连接数: conns,
  逐连接请求数: ((p.server_stats || {}).channels || {}).tls?.conns,
  连接复用: p.conn_reused_ok === true,
  HTTP2已协商: p.http2_ok === true,
})}`)
if (bad) { console.log('  报告原文：' + JSON.stringify(r).slice(0, 1600)); process.exit(1) }
console.log('\n✅ iOS 传输层取证完成：HTTP/2 = ' + (p.http2_ok === true ? '**已协商**' : '未协商') + '；连接复用 = ' + (reqs > conns ? '**是**' : '否'))
NODE
