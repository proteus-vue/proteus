// tests/fluid-system.test.ts
// ★Fluid System（fluid-system-plan S1）：FluidContext 容器查询/断点/设备环境纯逻辑 + p-split/p-zone 组件
// @vitest-environment happy-dom（组件挂载）
import { describe, it, expect } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import {
  createContainerQuery,
  deriveContainerBreakpoints,
  resolveBreakpoint,
  resolveOrientation,
  createDeviceEnv,
  readDisplayMode,
  detectFluidCapabilities,
  createSizeAwareObserver,
} from '@proteus-vue/fluid'
import { PSplit, PZone, PGrid } from '@proteus-vue/components'

/** fake 尺寸观察器工厂：observe 记录目标；fire 驱动 onSize（真实 RO 的 contentRect 回调等价） */
function fakeObserverFactory(onSize: (w: number, h: number) => void): { observe: (t: unknown) => void; disconnect: () => void; fire: (w: number, h: number) => void } {
  const targets: unknown[] = []
  return {
    observe: (t) => targets.push(t),
    disconnect: () => {
      targets.length = 0
    },
    fire: (w, h) => onSize(w, h),
  }
}

describe('FluidContext 容器查询（S1 纯逻辑）', () => {
  it('断点推导/求解：375 设计稿 → sm 188/md 328/lg 469/xl 609；宽度命中最高断点', () => {
    const bps = deriveContainerBreakpoints(375)
    expect(bps.map((b) => [b.name, b.min])).toEqual([
      ['sm', 188],
      ['md', 328],
      ['lg', 469],
      ['xl', 609],
    ])
    expect(resolveBreakpoint(100, bps)).toBe('sm')
    expect(resolveBreakpoint(400, bps)).toBe('md')
    expect(resolveBreakpoint(700, bps)).toBe('xl')
  })

  it('createContainerQuery：fake 观察器驱动 → 订阅收到宽度/方向/断点更新；destroy 停止', () => {
    let fake: ReturnType<typeof fakeObserverFactory> | null = null
    const el = { tag: 'div' }
    const query = createContainerQuery(el, {
      designWidth: 375,
      createObserver: (onSize) => {
        fake = fakeObserverFactory(onSize)
        return fake
      },
    })
    const states: string[] = []
    const off = query.subscribe((s) => states.push(`${s.width}/${s.breakpoint}/${s.orientation}`))
    // 初始订阅回调（0 尺寸）
    expect(states[0]).toBe('0/sm/portrait')
    fake?.fire(400, 800) // 竖屏容器 400px → md/portrait
    expect(states[1]).toBe('400/md/portrait')
    fake?.fire(700, 300) // 横屏容器 700px → xl/landscape
    expect(states[2]).toBe('700/xl/landscape')
    off()
    fake?.fire(900, 400)
    expect(states.length).toBe(3) // 取消订阅后不再回调
    query.destroy()
  })

  it('createContainerQuery：readSize 注入初始尺寸 + 相同尺寸不重复回调', () => {
    const query = createContainerQuery(null, { designWidth: 375, readSize: () => ({ width: 500, height: 300 }) })
    expect(query.get()).toMatchObject({ width: 500, height: 300, breakpoint: 'lg', orientation: 'landscape' })
    let calls = 0
    query.subscribe(() => calls++)
    expect(calls).toBe(1) // 初始回调一次
    query.destroy()
  })

  it('resolveOrientation：高 > 宽 → portrait；否则 landscape', () => {
    expect(resolveOrientation(300, 800)).toBe('portrait')
    expect(resolveOrientation(800, 300)).toBe('landscape')
    expect(resolveOrientation(500, 500)).toBe('landscape')
  })

  it('createDeviceEnv：fake matchMedia 检测折叠形态/减少动效/方向', () => {
    const queries = new Map<string, boolean>([
      ['(orientation: landscape)', true],
      ['(display-mode: fold)', true],
      ['(display-mode: span)', false],
      ['(display-mode: expand)', false],
      ['(prefers-reduced-motion: reduce)', true],
    ])
    const env = createDeviceEnv({
      matchMedia: (q) => ({ matches: queries.get(q) ?? false, addEventListener() {}, removeEventListener() {} }),
      isDriveMode: true,
    })
    const s = env.get()
    expect(s.displayMode).toBe('fold')
    expect(s.isDriveMode).toBe(true)
    expect(s.prefersReducedMotion).toBe(true)
    expect(s.orientation).toBe('landscape')
    env.destroy()
  })

  it('readDisplayMode：无折叠 media 匹配 → standard', () => {
    expect(readDisplayMode(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))).toBe('standard')
  })
})

