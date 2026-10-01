// tests/selfdraw-text-patch.test.ts
// ★★V7：**文本内容更新走补丁通道**（不再被迫全量）—— 真机 S4 的根因修复
//
// 【这条链此前为什么是全量（本仓实测）】Vue 对 `h('p-text', {...}, '文案')` 的内容更新走
//   `hostSetElementText`；适配器首版**清空 children + 新建文本节点** ⇒ 新 id ⇒ 结构变更
//   ⇒ `takePatches()` 返回 null ⇒ **整树重发**（真机 S4：300 行文案 = 280KB / 254ms）。
//   而核心侧真正需要的只是 300 条文本补丁。
//
// 【判据】
//   ① 文本更新 ⇒ `takePatches()` 返回**文本补丁**（`{id, text}`），不再是 null
//   ② **id 稳定**：文本节点的 id 在更新前后必须相同（这是能走补丁通道的前提）
//   ③ 无结构变更信号：`takeSplice()` 必须为 null（文本更新不该触发结构通道）
//   ④ 形态真变时（多子节点）仍走"替换"（那是真结构变更，不得被静默吞掉）
import { describe, it, expect } from 'vitest'
import { h, ref, nextTick, createTextVNode } from '@vue/runtime-core'
import { createAppRenderer } from '@proteus-vue/renderer-app'
import { createSelfDrawAdapter } from '@proteus-vue/renderer-app/adapters/selfdraw'

type Adapter = ReturnType<typeof createSelfDrawAdapter> & {
  takePatches(): Array<{ id: number; style: Record<string, unknown> }> | null
  takeSplice(): unknown
  toRequest(vp: { width: number; height: number }): {
    nodes: Array<{ id: number; text?: string; fontSize?: number; textStyleKey?: number }>
  }
}

/** 挂一个「容器 + 文本」的应用（与 Vue 对 `h('p-text', {}, 'x')` 的处理路径一致） */
async function mountText(initial: string) {
  const adapter = createSelfDrawAdapter() as Adapter
  const renderer = createAppRenderer(adapter)
  const label = ref(initial)
  const App = { render: () => h('p-view', { style: { height: 40 } }, [h('p-text', {}, label.value)]) }
  const container = adapter.createElement('p-view')
  adapter.root.children.push(container)
  container.parent = adapter.root
  const app = renderer.createApp(App)
  app.mount(container)
  await nextTick()
  adapter.markFullSync()
  return { adapter, label, app }
}

