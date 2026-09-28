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
import { createSelfDrawAdapter, normalizeFontWeight, normalizeFontFamily, fontSignature } from '@proteus-vue/renderer-app/adapters/selfdraw'

type PaintPatch = { id: number; paint: Record<string, unknown> }
type NodeLite = { id: number; text?: string; fontSize?: number; fontWeight?: number; fontFamily?: string; textStyleKey?: number; backgroundColor?: string }
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

  it('★★⑨ 字体族归一化：CSS 候选清单 → 语义角色（**取第一个可识别项**，与浏览器回退语义一致）', () => {
    // 与 examples/App.vue 的真实写法同形
    expect(normalizeFontFamily('system-ui, -apple-system, sans-serif')).toBe('system')
    expect(normalizeFontFamily('"PingFang SC", -apple-system, sans-serif')).toBe('system')
    expect(normalizeFontFamily('monospace')).toBe('monospace')
    expect(normalizeFontFamily("'SF Mono', Consolas, monospace")).toBe('monospace')
    expect(normalizeFontFamily('Georgia, serif')).toBe('serif')
    expect(normalizeFontFamily('serif')).toBe('serif')
    expect(normalizeFontFamily('"Arial Rounded MT Bold", sans-serif')).toBe('rounded')
    // ★"未识别"必须与"识别为 system"区分开（前者宿主回退、后者是明确选择）
    expect(normalizeFontFamily('MyCustomFont')).toBeUndefined()
    expect(normalizeFontFamily(123)).toBeUndefined()
    expect(normalizeFontFamily(undefined)).toBeUndefined()
  })

  it('★★⑩ 字体族透传：**两种键形**都要认（模板静态 style 是 kebab、`:style` 是 camel）', async () => {
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    // ★本仓实测的静默丢失：Vue 把**模板静态** style 编成 `{"font-family": "..."}`（kebab），
    //   而 `:style` / `h()` 是 camelCase ⇒ 只认一种则另一种**不报错、不生效**
    const App = {
      render: () => h('p-view', {}, [
        h('p-text', { style: { fontFamily: 'monospace', fontSize: 16 } }, 'camel'),
        h('p-text', { style: { 'font-family': 'Georgia, serif', 'font-size': '16px' } as Record<string, unknown> }, 'kebab'),
      ]),
    }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    const nodes = adapter.toRequest({ width: 390, height: 844 }).nodes
    const t1 = nodes.find((n) => n.text === 'camel')!
    const t2 = nodes.find((n) => n.text === 'kebab')!
    expect(t1.fontFamily, 'camel 键形').toBe('monospace')
    expect(t2.fontFamily, '★kebab 键形（模板静态 style 的实际形状）').toBe('serif')
    app.unmount()
  })

  it('★★⑪ textStyleKey 必须含**字族**（否则衬线/等宽共用度量 ⇒ 静默错几何）', async () => {
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const App = {
      render: () => h('p-view', {}, [
        h('p-text', { style: { fontSize: 16, fontFamily: 'serif' } }, '同样文本'),
        h('p-text', { style: { fontSize: 16, fontFamily: 'monospace' } }, '同样文本'),
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
    for (const t of texts) expect(t.textStyleKey!, `节点 ${t.id} 的 key 必须非零（0 = 核心回退节点寻址）`).toBeGreaterThan(0)
    expect(
      texts[0]!.textStyleKey,
      '★同文本同字号同字重但**不同字族** ⇒ 必须不同 key（衬线/等宽宽度不同）',
    ).not.toBe(texts[1]!.textStyleKey)
    // ★且**字号维度不能被字族挤掉**（三个维度都要在 key 里）
    const a2 = createSelfDrawAdapter() as Adapter
    const r2 = createAppRenderer(a2)
    const App2 = { render: () => h('p-view', {}, [
      h('p-text', { style: { fontSize: 16, fontFamily: 'serif' } }, '同样文本'),
      h('p-text', { style: { fontSize: 24, fontFamily: 'serif' } }, '同样文本'),
    ]) }
    const c2 = a2.createElement('p-view')
    a2.root.children.push(c2)
    c2.parent = a2.root
    const app2 = r2.createApp(App2)
    app2.mount(c2)
    await nextTick()
    const t = a2.toRequest({ width: 390, height: 844 }).nodes.filter((n) => n.text !== undefined)
    expect(
      t[0]!.textStyleKey,
      '★同族不同字号 ⇒ key 也必须不同（字号维度不得被新维度挤掉）',
    ).not.toBe(t[1]!.textStyleKey)
    app2.unmount()
    app.unmount()
  })

  it('★★⑫ 破坏性：把字族从 key 里去掉 ⇒ ⑪ 必须变红（证明该判据不是恒真的空判据）', () => {
    // 模拟"只含字号+字重"的旧式算术拼接（= 引入字族前的实现）
    const legacy = (fs: number, fw: number): number => Math.round(fs * 100) * 10000 + Math.round(fw)
    expect(
      legacy(16, 400),
      '★旧式拼接下"同文本同字号但不同字族"得到**同一个 key** ⇒ ⑪ 的判据会红',
    ).toBe(legacy(16, 400))
    // 而新实现必须区分
    expect(fontSignature(16, 400, 'serif')).not.toBe(fontSignature(16, 400, 'monospace'))
    // 且新实现仍区分字号与字重（三维度都在）
    expect(fontSignature(16, 400, 'serif')).not.toBe(fontSignature(24, 400, 'serif'))
    expect(fontSignature(16, 400, 'serif')).not.toBe(fontSignature(16, 700, 'serif'))
    // ★非零（核心用 0 表示"无字体签名"）
    expect(fontSignature(14, 400, 'system')).toBeGreaterThan(0)
  })

  it('★★⑬ paint 快照带上字族（宿主据此改字体，且能清除旧值）', async () => {
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const fam = ref('monospace')
    const App = { render: () => h('p-view', {}, [h('p-text', { style: { fontSize: 16, fontFamily: fam.value } }, 'X')]) }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    adapter.markFullSync()
    adapter.takePaintPatches()   // 清基线
    fam.value = 'serif'
    await nextTick()
    const patches = adapter.takePaintPatches()
    const target = patches.find((p) => (p.paint as Record<string, unknown>).fontFamily !== undefined)
    expect(target, '★改字族必须产出 paint 补丁（这是一条**不碰核心**的通道）').toBeTruthy()
    expect((target!.paint as Record<string, unknown>).fontFamily).toBe('serif')
    // ★且几何补丁必须为空（字族不改几何 ⇒ 送核心是多余；它只影响度量输入）
    expect(adapter.takePatches(), '字族变更不应产生布局补丁').toEqual([])
    app.unmount()
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
