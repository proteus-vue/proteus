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
} from '@proteus-vue/fluid'
import { PSplit, PZone } from '@proteus-vue/components'

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

describe('Fluid System 组件（S1：p-split / p-zone）', () => {
  function mount(comp: unknown, props: Record<string, unknown>, slots?: Record<string, unknown>): HTMLElement {
    const el = document.createElement('div')
    const app = createApp({ render: () => h(comp as never, props as never, slots as never) })
    app.mount(el)
    return el
  }

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
