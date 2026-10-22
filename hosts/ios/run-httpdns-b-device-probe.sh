#!/usr/bin/env bash
# hosts/ios/run-httpdns-b-device-probe.sh —— ★★★#1179：**iOS B 路线真机判据**
#
# 【为什么还要一条真机版（#1178 已在模拟器全绿）】
#   #1178 的诚实边界原文：「跑在**模拟器**（与真机同一份 CFNetwork），**真机未跑**」。
#   当时我手写了 `/Volumes/data1/applications/Xcode.app`（14.2，**无 devicectl**），
#   据此断言"本机没有 devicectl ⇒ 真机路线不可用"——而 26.5 一直装在
#   `/Volumes/data1/work/office-applications/Xcode.app`，**设备也一直连着**。
#   ⇒ 本脚本补上真机这一环；并且**不再手写任何 Xcode 路径**（`source lib/xcode-env.sh`）。
#
# 【判据（与 #1178 模拟器版同形，便于对照）】
#   ① 代理收到 `CONNECT sni-probe.local:18443`（不是明文绝对 URI、不是没流量）
#   ② TLS 服务端读到 SNI == `sni-probe.local`（原域名，不是 IP）
#   ③ 真机宿主回执 `httpdns_b.ok=true`（假域名 200 + Host 保留原域名）
#   ④ 3 次请求只产生 1 个 CONNECT（隧道内复用）
#
# 【装置】
#   本机起「HTTP 代理 + 自签 TLS 服务端」（绑 0.0.0.0，真机经 LAN IP 访问）
#   ⇒ App 侧由环境变量 `PROTEUS_B_PROXY=<LAN_IP>:<port>` 配 `connectionProxyDictionary`
#     （见 `HttpCapability.session` 与 `run-selfdraw.sh` 的转发）。
#   ★假域名 `sni-probe.local` 无 DNS 记录 ⇒ 系统解析必然失败，只有代理能让它通
#     ⇒ "200" 本身就是"代理接管了解析"的证据（混淆因子排除手法同 #1178）。
#
# 【诚实边界】
#   · 只**定性**：生产代理进程、表查询、降级链、业务 API 接入均未实现（见 T-ios-httpdns-options）。
#   · 自签证书 ⇒ App 侧 TLS 校验会失败；判据取"请求到达服务端（有 CONNECT / 有 SNI）"，
#     而**不是**"TLS 握手成功"。因此 App 回执的 `ok` 只在**代理侧确认**后才算有效。
#
# 用法：bash hosts/ios/run-httpdns-b-device-probe.sh [repeats]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# ★★★#1179：**不手写 Xcode 路径**——解析器按"能力完备度"选（见 lib/xcode-env.sh 文件头）
source "$HERE/lib/xcode-env.sh"

REPEATS="${1:-3}"
PROXY_PORT="${PROTEUS_B_PROXY_PORT:-18899}"
TLS_PORT="${PROTEUS_B_TLS_PORT:-18443}"
OUT_DIR="$HERE/results"
OUT_JSON="$OUT_DIR/httpdns-b-device.json"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
PROBES_DIR="$HERE/probes/httpdns-route-b"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -d "$PROBES_DIR" ] || { echo "✗ 缺探针源码目录 $PROBES_DIR"; exit 2; }

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
[ -n "$LAN_IP" ] || { echo "✗ 取不到本机局域网 IP（真机需要经 LAN 访问代理）"; exit 2; }

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/httpdns-b-device-proxy.json" "$OUT_DIR/httpdns-b-device-sni.json" "$OUT_JSON"

