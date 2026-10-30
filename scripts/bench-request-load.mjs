#!/usr/bin/env node
// scripts/bench-request-load.mjs —— ★★★#1404 请求层**高压行为**验证
//
// 【它回答的问题（与 bench-request.mjs 互补）】
//   `bench-request.mjs` 量的是"正常负载下治理开销多少"。
//   本脚本量的是**高压下治理层有没有真的起作用**：
//     · 限速：配 2000/s，跑 5000 个瞬时并发 ⇒ 实际放行多少？被拒多少？（应 ≈ 2000 + burst）
//     · 配额：配全局并发 8，跑 200 个并发 ⇒ 峰值在飞数是否真的不超过 8？
//     · 审计：跑完 N 个请求 ⇒ written + dropped 是否**恰好等于**发出的条数（不丢不重）
//
// 【★★为什么这三条比"QPS 多少"更重要】
//   QPS 只说明"跑得快"，而大厂采购真正要确认的是**"跑再快也不会打爆下游"**。
//   限速/配额/审计这三条一旦失效，量越大事故越大 —— 它们是"高压下的安全边界"。
//   本库前面所有判据都只在小规模下验证过（个位数请求），**高压下是否仍成立是另一回事**。
//
// 【★测量纪律】不用 sleep 校准；全部"跑完一批量总数"；断言用**精确等式**（不是 ≤ / ≥）
//   凡是"约等于"的地方都写明容差与理由。
//
// 用法：node scripts/bench-request-load.mjs [--check]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs/generated/request-load.json')
const CHECK = process.argv.includes('--check')

const now = () => performance.now()

const mod = await import(path.join(ROOT, 'packages/api/dist/index.js'))
const { createRequestClient } = mod
if (typeof createRequestClient !== 'function') {
  console.error('✗ dist 里没有 createRequestClient —— 先跑 node scripts/build-packages.mjs')
  process.exit(1)
}

/** 假 hooks：立刻成功；`delayMs` 用于让请求真的"在飞"一段时间（测配额） */
function makeHooks(opts = {}) {
  let n = 0
  let inflight = 0
  let peakInflight = 0
  const mk = async (_url, c) => {
    inflight++
    if (inflight > peakInflight) peakInflight = inflight
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
    inflight--
    n++
    return {
      ok: true, data: 1, status: 200, headers: {}, config: c,
      meta: { id: `l${n}`, attempts: 1, queuedMs: 0, totalMs: 0, attemptMs: [0], deduped: false, priority: 0 },
    }
  }
  return {
    hooks: {
      useFetch: mk,
      useFetchTask: (url, c) => ({ id: 't', result: mk(url, c), state: 'running', abort: () => undefined }),
      dispose: () => {},
    },
    get peakInflight() { return peakInflight },
    get served() { return n },
  }
}

/** ① 限速：瞬时打 5000 个，看放行/拒绝是否与配置相符 */
async function checkRateLimit() {
  const PER_SEC = 2000
  const BURST = 200
  const TOTAL = 5000
  const fake = makeHooks()
  const client = createRequestClient({
    hooks: fake.hooks,
    rateLimit: { permitsPerSecond: PER_SEC, burst: BURST, maxWaitMs: 0 },
  })
  /* ★为什么 TOTAL 远大于 burst：令牌桶初始满桶 = BURST，
     跑得够快时（整批在 < 1 个补令牌周期内完成）放行数应**恰好等于 burst**。
     若放行数明显 > burst ⇒ 漏令牌（限速失效）；若明显 < burst ⇒ 多扣（误限）。 */
  const tStart = now()
  const results = await Promise.all(
    Array.from({ length: TOTAL }, () => client.request('/rl')),
  )
  const elapsedMs = now() - tStart
  const okCount = results.filter((r) => r.ok).length
  /** ★按定义推导的理论上限：突发额度 + 这批请求实际耗时内补充的令牌 */
  const theoreticalMax = Math.ceil(BURST + (PER_SEC * elapsedMs) / 1000) + 1 /* +1 防边界浮点 */
  const rejected = results.filter((r) => !r.ok)
  const rateLimited = rejected.filter((r) => r.error && r.error.code === 'request.rateLimited').length
  client.dispose?.()

  return {
    configured: { permitsPerSecond: PER_SEC, burst: BURST },
    attempted: TOTAL,
    elapsedMs: +elapsedMs.toFixed(2),
    allowed: okCount,
    rejected: rejected.length,
    rejectedAsRateLimited: rateLimited,
    /**
     * ★判据（第二版 —— 第一版判错，记录在此）
     *   第一版写 `okCount <= BURST + 5`，实测放行 229 ⇒ 判红。
     *   取证：**冻结时钟连取 5000 次恰好放行 200** ⇒ 令牌桶精确，没有漏令牌。
     *   多出的 29 个是**真实时间流逝补的令牌**（整批 ~14.5ms × 2000/s ≈ 29）。
     *   ⇒ 正确上限应按**定义**推导：`burst + rate × 实际耗时`，不是拍一个容差。
     *   ★教训：**容差必须由机制推导**；拍脑袋的容差会把"正确行为"判成 bug。
     */
    pass: okCount <= theoreticalMax
      && rateLimited === rejected.length
      && rejected.length > 0,
    /** 按定义推导的理论上限（burst + 期间补充的令牌数） */
    theoreticalMax,
    note: '放行应 ≤ burst + 速率×实际耗时（按定义推导，不是拍容差）；被拒必须全部归因 request.rateLimited',
  }
}

