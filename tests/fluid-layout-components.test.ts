// tests/fluid-layout-components.test.ts
// ★G-22 柔性布局 B2/B3（fluid-layout-plan）：p-grid / p-stack / p-fit 组件挂载契约
//   断言编译产物样式（CSS Grid minmax / flex 换行 / fit-content 内在尺寸）
// @vitest-environment happy-dom（组件仅依赖 vue）
import { describe, it, expect } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { PGrid, PStack, PFit } from '@proteus-vue/components'

function mountComponent(comp: unknown, props: Record<string, unknown>): HTMLElement {
  const el = document.createElement('div')
  const app = createApp({ render: () => h(comp as never, props as never) })
  app.mount(el)
  return el
}

describe('★G-22 柔性布局组件（B2/B3）', () => {
  it('p-grid：只声明 min-col-width + gap → CSS Grid 模板（repeat(auto-fill, minmax(160px,1fr)) 列数自动）', async () => {
    const el = mountComponent(PGrid, { minColWidth: 160, gap: 12 })
    await nextTick()
    const grid = el.querySelector('.p-grid') as HTMLElement
    expect(grid.style.display).toBe('grid')
    expect(grid.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(160px, 1fr))')
    expect(grid.style.gap).toBe('12px')
  })

  it('p-grid：缺省参数（minColWidth 160 / gap 12）', async () => {
    const el = mountComponent(PGrid, {})
    await nextTick()
    const grid = el.querySelector('.p-grid') as HTMLElement
    expect(grid.style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(160px, 1fr))')
    expect(grid.style.gap).toBe('12px')
  })

  it('p-stack：direction row + wrap → flex row + wrap + gap（空间不足自动换行）', async () => {
    const el = mountComponent(PStack, { direction: 'row', wrap: true, gap: 8 })
    await nextTick()
    const stack = el.querySelector('.p-stack') as HTMLElement
    expect(stack.style.display).toBe('flex')
    expect(stack.style.flexDirection).toBe('row')
    expect(stack.style.flexWrap).toBe('wrap')
    expect(stack.style.gap).toBe('8px')
    expect(stack.classList.contains('p-stack-row')).toBe(true)
    expect(stack.classList.contains('p-stack-wrap')).toBe(true)
  })

  it('p-stack：缺省纵向（column / nowrap）', async () => {
    const el = mountComponent(PStack, {})
    await nextTick()
    const stack = el.querySelector('.p-stack') as HTMLElement
    expect(stack.style.flexDirection).toBe('column')
    expect(stack.style.flexWrap).toBe('nowrap')
  })

  it('p-fit：内在尺寸（width fit-content + maxWidth = maxRatio%）', async () => {
    const el = mountComponent(PFit, { maxRatio: 0.8 })
    await nextTick()
    const fit = el.querySelector('.p-fit') as HTMLElement
    expect(fit.style.width).toBe('fit-content')
    expect(fit.style.maxWidth).toBe('80%')
  })

  // ★G-32 L3 属性补齐（2026-09-19）：align / snap / loop——swiper 的语义消灭形态
  it('p-stack align：交叉轴对齐（空串 = 不设置，保持 flex 默认）', async () => {
    const el = mountComponent(PStack, { align: 'center' })
    await nextTick()
    expect((el.querySelector('.p-stack') as HTMLElement).style.alignItems).toBe('center')
    const el2 = mountComponent(PStack, {})
    await nextTick()
    expect((el2.querySelector('.p-stack') as HTMLElement).style.alignItems).toBe('')
  })

  it('p-stack snap（Web）：容器转滚动容器 + CSS scroll-snap；子项有 snap-align 规则', async () => {
    const el = mountComponent(PStack, { direction: 'row', snap: 'mandatory' })
    await nextTick()
    const stack = el.querySelector('.p-stack') as HTMLElement
    expect(stack.style.scrollSnapType).toBe('x mandatory')
    expect(stack.style.overflowX).toBe('auto')
    expect(stack.style.overflowY).toBe('hidden')
    expect(stack.classList.contains('p-stack-snap')).toBe(true)
    // 纵向时吸附轴为 y
    const el2 = mountComponent(PStack, { snap: 'proximity' })
    await nextTick()
    expect((el2.querySelector('.p-stack') as HTMLElement).style.scrollSnapType).toBe('y proximity')
  })

  it('p-stack snap：非法/缺省值按 none 处理（不转滚动容器、无 snap class）', async () => {
    for (const snap of ['none', 'bogus', undefined]) {
      const el = mountComponent(PStack, { snap })
      await nextTick()
      const stack = el.querySelector('.p-stack') as HTMLElement
      expect(stack.style.scrollSnapType, `snap=${String(snap)}`).toBe('')
      expect(stack.style.overflowX).toBe('')
      expect(stack.classList.contains('p-stack-snap')).toBe(false)
    }
  })

  it('p-stack：方向/换行类名由 computed 输出（MP 端 :class 数组项会被编译器跳过）', async () => {
    const el = mountComponent(PStack, { direction: 'row', wrap: true })
    await nextTick()
    const stack = el.querySelector('.p-stack') as HTMLElement
    expect(stack.classList.contains('p-stack-row')).toBe(true)
    expect(stack.classList.contains('p-stack-wrap')).toBe(true)
  })

  it('★p-stack scroll 载荷契约：Web 端补全 scrollLeft/scrollTop（原生 DOM Event 不含滚动量）', async () => {
    // 缺陷背景（2026-09-19 真实浏览器实测）：onScroll 原先只转发原生事件 → 父级 `@scroll` 读
    //   `e.scrollLeft` 恒 undefined（演示回显「永远停在首屏」）。现补全为与 MP bindscroll 同形的载荷。
    let received: Record<string, number> | null = null
    const el = document.createElement('div')
    const app = createApp({
      render: () => h(PStack, { snap: 'mandatory', direction: 'row', onScroll: (p: Record<string, number>) => { received = p } }),
    })
    app.mount(el)
    await nextTick()
    const stack = el.querySelector('.p-stack') as HTMLElement
    // happy-dom 中布局尺寸为 0——直接派发事件，验证「载荷形状」而非真实滚动
    stack.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(received).not.toBeNull()
    for (const k of ['scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight']) {
      expect(received, `载荷缺 ${k}`).toHaveProperty(k)
    }
  })

  it('p-fit：maxRatio 越界钳制（>1 → 100%；<0 → 0%）', async () => {
    const el = mountComponent(PFit, { maxRatio: 2 })
    await nextTick()
    expect((el.querySelector('.p-fit') as HTMLElement).style.maxWidth).toBe('100%')
    const el2 = mountComponent(PFit, { maxRatio: -1 })
    await nextTick()
    expect((el2.querySelector('.p-fit') as HTMLElement).style.maxWidth).toBe('0%')
  })
})

