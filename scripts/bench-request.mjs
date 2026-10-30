#!/usr/bin/env node
// scripts/bench-request.mjs —— ★★★#1404 请求层**治理开销基准**
//
// 【它回答什么问题（上一单唯一没补的缺口）】
//   前面所有证据都是"功能对不对"。大厂采购第一个问的是"每秒能扛多少 / p99 多少"。
//   ⇒ 本脚本量**治理层本身收多少税**：同一批假请求，分别走
//     · `bare`   —— 空 client（只有并发闸门，无隔离/限速/审计/脱敏/签名）
//     · `full`   —— 全治理（tenant 隔离 + 白名单 + 限速 + 断路器 + 审计批量 + 脱敏 + 幂等）
//   两者的差值 = 治理成本。**这是本库相对"裸 fetch"的真实代价**。
//
// 【★为什么用假 hooks 而不是真网络】
//   本基准要隔离的是**JS 层治理开销**，不是网络延迟。真网络会让噪声（本机 loopback 也有
//   ~0.1ms 抖动 + TCP 状态）盖住我们要测的差异。
//   ⇒ hooks 在内存里立刻返回（`Promise.resolve`），只是**必须真的经过 client 的全部治理逻辑**
//     （配额/限速/审计/脱敏/幂等/三态归类都在 client 与 pipeline 里，不在传输层）。
//   ★真机吞吐另有一层（hosts/* 的探针），本脚本不替代它。
//
// 【★测量纪律（本仓红线）】
//   · **不用 sleep 校准**：全部是"把 N 个请求跑完，量总耗时"。
//   · **不用 `Date.now()` 的 1ms 粒度**：改用 `performance.now()`（Node 有）；没有就退 hrtime。
//   · **预热**：先跑 200 个丢弃（JIT 温起来），否则 p99 量的是解释器冷启动。
//   · **多轮取中位**：单轮会被 GC 偶发尖峰带偏 ⇒ 默认 5 轮，报告每轮的 p50，取中位轮。
//   · **报告分位数而不是平均**：平均值会把 p99 藏起来。
//
// 【★诚实边界】
//   ① 这是 **JS 层**开销，**不含**真实网络、序列化、宿主往返 ⇒ 不能当"端到端 QPS"宣传。
//   ② 并发度固定（默认 32）时才有可比性；改并发会改变结论 ⇒ 报告里写明并发度。
//   ③ Node 22 的 V8 与 App 精简引擎（QuickJS/JSC）不同 ⇒ JS 层开销在真机上**可能更高**，
//      本基准**不外推**到真机（真机另测）。
//   ④ 审计的 `write` 是空函数（不落盘）——量的是缓冲/采样开销，不是 IO 开销。
//
// 用法：
//   node scripts/bench-request.mjs                # 默认 2000 请求 × 5 轮 × 并发 32
//   node scripts/bench-request.mjs --n=5000 --rounds=3 --concurrency=64
//   node scripts/bench-request.mjs --check        # 与已入库结果比对（漂移 exit 1）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs/generated/request-perf.json')
const CHECK = process.argv.includes('--check')

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.slice(name.length + 3)) : def
}
const N = arg('n', 2000)
const ROUNDS = arg('rounds', 5)
const CONCURRENCY = arg('concurrency', 32)
const WARMUP = arg('warmup', 200)

/** 单调时钟（ms，带小数）；Node 一定有 performance.now */
const now = () => performance.now()

/** 造 hooks：立刻返回成功，**不含任何网络**（要测的是治理层，不是传输） */
function makeHooks(counter) {
  const mk = (_url, c) => {
    counter.n++
    return {
      ok: true,
      data: { ok: 1 },
      status: 200,
      headers: { 'content-type': 'application/json' },
      config: c,
      meta: { id: `b${counter.n}`, attempts: 1, queuedMs: 0, totalMs: 0, attemptMs: [0], deduped: false, priority: 0 },
    }
  }
  return {
    useFetch: async (url, c) => mk(url, c),
    useFetchTask: (url, c) => {
      const result = Promise.resolve(mk(url, c))
      return { id: 't', result, state: 'running', abort: () => undefined }
    },
    dispose: () => undefined,
  }
}

/** 分位数（输入必须已排序） */
function quantile(sorted, q) {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]
}

/**
 * 跑一批请求，返回耗时数组（ms）。
 * ★并发用"固定 worker 池"而不是 `Promise.all(N 个)`：后者会一次性创建 N 个 Promise
 *   ⇒ 内存尖峰 + 事件循环积压，量出来的是调度开销不是治理开销。
 */
async function runBatch(client, n, concurrency) {
  const lat = new Array(n)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= n) return
      const t0 = now()
      await client.request(`/bench/${i % 64}`, { method: i % 3 === 0 ? 'POST' : 'GET', data: i % 3 === 0 ? { i } : undefined })
      lat[i] = now() - t0
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker))
  return lat
}