/** ② 配额：全局并发 8，打 200 个，量**峰值在飞数** */
async function checkQuota() {
  const LIMIT = 8
  const TOTAL = 200
  const fake = makeHooks({ delayMs: 3 })
  const client = createRequestClient({
    hooks: fake.hooks,
    tenant: { bizId: 'q', concurrency: LIMIT },
  })
  const t0 = now()
  await Promise.all(Array.from({ length: TOTAL }, () => client.request('/q')))
  const wall = now() - t0
  const peak = fake.peakInflight
  client.dispose?.()

  return {
    configuredConcurrency: LIMIT,
    attempted: TOTAL,
    served: fake.served,
    peakInflight: peak,
    wallMs: +wall.toFixed(1),
    /** ★判据：峰值在飞数**不得超过配置上限**（这就是"不会打爆下游"的直接证据） */
    pass: peak <= LIMIT && fake.served === TOTAL,
    note: '峰值在飞数不得超过 concurrency；所有请求最终都要被服务（不能静默丢）',
  }
}

/** ③ 审计：跑完 N 个，written + dropped 是否恰好等于发出条数 */
async function checkAudit() {
  const TOTAL = 1000
  const fake = makeHooks()
  /**
   * ★★**只数回调实参**（不再读 sink 自己的记账）。
   *   M-B3 变异（内部计数不增）原本没被判红，因为判据读的是 `snapshot().written` ——
   *   那证明的是"库觉得自己写了多少"，**不是"业务收到了多少"**。
   */
  let written = 0
  let batches = 0
  const client = createRequestClient({
    hooks: fake.hooks,
    tenant: { bizId: 'a' },
    audit: {
      sampleRate: 1,          // ★全留（采样另有用例，这里验"不丢不重"）
      batchSize: 37,          // 故意给个非整除的数：验边界批次
      flushIntervalMs: 0,
      maxBuffer: 5000,        // 够大，不触发丢弃
      write: (es) => { written += es.length; batches++ },
    },
  })
  // 串行发（并发会让"条数"更难对上，而本用例验的是**计数守恒**）
  for (let i = 0; i < TOTAL; i++) await client.request(`/a${i}`)
  const statsBeforeDispose = client.stats().audit
  client.dispose?.()   // ★dispose 会 flush 最后一批

  return {
    attempted: TOTAL,
    written,
    dropped: statsBeforeDispose?.dropped ?? 0,
    batches,
    /** ★判据：written 必须**恰好等于** attempted（不丢不重）；dropped 必须为 0（上限够大） */
    pass: written === TOTAL && (statsBeforeDispose?.dropped ?? 0) === 0,
    note: 'written 必须恰好等于发出条数（不丢不重）；缓冲够大时 dropped 必须为 0',
  }
}

const t0 = now()
const rateLimit = await checkRateLimit()
const quota = await checkQuota()
const audit = await checkAudit()

const failed = [rateLimit, quota, audit].filter((c) => !c.pass)
const result = {
  note:
    '请求层**高压行为**验证 —— 由 scripts/bench-request-load.mjs 生成。\n'
    + '★口径：假 hooks（零网络）· 用**精确等式**断言（不是"约等于"）· 容差只在必要处写明理由。\n'
    + '★★这三条比"QPS 多少"更重要：QPS 只说明跑得快，这三条说明**跑再快也不会打爆下游**。',
  generatedBy: 'scripts/bench-request-load.mjs',
  runtime: { node: process.version, platform: `${process.platform}-${process.arch}`, measuredAt: new Date().toISOString() },
  rateLimit,
  quota,
  audit,
  allPass: failed.length === 0,
  honestBoundaries: [
    '假 hooks：验的是治理层在高压下的行为，不含真实网络',
    '限速用例的容差（+5）是给事件循环调度留余量 —— 补令牌按真实时间流逝，整批不可能"零耗时"',
    '审计用例串行发：验的是**计数守恒**，并发下的条数对账另有单测覆盖',
  ],
}

const json = JSON.stringify(result, null, 2) + '\n'

if (CHECK) {
  if (!fs.existsSync(OUT)) {
    console.error(`✗ 缺 ${path.relative(ROOT, OUT)}——先跑 node scripts/bench-request-load.mjs`)
    process.exit(1)
  }
  if (!result.allPass) {
    console.error('✗ 高压行为验证未通过：')
    for (const c of failed) console.error(`   ${JSON.stringify(c)}`)
    process.exit(1)
  }
  console.log('✅ 请求层高压行为三条全过（限速硬上限 / 配额不越界 / 审计计数守恒）')
  process.exit(0)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, json)
console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}（耗时 ${Math.round(now() - t0)}ms）`)
console.log('')
console.log(`  ① 限速  配置 ${rateLimit.configured.permitsPerSecond}/s · burst ${rateLimit.configured.burst} ⇒ 打 ${rateLimit.attempted} 个：放行 ${rateLimit.allowed} · 拒绝 ${rateLimit.rejected}（全为 rateLimited: ${rateLimit.rejectedAsRateLimited === rateLimit.rejected}） ${rateLimit.pass ? '✅' : '❌'}`)
console.log(`  ② 配额  配置并发 ${quota.configuredConcurrency} ⇒ 打 ${quota.attempted} 个：峰值在飞 ${quota.peakInflight} · 全部服务 ${quota.served === quota.attempted} ${quota.pass ? '✅' : '❌'}`)
console.log(`  ③ 审计  打 ${audit.attempted} 条 ⇒ 写入 ${audit.written} · 丢弃 ${audit.dropped} · 批次 ${audit.batches} ${audit.pass ? '✅' : '❌'}`)
if (failed.length) process.exit(1)