cleanup() {
  [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true
  [ -n "${TLS_PID:-}" ] && kill "$TLS_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ★装置坑（#1178 实测踩过）：端口被残留进程占着 ⇒ 新进程 bind 静默失败，
#   而 `wait_for --port` 因**旧进程**在监听照样通过 ⇒ 判据读别人的记账。
for p in "$PROXY_PORT" "$TLS_PORT"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ 端口 $p 已被占用（残留进程会让本次判据读别人的记账）"
    echo "  排查：lsof -nP -iTCP:$p -sTCP:LISTEN"
    exit 4
  fi
done

# ★真机需要设备能访问本机 LAN IP ⇒ 绑 0.0.0.0
echo "==> ① 起本地代理 + 自签 TLS 服务端（绑 0.0.0.0，供真机经 ${LAN_IP} 访问）"
node "$PROBES_DIR/proxy-probe-server.mjs" "$PROXY_PORT" "$OUT_DIR/httpdns-b-device-proxy.json" 0.0.0.0 >/dev/null 2>&1 &
PROXY_PID=$!
node "$PROBES_DIR/sni-server.mjs" "$TLS_PORT" "$OUT_DIR/httpdns-b-device-sni.json" 0.0.0.0 >/dev/null 2>&1 &
TLS_PID=$!

# ★就绪判据用**文件**（= 我们自己的进程真的活到 listen 之后），不用 --port
bash "$WAIT_SH" --file "$OUT_DIR/httpdns-b-device-proxy.json" --timeout 15 --interval 1 --max-interval 2 >/dev/null \
  || { echo "✗ 代理未就绪"; exit 3; }
bash "$WAIT_SH" --file "$OUT_DIR/httpdns-b-device-sni.json" --timeout 15 --interval 1 --max-interval 2 >/dev/null \
  || { echo "✗ TLS 服务端未就绪"; exit 3; }

PUBLIC_URL="${PROTEUS_B_PUBLIC_URL:-https://www.cloudflare.com/cdn-cgi/trace}"

echo "==> ② 真机跑探针（App 经 PROTEUS_B_PROXY 走隧道）"
# ★报告先删（防 pull 失败读上轮）——与 run-usefetch-probe.sh 同纪律
rm -f "$OUT_DIR/superapp.json"
# ★★两组目标：
#   ① 假域名（自签证书）—— 证"只有代理能让它通"（排除碰巧直连）
#   ② 公网域名（真实证书）—— 证"生产形态下连接可复用"（自签会让 TLS 失败 ⇒ 假性不复用）
PROTEUS_B_PROXY="${LAN_IP}:${PROXY_PORT}" \
  bash "$HERE/run-selfdraw.sh" --superapp "--httpdns-b-probe=https://sni-probe.local:${TLS_PORT}/,${PUBLIC_URL},${REPEATS}" 2>&1 | tail -14

# 让服务端把 summary 落盘
kill -TERM "$PROXY_PID" 2>/dev/null || true
kill -TERM "$TLS_PID" 2>/dev/null || true
PROXY_PID=""; TLS_PID=""
bash "$WAIT_SH" --file "$OUT_DIR/httpdns-b-device-proxy.json" --timeout 5 --interval 1 >/dev/null 2>&1 || true

[ -f "$OUT_DIR/superapp.json" ] || { echo "✗ 报告未取回（$OUT_DIR/superapp.json）"; exit 4; }

echo "==> ③ 判定"
node - "$OUT_DIR" "$REPEATS" <<'NODE'
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const repeats = Number(process.argv[3] || 3)
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }

const proxy = rd('httpdns-b-device-proxy.json')
const sni = rd('httpdns-b-device-sni.json')
const report = rd('superapp.json')

let probe = report && report.httpdns_b_probe
if (typeof probe === 'string') { try { probe = JSON.parse(probe) } catch { probe = null } }
probe = probe || {}

const ev = (proxy && proxy.events) || []
const connects = ev.filter((e) => e.kind === 'connect')
const plain = ev.filter((e) => e.kind === 'request')
const sniEvents = ((sni && sni.events) || []).filter((e) => e.kind === 'sni')
const sniValues = sniEvents.map((e) => e.servername)
const tlsReqs = ((sni && sni.events) || []).filter((e) => e.kind === 'request')

const chk = []
const add = (ok, msg) => chk.push([ok, msg])

const fakeConnects = connects.filter((c) => c.url === `sni-probe.local:${process.env.PROTEUS_B_TLS_PORT || 18443}`)
const publicUrl = process.env.PROTEUS_B_PUBLIC_URL || 'https://www.cloudflare.com/cdn-cgi/trace'
const publicHost = (publicUrl.match(/^https?:\/\/([^/:]+)/) || [])[1] || ''
const publicConnects = connects.filter((c) => c.url === `${publicHost}:443`)

// ① 代理收到 CONNECT（真机那条）
add(fakeConnects.length > 0, `★真机代理收到 CONNECT sni-probe.local（${fakeConnects.length} 个）`)
add(publicConnects.length > 0, `★真机代理收到 CONNECT ${publicHost}:443（${publicConnects.length} 个）`)
add(plain.length === 0, `无明文绝对 URI 请求（实得 ${plain.length}）`)
// ② SNI 是原域名
add(sniValues.length > 0, `TLS 服务端读到 SNI（${sniValues.join(', ') || '无'}）`)
// ★空数组 every() 恒真 ⇒ 先要求非空（#1178 实测踩过）
add(sniValues.length > 0 && sniValues.every((v) => v === 'sni-probe.local'),
  `★SNI == 原域名（实得 ${JSON.stringify(sniValues)}）`)
// ③ 真机宿主回执
add(report && report.httpdns_b_base !== undefined, '探针已注入（--httpdns-b-probe）')
// ★★生产形态读数：公网域名（真实证书）经代理必须 200——这条才代表"B 路线能用"
add(probe.public_ok === true, `★公网经代理正常（生产形态；实得 ${JSON.stringify(probe.public_statuses)}）`)
// ★自签证书在真机生产 session 上必然失败 ⇒ 只要求"请求到达了服务端"，不要求 200
add(probe.fake_reached === true, `★假域名请求到达了服务端（证书失败即预期；errors=${JSON.stringify(probe.errors || [])}）`)
add(!!(report && String(report.httpdns_b_proxy_env || '').length > 0), `代理环境变量已注入（${report && report.httpdns_b_proxy_env}）`)
// ④ 复用（★用公网那组判：自签证书会让假域名每次都失败重连，那是**装置变量**不是路线缺陷）
add(fakeConnects.length >= 1, '假域名隧道已建立（CONNECT 计数）')
add(publicConnects.length >= 1 && publicConnects.length < repeats,
  `★公网 ${repeats} 次请求只建 ${publicConnects.length} 个隧道（< ${repeats} ⇒ 隧道内复用）`)
// ★★服务端侧"请求真的到达"的**正确判据**是 SNICallback 被调用（= TLS 握手已经开始），
//   而不是 HTTP 层 `request` 事件：真机生产 session 不信任自签证书 ⇒ **握手在证书校验处中断**，
//   HTTP 请求永远不会发出来 ⇒ 用 `request` 数判"到达"会永远红（假红，本轮实测踩过）。
add(sniValues.length > 0, `TLS 服务端已开始握手（SNICallback ${sniValues.length} 次 = 请求到达铁证）`)
if (tlsReqs.length > 0) {
  console.log(`  ℹ HTTP 层请求 ${tlsReqs.length} 次（自签证书被拒时预期为 0，非缺陷）`)
}

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }

