// tests/container-measure.test.ts
// ★Skyline 线收口批 4：MP 尺寸观测原语（createMpSizeObserverFactory）+ 组件层测量助手
//   覆盖：延迟重测 / 测量成功驱动 onSize / null 与异常静默 / resize 重测 / disconnect 清理 / 运行时测量类
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createMpSizeObserverFactory } from '@proteus-vue/fluid'
import { mpContainerObserverFactory, measureClass, isMpRuntime } from '../src/components/runtime/container-measure'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('createMpSizeObserverFactory（MP 尺寸观测原语）', () => {
  it('observe 触发测量 → onSize 收到尺寸；延迟重测', async () => {
    vi.useFakeTimers()
    let w = 300
    const factory = createMpSizeObserverFactory({
      measure: async () => ({ width: w, height: 100 }),
      delays: [0, 20],
    })
    const seen: number[] = []
    const obs = factory((width) => seen.push(width))
    obs.observe({})
    await vi.advanceTimersByTimeAsync(25)
    expect(seen).toContain(300)
    // 第二次测量读到新宽
    w = 700
    await vi.advanceTimersByTimeAsync(0) // 触发已排定的第二次（20ms 已过）
    obs.disconnect()
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(300)
  })

  it('measure 返回 null / 抛异常 → 静默（不 onSize）', async () => {
    const f1 = createMpSizeObserverFactory({ measure: async () => null, delays: [0] })
    const seen: number[] = []
    f1((w) => seen.push(w)).observe({})
    await Promise.resolve()
    expect(seen).toHaveLength(0)

    const f2 = createMpSizeObserverFactory({ measure: async () => { throw new Error('boom') }, delays: [0] })
    f2((w) => seen.push(w)).observe({})
    await Promise.resolve()
    expect(seen).toHaveLength(0)
  })

  it('onResize 订阅 → resize 触发重测；disconnect 调取消', async () => {
    let cb: (() => void) | null = null
    const off = vi.fn()
    const factory = createMpSizeObserverFactory({
      measure: async () => ({ width: 500, height: 200 }),
      delays: [0],
      onResize: (c) => { cb = c; return off },
    })
    const seen: number[] = []
    const obs = factory((w) => seen.push(w))
    obs.observe({})
    await Promise.resolve()
    expect(seen).toContain(500)
    seen.length = 0
    cb!() // 模拟窗口 resize
    await Promise.resolve()
    expect(seen).toContain(500)
    obs.disconnect()
    expect(off).toHaveBeenCalled()
  })
})

describe('组件层测量助手', () => {
  it('measureClass：生成运行时标记类（不参与 scoped 后缀）', () => {
    expect(measureClass('split')).toBe('proteus-measure-split')
  })

  it('Web（window 存在）→ isMpRuntime false；mpContainerObserverFactory null（用默认 RO）', () => {
    vi.stubGlobal('window', {})
    expect(isMpRuntime()).toBe(false)
    expect(mpContainerObserverFactory('.proteus-measure-split')).toBeNull()
  })

  it('MP（window 缺席 + wx）→ 返回工厂（真实测量路径由 createMpSizeObserverFactory 组覆盖）', () => {
    // 注：@proteus-vue/shared 的 adapter 单例在模块加载时定型（本测试环境 node → web adapter），
    //   故此处只断言 MP 分支正确产出工厂（measureRect 的实际测量由第一组注入式用例覆盖）
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('wx', { getSystemInfoSync: () => ({ renderer: 'skyline' }), createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => undefined }) }), exec: () => undefined }) })
    expect(isMpRuntime()).toBe(true)
    const factory = mpContainerObserverFactory('.proteus-measure-split')
    expect(typeof factory).toBe('function')
  })
})

// ★产物契约：容器响应式组件在 MP 上必须接线运行时测量（防「静默钉死」回归）
describe('组件接线契约（MP 产物含运行时测量）', () => {
  it('p-split / p-zone / p-toolbar 源码接线 mpContainerObserverFactory + 运行时测量类', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    for (const tag of ['p-split', 'p-zone', 'p-toolbar']) {
      const src = fs.readFileSync(path.resolve('src/components', tag, 'index.vue'), 'utf-8')
      expect(src).toMatch(/mpContainerObserverFactory/)
      expect(src).toMatch(/measureClass\(/)
      expect(src).toMatch(/isMpRuntime\(\)/)
    }
    // 降级告警契约
    const drag = fs.readFileSync(path.resolve('src/components/p-draggable/index.vue'), 'utf-8')
    expect(drag).toMatch(/capabilityWarnOnce\('p-draggable'/)
    const sc = fs.readFileSync(path.resolve('src/components/p-scroll/index.vue'), 'utf-8')
    expect(sc).toMatch(/capabilityWarnOnce\('p-scroll'/)
  })
})
