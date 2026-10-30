// tests/request-perf.test.ts —— ★★★#1404 请求层**性能产物**判据
//
// 【它守什么（防"数字说谎"）】
//   压测的价值全在数字可信。而数字最容易出的问题是**静默过期**：
//   代码改了、页面还挂着旧数字，没有任何机制会提醒（本仓已踩过多次）。
//   ⇒ 本文件守三件事：
//     ① 三份产物**存在且结构完整**（缺一份 = 报告在编）；
//     ② 结论性字段**自洽**（不是比对绝对值 —— 每次跑机器负载不同，绝对值必然漂）；
//     ③ 报告里必须**如实标注未验的端**（Android 无设备不能装作有）。
//
// 【★为什么不在这里断言"QPS > X"】
//   机器性能会变（换机/降频/CI）。断言绝对阈值只会让判据在慢机器上假红，
//   而假红会让人**开始忽略这条判据** —— 那比没有判据更糟。
//   ⇒ 只断言"结构 + 结论方向 + 诚实标注"。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string): unknown => {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

type Perf = {
  params: { concurrency: number; rounds: number }
  bare: { medianP50Ms: number; medianP99Ms: number; medianQps: number }
  full: { medianP50Ms: number; medianP99Ms: number; medianQps: number }
  overhead: { p50DeltaMs: number; p99DeltaMs: number; p50Ratio: number; qpsDropPct: number; noiseFloorP50Ms: number; belowNoiseFloor: boolean }
  p99Stability?: { p99Unstable: boolean }
  honestBoundaries: string[]
}
type Load = {
  rateLimit: { pass: boolean; allowed: number; rejected: number; theoreticalMax: number }
  quota: { pass: boolean; peakInflight: number; configuredConcurrency: number }
  audit: { pass: boolean; written: number; attempted: number; dropped: number }
  allPass: boolean
}
type Report = {
  jsLayer: { overhead: Perf['overhead'] } | null
  highPressure: { allPass: boolean } | null
  devices: Array<{ end: string; verified: boolean; reason?: string; steadyTtfbMs?: number; serialQpsCeiling?: number }>
  throughput: { measured: boolean; points?: Array<{ concurrency: number; qps: number; failed: number }>; best?: { concurrency: number; qps: number }; knee?: { at: number; qps: number } | null; reason?: string }
  deviceCaveats: string[]
  notProven: string[]
}