// ★MP 产物契约（2026-09-19）：snap/loop 在 MP 端是**可观察降级**，不是静默失效
//   依据 skyline-pitfalls S14「Skyline 的 view 不滚动」→ 吸附无载体（同 p-scroll 告警口径）
describe('p-stack MP 产物契约（snap/loop 降级 + 反黑盒）', () => {
  const srcPath = 'packages/components/p-stack/index.vue'
  async function compile(): Promise<string> {
    const fsMod = await import('node:fs')
    const { compileVueSfc } = await import('@proteus-vue/compiler')
    const source = fsMod.readFileSync(srcPath, 'utf-8')
    return compileVueSfc(source, { filename: 'p-stack', isComponent: true, px2rpx: false, rpxRatio: 2, debug: false }).js
  }

  it('产物含 isMp 守卫（MP 端不输出滚动样式——输出即静默无效属性）', async () => {
    const js = await compile()
    expect(js).toMatch(/!this\.data\.isMp/)
  })

  it('产物含降级告警接线（capabilityWarnOnce——降级须可观察，禁静默）', async () => {
    const js = await compile()
    expect(js).toContain('capabilityWarnOnce')
    expect(js).toMatch(/不滚动/)
  })

  it('产物类名走 computed（:class 数组项含 + 会被编译器跳过并告警）', async () => {
    const js = await compile()
    expect(js).toMatch(/stackClass/)
    expect(js).not.toMatch(/array class|数组项/)
  })

  it('★L3 属性登记一致：catalog props ⊇ 源码 defineProps（align/snap/loop）', async () => {
    const fsMod = await import('node:fs')
    const { PRIMITIVE_CATALOG } = await import('@proteus-vue/component-ir')
    const l3 = PRIMITIVE_CATALOG.find((p: { id: string }) => p.id === 'L3')
    expect(l3?.props).toEqual(expect.arrayContaining(['align', 'snap', 'loop']))
    // 源码真值包含三者（防「catalog 登记了但源码没实现」的反向漂移）
    const source = fsMod.readFileSync(srcPath, 'utf-8')
    for (const p of ['align', 'snap', 'loop']) expect(source, `源码缺 ${p}`).toMatch(new RegExp(`\\b${p}\\s*:\\s*\\{`))
  })
})
