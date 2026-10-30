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
//   · `devices[].serialQpsCeiling` 是**单连接串行**的理论上限（ttfb 倒数）——不是压测结果
//   · `throughput` 才是**并发压测实测**（#1404 新增探针）；两端通路不同（见各自 transportMode）
//   · 平台期**必须归属**：本机另跑 `scripts/bench-echo-server.mjs` 量服务端天花板，
//     否则"App 只跑 2.4k QPS"与"服务端只能跑 2.4k"读数同形（#1103 同族陷阱）
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
  // ★#1404 修正：Android 的传输证据**早已入库**（`hosts/android/results/transport-probe.json` · 2026-10-22）,
  //   此前这里写死 "adb devices 为空 ⇒ 未验" 是**过期标注**——把"当时没设备"固化成了"这一端没有证据"。
  //   ★同族缺陷：硬编码的结论不会随证据出现而失效（与"数字锚在错误位置"同类）。
  //   现在改为与 iOS/鸿蒙**同一读取函数**：有产物就认，没产物才标未验。
  deviceTransport('Android', 'hosts/android/results/transport-probe.json'),
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
   * 【★★实测曲线（各 3 轮取中位 · 2026-10-30 重测）】
   *   iOS     4/8/16 = 371.1 / 567.5 / 544.7 QPS（p50 10/13/28ms）
   *   Android 4/8/16 = 2247.2 / 2169.2 / 2164.5 QPS（p50 2/3/6ms）
   *   ⇒ 两端都是 **plateau（平台期）**：并发从 4 加到 16，QPS 只差 4%。
   *     加压换来的只有延迟上涨（iOS p50 10→28ms、Android 2→6ms）——**没有吞吐收益**。
   *
   * 【★★★为什么这一节被重写过（前一轮的结论是错的）】
   *   前一轮（同决策 #1404 的首次实现）报的是"**拐点在并发 8**：4→8 近线性、8→16 只涨延迟"。
   *   ★那是**单次扫描 + 每档 200 请求**的噪声：每档只跑 ~0.35s，预热/JIT/GC 的影响盖过信号。
   *   本轮取证：同一台 iOS 设备同一档（并发 8）重复测得 **412.5 与 542.6（差 27%）**；
   *   改成每档 1000 请求 × 3 轮取中位后，轮间差才降到 8–17%，曲线形状才稳定。
   *   ⇒ **"拐点在 8" 是测量装置缺陷造成的假结论，已被本轮数据推翻并更正**。
   *     这也是"单次读数会假装有结论"的最直接实证（同族：bench-request 首版 bare/full 分先后跑）。
   *
   * 【★QPS 数字的可引用性：已做归属】
   *   同机单独量 echo 服务端天花板（scripts/bench-echo-server.mjs）：最低档 9325 QPS。
   *   客户端 567（iOS）/ 2247（Android）只占其 6% / 24% ⇒ **瓶颈在客户端**，
   *   QPS 可作为框架指标引用。★若没有这一步，平台期是"客户端饱和"还是"服务端饱和"**读数同形**。
   */
  throughput: (() => {
    /**
     * ★★★#1404：**逐端**读取并发压测实测（此前只写死 iOS ⇒ Android 有证据也不显示）。
     *   ★每端通路不同，必须逐端标注 `transportMode`——把回环与 WiFi 的数字并排列出
     *     而不说明，等于制造"Android 比 iOS 快 4 倍"的误读。
     */
    const ENDS = [
      { end: 'iOS', rel: 'hosts/ios/results/perf-probe.json' },
      { end: 'Android', rel: 'hosts/android/results/perf-probe.json' },
    ]
    const readEnd = ({ end, rel }) => {
      const p = readJson(rel)
      if (!p || !Array.isArray(p.points) || p.points.length === 0) return null
      const pts = p.points.slice().sort((a, b) => a.concurrency - b.concurrency)
      return {
        end,
        /** 通路：iOS 走局域网 WiFi；Android 走 adb reverse 回环（targetSdk 34 拦明文） */
        transportMode: p.points[0]?.transportMode ?? (end === 'Android' ? 'loopback-usb' : 'lan-wifi'),
        points: pts.map((x) => ({
          concurrency: x.concurrency,
          qps: x.qps,
          p50Ms: x.p50Ms,
          p99Ms: x.p99Ms,
          failed: x.failed,
          /** ★多轮：中位值必须与轮间波动一起看（单次读数会假装有结论） */
          roundsCount: x.roundsCount ?? 1,
          qpsSpreadPct: x.qpsSpreadPct ?? null,
        })),
        best: p.best,
        /**
         * ★拐点判定（#1404 修正——旧版会**误报**）：
         *   旧口径「相邻档涨幅 < 1.1× 就算拐点」在**单次扫描的小幅非单调**下会给出错误结论：
         *   iOS 实测 4→380.2 / 8→412.5（+8.5%）/ 16→598.4（+45%）——中间那档涨幅不足 10%，
         *   旧口径便宣布"拐点在 4"，而最后一档又涨了 45% ⇒ **根本没饱和**。
         *   ⇒ 新口径：以**最高 QPS 档**为基准，只有当后面还有档位且**明显回落**（< 峰值 0.95×）时
         *     才报拐点；否则返回 null 表示"在测量范围内持续增长"（页面文案走"持续增长"分支）。
         *   ★诚实边界：null ≠ "无限扩展"，只是"这个并发范围内没看到饱和"。
         */
        knee: (() => {
          if (pts.length < 2) return null
          const peak = pts.reduce((a, b) => (b.qps > a.qps ? b : a))
          const after = pts.filter((p) => p.concurrency > peak.concurrency)
          if (after.length === 0) return null
          const drop = after.find((p) => p.qps < peak.qps * 0.95)
          return drop ? { at: peak.concurrency, qps: peak.qps } : null
        })(),
        /**
         * ★★★#1404：曲线**形状三分**（此前只有 knee/null 两种，把平台期说成"持续增长"）。
         *   · `rising`    —— 峰值在**最后一个**并发度（还在涨）
         *   · `plateau`   —— 峰值不在最后，且后续档都 ≥ 峰值 0.95×（**平了，但没回落**）
         *   · `knee-drop` —— 后续档明显回落（< 峰值 0.95×）⇒ 真拐点
         *   ★实测对照（各 3 轮取中位）：
         *     Android 4/8/16 = 2247/2169/2165 ⇒ **plateau**（三点差 4%，曲线是平的）
         *     iOS     4/8/16 = 371/567/545   ⇒ **plateau**（峰值在 8，16 档 0.96×）
         *     而旧文案会把两者都说成"测量范围内持续增长"——**方向说反了**。
         *   ★诚实边界：plateau 只说明"这一段没再涨"，**不说明饱和点在哪**（需扫更高并发）。
         */
        shape: (() => {
          if (pts.length < 2) return 'single-point'
          const peak = pts.reduce((a, b) => (b.qps > a.qps ? b : a))
          if (peak.concurrency === pts[pts.length - 1].concurrency) return 'rising'
          const after = pts.filter((p) => p.concurrency > peak.concurrency)
          return after.some((p) => p.qps < peak.qps * 0.95) ? 'knee-drop' : 'plateau'
        })(),
        source: rel,
      }
    }
    const ends = ENDS.map(readEnd).filter(Boolean)
    if (ends.length === 0) {
      return {
        measured: false,
        reason: '缺真机压测产物（跑 bash hosts/{ios,android}/run-perf-probe.sh）',
      }
    }

    /**
     * ★★**平台期归属**（缺这一步，QPS 数字无法解释）：
     *   拿服务端天花板（`scripts/bench-echo-server.mjs` 本机回环实测）比客户端实测，
     *   · 客户端 < 服务端 × 0.5  ⇒ 瓶颈在**客户端**（这个 QPS 是框架指标）
     *   · 否则                   ⇒ **装置可能先饱和**，QPS 不可当框架结论
     */
    const ceiling = readJson('docs/generated/request-server-ceiling.json')
    const attribution = ends.map((e) => {
      const top = Math.max(...e.points.map((p) => p.qps))
      if (!ceiling || typeof ceiling.floorQps !== 'number') {
        return { end: e.end, clientTopQps: top, verdict: 'unknown', reason: '缺服务端天花板基准（跑 node scripts/bench-echo-server.mjs）' }
      }
      const ratio = +(top / ceiling.floorQps).toFixed(2)
      return {
        end: e.end,
        clientTopQps: top,
        serverFloorQps: ceiling.floorQps,
        clientToServerRatio: ratio,
        verdict: ratio < 0.5 ? 'client-bound' : 'server-bound-or-tied',
        reason: ratio < 0.5
          ? `客户端最高 ${top} QPS，服务端最低档 ${ceiling.floorQps} QPS（${ratio}×）⇒ 瓶颈在客户端，QPS 可作为框架指标`
          : `客户端最高 ${top} QPS 与服务端 ${ceiling.floorQps} QPS 同量级（${ratio}×）⇒ 装置先饱和，此读数不可当框架结论`,
      }
    })

    return {
      measured: true,
      /** 兼容旧字段（首版只有 iOS）：保留 iOS 的 points 在顶层，读者不会因字段消失而误读为空 */
      end: ends[0].end,
      points: ends[0].points,
      best: ends[0].best,
      knee: ends[0].knee,
      /** 兼容旧字段：顶层 shape = 第一端的形状（逐端见 ends[]） */
      shape: ends[0].shape,
      source: ends[0].source,
      /** ★逐端全量（含通路标注） */
      ends,
      attribution,
      serverCeilingSource: ceiling ? 'docs/generated/request-server-ceiling.json' : null,
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
    '要真实并发吞吐看 throughput（#1404 新增探针已实测 iOS + Android）',
  ],
  /** ★★关键：**本报告不证明**的东西（避免被当作"已压测"引用） */
  notProven: [
    '端到端 QPS：JS 层基准不含网络/序列化/宿主往返；devices[] 的 serialQpsCeiling 是**单连接串行理论上限**（ttfb 倒数）',
    '并发吞吐：**iOS + Android 已实测**（见 throughput.ends）· **鸿蒙未测**（一次性 VM 无法 JS 侧并发循环，需会话式 VM）',
    '跨端横比：iOS 走局域网 WiFi、Android 走 adb reverse 回环 ⇒ **两端 QPS 不可直接比大小**',
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
  /**
   * ★★#1404：**有吞吐读数却没有归属 ⇒ 判红**。
   *   理由：一条平台期曲线在"客户端饱和"与"服务端饱和"两种情况下**读数完全同形**（#1103 同族陷阱）。
   *   没有服务端天花板基准时，那个 QPS 可能只是装置指标，却被当成框架结论引用。
   *   ★这是结构性判据：它会随新端加入自动生效（不依赖谁记得去跑）。
   */
  if (report.throughput?.measured) {
    const unknown = (report.throughput.attribution ?? []).filter((a) => a.verdict === 'unknown')
    for (const a of unknown) problems.push(`${a.end} 的吞吐未归属（缺服务端天花板基准 ⇒ 跑 node scripts/bench-echo-server.mjs）`)
    if (!report.throughput.serverCeilingSource) problems.push('缺服务端天花板产物（docs/generated/request-server-ceiling.json）')
  }
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
  for (const e of t.ends) {
    console.log(`  真机并发吞吐 · ${e.end}（${e.transportMode}）：`)
    for (const p of e.points) console.log(`    并发 ${p.concurrency} ⇒ ${p.qps} QPS · p50 ${p.p50Ms}ms · p99 ${p.p99Ms}ms`)
    if (e.shape === 'knee-drop' && e.knee) {
      console.log(`    ★曲线：峰值 ${e.knee.qps} QPS 在并发 ${e.knee.at}，之后**回落** ⇒ 真拐点，再加压只增延迟`)
    } else if (e.shape === 'plateau') {
      const lo = Math.min(...e.points.map((p) => p.qps))
      console.log(`    ★曲线：**平台期**（${lo}–${Math.max(...e.points.map((p) => p.qps))} QPS 横跨全部档位，峰值 ${e.best?.qps} 在并发 ${e.best?.concurrency}）⇒ 这一段没再涨，但饱和点位置需扫更高并发`)
    } else if (e.shape === 'rising' && e.best) {
      console.log(`    ★曲线：仍在上升 —— 最高 ${e.best.qps} QPS 在最后一档（并发 ${e.best.concurrency}），未到饱和`)
    }
  }
  for (const a of t.attribution ?? []) {
    console.log(`  归属 · ${a.end}：${a.verdict === 'client-bound' ? '✅ 客户端是瓶颈' : a.verdict === 'unknown' ? '⚠ 未知' : '⚠ 装置可能先饱和'} — ${a.reason}`)
  }
} else {
  console.log(`  真机并发吞吐：未测（${report.throughput?.reason ?? ''}）`)
}
for (const d of devices) {
  // ★#1404：ttfb < 1ms 时 serialQpsCeiling 为 null（倒数会失真成天文数字）——
  //   必须把"读数低于计时分辨率"说清楚，不能打印 "≈ null QPS"（那看起来像漏了字段）。
  if (d.verified && d.serialQpsCeiling !== null) {
    console.log(`  ${d.end}：稳定 ttfb ${d.steadyTtfbMs}ms ⇒ 单连接串行上限 ≈ ${d.serialQpsCeiling} QPS（${d.proto} · 同连接 ${d.sameConn}）`)
  } else if (d.verified) {
    console.log(`  ${d.end}：稳定 ttfb ${d.steadyTtfbMs}ms **低于计时分辨率 ⇒ 推不出串行上限**（${d.proto} · 同连接 ${d.sameConn}）—— 以并发实测为准`)
  } else {
    console.log(`  ${d.end}：未验（${d.reason}）`)
  }
}
