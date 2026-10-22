#!/usr/bin/env bash
# hosts/ios/run-httpdns-route-b-probe.sh —— ★★★#1178：**iOS HTTPDNS 的 B 路线可行性探针**
#
# 【要回答的问题（#1176 的唯一未定性缺口）】
#   iOS 的 `kCFNetworkProxiesHTTPSEnable` 在 SDK 头文件里标成 `CF_AVAILABLE(10_6, NA)`（iOS 不可用），
#   只留 `kCFNetworkProxiesHTTPEnable`（iOS 可用）。那么：**配了 HTTP 代理键之后，
#   `https://` 请求到底会不会交给代理？** ——头文件判不出来，只能实测。
#   若会（以 `CONNECT` 隧道形式）⇒ **B 路线（本地代理做 HTTPDNS）在 iOS 上可行**。
#
# 【判据三条（每条都必须有读数，不接受"看起来对"）】
#   ① 代理真的收到了 `CONNECT host:port`（不是明文绝对 URI，也不是没流量）
#   ② TLS 服务端的 `SNICallback` 读到的 servername == **原域名**（SNI 没退化成 IP）
#   ③ N 次请求只产生 1 个 CONNECT（隧道内连接复用没退化）
#
# 【为什么用 sni-probe.local 这个不存在的域名】
#   如果用的是公网域名，请求成功可能只是"代理没生效、直连成功"。用一个**无 DNS 记录**的
#   假域名 ⇒ ① 系统解析必然失败 ② 只有代理（按固定映射转发到本地 TLS 服务端）能让它成功
#   ⇒ "200" 本身就成了"代理真的接管了"的证据。
#
# 【诚实边界】
#   · 本探针跑在**模拟器**（同一份 CFNetwork）；真机需 Xcode ≥15 的 `devicectl`（本机 14.2 没有）。
#   · TLS 服务端用**自签证书 + 探针无条件信任**（仅为本探针读 SNI，绝不进生产）。
#   · 隧道内是 HTTP/1.1（本地服务端没开 h2）；公网实测那次是 `http/http/2`，见 02 篇。
#
# 用法：bash hosts/ios/run-httpdns-route-b-probe.sh [repeats]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/lib/xcode-env.sh"

REPEATS="${1:-3}"
PROXY_PORT="${PROTEUS_B_PROXY_PORT:-18898}"
TLS_PORT="${PROTEUS_B_TLS_PORT:-18443}"
OUT_DIR="$HERE/results"
OUT_JSON="$OUT_DIR/httpdns-route-b.json"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
BUILD_DIR="$(mktemp -d)"
PROBES_DIR="$ROOT/hosts/ios/probes/httpdns-route-b"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -d "$PROBES_DIR" ] || { echo "✗ 缺探针源码目录 $PROBES_DIR"; exit 2; }

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/httpdns-route-b-proxy.json" "$OUT_DIR/httpdns-route-b-sni.json" "$OUT_JSON"