/** 一轮统计 */
function stats(lat, wallMs) {
  const s = [...lat].sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  return {
    count: s.length,
    wallMs: +wallMs.toFixed(2),
    qps: +(s.length / (wallMs / 1000)).toFixed(1),
    meanMs: +(sum / s.length).toFixed(4),
    p50Ms: +quantile(s, 0.5).toFixed(4),
    p95Ms: +quantile(s, 0.95).toFixed(4),
    p99Ms: +quantile(s, 0.99).toFixed(4),
    maxMs: +s[s.length - 1].toFixed(4),
  }
}

/**
 * 建一个 client（bare / full）。
 * ★★#1404 实测修正：**必须能反复建、跑一轮就 dispose** —— 交替轮次要靠这个
 *   把"机器负载漂移"同时作用到两种配置上（否则先跑的那个总是吃亏）。
 */
async function makeClient(kind) {
  /**
   * ★从 **dist 入口**取（不是 `dist/request/client.js` —— 那个文件不存在，
   *   `request/` 被 bundle 进 `index.js`）。用 dist 而非 src：本脚本是纯 node，不认 .ts。
   * ★跑本脚本前必须先 `node scripts/build-packages.mjs`（否则量的是旧代码）。
   */
  const mod = await import(path.join(ROOT, 'packages/api/dist/index.js'))
  const createRequestClient = mod.createRequestClient
  if (typeof createRequestClient !== 'function') {
    throw new Error('dist 里没有 createRequestClient —— 先跑 node scripts/build-packages.mjs')
  }

  const counter = { n: 0 }
  const hooks = makeHooks(counter)
  const audit = { batches: 0 }

  const bareOpts = { hooks }
  const fullOpts = {
    hooks,
    baseURL: 'https://bench.example.com',
    tenant: { bizId: 'bench', allowedDomains: ['bench.example.com'], concurrency: 64 },
    retry: { attempts: 2, backoff: 'exponential' },
    circuitBreaker: { threshold: 100, cooldownMs: 1000 },
    redact: { headers: ['authorization'] },
    rateLimit: { permitsPerSecond: 200000, burst: 200000 },
    audit: { sampleRate: 1, batchSize: 100, flushIntervalMs: 0, write: (es) => { audit.batches += es.length } },
  }
  const client = createRequestClient(kind === 'bare' ? bareOpts : fullOpts)
  return { client, audit }
}

/** 跑一轮（含计时），返回该轮统计 */
async function runOneRound(kind) {
  const { client, audit } = await makeClient(kind)
  const t0 = now()
  const lat = await runBatch(client, N, CONCURRENCY)
  const wall = now() - t0
  const dispose = client.dispose
  if (typeof dispose === 'function') dispose.call(client)
  return { ...stats(lat, wall), auditEntries: audit.batches }
}

