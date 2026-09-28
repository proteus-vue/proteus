// tests/selfdraw-paint-patch.test.ts
// ★★V10：**绘制属性的增量通道** + **fontWeight 端到端**
//
// 【为什么必须有这一层（本仓实测的功能缺口）】`takePatches()` 只发布**布局**补丁
//   （`layoutStyleOf` 只留 LAYOUT_KEYS）⇒ 纯绘制变更（颜色 / 圆角 / 字重 / 字号 / 透明度）
//   在增量路径上**没有任何通道**：
//     `takePatches()` → `[]` → 宿主 `updatePatches([])` → 核心 applied=0 → 宿主早返回
//   ⇒ **层上的颜色/圆角仍然是旧值**（静默错显示；几何断言全绿）。
//   ⇒ 正解：**几何与绘制分两条通道**（几何 → 核心重排；绘制 → 宿主直接改层）。
//
// 【判据分层】
//   ① 颜色/圆角变更 ⇒ 产出 paint 补丁（不是空、不是 null）
//   ② 无变更 ⇒ 空（不产生噪声补丁）
//   ③ 取走即复位（与 takePatches 同语义——"自上次取走以来"）
//   ④ paint 补丁是**该节点的完整绘制快照**（缺省键为 null ⇒ 宿主可据此清除）
//   ⑤ fontWeight：透传 / 从父元素继承 / 进 textStyleKey（不同字重不得共用度量缓存）
import { describe, it, expect } from 'vitest'
import { h, ref, nextTick } from '@vue/runtime-core'
import { createAppRenderer } from '@proteus-vue/renderer-app'
import { createSelfDrawAdapter, normalizeFontWeight } from '@proteus-vue/renderer-app/adapters/selfdraw'

type PaintPatch = { id: number; paint: Record<string, unknown> }
type NodeLite = { id: number; text?: string; fontSize?: number; fontWeight?: number; textStyleKey?: number; backgroundColor?: string }
type Adapter = ReturnType<typeof createSelfDrawAdapter> & {
  takePaintPatches(): PaintPatch[]
  toRequest(vp: { width: number; height: number }): { nodes: NodeLite[] }
}

async function mountBox(initial: Record<string, unknown>) {
  const adapter = createSelfDrawAdapter() as Adapter
  const renderer = createAppRenderer(adapter)
  const style = ref(initial)
  const App = { render: () => h('p-view', { style: { ...style.value } }) }
  const container = adapter.createElement('p-view')
  adapter.root.children.push(container)
  container.parent = adapter.root
  const app = renderer.createApp(App)
  app.mount(container)
  await nextTick()
  adapter.markFullSync()
  return { adapter, style, app }
}