cleanup() {
  [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true
  [ -n "${TLS_PID:-}" ] && kill "$TLS_PID" 2>/dev/null || true
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

echo "==> ① 编译探针（模拟器，与真机同一份 CFNetwork）"
DEVDIR="${DEVELOPER_DIR:-$(xcode-select -p 2>/dev/null)}"
[ -n "$DEVDIR" ] || { echo "✗ 找不到 Xcode（xcode-select -p 为空）"; exit 3; }
SDK="$(/usr/bin/xcrun --sdk iphonesimulator --show-sdk-path 2>/dev/null || true)"
[ -n "$SDK" ] || { echo "✗ 取不到 iphonesimulator SDK"; exit 3; }
ARCH="$(uname -m)"
/usr/bin/xcrun -sdk iphonesimulator swiftc \
  -o "$BUILD_DIR/ios-proxy-probe" "$PROBES_DIR/ios-proxy-probe.swift" \
  -target "${ARCH}-apple-ios16.2-simulator" 2>&1 | head -10
/usr/bin/xcrun -sdk iphonesimulator swiftc \
  -o "$BUILD_DIR/ios-sni-probe" "$PROBES_DIR/ios-sni-probe.swift" \
  -target "${ARCH}-apple-ios16.2-simulator" 2>&1 | head -10
[ -x "$BUILD_DIR/ios-proxy-probe" ] && [ -x "$BUILD_DIR/ios-sni-probe" ] \
  || { echo "✗ 探针编译失败"; exit 3; }

echo "==> ② 起本地代理 + 自签 TLS 服务端"
# ★预检：端口被旧进程占着时，新进程 bind 失败会被静默吞掉，而 `wait_for --port` 因旧进程
#   在监听照样通过 ⇒ 探针读的是**别人**的记账（本次实测踩过：假域名 200 但 connectCount=0）。
#   ⇒ 必须先确认端口空闲，否则判据全部失效。
for p in "$PROXY_PORT" "$TLS_PORT"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✗ 端口 $p 已被占用（残留进程会让本次判据读别人的记账）"
    echo "  排查：lsof -nP -iTCP:$p -sTCP:LISTEN"
    exit 4
  fi
done

node "$PROBES_DIR/proxy-probe-server.mjs" "$PROXY_PORT" "$OUT_DIR/httpdns-route-b-proxy.json" >/dev/null 2>&1 &
PROXY_PID=$!
node "$PROBES_DIR/sni-server.mjs" "$TLS_PORT" "$OUT_DIR/httpdns-route-b-sni.json" >/dev/null 2>&1 &
TLS_PID=$!

# ★就绪判据用**文件**（服务端 listen 后写 events），不用 --port：
#   文件出现 = 我们自己的进程真的活到 listen 之后，不被别人的监听冒充。
bash "$WAIT_SH" --file "$OUT_DIR/httpdns-route-b-proxy.json" --timeout 15 --interval 1 --max-interval 2 >/dev/null \
  || { echo "✗ 代理未就绪"; exit 3; }
bash "$WAIT_SH" --file "$OUT_DIR/httpdns-route-b-sni.json" --timeout 15 --interval 1 --max-interval 2 >/dev/null \
  || { echo "✗ TLS 服务端未就绪"; exit 3; }

SIM="${PROTEUS_SIM_UDID:-}"
if [ -z "$SIM" ]; then
  SIM="$(/usr/bin/xcrun simctl list devices available 2>/dev/null \
    | grep -E "iPhone.*\((Booted|Shutdown)\)" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
fi
[ -n "$SIM" ] || { echo "✗ 没有可用模拟器（xcrun simctl list devices available）"; exit 3; }

echo "==> ③ 启动模拟器（${SIM}）"
/usr/bin/xcrun simctl bootstatus "$SIM" -b 2>&1 | tail -2

echo "==> ④ 对照组：不配代理，直连公网（确认测试环境本身可用）"
/usr/bin/xcrun simctl spawn "$SIM" "$BUILD_DIR/ios-proxy-probe" 0 \
  https://www.cloudflare.com/cdn-cgi/trace 1 2>/dev/null | tail -1 > "$OUT_DIR/httpdns-route-b-baseline.json" || true

echo "==> ⑤ 公网经代理（h2 / SNI / 复用）"
/usr/bin/xcrun simctl spawn "$SIM" "$BUILD_DIR/ios-proxy-probe" "$PROXY_PORT" \
  https://www.cloudflare.com/cdn-cgi/trace "$REPEATS" 2>/dev/null | tail -1 \
  > "$OUT_DIR/httpdns-route-b-public.json" || true

echo "==> ⑥ 假域名经代理（证明代理真的接管了解析）"
/usr/bin/xcrun simctl spawn "$SIM" "$BUILD_DIR/ios-sni-probe" "$PROXY_PORT" \
  "https://sni-probe.local:${TLS_PORT}/" "$REPEATS" 2>/dev/null | tail -1 \
  > "$OUT_DIR/httpdns-route-b-fakedomain.json" || true

# 让两个服务端把 summary 落盘（SIGTERM 触发）
kill -TERM "$PROXY_PID" 2>/dev/null || true
kill -TERM "$TLS_PID" 2>/dev/null || true
PROXY_PID=""; TLS_PID=""
bash "$WAIT_SH" --file "$OUT_DIR/httpdns-route-b-proxy.json" --timeout 5 --interval 1 >/dev/null 2>&1 || true

echo "==> ⑦ 判定"
node - "$OUT_DIR" "$REPEATS" <<'NODE'
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const repeats = Number(process.argv[3] || 3)
const rd = (f) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null }
}
const proxy = rd('httpdns-route-b-proxy.json')
const sni = rd('httpdns-route-b-sni.json')
const pub = rd('httpdns-route-b-public.json')
const fake = rd('httpdns-route-b-fakedomain.json')
const base = rd('httpdns-route-b-baseline.json')