describe('★★★#1404 请求层性能产物（防数字说谎）', () => {
  it('★★① 三份产物都存在（缺一份 ⇒ 报告在编）', () => {
    for (const rel of [
      'docs/generated/request-perf.json',
      'docs/generated/request-load.json',
      'docs/generated/request-perf-report.json',
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), `★缺 ${rel}（先跑 pnpm bench:request / bench:request-load / gen:request-perf-report）`).toBe(true)
    }
  })

  it('★★② JS 层基准：结论自洽（full 不应显著快于 bare）', () => {
    const p = read('docs/generated/request-perf.json') as Perf
    expect(p, '缺 request-perf.json').toBeTruthy()
    expect(p.params.concurrency).toBeGreaterThan(0)
    expect(p.params.rounds).toBeGreaterThan(0)
    // ★方向自洽：全治理不可能比裸跑快出噪声底之外（那说明 bare 没真的少做事）
    const delta = p.full.medianP50Ms - p.bare.medianP50Ms
    if (!p.overhead.belowNoiseFloor) {
      expect(delta, '★full 比 bare 快 —— bare 没真的绕过治理层').toBeGreaterThanOrEqual(-p.overhead.noiseFloorP50Ms * 2)
    }
    // ★噪声底必须被记录（不记录就分不清"开销"和"抖动"）
    expect(typeof p.overhead.noiseFloorP50Ms, '★噪声底必须记录').toBe('number')
    expect(p.honestBoundaries.length, '★诚实边界不能是空数组').toBeGreaterThan(0)
  })

  it('★★③ JS 层基准：p99 的不稳定性必须被如实标注', () => {
    const p = read('docs/generated/request-perf.json') as Perf
    expect(p.p99Stability, '★p99 的重复运行波动必须在产物里标注（实测达 10 倍差，单次数值无代表性）').toBeTruthy()
    expect(p.p99Stability!.p99Unstable, '★p99 已被实测证明不稳定，必须标 true').toBe(true)
  })

  it('★★★④ 高压行为三条全过（限速/配额/审计）', () => {
    const l = read('docs/generated/request-load.json') as Load
    expect(l, '缺 request-load.json').toBeTruthy()
    expect(l.allPass, '★高压行为未全过').toBe(true)
    // 逐条给出理由，便于定位是哪一条红
    expect(l.rateLimit.pass, '★限速未真的限住（放行超过 burst + 速率×耗时）').toBe(true)
    expect(l.quota.pass, `★配额越界（峰值 ${l.quota.peakInflight} > ${l.quota.configuredConcurrency}）`).toBe(true)
    expect(l.audit.pass, `★审计计数不守恒（写入 ${l.audit.written} / 发出 ${l.audit.attempted}）`).toBe(true)
  })

  it('★★⑤ 限速的判据上限必须按机制推导（不是拍容差）', () => {
    /* ★这条守的是"判据自己的口径"：第一版我写 `okCount <= burst + 5`（拍了个 5），
       实测放行 229 > 205 ⇒ 判红。取证后确认令牌桶精确（冻结时钟下恰好 200），
       多出的是真实时间补的令牌 ⇒ 上限应按 `burst + rate × 耗时` 推导。
       ⇒ 判据必须记录 `theoreticalMax`，否则下次还有人会拍容差。 */
    const l = read('docs/generated/request-load.json') as Load
    expect(typeof l.rateLimit.theoreticalMax, '★限速判据必须记录"按定义推导的上限"').toBe('number')
    expect(l.rateLimit.allowed, '★放行数不得超过推导上限').toBeLessThanOrEqual(l.rateLimit.theoreticalMax)
  })

  it('★★★⑥ 报告必须如实标注未验的端（★声称已验就必须有实际读数）', () => {
    const r = read('docs/generated/request-perf-report.json') as Report
    expect(r, '缺 request-perf-report.json').toBeTruthy()
    expect(r.devices.length, '★三端都要有条目').toBeGreaterThanOrEqual(3)
    for (const d of r.devices) {
      if (!d.verified) {
        expect(String(d.reason ?? ''), `★${d.end} 未验必须给出原因（不能空着）`).not.toBe('')
      } else {
        /* ★★声称已验 ⇒ 必须有**实际读数**。
           M-P4（把 Android 的 verified 伪造成 true）原本没被判红，因为判据只查了"未验时要有原因"。
           ⇒ 补这条：已验的端至少要有 ttfb（或并发的 QPS 读数）。 */
        const hasReading =
          (typeof d.steadyTtfbMs === 'number' && d.steadyTtfbMs > 0)
          || (typeof d.serialQpsCeiling === 'number' && d.serialQpsCeiling > 0)
        expect(hasReading, `★★★${d.end} 声称已验但**没有任何读数** —— 这是凭空声称，不是证据`).toBe(true)
      }
    }
  })

  it('★★⑦ 真机吞吐：有读数则必须自洽（QPS>0、失败率 0 才可作最优）', () => {
    const r = read('docs/generated/request-perf-report.json') as Report
    const t = r.throughput
    expect(t, '缺 throughput 段').toBeTruthy()
    if (t.measured) {
      expect(t.points!.length, '★有读数就至少两档（单档看不出拐点）').toBeGreaterThanOrEqual(2)
      for (const p of t.points!) {
        expect(p.qps, '★QPS 必须为正').toBeGreaterThan(0)
        // ★失败率不为 0 的档不能作为"最优"（高失败率下的快是假绿）
        if (p.failed > 0) expect(String(t.best?.concurrency)).not.toBe(String(p.concurrency))
      }
      expect(t.best, '★必须给出最优档').toBeTruthy()
      expect(t.knee, '★必须给出拐点（QPS 不再随并发上升的那档）').toBeTruthy()
    } else {
      expect(String(t.reason ?? ''), '★未测必须给出原因').not.toBe('')
    }
  })

  it('★★⑧ 报告必须写明"不证明什么"（防止被当"已压测"引用）', () => {
    const r = read('docs/generated/request-perf-report.json') as Report
    expect(r.notProven.length, '★notProven 不能为空').toBeGreaterThan(0)
    const joined = r.notProven.join(' ')
    // 这几条是最容易被误读的，必须在名单里
    expect(joined).toMatch(/端到端 QPS|JS 层/)
    expect(joined).toMatch(/并发吞吐/)
    expect(r.deviceCaveats.length, '★真机数字的证据性质必须写在数据旁边').toBeGreaterThan(0)
  })
})
