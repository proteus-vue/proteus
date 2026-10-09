// tests/runtime-profiler.test.ts —— ★★运行期阶段耗时自采样（CPU Profiler · 决策 #715）判据
//
// 【锁什么】`createRuntimeProfiler`（packages/render-backend/src/runtime-profiler.ts）——
//   ① 累加正确（count/totalMs/maxMs，同 label 归并）；② `drain()` 排空 + 按累计降序；
//   ③ `time()` 在 `fn` 抛错时**仍记账**（finally）且异常照常上抛；④ 未启用 ⇒ 空实现零开销。
//
// 【为什么单列】它是 CPU Profiler 的数据底座——若累加/drain 有 bug，面板上的排行就是错的
//   （而"错排行"比"没排行"更危险：会指错优化方向）。
import { describe, it, expect } from 'vitest'
import { createRuntimeProfiler, NULL_PROFILER } from '@proteus-vue/render-backend'

/** 忙等 n 毫秒（确定性耗时——不依赖 sleep/定时器） */
function busy(ms: number): number {
  const t0 = Date.now()
  let x = 0
  while (Date.now() - t0 < ms) x++
  return x
}

describe('★运行期阶段耗时自采样（决策 #715）', () => {
  it('① 累加：同 label 归并（count/totalMs/maxMs），返回值透传', () => {
    const p = createRuntimeProfiler()
    const r1 = p.time('instantiate', () => { busy(5); return 42 })
    const r2 = p.time('instantiate', () => { busy(1); return 7 })
    expect(r1).toBe(42)
    expect(r2).toBe(7)
    const [e] = p.drain()
    expect(e!.label).toBe('instantiate')
    expect(e!.count).toBe(2)
    expect(e!.totalMs).toBeGreaterThan(0)
    expect(e!.maxMs).toBeGreaterThanOrEqual(1)   // 5ms 那次应成为 max
  })

  it('② drain 排空 + 按累计耗时降序', () => {
    const p = createRuntimeProfiler()
    p.time('flush', () => busy(2))
    p.time('dispatch', () => busy(8))
    p.time('relink', () => busy(1))
    const out = p.drain()
    expect(out.map((e) => e.label)).toEqual(['dispatch', 'flush', 'relink'])
    // 排空式：再取为空
    expect(p.drain()).toHaveLength(0)
  })

  it('③ 抛错也记账（finally）且异常照常上抛', () => {
    const p = createRuntimeProfiler()
    expect(() => p.time('handler「h0」', () => { busy(1); throw new Error('boom') })).toThrow('boom')
    const out = p.drain()
    expect(out).toHaveLength(1)
    expect(out[0]!.label).toBe('handler「h0」')
    expect(out[0]!.count).toBe(1)
  })

  it('④ loc 归因：同 label 只记首见源位置（模板行）', () => {
    const p = createRuntimeProfiler()
    p.time('handler「h0」', () => busy(1), { line: 5, column: 9 })
    p.time('handler「h0」', () => busy(1), { line: 99, column: 1 })
    const [e] = p.drain()
    expect(e!.loc).toEqual({ line: 5, column: 9 })
  })

  it('⑤ NULL_PROFILER：time 直接透传、drain 恒空（未启用零开销）', () => {
    expect(NULL_PROFILER.time('x', () => 123)).toBe(123)
    expect(NULL_PROFILER.drain()).toEqual([])
  })
})