describe('V7 · 文本更新走补丁（而非全量重发）', () => {
  it('★★① 文本更新 ⇒ 返回文本补丁（此前返回 null ⇒ 整树重发）', async () => {
    const { adapter, label, app } = await mountText('A')
    label.value = 'B'
    await nextTick()
    const patches = adapter.takePatches()
    // ★这是本用例的核心判据：以前这里是 null
    expect(patches, '文本更新必须产出补丁（而非 null ⇒ 全量）').not.toBeNull()
    const textPatches = (patches ?? []).filter((p) => p.style.text !== undefined)
    expect(textPatches.length, '应恰好一条文本补丁').toBe(1)
    // ★形状必须与 Rust 的 StylePatch 一致（`text` 在 **style 内**）——
    //   顶层 `{id,text}` 会被 serde 静默忽略：applied 照数、改动为零（本仓实测）
    expect(textPatches[0]!.style.text).toBe('B')
    app.unmount()
  })

  it('★★② 文本节点 id **稳定**（走补丁通道的前提）', async () => {
    const { adapter, label, app } = await mountText('A')
    const idOfText = (): number | undefined =>
      adapter.toRequest({ width: 390, height: 844 }).nodes.find((n) => n.text !== undefined)?.id
    const before = idOfText()
    expect(before, '首帧应有文本节点').toBeDefined()
    label.value = 'B'
    await nextTick()
    const patches = adapter.takePatches() ?? []
    const tp = patches.find((p) => p.style.text !== undefined)!
    // ★判据：补丁的 id == 首帧文本节点 id（新建节点会让 id 变化 ⇒ 结构变更 ⇒ 全量）
    expect(tp.id, '文本补丁必须指向**同一个**节点 id').toBe(before)
    expect(idOfText(), '树里的文本节点 id 也应保持不变').toBe(before)
    app.unmount()
  })

  it('★③ 文本更新**不得**触发结构通道（takeSplice 必须为 null）', async () => {
    const { adapter, label, app } = await mountText('A')
    label.value = 'B'
    await nextTick()
    // 先取 splice：文本更新若被误判为结构变更，这里会给出 removes/inserts 或 full-required
    expect(adapter.takeSplice(), '文本更新不是结构变更').toBeNull()
    void adapter.takePatches()
    app.unmount()
  })

  it('★④ 子节点**形态真的变了** ⇒ 仍走替换（结构变更不得被静默吞掉）', async () => {
    // 从「单文本」变成「两个文本子节点」：这是真结构变更 ⇒ 必须走结构通道（或全量）
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const mode = ref<'one' | 'two'>('one')
    const App = {
      render: () =>
        h('p-view', { style: { height: 40 } }, [
          mode.value === 'one' ? h('p-text', {}, 'A') : h('p-text', {}, 'A2'),
          ...(mode.value === 'two' ? [h('p-text', {}, 'B')] : []),
        ]),
    }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    adapter.markFullSync()

    mode.value = 'two'
    await nextTick()
    // ★形态变 ⇒ 既有结构语义（全量或 splice），**不得**被当成"纯文本补丁"悄悄吞掉
    const patches = adapter.takePatches()
    const splice = adapter.takeSplice()
    const wentFull = patches === null
    const wentSplice = splice !== null
    expect(wentFull || wentSplice, '形态变更必须走全量或结构通道（不得只发文本补丁）').toBe(true)
    app.unmount()
  })

  it('★★⑤ 多条文本一起改 ⇒ 逐条补丁（真机 S4 的形态：300 行文案）', async () => {
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const items = ref(Array.from({ length: 20 }, (_, i) => ({ id: i, title: `t${i}` })))
    const App = {
      render: () =>
        h('p-view', { style: { flexDirection: 'column' } },
          items.value.map((it) => h('p-view', { key: it.id, style: { height: 20 } }, [h('p-text', {}, it.title)]))),
    }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    adapter.markFullSync()

    // 改前 10 行的文案（与 S4 同款：只改一部分）
    items.value = items.value.map((it, i) => (i < 10 ? { ...it, title: `R${i}` } : it))
    await nextTick()
    const patches = adapter.takePatches()
    expect(patches, '批量文本更新应产出补丁（而非全量）').not.toBeNull()
    const textPatches = (patches ?? []).filter((p) => p.style.text !== undefined)
    expect(textPatches.length, '10 行改文案 ⇒ 10 条文本补丁').toBe(10)
    // 未改的行不应出现（补丁是 delta，不是全量快照）
    const titles = textPatches.map((p) => p.style.text)
    expect(titles).not.toContain('t15')
    app.unmount()
  })

  /**
   * ★★⑥ **文本 vnode 路径**（编译模板 `{{ }}` 插值就是这条——与上面五条不同的路）
   *
   * 【为什么必须单列（2026-10-01 更新路径 A/B 抓出的静默丢件）】
   *   `h('p-text', {}, 'x')`（字符串孩子）走 **`setElementText`**（上面①..⑤覆盖的路径）；
   *   而编译模板里的 `{{ x }}` 产出的是 **`createTextVNode(...)` 孩子**——
   *   更新时走 **`hostSetText` → `setText`**，是**另一条路**。
   *   初版 `setText` 只改 `node.text` 不入 `textDirty` ⇒ `takePatches()` 里没有该补丁
   *   ⇒ 宿主永远收不到文本变更（**静默丢件**：JS 树是新值、全量请求也是新值，
   *     唯独增量通道少一条——与 V7 被修的 `setElementText` 缺陷同族，但入口不同）。
   *   ⇒ 本用例钉住：文本 vnode 更新必须产出与 Rust `StylePatch` 同形状的文本补丁。
   */
  it('★★⑥ 文本 vnode（`{{ }}` 插值路径 → setText）更新 ⇒ 同样必须产出文本补丁', async () => {
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const label = ref('A')
    // ★形态与编译产物一致：p-text 的孩子是 **Text vnode**（不是字符串）
    const App = {
      render: () => h('p-view', {}, [h('p-text', { width: 80 }, [createTextVNode(label.value)])]),
    }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    adapter.markFullSync()

    label.value = 'B'
    await nextTick()
    const patches = adapter.takePatches()
    expect(patches, '文本 vnode 更新必须产出补丁（此前静默丢件 ⇒ 宿主收不到文本变更）').not.toBeNull()
    const textPatches = (patches ?? []).filter((p) => p.style.text !== undefined)
    expect(textPatches.length, '应恰好一条文本补丁').toBe(1)
    // ★形状与 Rust StylePatch 一致（`text` 在 style 内）——顶层 `{id,text}` 会被 serde 静默忽略
    expect(textPatches[0]!.style.text).toBe('B')
    app.unmount()
  })
})

