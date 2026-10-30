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
# 【★★多轮取中位（本脚本最重要的方法论）】
#   实测同一台设备同一档重复测：iOS 并发 8 两次得 **412.5 / 542.6**（差 27%）——
#   **单次扫描的曲线形状不可信**，既可能是噪声也可能是真拐点，单次读数无法区分。
#   ⇒ 每档重复 PROTEUS_PERF_ROUNDS（默认 3）轮，报**中位** + 轮间 spread（噪声底）。
#
# 【诚实边界】
#   ① 只走 `useFetch` 门面，**不经过** `createRequestClient` 治理层（配额/限速/审计）
#      ⇒ 这是"传输 + 门面"的吞吐。治理层开销另由 `scripts/bench-request.mjs` 在假 hooks 下量过
#      （p50 +0.03ms 量级，低于噪声底）→ 两者相加才是全貌。
#   ② 服务端是**单进程 node**，可能先成为瓶颈 ⇒ 报告侧用 `scripts/bench-echo-server.mjs` 做归属。
#   ③ 本机局域网 → **不代表公网**（公网还有 RTT 与中间设备）。
#   ④ iOS 走**局域网 WiFi**、Android 走 **adb reverse 回环**（targetSdk 34 拦明文）
#      ⇒ 两端 QPS **不可直接比大小**（报告侧逐端标 transportMode 就是为了这个）。
#
# 用法：bash hosts/ios/run-perf-probe.sh [concurrency] [total] [--udid <UDID>]
#       PROTEUS_PERF_SWEEP=1 bash hosts/ios/run-perf-probe.sh    # 扫 4/8/16
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"
REPORT="$HERE/results/superapp.json"
OUT="$HERE/results/perf-probe.json"
SRV_LOG="$HERE/results/perf-probe-server.log"
PORT="${PROTEUS_PERF_PORT:-8977}"
ROUNDS="${PROTEUS_PERF_ROUNDS:-3}"

CONC="${1:-8}"
TOTAL="${2:-1000}"

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

bash "$HERE/signing.sh" status 2>&1 | grep -E "✓ 描述文件" >/dev/null || {
  echo "✗ 描述文件无效/过期 ⇒ 先跑 bash hosts/ios/experiments/device/provision.sh"; exit 3
}

UDID_ARG=""
[ "${3:-}" = "--udid" ] && UDID_ARG="--udid ${4:-}"

# 单轮：跑一次探针并落一份 raw
runOneRound() {
  local conc="$1" total="$2" round="$3"
  rm -f "$REPORT"
  # ★必须带 --superapp（SA_ARGS 只在该分支组装）· PROTEUS_EXIT_AFTER_REPORT=1 ⇒ 报告落盘即自退
  if ! PROTEUS_EXIT_AFTER_REPORT=1 bash "$HERE/run-selfdraw.sh" --superapp \
      --perf-probe="${BASE},${conc},${total}" $UDID_ARG 2>&1 | tail -4; then
    echo "✗ run-selfdraw 失败（看上方输出）"; return 4
  fi
  [ -f "$REPORT" ] || { echo "✗ 报告未生成：${REPORT}"; return 4; }
  cp "$REPORT" "$HERE/results/perf-probe-raw-${round}.json"
}

