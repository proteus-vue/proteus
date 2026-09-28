// tests/selfdraw-event-dispatch.test.ts
// ★★V9：**自绘管线的事件派发**（命中测试在核心，派发在适配器）
//
// 【为什么必须有这一层（本仓实测的功能缺口）】自绘场景**没有 UIKit/原生 View 承载事件**：
//   命中判定在 Rust 核心（`hit.rs` 返回 target + **冒泡链**），而处理器是 Vue 的函数
//   ⇒ 必须有"nodeId → 处理器"的桥。此前适配器**只计数不登记**（注释写"由核心命中测试 +
//   平台手势承担"）——但那条链**从未接线** ⇒ 自绘场景**完全不能交互**。
//
// 【判据分四层】
//   ① 登记：`onXxx` 进表，`null` 移除；类型归一化（`onClick` ≡ `tap`）
//   ② 派发：沿核心给的 **chain** 自内向外（冒泡）；`fired` 可观测
//   ③ 停止传播：`e.stopPropagation()` 终止后续
//   ④ 清理：节点移除 ⇒ 处理器一并清（防内存积 + 幽灵派发）
import { describe, it, expect } from 'vitest'
import { h, ref, nextTick } from '@vue/runtime-core'
import { createAppRenderer } from '@proteus-vue/renderer-app'
import { createSelfDrawAdapter, normalizeEventType } from '@proteus-vue/renderer-app/adapters/selfdraw'

type NodeLite = { id: number; parentId: number | null; width?: number; height?: number }
type Adapter = ReturnType<typeof createSelfDrawAdapter> & {
  /** ★按**可靠特征**取节点（不猜数组下标——本仓实测：手算/猜下标已错三次） */
  nodesOf(): NodeLite[]
  dispatchEvent(
    nodeId: number,
    chain: number[],
    type: string,
    x: number,
    y: number,
  ): { fired: number[]; stoppedAt: number | null; errors: string[] }
  toRequest(vp: { width: number; height: number }): { nodes: Array<{ id: number; parentId: number | null }> }
}

describe('V9 · 事件类型归一化', () => {
  it('★onClick ≡ tap（触屏口径，与 MP 端 onClick→bindtap 同源）', () => {
    expect(normalizeEventType('onClick')).toBe('tap')
    expect(normalizeEventType('onTap')).toBe('tap')
  })
  it('★语义名与 gesture 层一致（longpress/pan/touchstart）', () => {
    expect(normalizeEventType('onLongpress')).toBe('longpress')
    expect(normalizeEventType('onLongPress')).toBe('longpress')
    expect(normalizeEventType('onTouchstart')).toBe('touchstart')
    expect(normalizeEventType('onPanstart')).toBe('panstart')
  })
  it('★Capture 后缀去掉（当前只做冒泡这一趟）', () => {
    expect(normalizeEventType('onClickCapture')).toBe('tap')
    expect(normalizeEventType('onTouchstartCapture')).toBe('touchstart')
  })
  it('非法输入返回 null（不静默产生怪类型）', () => {
    expect(normalizeEventType('on')).toBeNull()
    expect(normalizeEventType('click')).toBeNull()
  })
})

/** 挂一个「容器 → 行 → 圆点」的三层结构（用来验冒泡链） */
async function mountNested(onRowTap?: (e: unknown) => void, onDotTap?: (e: unknown) => void) {
  const adapter = createSelfDrawAdapter() as Adapter
  const renderer = createAppRenderer(adapter)
  const App = {
    render: () =>
      h('p-view', { style: { height: 300 } }, [
        h(
          'p-view',
          // ★处理器**按需挂载**（不挂时传 undefined 而非空函数——
          //   `?? (()=>{})` 会让"无处理器"变成"有空处理器"，冒泡用例就测不到了）
          { style: { height: 100 }, onClick: onRowTap },
          [h('p-view', { style: { width: 40, height: 40 }, onClick: onDotTap })],
        ),
      ]),
  }
  const container = adapter.createElement('p-view')
  adapter.root.children.push(container)
  container.parent = adapter.root
  const app = renderer.createApp(App)
  app.mount(container)
  await nextTick()
  adapter.markFullSync()
  const nodesOf = (): NodeLite[] =>
    (adapter.toRequest({ width: 390, height: 844 }) as unknown as { nodes: NodeLite[] }).nodes
  return { adapter, app, nodesOf }
}

