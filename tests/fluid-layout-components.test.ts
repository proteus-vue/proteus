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

  it('p-fit：maxRatio 越界钳制（>1 → 100%；<0 → 0%）', async () => {
    const el = mountComponent(PFit, { maxRatio: 2 })
    await nextTick()
    expect((el.querySelector('.p-fit') as HTMLElement).style.maxWidth).toBe('100%')
    const el2 = mountComponent(PFit, { maxRatio: -1 })
    await nextTick()
    expect((el2.querySelector('.p-fit') as HTMLElement).style.maxWidth).toBe('0%')
  })
})
