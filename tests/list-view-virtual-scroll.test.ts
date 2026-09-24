// tests/list-view-virtual-scroll.test.ts
// @vitest-environment jsdom
// ★2026-09-24 实测缺陷的回归锁：p-list-view 虚拟模式**缺底部占位块** → 滚动范围被截断。
//
// 背景：模板原本只有**顶部**占位（`height: start * itemHeight`），未渲染行数的高度
//   从未进入布局 ⇒ 内容区总高 = 顶部占位 + 已渲染行数。
//   实测（500 行 × 44px，视口 220px）：scrollHeight 仅 **315px**（= 7 行高），
//   而正确值应为 22000px ⇒ **用户永远滚不到列表后半段**（只能「棘轮式」往下蹭），
//   且「只渲染可视窗口」这一主张无法被验证（因为根本滚不动）。
//
// 修法：补底部占位 `(total - start - count) * itemHeight`，使内容总高恒等于 total × itemHeight。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'
import PListView from '../packages/components/p-list-view/index.vue'
import { getVirtualWindow } from '../packages/components/runtime/virtual-window'

describe('★p-list-view 虚拟化：滚动范围必须覆盖全部数据（上下双占位）', () => {
  let app: ReturnType<typeof createApp> | null = null
  let host: HTMLElement | null = null
  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    document.body.appendChild(host)
  })
  afterEach(() => {
    app?.unmount()
    document.body.innerHTML = ''
    app = null
    host = null
  })

  const mountList = async (props: Record<string, unknown>) => {
    app = createApp({ setup: () => () => h(PListView, props as never) })
    app.mount(host!)
    // ★等一拍：渲染窗口在 onMounted 的 calc() 里算（同步挂载后需 flush 才能读到正确行数）
    await new Promise((r) => setTimeout(r, 0))
    const el = host!.querySelector('.p-list-view') as HTMLElement
    const spacers = [...host!.querySelectorAll('.plv-ph')] as HTMLElement[]
    const rows = [...host!.querySelectorAll('.plv-row')] as HTMLElement[]
    /** 各占位块高度（px，取内联样式） */
    const spacerHeights = spacers.map((s) => parseInt(s.style.height || '0', 10))
    return { el, spacers, rows, spacerHeights }
  }

  const ITEM_H = 44
  const VIEW_H = 220

  it('★500 行：上下双占位高度之和 + 渲染行 = 总高（此前只有顶部占位 → 总高被截断）', async () => {
    const { rows, spacers, spacerHeights } = await mountList({
      items: Array.from({ length: 500 }, (_, i) => ({ title: 'r' + i })),
      itemHeight: ITEM_H,
      height: VIEW_H,
      bufferSize: 2,
    })
    expect(spacers.length, '虚拟模式应有**两个**占位块（顶 + 底）').toBe(2)
    const renderedH = rows.length * ITEM_H
    const totalH = spacerHeights.reduce((a, b) => a + b, 0) + renderedH
    expect(totalH, `内容总高应为 500×44=${500 * ITEM_H}px（实际 ${totalH}）`).toBe(500 * ITEM_H)
  })

  it('★只渲染可视窗口（行数远小于总数，与数据量无关）', async () => {
    const { rows } = await mountList({
      items: Array.from({ length: 500 }, (_, i) => ({ title: 'r' + i })),
      itemHeight: ITEM_H,
      height: VIEW_H,
      bufferSize: 2,
    })
    const w = getVirtualWindow(0, ITEM_H, VIEW_H, 2, 500)
    expect(rows.length, '渲染行数应等于可视窗口行数').toBe(w.count)
    expect(rows.length, '不应把 500 行全渲染').toBeLessThan(20)
  })

  it('virtual=false（全量模式）：渲染全部行且**无占位块**（不引入多余高度）', async () => {
    const { rows, spacers } = await mountList({
      items: Array.from({ length: 30 }, (_, i) => ({ title: 'r' + i })),
      itemHeight: ITEM_H,
      height: VIEW_H,
      virtual: false,
    })
    expect(rows.length, '全量模式应渲染全部 30 行').toBe(30)
    expect(spacers.length, '全量模式不应有占位块').toBe(0)
  })

  it('边界：数据比视口还少 → 底部占位为 0（不撑出多余滚动区）', async () => {
    const { rows, spacerHeights } = await mountList({
      items: Array.from({ length: 3 }, (_, i) => ({ title: 'r' + i })),
      itemHeight: ITEM_H,
      height: VIEW_H,
      bufferSize: 2,
    })
    expect(rows.length).toBe(3)
    // 顶部 0（start=0）+ 底部 0（3 行全渲染）→ 总高恰为 3 行高
    expect(spacerHeights.reduce((a, b) => a + b, 0), '无剩余行 → 占位应为 0').toBe(0)
  })
})
