#!/usr/bin/env bash
# hosts/android/run-perf-probe.sh —— ★★★#1404 请求层**真机并发吞吐**判据（Android）
#
# 【与 iOS `hosts/ios/run-perf-probe.sh` 同一份口径，但通路不同（见边界 ④）】
#   设备真网络 → 走 `useFetch` 门面 → 固定 worker 池 → 预热一轮丢弃 → p50/p95/p99 + QPS。
#
# 【★为什么需要 Java 探针类（PerfProbe.java）而不是 `capprobe`】
#   取证结论：`capprobe js:<表达式>` 是**裸 eval**，`__proteusHostInvoke` 等全局只在
#   bundle 装进上下文后才存在 ⇒ 裸上下文里取不到探针（ReferenceError）。
#   `PerfProbe.java` 与 `UseFetchProbe.java` 同形态：先 eval bundle，再调 bundle 暴露的
#   `__proteusHostAppPerfProbe(base, conc, total)`，并用主线程 Handler 驱微任务直到结果回填。
#
# 【★★多轮取中位（本脚本最重要的方法论）】
#   实测同一台设备同一档重复测：iOS 并发 8 两次得 **412.5 / 542.6**（差 27%）——
#   **单次扫描的曲线形状不可信**，既可能是噪声也可能是真拐点，单次读数无法区分。
#   ⇒ 每档重复 PROTEUS_PERF_ROUNDS（默认 3）轮，报**中位** + 轮间 spread（噪声底）。
#   ★同族教训：`scripts/bench-request.mjs` 首版把 bare/full 分先后跑，机器负载漂移让
#     full 反而更快（0.76×）——那次也是"单次读数看起来有结论"。
#
# 【★三个"假绿"陷阱（都已在本文件里堵住）】
#   ① **旧报告冒充新结果**：报告文件先删且删不掉就退出（不是"尽力而为"）；
#   ② **失败率高时的"快"**：判定里"失败数 = 0"与"完成数 = 全部"是硬条件；
#      ★且探针必须回填 `firstError`（首版只记 failed=N，真机首跑"failed=8 wallMs=8"
#        完全不知道原因，只能靠猜——补了归因才查出是 CLEARTEXT 被系统拦）；
#   ③ **装置不确定当成框架结论**：探针超时 → 报"装置不确定"，不算通过也不算失败。
#
# 【诚实边界】
#   ① 只走 `useFetch` 门面，**不经过** `createRequestClient` 治理层（配额/限速/审计）
#      ⇒ 量到的是"传输 + 门面"的吞吐；治理层开销另由 `scripts/bench-request.mjs` 量。
#   ② 服务端是**单进程 node**（`transfer-echo-server.mjs`），可能先成为瓶颈
#      ⇒ 报告侧用 `scripts/bench-echo-server.mjs` 量服务端天花板做**归属**。
#   ③ 局域网 ≠ 公网。
#   ④ ★**Android 走 `adb reverse` 回环而不是局域网**（与 iOS 不同端，**数字不可直接横向比较**）：
#      实测 `--es base http://<局域网IP>:8977` ⇒ `java.net.UnknownServiceException:
#      CLEARTEXT communication to 192.168.1.136 not permitted by network security policy`。
#      这是 **Android 系统策略**（targetSdk 34 默认禁明文；回环例外 ⇒ 仓内 30+ 探针都走 127.0.0.1 才通），
#      不是框架缺陷、也不是本探针的装置缺陷。⇒ Android 口径 = "JS + 宿主管道吞吐（去掉网络变量）"；
#      iOS 口径 = "含 WiFi 抖动"。★两者不可直接比大小。
#
# 前置：bash hosts/android/build-and-run.sh --no-install（APK 需含最新 bundle-superapp.js）
# 用法：bash hosts/android/run-perf-probe.sh [concurrency] [total]
#       PROTEUS_PERF_SWEEP=1 bash hosts/android/run-perf-probe.sh      # 扫 4/8/16
#       PROTEUS_PERF_ROUNDS=3 PROTEUS_PERF_TOTAL=1000 ...              # 多轮取中位
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WAIT_SH="$ROOT/.agents/skills/ai-efficiency-rules/scripts/wait_for.sh"

PKG="dev.proteus.layoutcore"
ADB="${ADB:-adb}"
APK="${PROTEUS_APK:-$HERE/build/proteus-layoutcore.apk}"
PORT="${PROTEUS_PERF_PORT:-8977}"
OUT_DIR="$HERE/results"
OUT="$OUT_DIR/perf-probe.json"
SRV_LOG="$OUT_DIR/perf-probe-server.log"
REPORT="/sdcard/Android/data/$PKG/files/perf-probe.json"
ROUNDS="${PROTEUS_PERF_ROUNDS:-3}"
mkdir -p "$OUT_DIR"