describe('V9 · 派发（沿核心给的冒泡链）', () => {
  it('★★① 命中内层 ⇒ **内层先触发、父层后触发**（DOM 冒泡顺序）', async () => {
    const order: string[] = []
    const { adapter, app, nodesOf } = await mountNested(
      () => order.push('row'),
      () => order.push('dot'),
    )
    const nodes = nodesOf()
    const dot = nodes.find((n) => n.width === 40)!
    const row = nodes.find((n) => n.id === dot.parentId)!
    // 核心给的 chain：自内向外（target → … → 根）
    const chain = [dot.id, row.id, ...nodes.filter((n) => n.id !== dot.id && n.id !== row.id).map((n) => n.id)]
    const r = adapter.dispatchEvent(dot.id, chain, 'tap', 10, 10)
    expect(order, '冒泡顺序：内层先、父层后').toEqual(['dot', 'row'])
    expect(r.fired, 'fired 应记录实际调用的节点').toEqual([dot.id, row.id])
    app.unmount()
  })

  it('★★② 内层无处理器 ⇒ 冒泡到父层（事件不丢）', async () => {
    const hits: string[] = []
    // ★只给**行**挂处理器（圆点不挂）——verify "内层无处理器 ⇒ 冒泡到父层"
    const { adapter, app, nodesOf } = await mountNested(() => hits.push('row'), undefined)
    const nodes = nodesOf()
    const dot = nodes.find((n) => n.width === 40)!
    const row = nodes.find((n) => n.id === dot.parentId)!
    const chain = [dot.id, row.id]
    const r = adapter.dispatchEvent(dot.id, chain, 'tap', 10, 10)
    expect(hits, '内层无处理器 ⇒ 父层触发').toEqual(['row'])
    expect(r.fired).toEqual([row.id])
    app.unmount()
  })

  it('★★③ stopPropagation ⇒ 父层不再触发', async () => {
    const order: string[] = []
    const { adapter, app, nodesOf } = await mountNested(
      () => order.push('row'),
      (e) => {
        order.push('dot')
        ;(e as { stopPropagation(): void }).stopPropagation()
      },
    )
    const nodes = nodesOf()
    const dot = nodes.find((n) => n.width === 40)!
    const row = nodes.find((n) => n.id === dot.parentId)!
    const r = adapter.dispatchEvent(dot.id, [dot.id, row.id], 'tap', 10, 10)
    expect(order, 'stopPropagation 后父层不触发').toEqual(['dot'])
    expect(r.stoppedAt).toBe(dot.id)
    app.unmount()
  })

  it('★④ 类型不匹配 ⇒ 不触发（tap 与 longpress 互不串）', async () => {
    const hits: string[] = []
    const { adapter, app, nodesOf } = await mountNested(() => hits.push('row'))
    const nodes = nodesOf()
    const row = nodes.find((n) => n.height === 100)!
    const r = adapter.dispatchEvent(row.id, [row.id], 'longpress', 0, 0)
    expect(hits).toEqual([])
    expect(r.fired).toEqual([])
    app.unmount()
  })

  it('★★⑤ 处理器抛异常 ⇒ **上报而非吞**（且不影响父层冒泡）', async () => {
    const order: string[] = []
    const { adapter, app, nodesOf } = await mountNested(
      () => order.push('row'),
      () => {
        throw new Error('boom')
      },
    )
    const nodes = nodesOf()
    const dot = nodes.find((n) => n.width === 40)!
    const row = nodes.find((n) => n.id === dot.parentId)!
    const r = adapter.dispatchEvent(dot.id, [dot.id, row.id], 'tap', 0, 0)
    expect(r.errors.length, '★异常必须上报（静默 = 点了没反应，无从归因）').toBe(1)
    expect(r.errors[0]).toContain('boom')
    expect(order, '内层抛异常不应阻断父层').toEqual(['row'])
    app.unmount()
  })

  it('★★⑥ 节点移除 ⇒ 处理器一并清（防内存积 + 幽灵派发）', async () => {
    const hits: string[] = []
    const adapter = createSelfDrawAdapter() as Adapter
    const renderer = createAppRenderer(adapter)
    const show = ref(true)
    const App = {
      render: () =>
        h('p-view', { style: { height: 300 } }, [
          show.value ? h('p-view', { style: { height: 100 }, onClick: () => hits.push('gone') }) : null,
        ]),
    }
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const app = renderer.createApp(App)
    app.mount(container)
    await nextTick()
    adapter.markFullSync()
    const before = (adapter.toRequest({ width: 390, height: 844 }) as unknown as { nodes: NodeLite[] }).nodes
    const target = before.find((n) => n.height === 100)!

    // 移除该节点
    show.value = false
    await nextTick()
    // ★派发到已移除的 id：不应触发（若处理器未清 ⇒ 会幽灵派发）
    const r = adapter.dispatchEvent(target.id, [target.id], 'tap', 0, 0)
    expect(hits, '已移除节点的处理器必须已清（否则幽灵派发）').toEqual([])
    expect(r.fired).toEqual([])
    app.unmount()
  })
})