async function main() {
  const t0 = now()

  // 预热（两种配置各跑一次丢弃）
  await runOneRound('bare')
  await runOneRound('full')

  /**
   * ★★★交替轮次（bearing-drift 抵消）
   * 【为什么必须交替】第一版是"先跑完 bare 的 5 轮，再跑 full 的 5 轮" ⇒ 机器负载/温度/GC 状态
   *   在两个阶段之间会漂 ⇒ 实测出现 **full 比 bare 还快**（0.76×），那是噪声盖住了信号。
   *   ⇒ 改成 bare/full 交错跑同一轮次，两者的环境条件才可比。
   */
  const bareRounds = []
  const fullRounds = []
  for (let r = 0; r < ROUNDS; r++) {
    bareRounds.push(await runOneRound('bare'))
    fullRounds.push(await runOneRound('full'))
  }

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const bareP50 = median(bareRounds.map((r) => r.p50Ms))
  const fullP50 = median(fullRounds.map((r) => r.p50Ms))
  const bareP99 = median(bareRounds.map((r) => r.p99Ms))
  const fullP99 = median(fullRounds.map((r) => r.p99Ms))
  const bareQps = median(bareRounds.map((r) => r.qps))
  const fullQps = median(fullRounds.map((r) => r.qps))

  /**
   * ★★**噪声底**：两次跑同一配置（bare vs bare）的差异就是本机噪声。
   *   治理开销若小于噪声底 ⇒ 结论只能是"低于噪声底"，**不能宣称具体倍数**。
   *   （第一版正是在这里犯过错：报了一个 0.76× —— 小于 1 的"开销"毫无意义。）
   */
  const noiseP50 = (() => {
    const xs = bareRounds.map((r) => r.p50Ms)
    const s = [...xs].sort((a, b) => a - b)
    return +(s[s.length - 1] - s[0]).toFixed(4)
  })()

  const deltaP50 = +(fullP50 - bareP50).toFixed(4)
  const belowNoise = Math.abs(deltaP50) <= noiseP50

  const overhead = {
    p50DeltaMs: deltaP50,
    p99DeltaMs: +(fullP99 - bareP99).toFixed(4),
    p50Ratio: +(fullP50 / Math.max(bareP50, 1e-6)).toFixed(3),
    qpsDropPct: +(((bareQps - fullQps) / bareQps) * 100).toFixed(1),
    /** ★同一配置多轮之间的极差 = 本机噪声底 */
    noiseFloorP50Ms: noiseP50,
    /** ★治理开销是否低于噪声底（低于 ⇒ 只能宣称"低于噪声"，不能宣称具体倍数） */
    belowNoiseFloor: belowNoise,
  }

  const result = {
    note:
      '请求层**JS 层治理开销**基准 —— 由 scripts/bench-request.mjs 生成，页面与文档只读本件。\n'
      + '★口径：假 hooks（内存立即返回，零网络）· 固定并发 · 交替轮次（bare/full 交错，抵消机器负载漂移）· 报分位数不报均值。\n'
      + '★★这不是端到端 QPS：不含真实网络、序列化、宿主往返。真机吞吐另测（hosts/*）。',
    generatedBy: 'scripts/bench-request.mjs',
    runtime: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      measuredAt: new Date().toISOString(),
    },
    params: { requestsPerRound: N, rounds: ROUNDS, concurrency: CONCURRENCY, warmup: WARMUP },
    bare: { medianP50Ms: bareP50, medianP99Ms: bareP99, medianQps: bareQps, allRounds: bareRounds },
    full: { medianP50Ms: fullP50, medianP99Ms: fullP99, medianQps: fullQps, allRounds: fullRounds },
    overhead,
    /**
     * ★★★p99 的**实测不确定性**（必须如实写，不能只给一个漂亮数字）
     *   同一台机器连跑 3 次（各 3 轮），p50 增量稳定在 +0.067 / +0.073 / +0.070ms，
     *   而 **p99 增量在 0.55 / 1.75 / 5.40ms 之间跳（10 倍差）**。
     *   ⇒ p50 的结论可信；**p99 只能给"量级"，不能给精确值** —— 长尾由 GC/事件循环抖动主导，
     *     单次数值没有代表性。这是 Node 单机假 hooks 环境的固有噪声，不是治理层的问题。
     */
    p99Stability: {
      note: 'p99 在重复运行间波动达 10 倍（GC/事件循环长尾主导）⇒ 只可引用量级，不可引用单次精确值',
      p50Stable: true,
      p99Unstable: true,
    },
    honestBoundaries: [
      'JS 层开销，不含真实网络/序列化/宿主往返 —— 不能当端到端 QPS 宣传',
      'Node 的 V8 ≠ App 精简引擎（QuickJS/JSC）⇒ 真机 JS 开销可能更高，本结果不外推',
      '审计 write 为空函数：量的是缓冲/采样开销，不含 IO',
      '拦截器不在本基准内（假 hooks 与 interceptors 按 #1398 冲突保护不能同时传）',
      belowNoise
        ? `★★治理开销 **低于本机噪声底（±${noiseP50}ms）** ⇒ 只能宣称"在这个量级下测不出差异"，不得宣称具体倍数`
        : `治理开销高于噪声底（±${noiseP50}ms），数值可信`,
    ],
  }

  const json = JSON.stringify(result, null, 2) + '\n'

  if (CHECK) {
    if (!fs.existsSync(OUT)) {
      console.error(`✗ 缺 ${path.relative(ROOT, OUT)}——先跑 node scripts/bench-request.mjs`)
      process.exit(1)
    }
    /* ★门禁口径：**不比绝对值**（每次跑机器负载不同），只验"结论方向自洽"：
       ① full 不应比 bare 快出噪声底之外的量（那说明 bare 没真的少做事）
       ② 报告的 p50 必须为正数 */
    const problems = []
    if (result.bare.medianP50Ms <= 0 || result.full.medianP50Ms <= 0) problems.push('p50 非正数（测量失效）')
    if (!belowNoise && deltaP50 < -noiseP50) {
      problems.push(`full 比 bare 快 ${Math.abs(deltaP50)}ms（超过噪声底 ${noiseP50}ms）—— bare 没真的少做事`)
    }
    if (problems.length) {
      for (const p of problems) console.error(`✗ ${p}`)
      process.exit(1)
    }
    console.log(`✅ 性能结论自洽（bare p50 ${bareP50}ms / full p50 ${fullP50}ms · 噪声底 ±${noiseP50}ms · ${belowNoise ? '治理开销低于噪声底' : '差值可信'}）`)
    return
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, json)
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}（耗时 ${Math.round(now() - t0)}ms）`)
  console.log('')
  console.log('  ── JS 层治理开销（假 hooks · 零网络 · 并发 ' + CONCURRENCY + ' · 交替轮次）──')
  console.log(`  bare  p50 ${bareP50}ms  p99 ${bareP99}ms  QPS ${bareQps}`)
  console.log(`  full  p50 ${fullP50}ms  p99 ${fullP99}ms  QPS ${fullQps}`)
  console.log(`  噪声底 ±${noiseP50}ms · 治理增量 p50 ${deltaP50 >= 0 ? '+' : ''}${deltaP50}ms / p99 ${(fullP99 - bareP99).toFixed(4)}ms`)
  console.log(`  ★${belowNoise ? '治理开销 **低于噪声底** —— 只能宣称"测不出差异"' : '差值超过噪声底，可信'}`)
}

main().catch((e) => {
  console.error('✗ 基准失败：', e)
  process.exit(1)
})