describe('V10 · 绘制补丁通道（颜色/圆角/透明度）', () => {
  it('★★① 只改颜色 ⇒ 产出 paint 补丁（当前无通道 ⇒ 层颜色停留旧值）', async () => {
    const { adapter, style, app } = await mountBox({ width: 100, height: 50, backgroundColor: '#123456' })
    // 清掉挂载期的记录（markFullSync 已清；再取一次确保干净）
    adapter.takePaintPatches()
    style.value = { width: 100, height: 50, backgroundColor: '#ff0000' }
    await nextTick()
    const pp = adapter.takePaintPatches()
    expect(pp, '颜色变更必须产出 paint 补丁').toBeTruthy()
    expect(pp.length, '应恰好一个节点的补丁').toBe(1)
    expect(pp[0]!.paint.backgroundColor, '应带新颜色').toBe('#ff0000')
    app.unmount()
  })

  it('★★② 只改圆角 ⇒ 产出 paint 补丁', async () => {
    const { adapter, style, app } = await mountBox({ width: 100, height: 50, borderRadius: 4 })
    adapter.takePaintPatches()
    style.value = { width: 100, height: 50, borderRadius: 16 }
    await nextTick()
    const pp = adapter.takePaintPatches()
    expect(pp.length).toBe(1)
    expect(pp[0]!.paint.borderRadius).toBe(16)
    app.unmount()
  })

  it('★③ 无绘制变更 ⇒ 空数组（不产生噪声补丁）', async () => {
    const { adapter, style, app } = await mountBox({ width: 100, height: 50, backgroundColor: '#123456' })
    adapter.takePaintPatches()
    // 改**布局**（宽）——不应产生 paint 补丁
    style.value = { width: 200, height: 50, backgroundColor: '#123456' }
    await nextTick()
    expect(adapter.takePaintPatches(), '纯布局变更不该出现在 paint 通道').toEqual([])
    app.unmount()
  })

  it('★★④ 取走即复位（第二次取走为空——与 takePatches 同语义）', async () => {
    const { adapter, style, app } = await mountBox({ width: 100, height: 50, backgroundColor: '#111111' })
    adapter.takePaintPatches()
    style.value = { width: 100, height: 50, backgroundColor: '#222222' }
    await nextTick()
    expect(adapter.takePaintPatches().length).toBe(1)
    expect(adapter.takePaintPatches(), '重复取走不得重复报告').toEqual([])
    app.unmount()
  })

  it('★★⑤ paint 是**完整快照**：未设置的绘制键为 null（宿主据此可清除旧值）', async () => {
    // 场景：先有圆角，后移除 ⇒ 宿主必须能把 cornerRadius 清回 0
    const { adapter, style, app } = await mountBox({ width: 100, height: 50, borderRadius: 12 })
    adapter.takePaintPatches()
    style.value = { width: 100, height: 50 } // 移除 borderRadius
    await nextTick()
    const pp = adapter.takePaintPatches()
    expect(pp.length, '移除绘制属性也算变更').toBe(1)
    expect(pp[0]!.paint.borderRadius, '缺省键必须是显式 null（不是"不出现"）').toBeNull()
    app.unmount()
  })

  it('★⑥ 绘制变更**不进**布局补丁（两通道互不污染）', async () => {
    const { adapter, style, app } = await mountBox({ width: 100, height: 50, backgroundColor: '#010101' })
    adapter.takePatches()
    style.value = { width: 100, height: 50, backgroundColor: '#020202' }
    await nextTick()
    // 纯颜色变更 ⇒ 布局补丁为空（不该发到核心）
    expect(adapter.takePatches(), '颜色不影响几何 ⇒ 布局补丁应为空').toEqual([])
    expect(adapter.takePaintPatches().length).toBe(1)
    app.unmount()
  })
})

describe('V10 · fontWeight 归一化与端到端', () => {
  it('★归一化：normal/bold/数字（与 CSS 口径一致）', () => {
    expect(normalizeFontWeight('normal')).toBe(400)
    expect(normalizeFontWeight('bold')).toBe(700)
    expect(normalizeFontWeight('BOLD')).toBe(700)
    expect(normalizeFontWeight(600)).toBe(600)
    expect(normalizeFontWeight('300')).toBe(300)
    expect(normalizeFontWeight(undefined)).toBeUndefined()
    expect(normalizeFontWeight('bogus')).toBeUndefined()
  })

  it('★★⑦ 文本的 fontWeight 必须透传（否则宿主按常规体渲染+度量）', async () => {
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    // ★真实形态（本仓组件 p-heading 即如此）：fontWeight 写在 **p-text 元素**上
    const App = { render: () => h('p-view', {}, [h('p-text', { style: { fontSize: 20, fontWeight: 'bold' } }, 'X')]) }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    const textNode = adapter.toRequest({ width: 390, height: 844 }).nodes.find((n) => n.text !== undefined)!
    expect(textNode.fontWeight, '★文本叶子必须带上字重（从父元素继承）').toBe(700)
    app.unmount()
  })

  it('★★⑧ textStyleKey 必须含字重（否则粗细共用度量缓存 ⇒ 静默错几何）', async () => {
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const App = {
      render: () => h('p-view', {}, [
        h('p-text', { style: { fontSize: 16, fontWeight: 'normal' } }, '同样文本'),
        h('p-text', { style: { fontSize: 16, fontWeight: 'bold' } }, '同样文本'),
      ]),
    }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    const texts = adapter.toRequest({ width: 390, height: 844 }).nodes.filter((n) => n.text !== undefined)
    expect(texts.length).toBe(2)
    for (const t of texts) expect(t.textStyleKey, `节点 ${t.id} 必须有非零 textStyleKey`).toBeGreaterThan(0)
    expect(
      texts[0]!.textStyleKey,
      '★同文本同字号但不同字重 ⇒ 必须不同 key（否则内容寻址会把它们合并）',
    ).not.toBe(texts[1]!.textStyleKey)
    app.unmount()
  })
})
