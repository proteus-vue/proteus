// tests/selfdraw-structural-diff.test.ts
// ★★V7：**结构变更 diff**（适配器侧）—— 让增删行走增量而非重发整树
//
// 【背景（本仓实测的量化依据）】此前结构变化一律**重发整棵树**
//   （真机 S5：500→600 项 **230ms**，几乎全是搬运成本）。而增删行在长列表里是最常见交互。
//
// 【判据四层】
//   ① **全量同步后干净**：`markFullSync()` 之后 `takeSplice()` 必须返回 `null`
//      （否则会把整棵树当"新建"重复插入）
//   ② **追加 ⇒ 精确 splice**：只含新节点，落点父正确
//   ③ **中间插入 ⇒ `full-required`**（不静默按末尾插——那个架构限制见适配器注释）
//   ④ **删除 ⇒ removes**（只列子树根，核心连同子孙摘除）
import { describe, it, expect } from 'vitest'
import { h, ref, nextTick } from '@vue/runtime-core'
import { createAppRenderer } from '@proteus-vue/renderer-app'
import { createSelfDrawAdapter } from '@proteus-vue/renderer-app/adapters/selfdraw'

/** 挂载一个「列 + N 行」的应用（行有 key，便于 diff） */
async function mountList(rowIds: number[]) {
  const adapter = createSelfDrawAdapter() as ReturnType<typeof createSelfDrawAdapter> & {
    takeSplice(): unknown
  }
  const renderer = createAppRenderer(adapter)
  const items = ref(rowIds.map((id) => ({ id })))
  const App = {
    render: () =>
      h(
        'p-view',
        { style: { flexDirection: 'column' } },
        items.value.map((it: { id: number }) => h('p-view', { key: it.id, style: { height: 50 } })),
      ),
  }
  const container = adapter.createElement('p-view')
  adapter.root.children.push(container)
  container.parent = adapter.root
  const app = renderer.createApp(App)
  app.mount(container)
  await nextTick()
  adapter.markFullSync()
  return { adapter, items, app }
}

