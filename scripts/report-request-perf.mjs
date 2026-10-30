#!/usr/bin/env node
// scripts/report-request-perf.mjs —— ★★★#1404 请求层性能**汇总报告**（JS 层基准 + 真机证据）
//
// 【它做什么】把两处机器产物汇成一份对外可引用的报告：
//   ① `docs/generated/request-perf.json`  —— JS 层治理开销（scripts/bench-request.mjs 生成）
//   ② `docs/generated/request-load.json`  —— 高压行为（scripts/bench-request-load.mjs 生成）
//   ③ **真机传输读数** —— 从三端已入库的探针产物里读出（不重跑真机，只读证据）
//
// 【★为什么真机数字"只读"而不"重跑"】
//   真机吞吐要装包 + 起本地服务 + 设备在线。把它塞进一个可在 CI 跑的脚本里会变成
//   "设备不在就跳过" —— 而**跳过的门禁等于没有门禁**（本仓已记录多次）。
//   ⇒ 本脚本只**读已入库的真机证据**并校验它是否新鲜/自洽；重跑真机是 hosts/* 的脚本。
//   ★每条真机数字都带 `source`（哪个文件、哪一轮），可追溯。
//
// 【诚实边界（写进产物，不只写在这里）】
//   · JS 层基准 ≠ 端到端 QPS（不含网络/序列化/宿主往返）
//   · 真机吞吐是**单连接串行**的理论上限（ttfb 倒数），**不是**并发压测结果 ——
//     要真实并发吞吐需要新的真机压测探针，本轮**没做**
//   · Android 无设备 ⇒ 本端如实标未验
//
// 用法：node scripts/report-request-perf.mjs [--check]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs/generated/request-perf-report.json')
const CHECK = process.argv.includes('--check')