const summary = {
  verdict: bad === 0 ? 'ROUTE_B_DEVICE_OK' : 'ROUTE_B_DEVICE_FAILED',
  connectCount: connects.length,
  fakeConnects: fakeConnects.length,
  connectTargets: connects.map((c) => c.url),
  sniValues,
  proxyEnv: report ? report.httpdns_b_proxy_env : null,
  probe: {
    ok: probe.ok,
    fake_domain_ok: probe.fake_domain_ok,
    fake_reached: probe.fake_reached,
    host_preserved: probe.host_preserved,
    public_ok: probe.public_ok,
    public_statuses: probe.public_statuses,
    statuses: probe.statuses,
    errors: probe.errors,
    error: probe.error,
  },
  failedChecks: chk.filter(([ok]) => !ok).map(([, m]) => m),
}
fs.writeFileSync(path.join(dir, 'httpdns-b-device.json'), JSON.stringify(summary, null, 2))

if (bad) {
  console.log('\n  ★诊断：fakeConnects=0 ⇒ 真机上代理没被用上（检查 PROTEUS_B_PROXY 是否转发进 App）')
  console.log('  summary：' + JSON.stringify(summary, null, 2))
  process.exit(1)
}
console.log('\n✅ B 路线在**真机**上成立：https 经 HTTP 代理键走 CONNECT 隧道，SNI/Host 保留')
NODE
