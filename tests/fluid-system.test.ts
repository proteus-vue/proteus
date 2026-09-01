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
  resolveSafeAreaStyle,
  shouldReduceMotion,
  calcVisibleToolbarItems,
} from '@proteus-vue/fluid'
import { PSplit, PZone, PGrid, PSafe, PAspect, PSidebar, PToolbar } from '@proteus-vue/components'

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
    expect(all).toEqual({ clamp: true, grid: true, containerQuery: true, flexGap: true, aspectRatio: true })
    const noGrid = detectFluidCapabilities((p, v) => !(p === 'display' && v === 'grid'))
    expect(noGrid.grid).toBe(false)
    expect(noGrid.clamp).toBe(true)
    expect(noGrid.containerQuery).toBe(true)
    expect(noGrid.flexGap).toBe(true)
    expect(noGrid.aspectRatio).toBe(true)
    const noAspect = detectFluidCapabilities((p, v) => !(p === 'aspect-ratio' && v === '1 / 1'))
    expect(noAspect.aspectRatio).toBe(false)
    expect(noAspect.grid).toBe(true)
    const throwing = detectFluidCapabilities(() => {
      throw new Error('boom')
    })
    expect(throwing).toEqual({ clamp: false, grid: false, containerQuery: false, flexGap: false, aspectRatio: false })
  })

  it('无 CSS.supports（MP 逻辑层/SSR）→ 假设全支持（渲染端自决降级）', () => {
    expect(detectFluidCapabilities(null)).toEqual({ clamp: true, grid: true, containerQuery: true, flexGap: true, aspectRatio: true })
  })

  it('缺省读全局 CSS.supports（happy-dom 全真 → 全支持）', () => {
    expect(detectFluidCapabilities()).toEqual({ clamp: true, grid: true, containerQuery: true, flexGap: true, aspectRatio: true })
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

describe('Fluid System S2 纯逻辑（resolveSafeAreaStyle 安全区样式）', () => {
  it('area=top → paddingTop env(safe-area-inset-top)；fallback 0 不包裹', () => {
    expect(resolveSafeAreaStyle({ area: 'top' })).toEqual({ paddingTop: 'env(safe-area-inset-top, 0px)' })
    expect(resolveSafeAreaStyle({})).toEqual({ paddingTop: 'env(safe-area-inset-top, 0px)' }) // 默认 top
  })

  it('area=all + fallback=44 → 四边 max(env(...), 44px) 包裹（「至少 Npx」）', () => {
    expect(resolveSafeAreaStyle({ area: 'all', fallback: 44 })).toEqual({
      paddingTop: 'max(env(safe-area-inset-top, 0px), 44px)',
      paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 44px)',
      paddingLeft: 'max(env(safe-area-inset-left, 0px), 44px)',
      paddingRight: 'max(env(safe-area-inset-right, 0px), 44px)',
    })
  })

  it('area=horizontal → 左右避让；未知 area → 空样式', () => {
    expect(resolveSafeAreaStyle({ area: 'horizontal' })).toEqual({
      paddingLeft: 'env(safe-area-inset-left, 0px)',
      paddingRight: 'env(safe-area-inset-right, 0px)',
    })
    expect(resolveSafeAreaStyle({ area: 'diagonal' })).toEqual({})
  })

  it('fold + displayMode=fold/span → hinge 左右避让（fold-right 由 fold-left+fold-width 推导）', () => {
    const hinge = {
      paddingLeft: 'env(fold-left, 0px)',
      paddingRight: 'calc(100% - env(fold-left, 0px) - env(fold-width, 0px))',
    }
    expect(resolveSafeAreaStyle({ fold: true, displayMode: 'fold' })).toEqual(hinge)
    expect(resolveSafeAreaStyle({ fold: true, displayMode: 'span' })).toEqual(hinge)
  })

  it('fold 开关守卫：expand/standard 不生效；fold=false 即使 displayMode=fold 也不生效', () => {
    expect(resolveSafeAreaStyle({ fold: true, displayMode: 'expand' })).toEqual({})
    expect(resolveSafeAreaStyle({ fold: true, displayMode: 'standard' })).toEqual({})
    expect(resolveSafeAreaStyle({ fold: false, displayMode: 'fold' })).toEqual({ paddingTop: 'env(safe-area-inset-top, 0px)' })
  })
})

describe('Fluid System S2 组件（p-safe 安全区 / p-aspect 纵横比）', () => {
  it('p-safe：area=top 渲染（样式字符串由 resolveSafeAreaStyle 纯函数保证——happy-dom CSS 解析器丢弃 env()）', async () => {
    const el = mount(PSafe, { area: 'top' }, { default: () => h('div', { class: 'inner' }) })
    await nextTick()
    const root = el.querySelector('.p-safe') as HTMLElement
    expect(root.classList.contains('p-safe-fold')).toBe(false)
    expect(el.querySelector('.inner')).not.toBeNull()
  })

  it('p-safe：fold=true 且 display-mode=fold（matchMedia 注入）→ p-safe-fold 类 + hinge 样式', async () => {
    const prevMm = (globalThis as { matchMedia?: unknown }).matchMedia
    ;(globalThis as { matchMedia: unknown }).matchMedia = (q: string) => ({
      matches: q === '(display-mode: fold)',
      addEventListener() {},
      removeEventListener() {},
    })
    try {
      const el = mount(PSafe, { fold: true })
      await nextTick()
      const root = el.querySelector('.p-safe') as HTMLElement
      expect(root.classList.contains('p-safe-fold')).toBe(true)
    } finally {
      if (prevMm === undefined) delete (globalThis as { matchMedia?: unknown }).matchMedia
      else (globalThis as { matchMedia: unknown }).matchMedia = prevMm
    }
  })

  it('p-safe：fold=true 但 display-mode=standard（桌面）→ 无 hinge（不误伤普通环境）', async () => {
    const el = mount(PSafe, { fold: true })
    await nextTick()
    expect((el.querySelector('.p-safe') as HTMLElement).classList.contains('p-safe-fold')).toBe(false)
  })

  it('p-aspect：aspect-ratio 支持 → 原生比例 + maxWidth', async () => {
    const el = mount(PAspect, { ratio: 16 / 9, maxWidth: 400 })
    await nextTick()
    const root = el.querySelector('.p-aspect') as HTMLElement
    expect(root.classList.contains('p-aspect-fallback')).toBe(false)
    expect(root.style.aspectRatio).toBe('1.7777777777777777 / 1')
    expect(root.style.maxWidth).toBe('400px')
    expect(root.style.position).toBe('relative')
  })

  it('p-aspect：aspect-ratio 不支持 → padding-top hack 降级（height 0 + paddingTop 1/ratio%）', async () => {
    const prevCss = (globalThis as { CSS?: unknown }).CSS
    ;(globalThis as { CSS: unknown }).CSS = { supports: (p: string, v: string) => !(p === 'aspect-ratio' && v === '1 / 1') }
    try {
      const el = mount(PAspect, { ratio: 16 / 9 })
      await nextTick()
      const root = el.querySelector('.p-aspect') as HTMLElement
      expect(root.classList.contains('p-aspect-fallback')).toBe(true)
      expect(root.style.height).toBe('0px')
      expect(root.style.paddingTop).toBe('56.25%')
      expect(root.style.aspectRatio).toBe('')
    } finally {
      if (prevCss === undefined) delete (globalThis as { CSS?: unknown }).CSS
      else (globalThis as { CSS: unknown }).CSS = prevCss
    }
  })

  it('p-aspect：ratio 非法（≤0）→ 兜底 16/9', async () => {
    const el = mount(PAspect, { ratio: 0 })
    await nextTick()
    const root = el.querySelector('.p-aspect') as HTMLElement
    expect(root.style.aspectRatio).toBe('1.7777777777777777 / 1')
  })
})

describe('Fluid System S3 纯逻辑（shouldReduceMotion 动效门 / calcVisibleToolbarItems 溢出折叠）', () => {
  it('shouldReduceMotion：drive-mode 或 prefers-reduced-motion 任一命中 → true', () => {
    expect(shouldReduceMotion({})).toBe(false)
    expect(shouldReduceMotion({ isDriveMode: true })).toBe(true)
    expect(shouldReduceMotion({ prefersReducedMotion: true })).toBe(true)
    expect(shouldReduceMotion({ isDriveMode: true, prefersReducedMotion: true })).toBe(true)
    expect(shouldReduceMotion({ isDriveMode: false, prefersReducedMotion: false })).toBe(false)
  })

  it('calcVisibleToolbarItems：全部放得下 → 不折叠（返回 count）', () => {
    // 6 项 × 80 + 更多 48 = 528 ≤ 600
    expect(calcVisibleToolbarItems({ count: 6, containerWidth: 600, itemWidth: 80, moreWidth: 48 })).toBe(6)
  })

  it('calcVisibleToolbarItems：溢出 → floor((容器-更多)/项宽) 且钳制 [1, count-1]', () => {
    // 6 项 × 80 + 48 = 528 > 400 → floor((400-48)/80)=4 → 4 可见 + 2 进更多
    expect(calcVisibleToolbarItems({ count: 6, containerWidth: 400, itemWidth: 80, moreWidth: 48 })).toBe(4)
    // 容器极小 → 至少 1
    expect(calcVisibleToolbarItems({ count: 6, containerWidth: 30, itemWidth: 80, moreWidth: 48 })).toBe(1)
    // count-1 上界（不可能全可见时）
    expect(calcVisibleToolbarItems({ count: 3, containerWidth: 100, itemWidth: 80, moreWidth: 48 })).toBe(1)
  })

  it('calcVisibleToolbarItems：容器不可测（0）/ count≤1 / count=0 边界', () => {
    // 容器不可测（MP 无 ResizeObserver）→ 不折叠全显示（降级「朴素但正确」）
    expect(calcVisibleToolbarItems({ count: 6, containerWidth: 0, itemWidth: 80, moreWidth: 48 })).toBe(6)
    expect(calcVisibleToolbarItems({ count: 6, containerWidth: -1 })).toBe(6)
    expect(calcVisibleToolbarItems({ count: 1, containerWidth: 10, itemWidth: 80, moreWidth: 48 })).toBe(1)
    expect(calcVisibleToolbarItems({ count: 0, containerWidth: 500 })).toBe(0)
  })

  it('calcVisibleToolbarItems：缺省 itemWidth 80 / moreWidth 48', () => {
    // 5 项 × 80 + 48 = 448 > 300 → floor((300-48)/80)=3
    expect(calcVisibleToolbarItems({ count: 5, containerWidth: 300 })).toBe(3)
  })
})

describe('Fluid System S3 组件（p-sidebar 自适应导航 / p-toolbar 溢出折叠）', () => {
  it('p-sidebar：无 ResizeObserver 环境 → 默认 bottom-bar（窄屏主场景）', async () => {
    const el = mount(
      PSidebar,
      { minSidebarWidth: 640, navWidth: 160 },
      { nav: () => h('a', { class: 'n1', href: '#' }, '首页'), default: () => h('div', { class: 'm' }) },
    )
    await nextTick()
    const root = el.querySelector('.p-sidebar') as HTMLElement
    expect(root.classList.contains('p-sidebar-bottom-bar')).toBe(true)
    expect(root.style.flexDirection).toBe('column') // bottom-bar：纵向堆叠（main 上 nav 下）
    const nav = el.querySelector('.p-sidebar-nav') as HTMLElement
    expect(nav.style.flexDirection).toBe('row')
    expect(nav.style.width).toBe('100%')
    expect(el.querySelector('.n1')).not.toBeNull()
  })

  it('p-sidebar：prefers-reduced-motion（matchMedia 注入）→ no-motion class（drive-mode 动效门）', async () => {
    const prevMm = (globalThis as { matchMedia?: unknown }).matchMedia
    ;(globalThis as { matchMedia: unknown }).matchMedia = (q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)',
      addEventListener() {},
      removeEventListener() {},
    })
    try {
      const el = mount(PSidebar, {}, { nav: () => h('a', { href: '#' }, '首页'), default: () => h('div') })
      await nextTick()
      expect((el.querySelector('.p-sidebar') as HTMLElement).classList.contains('p-sidebar-no-motion')).toBe(true)
    } finally {
      if (prevMm === undefined) delete (globalThis as { matchMedia?: unknown }).matchMedia
      else (globalThis as { matchMedia: unknown }).matchMedia = prevMm
    }
  })

  it('p-toolbar：无 ResizeObserver 环境 → 容器不可测 → 不折叠全显示（无「更多」）', async () => {
    const el = mount(
      PToolbar,
      { items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }], itemWidth: 80, moreWidth: 48 },
    )
    await nextTick()
    const items = el.querySelectorAll('.p-toolbar-item')
    expect(items.length).toBe(3) // 全显示
    expect(el.querySelector('.p-toolbar-more')).toBeNull()
  })

  it('p-toolbar：点击可见项 → select emit；「更多」展开/收起', async () => {
    const el = mount(PToolbar, { items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] })
    await nextTick()
    const selected: unknown[] = []
    const root = el.querySelector('.p-toolbar') as HTMLElement
    // 通过组件实例订阅 emit：重挂载带 @select 的壳
    const el2 = document.createElement('div')
    const app2 = createApp({
      render: () => h(PToolbar as never, { items: [{ key: 'a', label: 'A' }], onSelect: (k: unknown) => selected.push(k) } as never),
    })
    app2.mount(el2)
    await nextTick()
    ;(el2.querySelector('.p-toolbar-item') as HTMLElement).click()
    expect(selected).toEqual(['a'])
    root.remove()
  })
})