const readJson = (rel) => {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

const perf = readJson('docs/generated/request-perf.json')
const load = readJson('docs/generated/request-load.json')

/**
 * 从真机探针产物里抽"稳定态 ttfb"（连接复用之后的那一轮）。
 * ★只认 `transport_last` / `transport_per_round` 里的 reuse 轮 ——
 *   首轮含 DNS+TCP+TLS，用它算吞吐会把握手成本摊进每个请求（严重低估）。
 */
function deviceTransport(end, rel) {
  const d = readJson(rel)
  if (!d) return { end, verified: false, reason: `缺 ${rel}` }

  const nested = typeof d.transport_probe === 'string' ? tryParse(d.transport_probe) : d.transport_probe
  // 鸿蒙形态：读数在顶层
  const probe = nested ?? (d.transport_last || d.conn_reused_ok !== undefined ? d : null)
  const perRound = probe?.transport_per_round ?? []
  const reused = perRound.filter((r) => r.reused === true && typeof r.ttfbMs === 'number')
  const lastTtfb = (() => {
    const a = probe?.transport_last?.ttfbMs
    if (a !== undefined && Number.isFinite(Number(a))) return Number(a)
    if (reused.length) return Number(reused[reused.length - 1].ttfbMs)
    return null
  })()

  return {
    end,
    verified: (probe?.ok ?? d.ok) === true && lastTtfb !== null,
    proto: probe?.client_protos?.[probe.client_protos.length - 1]
      ?? (probe?.server_stats?.channels?.plain?.protocols ? Object.keys(probe.server_stats.channels.plain.protocols).join(',') : null)
      ?? null,
    sameConn: probe?.client_same_conn ?? probe?.conn_reused_ok ?? null,
    firstTtfbMs: probe?.transport_first?.ttfbMs ?? null,
    steadyTtfbMs: lastTtfb,
    /** ★单连接串行吞吐上限 = 1000 / 稳定 ttfb（**不是**并发压测结果） */
    serialQpsCeiling: lastTtfb && lastTtfb > 0 ? Math.round(1000 / lastTtfb) : null,
    rounds: probe?.rounds ?? null,
    source: rel,
  }
}

function tryParse(s) { try { return JSON.parse(s) } catch { return null } }

const devices = [
  deviceTransport('iOS', 'hosts/ios/results/transport-probe.json'),
  deviceTransport('鸿蒙', 'hosts/harmony/results/transport-probe.json'),
  // ★Android 无设备（adb devices 空）⇒ 不伪造数据，只标未验
  { end: 'Android', verified: false, reason: 'adb devices 为空（设备未连接）——如实标未验，不伪造' },
]

const report = {
  note:
    '请求层性能**汇总报告** —— 由 scripts/report-request-perf.mjs 从三处机器产物汇成。\n'
    + '① JS 层治理开销（假 hooks · 零网络）② 高压行为（限速/配额/审计）③ 三端真机传输读数（**只读已入库证据**）。\n'
    + '★本文件不含手写数字：每个数字都能追到 source。',
  generatedBy: 'scripts/report-request-perf.mjs',
  generatedAt: new Date().toISOString(),

  jsLayer: perf
    ? {
        params: perf.params,
        bare: { p50Ms: perf.bare.medianP50Ms, p99Ms: perf.bare.medianP99Ms, qps: perf.bare.medianQps },
        full: { p50Ms: perf.full.medianP50Ms, p99Ms: perf.full.medianP99Ms, qps: perf.full.medianQps },
        overhead: perf.overhead,
        p99Stability: perf.p99Stability,
        source: 'docs/generated/request-perf.json',
      }
    : null,

  highPressure: load
    ? {
        rateLimit: {
          configured: load.rateLimit.configured,
          attempted: load.rateLimit.attempted,
          allowed: load.rateLimit.allowed,
          rejected: load.rateLimit.rejected,
          pass: load.rateLimit.pass,
        },
        quota: {
          configuredConcurrency: load.quota.configuredConcurrency,
          attempted: load.quota.attempted,
          peakInflight: load.quota.peakInflight,
          pass: load.quota.pass,
        },
        audit: { attempted: load.audit.attempted, written: load.audit.written, dropped: load.audit.dropped, pass: load.audit.pass },
        allPass: load.allPass,
        source: 'docs/generated/request-load.json',
      }
    : null,

  devices,

  /**
   * ★★★#1404：**真机并发吞吐实测**（本轮新增 —— 这是唯一能回答"QPS 多少"的东西）
   *
   * 【与上面 `devices[].serialQpsCeiling` 的区别】
   *   `serialQpsCeiling` 是 `1000 / 单次 ttfb` 的**推导值**（单连接串行）；
   *   这里是**真跑并发压测**的结果（固定 worker 池 + 预热 + 分位数）。
   *   ★两者不可混用：推导值只能说明"单请求多快"，实测值才回答"每秒能扛多少"。
   *
   * 【★实测曲线暴露的结论（比单个数字有价值）】
   *   并发 4 → 8：QPS 375 → 576（**近线性提升**）；
   *   并发 8 → 16：QPS 576 → 567（**不再提升**），而 p50 从 13ms 涨到 27ms、p99 从 23ms 涨到 45ms。
   *   ⇒ **拐点在并发 8 附近** —— 继续加压只增加延迟不增加吞吐。
   *     这是"该在哪个并发度运行"的直接依据，也是"下游服务端先饱和"的信号。
   */
  throughput: (() => {
    const p = readJson('hosts/ios/results/perf-probe.json')
    if (!p || !Array.isArray(p.points) || p.points.length === 0) {
      return { measured: false, reason: '缺 hosts/ios/results/perf-probe.json（跑 bash hosts/ios/run-perf-probe.sh）' }
    }
    return {
      measured: true,
      end: 'iOS',
      points: p.points.map((x) => ({ concurrency: x.concurrency, qps: x.qps, p50Ms: x.p50Ms, p99Ms: x.p99Ms, failed: x.failed })),
      best: p.best,
      /** ★拐点判定：QPS 不再随并发上升的那一档 */
      knee: (() => {
        const pts = p.points.slice().sort((a, b) => a.concurrency - b.concurrency)
        if (pts.length < 2) return null
        for (let i = 1; i < pts.length; i++) {
          // 并发翻倍但 QPS 没涨 10% 以上 ⇒ 视为饱和
          if (pts[i].qps < pts[i - 1].qps * 1.1) return { at: pts[i - 1].concurrency, qps: pts[i - 1].qps }
        }
        return { at: pts[pts.length - 1].concurrency, qps: pts[pts.length - 1].qps }
      })(),
      source: 'hosts/ios/results/perf-probe.json',
    }
  })(),

  /**
   * ★★★**真机数字的证据性质（必须写在数据旁边，不能只写在注释里）**
   *
   * 上面 `devices[].serialQpsCeiling` 是 `1000 / 稳定 ttfb` 的**推导值**，它成立的前提是：
   *   · **单连接、串行、无并发** → 真实并发下连接池 + 多路复用会改变结果（可能更高也可能更低）；
   *   · ttfb 本身是**单次测量**（不是分位数）→ 抖动未知；
   *   · 证据来自**已入库的旧探针产物**（非本单新跑）→ 代码可能已变。
   * ⇒ **这个数只能回答"单个请求的稳定往返有多快"，不能回答"吞吐多少"。**
   *   把它当 QPS 引用是错的 —— 这正是本仓反复抓的"数字锚在错误位置"。
   */
  deviceCaveats: [
    'serialQpsCeiling 是 1000/ttfb 的**推导值**，前提是单连接串行 —— 不是压测结果',
    'ttfb 为单次测量（非 p50/p99），抖动未知',
    '真机数字来自**已入库旧产物**（鸿蒙 10-22 / iOS 10-29），非本单重跑；代码可能已变',
    '要真实并发吞吐必须新写真机压测探针（并发 N 连接 + 计时），本轮未做',
  ],
  /** ★★关键：**本报告不证明**的东西（避免被当作"已压测"引用） */
  notProven: [
    '端到端 QPS：JS 层基准不含网络/序列化/宿主往返；真机数字是**单连接串行理论上限**（ttfb 倒数）',
    '并发吞吐：**iOS 已实测**（见 throughput）· **鸿蒙/Android 未测**（鸿蒙一次性 VM 无法 JS 侧并发循环；Android 无设备）',
    'Android：设备未连接，本端未验',
    '长稳（soak）：没有跑"持续 N 小时"的内存/句柄曲线',
    'App 精简引擎（QuickJS/JSC）的 JS 层开销：本机基准是 Node V8，不外推',
  ],
}

const json = JSON.stringify(report, null, 2) + '\n'

if (CHECK) {
  if (!fs.existsSync(OUT)) {
    console.error(`✗ 缺 ${path.relative(ROOT, OUT)}——先跑 node scripts/report-request-perf.mjs`)
    process.exit(1)
  }
  /* ★门禁口径：只验**结论是否仍成立**，不比时间戳（每次生成都会变）：
     ① JS 层基准与高压行为都必须在
     ② 高压三条必须全过
     ③ 至少一端真机证据 verified（全无证据 ⇒ 报告里"真机"整段是空的，不该当成绩） */
  const problems = []
  if (!perf) problems.push('缺 request-perf.json（JS 层基准未跑）')
  if (!load) problems.push('缺 request-load.json（高压行为未跑）')
  if (load && !load.allPass) problems.push('高压行为未全过（限速/配额/审计）')
  if (!devices.some((d) => d.verified)) problems.push('没有任何一端的真机传输证据（verified 全 false）')
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`)
    process.exit(1)
  }
  console.log(`✅ 性能报告自洽（JS 层 ${perf ? '有' : '无'} · 高压 ${load?.allPass ? '全过' : '未过'} · 真机 ${devices.filter((d) => d.verified).length}/3 端有证据）`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, json)
console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}`)
console.log('')
if (report.jsLayer) {
  const j = report.jsLayer
  console.log(`  JS 层（假 hooks · 并发 ${j.params.concurrency}）：bare p50 ${j.bare.p50Ms}ms → full ${j.full.p50Ms}ms（${j.overhead.p50Ratio}×）`)
  console.log(`    QPS ${j.bare.qps} → ${j.full.qps}（${j.overhead.qpsDropPct}%）· p99 增量 ${j.overhead.p99DeltaMs}ms ${j.p99Stability?.p99Unstable ? '（★不稳定，只可引用量级）' : ''}`)
}
if (report.highPressure) {
  const h = report.highPressure
  console.log(`  高压：限速 ${h.rateLimit.pass ? '✅' : '❌'} · 配额峰值 ${h.quota.peakInflight}/${h.quota.configuredConcurrency} ${h.quota.pass ? '✅' : '❌'} · 审计 ${h.audit.written}/${h.audit.attempted} ${h.audit.pass ? '✅' : '❌'}`)
}
if (report.throughput?.measured) {
  const t = report.throughput
  console.log('  真机并发吞吐（iOS 实测）：')
  for (const p of t.points) console.log(`    并发 ${p.concurrency} ⇒ ${p.qps} QPS · p50 ${p.p50Ms}ms · p99 ${p.p99Ms}ms`)
  if (t.knee) console.log(`    ★拐点：并发 ${t.knee.at}（${t.knee.qps} QPS）—— 再加压只增延迟不增吞吐`)
} else {
  console.log(`  真机并发吞吐：未测（${report.throughput?.reason ?? ''}）`)
}
for (const d of devices) {
  if (d.verified) console.log(`  ${d.end}：稳定 ttfb ${d.steadyTtfbMs}ms ⇒ 单连接串行上限 ≈ ${d.serialQpsCeiling} QPS（${d.proto} · 同连接 ${d.sameConn}）`)
  else console.log(`  ${d.end}：未验（${d.reason}）`)
}