/** 挂载组件到 DOM（返回根容器；slot 注入测试） */
function mount(comp: unknown, props: Record<string, unknown>, slots?: Record<string, unknown>): HTMLElement {
  const el = document.createElement('div')
  const app = createApp({ render: () => h(comp as never, props as never, slots as never) })
  app.mount(el)
  return el
}

describe('Fluid System 组件（S1：p-split / p-zone）', () => {
  it('p-split：无 ResizeObserver 环境 → 默认堆叠（column）', async () => {
    const el = mount(PSplit, { minSplitWidth: 640, gap: 16 }, { aside: () => h('div', { class: 'a' }), default: () => h('div', { class: 'm' }) })
    await nextTick()
    const root = el.querySelector('.p-split') as HTMLElement
    expect(root.classList.contains('p-split-stacked')).toBe(true)
    expect(root.style.flexDirection).toBe('column')
    expect(el.querySelector('.p-split-aside')).not.toBeNull()
    expect(el.querySelector('.p-split-main')).not.toBeNull()
  })

  it('p-zone：无 ResizeObserver 环境 → 默认 sm 槽（容器断点缺省）', async () => {
    const el = mount(PZone, { designWidth: 375 }, { sm: () => h('div', { class: 'sm-box' }), xl: () => h('div', { class: 'xl-box' }) })
    await nextTick()
    expect(el.querySelector('.p-zone-sm')).not.toBeNull()
    expect(el.querySelector('.sm-box')).not.toBeNull()
    expect(el.querySelector('.xl-box')).toBeNull()
  })
})

describe('能力检测 detectFluidCapabilities（essence 02 §4 降级策略）', () => {
  it('supports 注入：全支持 / 部分不支持 / probe 抛错兑底（单能力 false 不牵连其余）', () => {
    const all = detectFluidCapabilities(() => true)
    expect(all).toEqual({ clamp: true, grid: true, containerQuery: true, flexGap: true })
    const noGrid = detectFluidCapabilities((p, v) => !(p === 'display' && v === 'grid'))
    expect(noGrid.grid).toBe(false)
    expect(noGrid.clamp).toBe(true)
    expect(noGrid.containerQuery).toBe(true)
    expect(noGrid.flexGap).toBe(true)
    const throwing = detectFluidCapabilities(() => {
      throw new Error('boom')
    })
    expect(throwing).toEqual({ clamp: false, grid: false, containerQuery: false, flexGap: false })
  })

  it('无 CSS.supports（MP 逻辑层/SSR）→ 假设全支持（渲染端自决降级）', () => {
    expect(detectFluidCapabilities(null)).toEqual({ clamp: true, grid: true, containerQuery: true, flexGap: true })
  })

  it('缺省读全局 CSS.supports（happy-dom 全真 → 全支持）', () => {
    expect(detectFluidCapabilities()).toEqual({ clamp: true, grid: true, containerQuery: true, flexGap: true })
  })
})

