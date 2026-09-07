// tests/flamegraph.test.ts —— @proteus-vue/devtools-runtime 性能火焰图（devtools-plan M6/B6）
// start/end → 父子树 + inclusive/exclusive；同层 start 排序；startMs 相对基线；
// icicle 倒置；compare ±10% regression/improvement；录制 start/stop 门控
import { describe, it, expect } from 'vitest'
import { createFlamegraphCollector } from '@proteus-vue/devtools-runtime'
import type { TraceEvent, TraceSource } from '@proteus-vue/devtools-runtime'

function ev(source: TraceSource, phase: 'start' | 'end', name: string, timestamp: number): TraceEvent {
  return { source, phase, name, timestamp }
}

/** 构造已知耗时树：boot(100ms) 含 capability.detect(30) + store.hydrate(40) */
function recordStartup(c: ReturnType<typeof createFlamegraphCollector>): void {
  c.start()
  c.ingest(ev('lifecycle', 'start', 'boot', 1000))
  c.ingest(ev('capability', 'start', 'detect', 1010))
  c.ingest(ev('capability', 'end', 'detect', 1040)) // 30ms
  c.ingest(ev('store', 'start', 'hydrate', 1020))
  c.ingest(ev('store', 'end', 'hydrate', 1060)) // 40ms
  c.ingest(ev('lifecycle', 'end', 'boot', 1100)) // 100ms
  c.stop()
}

describe('火焰图：树结构 + inclusive/exclusive', () => {
  it('start/end → 嵌套父子树 + duration（inclusive）+ self（exclusive）', () => {
    const c = createFlamegraphCollector()
    recordStartup(c)
    const roots = c.roots()
    expect(roots.length).toBe(1)
    const boot = roots[0]
    expect(boot).toMatchObject({ source: 'lifecycle', name: 'boot', durationMs: 100, depth: 0 })
    expect(boot.selfMs).toBe(30) // 100 - 30(detect) - 40(hydrate)
    expect(boot.children.length).toBe(2)
    const detect = boot.children.find((n) => n.name === 'detect')
    const hydrate = boot.children.find((n) => n.name === 'hydrate')
    expect(detect).toMatchObject({ durationMs: 30, selfMs: 30, depth: 1 })
    expect(hydrate).toMatchObject({ durationMs: 40, selfMs: 40, depth: 1 })
  })

  it('startMs 相对录制起点（基线归零）', () => {
    const c = createFlamegraphCollector({ now: () => 5000 })
    c.start()
    c.ingest(ev('lifecycle', 'start', 'boot', 6000))
    c.ingest(ev('lifecycle', 'end', 'boot', 6200))
    c.stop()
    const boot = c.roots()[0]
    expect(boot.startMs).toBe(1000) // 6000 - 5000
  })

  it('同层按 start 排序（detect 1010 < hydrate 1020）', () => {
    const c = createFlamegraphCollector()
    recordStartup(c)
    const children = c.roots()[0].children
    expect(children[0].name).toBe('detect')
    expect(children[1].name).toBe('hydrate')
  })

  it('point/error 事件不进火焰图；stop 后 ingest 忽略；未结束 span 丢弃', () => {
    const c = createFlamegraphCollector()
    c.start()
    c.ingest(ev('lifecycle', 'point', 'mounted', 100))
    c.ingest(ev('api', 'start', 'req', 200)) // 未结束
    c.stop()
    expect(c.roots().length).toBe(0)
    c.ingest(ev('lifecycle', 'start', 'late', 300))
    expect(c.roots().length).toBe(0) // stop 后忽略
  })
})

describe('火焰图：icicle 与 compare', () => {
  it('icicle 按 depth 降序（深→浅）', () => {
    const c = createFlamegraphCollector()
    recordStartup(c)
    const icicle = c.icicle()
    expect(icicle[0].depth).toBe(1) // children 在前
    expect(icicle[icicle.length - 1].depth).toBe(0) // root 最后
  })

  it('compare：±10% 阈值识别 regression / improvement / same（exclusive 聚合）', () => {
    const c = createFlamegraphCollector()
    recordStartup(c)
    const previous = c.roots()

    // 本次录制：boot 变慢（detect 30→40ms，+33%），hydrate 变快（40→36ms，-10%）
    c.start()
    c.ingest(ev('lifecycle', 'start', 'boot', 1000))
    c.ingest(ev('capability', 'start', 'detect', 1010))
    c.ingest(ev('capability', 'end', 'detect', 1050)) // 40ms（+33.3%）
    c.ingest(ev('store', 'start', 'hydrate', 1020))
    c.ingest(ev('store', 'end', 'hydrate', 1056)) // 36ms（-10%）
    c.ingest(ev('lifecycle', 'end', 'boot', 1100))
    c.stop()

    const compare = c.compare(previous)
    const detect = compare.find((e) => e.name === 'detect')
    const hydrate = compare.find((e) => e.name === 'hydrate')
    expect(detect?.verdict).toBe('regression')
    expect(detect?.deltaPct).toBeGreaterThan(30)
    expect(hydrate?.verdict).toBe('improvement') // -10% 恰好边界 → improvement
    expect(hydrate?.deltaPct).toBeLessThanOrEqual(-10)
    // boot exclusive 也变：self 30 → 24（-20%——children 耗时变化传导）
    expect(compare.find((e) => e.name === 'boot')?.verdict).toBe('improvement')
  })

  it('compare：新增/消失节点（aMs 0 → 100% / bMs 0）', () => {
    const c = createFlamegraphCollector()
    c.start()
    c.ingest(ev('lifecycle', 'start', 'boot', 1000))
    c.ingest(ev('lifecycle', 'end', 'boot', 1100))
    c.stop()
    const previous = c.roots()
    // 本次无 boot，但有新节点 init
    c.start()
    c.ingest(ev('api', 'start', 'init', 1000))
    c.ingest(ev('api', 'end', 'init', 1050))
    c.stop()
    const compare = c.compare(previous)
    const boot = compare.find((e) => e.name === 'boot')
    expect(boot?.verdict).toBe('improvement') // bMs 0 → -100%
    expect(boot?.deltaPct).toBe(-100)
  })

  it('nodes() 全量收集 + 缓冲上限裁剪', () => {
    const c = createFlamegraphCollector({ bufferSize: 1 })
    c.start()
    c.ingest(ev('lifecycle', 'start', 'a', 1000))
    c.ingest(ev('lifecycle', 'end', 'a', 1010))
    c.ingest(ev('lifecycle', 'start', 'b', 1020))
    c.ingest(ev('lifecycle', 'end', 'b', 1030))
    c.stop()
    expect(c.roots().length).toBe(1) // 最旧被裁剪
    expect(c.roots()[0].name).toBe('b')
    expect(c.nodes().length).toBe(1)
  })

  it('recording 状态门控', () => {
    const c = createFlamegraphCollector()
    expect(c.recording).toBe(false)
    c.start()
    expect(c.recording).toBe(true)
    c.stop()
    expect(c.recording).toBe(false)
  })
})
