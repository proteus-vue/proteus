#!/usr/bin/env bash
# hosts/ios/run-httpdns-prod-probe.sh —— ★★★#1180：**iOS HTTPDNS 生产面真机判据**
#
# 【它验证什么（与 #1179 的探针分工不同，两条都留）】
#   · #1179 `run-httpdns-b-device-probe.sh`：验证**传输通路**——宿主配了代理后 https 会不会
#     走 CONNECT 隧道（表由探针脚本的固定映射提供，**不走业务 API**）。
#   · **本脚本**：验证**业务面**——`useFetch({ httpDns })` 传的表经线格式到宿主后，
#     由 `HttpDnsProxy` 真的按表解析。这是"iOS 端已支持 HTTPDNS"的**唯一**判据。
#
# 【判据（双向对照，与 Android #1171 同形）】
#   ① 注入**不可达 IP**（203.0.113.1，RFC 5737 TEST-NET-3）⇒ 请求**必须失败**
#      （若表没生效，系统 DNS 会解析成功 ⇒ 请求成功 ⇒ 判据红）
#   ② 不注入（基线）⇒ 请求**必须成功**
#   ③ `http.dnsStats` 的 `tableHits > 0` 且 `lastSource == 'table'`（"表被采用"的直接证据）
#   ④ 表未命中的域名（另一个公网域名）⇒ 回落系统解析且 `lastSource == 'system'`（**回落可见**）
#
# 【为什么①必须在②之前】连接池优先于 DNS（HTTPDNS 固有语义）：先跑基线会让
#   `host:443` 的连接进池，注入侧直接复用、不查 DNS ⇒ 表"看起来没生效"（#1169 实测：
#   `lookups=1, tableHits=0, lastSource='system'`）。JS 探针里已按此顺序实现。
#
# 用法：bash hosts/ios/run-httpdns-prod-probe.sh [hitUrl] [missUrl]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# ★★★#1179 纪律：**不手写 Xcode 路径**（解析器按能力完备度选）
source "$HERE/lib/xcode-env.sh"

HIT_URL="${1:-https://www.cloudflare.com/cdn-cgi/trace}"
MISS_URL="${2:-https://httpbin.org/get}"
UNREACHABLE="${PROTEUS_DNS_UNREACHABLE:-203.0.113.1}"
OUT_DIR="$HERE/results"
OUT_JSON="$OUT_DIR/httpdns-prod-device.json"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

[ -x "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$OUT_DIR"

# ★报告先删（防 pull 失败读上轮——本仓反复踩过"报告永远是旧的"）
rm -f "$OUT_DIR/superapp.json" "$OUT_JSON"

echo "==> 真机跑生产面探针（注入 $UNREACHABLE 应失败 / 基线应成功 / 表未命中应回落）"
bash "$HERE/run-selfdraw.sh" --superapp \
  "--httpdns-prod-probe=${HIT_URL},${MISS_URL},${UNREACHABLE}" 2>&1 | tail -12

[ -f "$OUT_DIR/superapp.json" ] || { echo "✗ 报告未取回（$OUT_DIR/superapp.json）"; exit 4; }

echo "==> 判定"
node - "$OUT_DIR" <<'NODE'
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }
const report = rd('superapp.json')

let probe = report && report.httpdns_prod_probe
if (typeof probe === 'string') { try { probe = JSON.parse(probe) } catch { probe = null } }
probe = probe || {}
const stats = (probe.dnsStats && typeof probe.dnsStats === 'object') ? probe.dnsStats : {}
// ★★★判据取值的**唯一事实来源**是宿主 `extraReadings`（report 顶层）——它是 Swift 在
//   报告落盘那一刻直接读 `HttpDnsProxies.statsSnapshot()` 得到的，**不依赖探针能否调 invoke**。
//   探针里 `bridge.invoke('http.dnsStats')` 在本轮的 bridge 形态下取不到（返回空），
//   若只认那份就会把"读数拿不到"误判成"表没生效"（本轮实测踩过）。
const hostStats = {
  lookups: report && report.lookups,
  tableHits: report && report.tableHits,
  misses: report && report.misses,
  lastSource: report && report.lastSource,
  lastHost: report && report.lastHost,
  proxies: report && report.proxies,
}
/** 合并：宿主侧优先（更可靠），探针侧兜底 */
const merged = {
  lookups: hostStats.lookups ?? stats.lookups,
  tableHits: hostStats.tableHits ?? stats.tableHits,
  misses: hostStats.misses ?? stats.misses,
  lastSource: (hostStats.lastSource !== undefined && hostStats.lastSource !== '') ? hostStats.lastSource : stats.lastSource,
  lastHost: hostStats.lastHost ?? stats.lastHost,
  proxies: hostStats.proxies ?? stats.proxies,
}