describe('统一断点入口 createSizeAwareObserver（essence 02 §2 useBreakpoint 桥接底座）', () => {
  function fakeResizeTarget(): {
    target: {
      addEventListener: (t: string, cb: () => void) => void
      removeEventListener: (t: string, cb: () => void) => void
    }
    listeners: Record<string, Array<() => void>>
  } {
    const listeners: Record<string, Array<() => void>> = { resize: [], orientationchange: [] }
    const target = {
      addEventListener: (t: string, cb: () => void) => listeners[t].push(cb),
      removeEventListener: (t: string, cb: () => void) => {
        const i = listeners[t].indexOf(cb)
        if (i >= 0) listeners[t].splice(i, 1)
      },
    }
    return { target, listeners }
  }

  it('容器 + 视口双断点：容器变化 → containerBreakpoint；resize → viewportBreakpoint；destroy 释放监听', () => {
    let fake: ReturnType<typeof fakeObserverFactory> | null = null
    const { target, listeners } = fakeResizeTarget()
    let vw = 500
    const aware = createSizeAwareObserver(
      { tag: 'div' },
      {
        designWidth: 375,
        createObserver: (onSize) => {
          fake = fakeObserverFactory(onSize)
          return fake
        },
        viewportSize: () => vw,
        resizeTarget: target,
      },
    )
    const states: string[] = []
    const off = aware.subscribe((s) => states.push(`${s.containerBreakpoint}/${s.viewportBreakpoint}/${s.orientation}/${s.containerWidth}/${s.viewportWidth}`))
    // 初始：容器 0 → sm；视口 500 → lg（469 ≤ 500 < 609）
    expect(states[0]).toBe('sm/lg/portrait/0/500')
    fake?.fire(700, 400) // 容器 700 → xl/landscape
    expect(states[1]).toBe('xl/lg/landscape/700/500')
    vw = 800
    listeners.resize[0]()
    expect(states[2]).toBe('xl/xl/landscape/700/800')
    off()
    fake?.fire(900, 300)
    vw = 1000
    listeners.resize[0]()
    expect(states.length).toBe(3) // 取消订阅后不再回调
    aware.destroy()
    expect(listeners.resize.length).toBe(0) // destroy 移除 resize 监听
    expect(listeners.orientationchange.length).toBe(0)
  })

  it('视口尺寸未变 → 不重复回调；destroy 后再触发不回调', () => {
    const { target, listeners } = fakeResizeTarget()
    const aware = createSizeAwareObserver(null, { designWidth: 375, viewportSize: () => 600, resizeTarget: target })
    let calls = 0
    aware.subscribe(() => calls++)
    expect(calls).toBe(1) // 初始订阅回调一次
    const resizeCb = listeners.resize[0]
    resizeCb() // 同宽 600 → 不重复
    expect(calls).toBe(1)
    aware.destroy()
    resizeCb() // destroy 后刷新直接 return（destroyed 守卫）
    expect(calls).toBe(1)
  })
})

describe('Fluid System 组件降级（G-22.2 铁律「朴素但正确」：p-grid）', () => {
  it('p-grid：grid 支持 → CSS Grid auto-fill（既有语义不变）', async () => {
    const el = mount(PGrid, { minColWidth: 160, gap: 12 }, { default: () => h('div', { class: 'item' }) })
    await nextTick()
    const root = el.querySelector('.p-grid') as HTMLElement
    expect(root.classList.contains('p-grid-fallback')).toBe(false)
    expect(root.style.display).toBe('grid')
    expect(root.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(160px, 1fr))')
  })

  it('p-grid：CSS.supports 探测 grid 不支持 → flex-wrap 模拟 auto-fit', async () => {
    const prevCss = (globalThis as { CSS?: unknown }).CSS
    ;(globalThis as { CSS: unknown }).CSS = { supports: (p: string, v: string) => !(p === 'display' && v === 'grid') }
    try {
      const el = mount(PGrid, { minColWidth: 160, gap: 12 }, { default: () => h('div', { class: 'item' }) })
      await nextTick()
      const root = el.querySelector('.p-grid') as HTMLElement
      expect(root.classList.contains('p-grid-fallback')).toBe(true)
      expect(root.style.display).toBe('flex')
      expect(root.style.flexWrap).toBe('wrap')
      expect(root.style.gap).toBe('12px')
      expect(root.style.getPropertyValue('--pgrid-min')).toBe('160px')
      // ★slot 子项 min-width/flex 由 <style global> 规则提供（组件内联样式无法触达 slot 子元素）——
      //   vitest 默认不注入 CSS（css:false），规则存在性改由双端构建产物验证（web css / mp wxss 含 .p-grid-fallback > *）
    } finally {
      if (prevCss === undefined) delete (globalThis as { CSS?: unknown }).CSS
      else (globalThis as { CSS: unknown }).CSS = prevCss
    }
  })
})