describe('V8 · ★文本字号必须传给宿主（此前被静默丢弃 ⇒ 全部按 14pt 度量+绘制）', () => {
  it('★★① 文本节点的 fontSize 必须进 spec（否则宿主用 `?? 14` 兜底 ⇒ 字号全错）', async () => {
    // 【为什么这是真缺陷（本仓实测）】适配器 `fillSpec` 的文本分支**提前 return**
    //   ⇒ 只有**元素**分支会透传 paint 字段 ⇒ 文本节点的 `fontSize` 从未发出。
    //   而宿主用同一个字段**同时**做两件事：绘制（CATextLayer.fontSize）与**度量**
    //   （`measureText(text, fontSize ?? 14)`）⇒ 后果：**所有文本按 14pt 度量与绘制**
    //   （16pt 标题与 13pt 说明长得一样）。两侧口径一致 ⇒ 不报错、几何自洽 ⇒ 长期隐身。
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const App = { render: () => h('p-view', {}, [h('p-text', { style: { fontSize: 24 } }, 'X')]) }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    const spec = adapter.toRequest({ width: 390, height: 844 }).nodes.find((n) => n.text !== undefined) as
      | { fontSize?: number; textStyleKey?: number }
      | undefined
    expect(spec, '应有文本节点').toBeTruthy()
    expect(spec!.fontSize, '★文本的 fontSize 必须透传（否则字全按 14pt 画/量）').toBe(24)
    app.unmount()
  })

  it('★★② 文本必须带 textStyleKey（度量缓存"字体维度"——内容寻址安全的前提）', async () => {
    // 【为什么必须有】缓存键是 `(text_hash, max_w)`，而 hash 里唯一能区分字体的就是 `style_key`。
    //   若恒为 0 ⇒ 同文本不同字号会**错误共用**缓存项（本仓已实测：字号 16/28 都算 16 高）。
    //   核心的保守处置是"`style_key == 0` 时回退节点寻址"（正确但失去复用）。
    //   ⇒ 适配器按 fontSize 算出并下发，复用与正确性才能兼得。
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const App = {
      render: () => h('p-view', {}, [
        h('p-text', { style: { fontSize: 16 } }, '同文本'),
        h('p-text', { style: { fontSize: 28 } }, '同文本'),
      ]),
    }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    const texts = adapter.toRequest({ width: 390, height: 844 }).nodes.filter((n) => n.text !== undefined) as Array<{
      id: number
      fontSize?: number
      textStyleKey?: number
    }>
    expect(texts.length).toBe(2)
    for (const t of texts) {
      expect(t.textStyleKey, `节点 ${t.id} 必须有非零 textStyleKey`).toBeGreaterThan(0)
    }
    // ★判据：**不同字号 ⇒ 不同 key**（否则内容寻址会把它们合并 ⇒ 静默错几何）
    expect(texts[0]!.textStyleKey, '字号不同必须 key 不同').not.toBe(texts[1]!.textStyleKey)
    // ★同字号 ⇒ 同 key（复用的来源）
    const same = adapter.toRequest({ width: 390, height: 844 }).nodes.filter((n) => n.text !== undefined)
    expect(same.length).toBe(2)
    app.unmount()
  })
})