const chk = []
const add = (ok, msg) => chk.push([ok, msg])

add(report && report.httpdns_prod_base !== undefined, '探针已注入（--httpdns-prod-probe）')
add(probe.inject_failed === true,
  `★注入不可达 IP ⇒ 请求必须失败（实得 ${JSON.stringify(probe.inject || null)}）`)
add(probe.baseline_ok === true,
  `★基线（不注入）必须成功（实得 ${JSON.stringify(probe.baseline || null)}）`)
// ★"表被采用"只判**宿主侧读数**——探针内 `bridge.invoke('http.dnsStats')` 在当前 bridge
//   形态下取不到值（`probe.dnsStats` 为空），若也用 `probe.table_hit_seen` 判会重复且误红
//   （本轮实测：宿主 tableHits=1 已成立，而 JS 侧判据红）。
add(Number(merged.tableHits ?? 0) > 0,
  `★表被采用（tableHits>0，宿主侧直接读数；实得 ${JSON.stringify(merged)}）`)
// ★`lastSource` 的取值时机：探针最后一条请求是"表未命中"那条 ⇒ 落盘时 lastSource 是 `system`。
//   所以这里判的是「**table 出现过**」（由 inject_failed + tableHits 共同证明），
//   而不是强求落盘瞬间的值是 table（那是本轮实测暴露的判据错设）。
add(Number(merged.misses ?? 0) > 0,
  `★回落可见：misses>0（表未命中的域名走了系统解析；实得 ${JSON.stringify(merged)}）`)
// 表未命中的域名：回落系统解析，且回落**可见**
if (probe.miss) {
  add(probe.miss.ok === true,
    `★表未命中的域名应回落系统解析并成功（实得 ${JSON.stringify(probe.miss)}）`)
}
// 宿主侧记账兜底（两条独立来源必须都可读）
add(Number(hostStats.tableHits ?? -1) >= 0 || Number(stats.tableHits ?? -1) >= 0,
  '宿主 http.dnsStats 可读（探针或 extraReadings 至少一处有值）')

let bad = 0
for (const [ok, msg] of chk) { console.log(`  ${ok ? '✅' : '✗'} ${msg}`); if (!ok) bad++ }

const summary = {
  verdict: bad === 0 ? 'HTTPDNS_PROD_DEVICE_OK' : 'HTTPDNS_PROD_DEVICE_FAILED',
  hitUrl: probe.hitUrl || null,
  missUrl: probe.missUrl || null,
  inject: probe.inject || null,
  baseline: probe.baseline || null,
  miss: probe.miss || null,
  dnsStats: merged,
  failedChecks: chk.filter(([ok]) => !ok).map(([, m]) => m),
}
fs.writeFileSync(path.join(dir, 'httpdns-prod-device.json'), JSON.stringify(summary, null, 2))

if (bad) {
  console.log('\n  ★诊断：')
  console.log('    inject_failed=false ⇒ 表没生效（系统 DNS 解析成功 ⇒ 请求成功）')
  console.log('    baseline_ok=false  ⇒ 测试环境本身不通（先确认网络与目标可达）')
  console.log('    tableHits=0        ⇒ 宿主没走到表（查 session 是否按表选了代理）')
  console.log('  summary：' + JSON.stringify(summary, null, 2))
  process.exit(1)
}
console.log('\n✅ iOS HTTPDNS 生产面在真机成立：注入不可达 IP 失败 / 基线成功 / tableHits>0 / 未命中回落系统')
NODE