# 单档：跑 ROUNDS 轮，取中位后累积进 OUT
runOne() {
  local conc="$1" total="$2"
  echo ""
  echo "==> 并发 ${conc} · 共 ${total} 个 × ${ROUNDS} 轮"

  local raws=() i
  for i in $(seq 1 "$ROUNDS"); do
    if ! runOneRound "$conc" "$total" "$i"; then
      echo "  ✗ 第 ${i} 轮失败"; return 4
    fi
    node -e '
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
      let p = null; try { p = JSON.parse(String(j.perf_probe ?? "null")) } catch {}
      const q = p || {}
      console.log(`    第 ${process.argv[2]} 轮：${q.qps ?? "-"} QPS · p50 ${q.p50Ms ?? "-"}ms · p99 ${q.p99Ms ?? "-"}ms · failed ${q.failed ?? "-"}`)
      if (q.failed) console.log(`      ★失败归因：${JSON.stringify(q.firstError ?? "（无 firstError —— 探针缺归因）")}`)
    ' "$HERE/results/perf-probe-raw-${i}.json" "$i"
    raws+=("$HERE/results/perf-probe-raw-${i}.json")
  done

  echo ""
  echo "==> 判定（${ROUNDS} 轮取中位）"
  node - "${raws[@]}" "$OUT" "$conc" "$total" "$BASE" <<'NODE'
const fs = require('fs')
const args = process.argv.slice(2)
const outPath = args[args.length - 4]
const conc = args[args.length - 3]
const total = args[args.length - 2]
const base = args[args.length - 1]
const rawPaths = args.slice(0, args.length - 4)

/** 中位（偶数取均值）——单轮时退化为该轮值 */
const median = (xs) => {
  const a = xs.slice().sort((x, y) => x - y)
  if (a.length === 0) return 0
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : +((a[m - 1] + a[m]) / 2).toFixed(2)
}

const probes = rawPaths.map((path) => {
  const r = JSON.parse(fs.readFileSync(path, 'utf8'))
  const raw = String(r.perf_probe ?? 'null')
  try { return JSON.parse(raw) } catch { return { __unparsable: raw.slice(0, 160), reportKeys: Object.keys(r).join(',').slice(0, 200) } }
})

// ── 每轮必须自洽：任何一轮失败 ⇒ 整体不通过（不允许"取好的那轮"） ──
const chk = []
const add = (c, m) => chk.push([c, m])
const bad = probes.map((p, i) => ({ i: i + 1, p })).filter(({ p }) => !p || p.ok !== true || p.completed !== Number(total) || p.failed !== 0)
add(probes.every((p) => p && !p.__unparsable), `所有轮次回执可解析（${probes.filter((p) => p && !p.__unparsable).length}/${probes.length}）`)
for (const { i, p } of bad) {
  const e = p?.firstError
  add(false, `第 ${i} 轮不完整（${p?.__unparsable ? '不可解析：' + p.__unparsable : `completed=${p?.completed ?? '-'} failed=${p?.failed ?? '-'}${e ? ` · ${e.code}: ${e.message}` : ''}`}）`)
}
if (bad.length === 0) add(true, `每一轮都完成 ${total} 个且失败 0`)

const ok = probes.filter((p) => p && p.ok === true)
const qpsList = ok.map((p) => p.qps)
const spreadPct = qpsList.length > 1
  ? +(((Math.max(...qpsList) - Math.min(...qpsList)) / Math.max(...qpsList)) * 100).toFixed(1)
  : null
const qps = median(qpsList)
const p50 = median(ok.map((p) => p.p50Ms))
const p99 = median(ok.map((p) => p.p99Ms))
add(qps > 0, `中位 QPS = ${qps}（${qpsList.join(' / ')}${spreadPct !== null ? ` · 轮间差 ${spreadPct}%` : ''}）`)
add(p50 > 0, `中位 p50 = ${p50}ms · p99 = ${p99}ms`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }

const artifact = {
  end: 'iOS',
  verified: pass === chk.length,
  concurrency: Number(conc),
  total: Number(total),
  base,
  /** ★多轮原始读数（可复查）+ 中位；roundsCount=1 时 qps 等于该轮 */
  rounds: ok.map((p) => ({ qps: p.qps, p50Ms: p.p50Ms, p99Ms: p.p99Ms, failed: p.failed, completed: p.completed })),
  roundsCount: probes.length,
  qpsSpreadPct: spreadPct,
  completed: median(probes.map((p) => p?.completed ?? 0)),
  failed: probes.reduce((a, p) => a + (p?.failed ?? 0), 0),
  failRatePct: +((probes.reduce((a, p) => a + (p?.failed ?? 0), 0) / (Number(total) * probes.length)) * 100).toFixed(1),
  wallMs: median(ok.map((p) => p.wallMs ?? 0)),
  qps,
  meanMs: median(ok.map((p) => p.meanMs ?? 0)),
  p50Ms: p50,
  p95Ms: median(ok.map((p) => p.p95Ms ?? 0)),
  p99Ms: p99,
  maxMs: Math.max(...ok.map((p) => p.maxMs ?? 0)),
  measuredAt: new Date().toISOString(),
  server: '单进程 node（transfer-echo-server.mjs）· 本机局域网',
  transportMode: 'lan-wifi',
  honestBoundaries: [
    '只走 useFetch 门面，不经过治理层（配额/限速/审计）',
    '服务端为单进程 node，可能先成为瓶颈（报告侧另有服务端天花板归属）',
    '局域网 ≠ 公网（公网另有 RTT 与中间设备）',
    'iOS 走局域网 WiFi、Android 走 adb reverse 回环 ⇒ 两端 QPS 不可直接比大小',
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
all.honestBoundaries = artifact.honestBoundaries
all.points = all.points.filter((x) => x.concurrency !== artifact.concurrency)
all.points.push(artifact)
all.points.sort((a, b) => a.concurrency - b.concurrency)
// ★最优档 = QPS 最高且**所有轮**失败 0 的那档（不是"最后一档"）
const best = all.points.filter((x) => x.failed === 0).sort((a, b) => b.qps - a.qps)[0]
all.best = best ? { concurrency: best.concurrency, qps: best.qps, p50Ms: best.p50Ms, p99Ms: best.p99Ms } : null
all.verified = all.points.some((x) => x.verified)
fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n')
console.log(`\n${pass}/${chk.length} 通过 · 已落盘 ${outPath}`)
process.exit(pass === chk.length ? 0 : 1)
NODE
}

RC=0
if [ "${PROTEUS_PERF_SWEEP:-0}" = "1" ]; then
  # ★拐点必须扫多档：单档只能说"这个并发度下多快"，说不出"能扛到哪"
  for c in 4 8 16; do
    runOne "$c" "${PROTEUS_PERF_TOTAL:-1000}" || RC=$?
  done
else
  runOne "$CONC" "$TOTAL" || RC=$?
fi

rm -f "$HERE/results"/perf-probe-raw-*.json
exit $RC