const ev = (proxy && proxy.events) || []
const connects = ev.filter((e) => e.kind === 'connect')
const plain = ev.filter((e) => e.kind === 'request')
const sniEvents = ((sni && sni.events) || []).filter((e) => e.kind === 'sni')
const sniValues = sniEvents.map((e) => e.servername)
const tlsReqs = ((sni && sni.events) || []).filter((e) => e.kind === 'request')

const chk = []
const add = (ok, msg) => chk.push([ok, msg])

// ① 代理真的收到 CONNECT
add(connects.length > 0, `代理收到 CONNECT（${connects.length} 个：${connects.map((c) => c.url).join(', ') || '无'}）`)
add(plain.length === 0, `无明文绝对 URI 请求（实得 ${plain.length}）`)
// ② SNI 是原域名
add(sniValues.length > 0, `TLS 服务端读到 SNI（${sniValues.join(', ') || '无'}）`)
// ★空数组时 every() 恒 true ⇒ 必须显式要求"至少一条 SNI"再判内容（否则这条是假绿）
add(sniValues.length > 0 && sniValues.every((v) => v === 'sni-probe.local'),
  `★SNI == 原域名（实得 ${JSON.stringify(sniValues)}）`)
// 假域名 200 ⇒ 代理接管了"解析"
add(fake && fake.status === 200, `★无 DNS 记录的假域名经代理成功（status=${fake ? fake.status : 'null'}）`)
add(!!(fake && String(fake.bodyFirst || '').includes('sni-probe.local')), 'Host 头保留原域名')
// ③ 复用
const fakeConnects = connects.filter((c) => c.url === 'sni-probe.local:' + (process.env.PROTEUS_B_TLS_PORT || 18443))
add(
  fakeConnects.length >= 1 && fakeConnects.length < repeats,
  `★${repeats} 次请求只建 ${fakeConnects.length} 个隧道（< ${repeats} ⇒ 隧道内连接复用）`,
)
// 对照组
add(base && base.status === 200, `对照组（不配代理直连）成功（status=${base ? base.status : 'null'}）`)
// 公网经代理仍 h2
const pubTrace = (pub && pub.trace) || {}
add(pub && pub.status === 200, `公网经代理 status=200（实得 ${pub ? pub.status : 'null'}）`)
add(pubTrace.http === 'http/2', `★公网经代理仍是 h2（实得 ${pubTrace.http || '空'}）`)
add(pubTrace.visit_scheme === 'https', `端到端仍是 https（实得 ${pubTrace.visit_scheme || '空'}）`)

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }

const summary = {
  verdict: bad === 0 ? 'ROUTE_B_FEASIBLE' : 'ROUTE_B_BLOCKED',
  connectCount: connects.length,
  connectTargets: connects.map((c) => c.url),
  sniValues,
  publicTrace: pubTrace,
  failedChecks: chk.filter(([ok]) => !ok).map(([, m]) => m),
}
fs.writeFileSync(path.join(dir, 'httpdns-route-b.json'), JSON.stringify(summary, null, 2))

if (bad) {
  console.log('\n  ★诊断：connectCount=0 ⇒ 代理配置对 https 无效（B 路线需换手段）')
  console.log('  summary：' + JSON.stringify(summary, null, 2))
  process.exit(1)
}
console.log('\n✅ B 路线在 iOS 上可行：https 经 HTTP 代理键走 CONNECT 隧道，SNI/Host/h2/复用全保留')
NODE