describe('V7 · 结构 diff：适配器侧', () => {
  it('★① 全量同步后 takeSplice 必须返回 null（不得把整棵树当"新建"）', async () => {
    const { adapter, app } = await mountList([1, 2, 3])
    // ★这是本仓实测踩到的缺陷：markFullSync 若不清结构追踪，这里会返回整棵树
    //   ⇒ 调用方照着发 splice 会**重复插入**（树被撑大 / id 冲突）
    expect(adapter.takeSplice()).toBeNull()
    app.unmount()
  })

  it('★★② 追加一项 ⇒ 精确的 splice（只含新节点，落点正确）', async () => {
    const { adapter, items, app } = await mountList([1, 2])
    items.value = [...items.value, { id: 3 }]
    await nextTick()
    const sp = adapter.takeSplice() as { removes: number[]; inserts: Array<{ parentId: number; nodes: Array<{ id: number; parentId: number | null }> }> }
    expect(sp, '追加应产出 splice 请求（而非 null/full-required）').toBeTruthy()
    expect(typeof sp).not.toBe('string')
    expect(sp.removes).toEqual([])
    expect(sp.inserts.length).toBe(1)
    // ★新节点恰好一个（不含既有节点——否则会重复插入）
    const newNodeIds = sp.inserts[0]!.nodes.map((n) => n.id)
    expect(newNodeIds.length).toBe(1)
    // 落点父 = 列容器的 id
    const colId = sp.inserts[0]!.parentId
    expect(colId).toBeGreaterThan(0)
    expect(sp.inserts[0]!.nodes[0]!.parentId).toBe(colId)
    app.unmount()
  })

  it('★★③ 中间插入 ⇒ `full-required`（不静默按末尾插）', async () => {
    // 【为什么必须拒绝而不是"按末尾插"】核心的 `build_taffy` 按数组顺序连父子
    //   ⇒ 中间插入无法用"追加节点"表达 ⇒ 若强行按末尾插，**行序会错**且零提示。
    //   本仓纪律：宁可拒绝（调用方走全量），不可静默错。
    const { adapter, items, app } = await mountList([1, 2])
    items.value = [{ id: 0 }, ...items.value]
    await nextTick()
    expect(adapter.takeSplice()).toBe('full-required')
    app.unmount()
  })

  it('★★③b **移动既有行** ⇒ `full-required`（append-only 表达不了顺序变化）', async () => {
    // 【为什么必须拒绝（本仓实测的静默错序）】keyed diff 的重排走 `insert(existing, ...)`：
    //   它**不新建节点**（createdNodes/removedNodeIds 都为空）⇒ 若不单独检测"移动"，
    //   takeSplice 会返回 null（"无结构变更"），而实际顺序已变 ⇒ 宿主画面**顺序错**且零提示。
    const { adapter, items, app } = await mountList([1, 2, 3])
    items.value = [...items.value].reverse()
    await nextTick()
    expect(adapter.takeSplice()).toBe('full-required')
    app.unmount()
  })

  it('★★③c 文本内容替换（setElementText）⇒ 旧文本移除 + 新文本插入（不得只剩一半）', async () => {
    // 【为什么要单独测（本仓实测的缺陷）】Vue 对 `h('p-text', {...}, '文本')` 走
    //   `hostSetElementText`：**替换**全部子节点。此前适配器只登记**元素**的新建/移除
    //   ⇒ 结果是"旧文本被摘掉、新文本从不插入" ⇒ **文字消失**（而结构计数全都正常）。
    const adapter = createSelfDrawAdapter() as ReturnType<typeof createSelfDrawAdapter> & { takeSplice(): unknown }
    const renderer = createAppRenderer(adapter)
    const label = ref('A')
    const App = { render: () => h('p-view', { style: { height: 40 } }, [h('p-text', {}, label.value)]) }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    adapter.markFullSync()

    label.value = 'B'
    await nextTick()
    const sp = adapter.takeSplice() as { removes: number[]; inserts: Array<{ nodes: Array<{ text?: string }> }> }
    expect(typeof sp, `替换文本应产出 splice（实得 ${JSON.stringify(sp)}）`).not.toBe('string')
    // ★两半都要有：摘旧文本 + 插新文本
    expect(sp.removes.length, '旧文本必须登记为移除').toBe(1)
    const texts = sp.inserts.flatMap((g) => g.nodes).map((n) => n.text)
    expect(texts, '新文本必须登记为插入（否则文字消失）').toContain('B')
    app.unmount()
  })

  it('★④ 删除一项 ⇒ removes 只列子树根（核心连同子孙摘除）', async () => {
    const { adapter, items, app } = await mountList([1, 2, 3])
    items.value = items.value.filter((it) => it.id !== 2)
    await nextTick()
    const sp = adapter.takeSplice() as { removes: number[]; inserts: unknown[] }
    expect(typeof sp).not.toBe('string')
    expect(sp.removes.length).toBe(1)
    // ★只列**行根**（其子孙由核心侧一并摘除——不需要逐个列出）
    expect(sp.inserts.length).toBe(0)
    app.unmount()
  })

  it('★⑤ 无结构变化 ⇒ null（不产生空请求）', async () => {
    const { adapter, items, app } = await mountList([1, 2])
    // 只改样式（改行高）——不是结构变化
    items.value = items.value.map((it) => ({ ...it }))
    await nextTick()
    expect(adapter.takeSplice()).toBeNull()
    app.unmount()
  })

  it('★★⑥ 结构追踪是"自上次取走以来"（取走即复位，不重复报告）', async () => {
    const { adapter, items, app } = await mountList([1])
    items.value = [...items.value, { id: 2 }]
    await nextTick()
    const first = adapter.takeSplice()
    expect(first).toBeTruthy()
    // ★再取一次：不应重复报告同一批新建（否则调用方会重复插入——与 ① 同源的坑）
    expect(adapter.takeSplice()).toBeNull()
    app.unmount()
  })
})