[ -f "$WAIT_SH" ] || { echo "✗ 缺 wait_for.sh——本脚本禁止盲等"; exit 2; }
[ -f "$APK" ] || { echo "✗ 找不到 APK：$APK（先 bash hosts/android/build-and-run.sh --no-install）"; exit 3; }
"$ADB" get-state >/dev/null 2>&1 || { echo "✗ 设备未连接"; exit 3; }

# ★APK 里必须含带探针的 bundle —— 否则测的是旧包（本仓实测过"装到旧包排查一轮"）
APK_LIST="$(unzip -l "$APK" 2>/dev/null)"
if ! printf '%s' "$APK_LIST" | grep -q "assets/bundle-superapp.js"; then
  echo "✗ APK 内无 assets/bundle-superapp.js —— 先 node hosts/android/bridge/build-batch.mjs 再构建"
  exit 3
fi

echo "==> ① 起本地 HTTP 服务（port ${PORT}）"
node "$HERE/tools/transfer-echo-server.mjs" "$PORT" 0.0.0.0 > "$SRV_LOG" 2>&1 &
SRV=$!
cleanup() {
  kill "$SRV" 2>/dev/null || true
  "$ADB" reverse --remove "tcp:${PORT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! bash "$WAIT_SH" --http "http://127.0.0.1:${PORT}/health" --timeout 30 >/dev/null 2>&1; then
  echo "✗ 服务端未就绪（见 ${SRV_LOG}）"; exit 3
fi

# ★设备地址：默认 **adb reverse 回环**（见边界 ④）。PROTEUS_PERF_BASE_MODE=lan 可切局域网。
BASE_MODE="${PROTEUS_PERF_BASE_MODE:-reverse}"
if [ "$BASE_MODE" = "lan" ]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$LAN_IP" ] || { echo "✗ 取不到本机局域网 IP"; exit 3; }
  BASE="http://${LAN_IP}:${PORT}"
  echo "    服务端：${BASE}（局域网 —— ★targetSdk 34 会拦明文，除非清单/配置放行）"
else
  "$ADB" reverse "tcp:${PORT}" "tcp:${PORT}" >/dev/null 2>&1 || { echo "✗ adb reverse 失败"; exit 3; }
  BASE="http://127.0.0.1:${PORT}"
  echo "    服务端：${BASE}（adb reverse 回环 · 与仓内其他 Android 探针同通路）"
fi

# 单轮：跑一次探针并落一份 raw
runOneRound() {
  local conc="$1" total="$2" round="$3"

  "$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
  "$ADB" shell "rm -f ${REPORT}" >/dev/null 2>&1 || true
  if "$ADB" shell "test -f ${REPORT}" >/dev/null 2>&1; then
    echo "✗ 旧报告删不掉（等待信号会命中陈旧文件）"; return 4
  fi
  "$ADB" logcat -c >/dev/null 2>&1 || true

  "$ADB" shell "am start -n $PKG/.MainActivity --es path perf-probe --es base '$BASE' --ei conc $conc --ei total $total" >/dev/null 2>&1
  # ★条件等待：receiver 就绪后再发广播（替代"盲等 N 秒"）
  if ! bash "$WAIT_SH" --cmd "\"$ADB\" logcat -d -s 'proteus:I' | grep -q run-receiver-ready" --timeout 30 --interval 1 --max-interval 3; then
    echo "  ⚠ 未见 run-receiver-ready（30s）"; return 4
  fi
  "$ADB" shell "am broadcast -a dev.proteus.RUN --es path perf-probe --es base '$BASE' --ei conc $conc --ei total $total -p $PKG" >/dev/null 2>&1

  if ! bash "$WAIT_SH" --cmd "\"$ADB\" shell \"test -f ${REPORT}\" >/dev/null 2>&1" --timeout 180 --interval 1 --max-interval 3; then
    echo "✗ 报告未生成——看 logcat"
    "$ADB" logcat -d -s 'proteus:I' | tail -15 || true
    return 4
  fi
  "$ADB" pull "$REPORT" "$OUT_DIR/perf-probe-raw-${round}.json" >/dev/null 2>&1 || { echo "✗ 拉取报告失败"; return 4; }
}

# 单档：跑 ROUNDS 轮，取中位后累积进 OUT
runOne() {
  local conc="$1" total="$2"
  echo ""
  echo "==> 并发 ${conc} · 共 ${total} 个 × ${ROUNDS} 轮"

  "$ADB" install -r -t "$APK" 2>&1 | grep -E "Success|Failure" | head -1

  local raws=() i
  for i in $(seq 1 "$ROUNDS"); do
    local raw="$OUT_DIR/perf-probe-raw-${i}.json"
    rm -f "$raw"
    if ! runOneRound "$conc" "$total" "$i"; then
      echo "  ✗ 第 ${i} 轮失败"; return 4
    fi
    node -e '
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
      const p = j.probe || {}
      console.log(`    第 ${process.argv[2]} 轮：${p.qps ?? "-"} QPS · p50 ${p.p50Ms ?? "-"}ms · p99 ${p.p99Ms ?? "-"}ms · failed ${p.failed ?? "-"}`)
    ' "$raw" "$i"
    raws+=("$raw")
  done

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

const probes = rawPaths.map((p) => {
  const r = JSON.parse(fs.readFileSync(p, 'utf8'))
  return r.probe || null
})

// ── 每轮必须自洽：任何一轮失败 ⇒ 整体不通过（不允许"取好的那轮"） ──
const chk = []
const add = (c, m) => chk.push([c, m])
const bad = probes.map((p, i) => ({ i: i + 1, p })).filter(({ p }) => !p || p.ok !== true || p.completed !== Number(total) || p.failed !== 0)
add(probes.every((p) => !!p), `所有轮次都拿到回执（${probes.filter((p) => !!p).length}/${probes.length}）`)
for (const { i, p } of bad) {
  const e = p?.firstError
  add(false, `第 ${i} 轮不完整（completed=${p?.completed ?? '-'} failed=${p?.failed ?? '-'}${e ? ` · ${e.code}: ${e.message}` : ''}）`)
}
if (bad.length === 0) add(true, `每一轮都完成 ${total} 个且失败 0`)

const qpsList = probes.filter((p) => p && p.ok).map((p) => p.qps)
const spreadPct = qpsList.length > 1
  ? +(((Math.max(...qpsList) - Math.min(...qpsList)) / Math.max(...qpsList)) * 100).toFixed(1)
  : null
const qps = median(qpsList)
const p50 = median(probes.filter((p) => p && p.ok).map((p) => p.p50Ms))
const p99 = median(probes.filter((p) => p && p.ok).map((p) => p.p99Ms))
add(qps > 0, `中位 QPS = ${qps}（${qpsList.join(' / ')}${spreadPct !== null ? ` · 轮间差 ${spreadPct}%` : ''}）`)
add(p50 > 0, `中位 p50 = ${p50}ms · p99 = ${p99}ms`)

let pass = 0
for (const [c, m] of chk) { console.log(`  ${c ? '✅' : '❌'} ${m}`); if (c) pass++ }

const artifact = {
  end: 'Android',
  verified: pass === chk.length,
  concurrency: Number(conc),
  total: Number(total),
  base,
  /** ★多轮原始读数（可复查）+ 中位；roundsCount=1 时 qps 等于该轮 */
  rounds: probes.filter((p) => p && p.ok).map((p) => ({ qps: p.qps, p50Ms: p.p50Ms, p99Ms: p.p99Ms, failed: p.failed, completed: p.completed })),
  roundsCount: probes.length,
  qpsSpreadPct: spreadPct,
  completed: median(probes.map((p) => p?.completed ?? 0)),
  failed: probes.reduce((a, p) => a + (p?.failed ?? 0), 0),
  failRatePct: +((probes.reduce((a, p) => a + (p?.failed ?? 0), 0) / (Number(total) * probes.length)) * 100).toFixed(1),
  qps,
  meanMs: median(probes.map((p) => p?.meanMs ?? 0)),
  p50Ms: p50,
  p95Ms: median(probes.map((p) => p?.p95Ms ?? 0)),
  p99Ms: p99,
  maxMs: Math.max(...probes.map((p) => p?.maxMs ?? 0)),
  measuredAt: new Date().toISOString(),
  server: '单进程 node（transfer-echo-server.mjs）· adb reverse 回环',
  transportMode: base.includes('127.0.0.1') ? 'loopback-usb' : 'lan-wifi',
  // ★边界文案随实际通路变（写死会在另一模式下变成假陈述）
  honestBoundaries: base.includes('127.0.0.1')
    ? [
        '只走 useFetch 门面，不经过治理层（配额/限速/审计）',
        '服务端为单进程 node，可能先成为瓶颈（报告侧另有服务端天花板归属）',
        'Android 走 adb reverse 回环（targetSdk 34 拦局域网明文）⇒ 口径 = "JS+宿主管道"，与 iOS 的 WiFi 口径**不可直接比大小**',
      ]
    : [
        '只走 useFetch 门面，不经过治理层（配额/限速/审计）',
        '服务端为单进程 node，可能先成为瓶颈',
        '局域网 ≠ 公网（公网另有 RTT 与中间设备）',
      ],
}

// ★按并发度累积（保留全部档位，才能看出拐点；单档覆盖会让最后一档冒充结论）
let all = { end: 'Android', points: [], honestBoundaries: artifact.honestBoundaries }
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
console.log(`  ${pass}/${chk.length} 通过 · 已落盘 ${outPath}`)
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
  runOne "${1:-8}" "${2:-1000}" || RC=$?
fi

"$ADB" shell "am force-stop $PKG" >/dev/null 2>&1 || true
rm -f "$OUT_DIR"/perf-probe-raw-*.json
exit $RC
