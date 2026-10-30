#!/usr/bin/env bash
# hosts/ios/run-perf-probe.sh —— ★★★#1404 请求层**真机并发吞吐**判据（iOS）
#
# 【它回答什么（本轮唯一剩下的硬缺口）】
#   已有真机证据只能回答"**单个**请求的稳定往返多快"（ttfb 11.1ms）。
#   而大厂采购问的是"**每秒能扛多少**" —— 那是**并发**下的吞吐。
#   并发下连接池 / 多路复用 / 事件循环调度都会改变结果 ⇒ 必须实测，不能从 ttfb 推导。
#
# 【测量口径】
#   · 真网络（本地 HTTP 服务端，不走公网 —— 公网限流/断连会让"连不上"与"宿主有 bug"无法区分）
#   · 固定 worker 池（不是 Promise.all(N)）· 预热一轮丢弃 · 报 p50/p95/p99 + QPS
#   · **失败率必须与吞吐一起看** —— 高失败率下的"快"是假绿
#
# 【诚实边界】
#   ① 只走 `useFetch` 门面，**不经过** `createRequestClient` 治理层（配额/限速/审计）
#      ⇒ 这是"传输 + 门面"的吞吐。治理层开销另由 `scripts/bench-request.mjs` 在假 hooks 下量过
#      （p50 +0.03ms 量级，低于噪声底）→ 两者相加才是全貌。
#   ② 服务端是**单进程 node**，可能先成为瓶颈 ⇒ 报告里必须写明服务端形态。
#   ③ 本机 loopback/局域网 → **不代表公网**（公网还有 RTT 与中间设备）。
#
# 用法：bash hosts/ios/run-perf-probe.sh [concurrency] [total] [--udid <UDID>]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
REPORT="$HERE/results/superapp.json"
OUT="$HERE/results/perf-probe.json"
SRV_LOG="$HERE/results/perf-probe-server.log"
PORT="${PROTEUS_PERF_PORT:-8977}"

CONC="${1:-8}"
TOTAL="${2:-200}"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
mkdir -p "$HERE/results"

echo "==> ① 起本地 HTTP 服务（port ${PORT}）"
node "$ROOT/hosts/android/tools/transfer-echo-server.mjs" "$PORT" 0.0.0.0 > "$SRV_LOG" 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; }
trap cleanup EXIT

bash "$WAIT_SH" --http "http://127.0.0.1:${PORT}/health" --timeout 30 >/dev/null 2>&1 || {
  echo "✗ 服务端未就绪（见 ${SRV_LOG}）"; exit 3
}

# ★设备地址：局域网 IP（真机不能用 127.0.0.1）。从路由表取当前出口网卡地址。
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
[ -n "$LAN_IP" ] || { echo "✗ 取不到本机局域网 IP（真机要用它连服务端）"; exit 3; }
BASE="http://${LAN_IP}:${PORT}"
echo "    服务端：${BASE}（局域网 · 真机可达）"

echo "==> ② 跑探针（并发 ${CONC} · 共 ${TOTAL} 个）"
bash "$HERE/signing.sh" status 2>&1 | grep -E "✓ 描述文件" >/dev/null || {
  echo "✗ 描述文件无效/过期 ⇒ 先跑 bash hosts/ios/experiments/device/provision.sh"; exit 3
}

rm -f "$REPORT"
UDID_ARG=""
[ "${3:-}" = "--udid" ] && UDID_ARG="--udid ${4:-}"

# ★必须带 --superapp（SA_ARGS 只在该分支组装）· PROTEUS_EXIT_AFTER_REPORT=1 ⇒ 报告落盘即自退
if ! PROTEUS_EXIT_AFTER_REPORT=1 bash "$HERE/run-selfdraw.sh" --superapp \
    --perf-probe="${BASE},${CONC},${TOTAL}" $UDID_ARG 2>&1 | tail -8; then
  echo "✗ run-selfdraw 失败（看上方输出）"; exit 4
fi

[ -f "$REPORT" ] || { echo "✗ 报告未生成：${REPORT}"; exit 4; }

echo "==> ③ 判定"
node - "$REPORT" "$OUT" "$CONC" "$TOTAL" "$BASE" <<'NODE'
const fs = require('fs')
const [reportPath, outPath, conc, total, base] = process.argv.slice(2)
const r = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const raw = String(r.perf_probe ?? 'null')
let p = null
try { p = JSON.parse(raw) } catch { /* 下面统一报 */ }

if (!p || typeof p !== 'object') {
  console.log(`  ❌ 探针回执不可解析：${raw.slice(0, 200)}`)
  console.log(`     报告键：${Object.keys(r).join(', ').slice(0, 300)}`)
  process.exit(1)
}

const chk = []
const add = (c, m) => chk.push([c, m])
add(p.ok === true, `整体 ok${p.error ? ' — ' + p.error : ''}`)
add(p.completed === Number(total), `完成数 = ${p.completed}/${total}`)
add(p.failed === 0, `失败数 = ${p.failed}（★高失败率下的"快"是假绿，必须先看这条）`)
add(typeof p.qps === 'number' && p.qps > 0, `QPS = ${p.qps}`)
add(typeof p.p50Ms === 'number' && p.p50Ms > 0, `p50 = ${p.p50Ms}ms · p95 = ${p.p95Ms}ms · p99 = ${p.p99Ms}ms`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }

// 落盘（机器产物，供 report-request-perf.mjs 读）
const artifact = {
  end: 'iOS', verified: pass === chk.length,
  concurrency: Number(conc), total: Number(total), base,
  completed: p.completed, failed: p.failed, failRatePct: p.failRatePct,
  wallMs: p.wallMs, qps: p.qps, meanMs: p.meanMs, p50Ms: p.p50Ms, p95Ms: p.p95Ms, p99Ms: p.p99Ms, maxMs: p.maxMs,
  measuredAt: new Date().toISOString(),
  server: '单进程 node（transfer-echo-server.mjs）· 本机局域网',
  honestBoundaries: [
    '只走 useFetch 门面，不经过治理层（配额/限速/审计）',
    '服务端为单进程 node，可能先成为瓶颈',
    '局域网 ≠ 公网（公网另有 RTT 与中间设备）',
  ],
}
// ★按并发度累积（保留全部档位，才能看出拐点；单档覆盖会让最后一档冒充结论）
let all = { end: 'iOS', points: [], honestBoundaries: artifact.honestBoundaries }
if (fs.existsSync(outPath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'))
    if (Array.isArray(prev.points)) all = prev
  } catch { /* 旧文件坏了就重建 */ }
}
all.points = all.points.filter((x) => x.concurrency !== artifact.concurrency)
all.points.push(artifact)
all.points.sort((a, b) => a.concurrency - b.concurrency)
// ★最优档 = QPS 最高且失败率为 0 的那档（不是"最后一档"）
const best = all.points.filter((x) => x.failed === 0).sort((a, b) => b.qps - a.qps)[0]
all.best = best ? { concurrency: best.concurrency, qps: best.qps, p50Ms: best.p50Ms, p99Ms: best.p99Ms } : null
all.verified = all.points.some((x) => x.verified)
fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n')
console.log(`\n${pass}/${chk.length} 通过 · 已落盘 ${outPath}`)
process.exit(pass === chk.length ? 0 : 1)
NODE
