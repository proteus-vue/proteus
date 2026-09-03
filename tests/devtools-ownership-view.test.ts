// tests/devtools-ownership-view.test.ts
// ★G-43 B4（proteus-ownership-plan batches B4）：DevTools 所有权面板视图（UI 层）
//   renderOwnership 渲染（概要/四类告警/资源树/时间线配对+未配对高亮/空态）+ createOwnershipTracer 采集
//   + panel 第十视图集成 + WS 协议（bridge Proteus.ownership 响应 / source 缓存）
// @vitest-environment happy-dom（DOM 渲染断言 + WebSocket 全局）
import { describe, it, expect, vi } from 'vitest'
import {
  OwnershipGraph,
  Owned,
  createPageOwnership,
  createStackContainer,
  createOwnershipHistory,
} from '@proteus-vue/render-backend'
import { renderOwnership, createOwnershipTracer, createDevtoolsPanel, createDevtoolsWsSource, createTraceBusWsBridge } from '@proteus-vue/devtools'
import type { TraceBus } from '@proteus-vue/devtools-runtime'
import { createTraceBus } from '@proteus-vue/devtools-runtime'

function makeViewDataFixture() {
  return {
    summary: { alive: 2, total: 3, bytesAlive: 12 * 1024 * 1024, byType: { 'array-buffer': { allocated: 3, alive: 2 } } },
    diagnosis: {
      orphans: [{ id: 'orphan-1', type: 'array-buffer', byteSize: 1024, sourceLocation: 'X.vue:2' }],
      leaks: [{ resourceId: 'leak-1', type: 'video-stream', byteSize: 3 * 1024 * 1024, sourceLocation: 'Player.vue:12', referenceChain: ['PageB.timer --borrows--> leak-1'] }],
      longBorrows: [{ resourceId: 'leak-1', borrowedBy: 'ComponentX', owner: 'PageA' }],
      crossPageRefs: [{ resourceId: 'cross-1', owner: 'PageA', heldBy: 'PageB' }],
    },
    resources: [
      { owner: 'PageA', items: [{ id: 'a1', type: 'array-buffer', byteSize: 8 * 1024 * 1024, owner: 'PageA', state: 'alive' as const, sourceLocation: 'Gallery.vue:5', borrowedBy: ['GalleryView'] }] },
      { owner: '（无主）', items: [{ id: 'orphan-1', type: 'array-buffer', byteSize: 1024, owner: null, state: 'alive' as const, sourceLocation: 'X.vue:2', borrowedBy: [] }] },
    ],
    timeline: {
      events: [
        { ts: 1000, kind: 'alloc' as const, id: 'a1', type: 'array-buffer', byteSize: 8 * 1024 * 1024, sourceLocation: 'Gallery.vue:5' },
        { ts: 2000, kind: 'drop' as const, id: 'a1', type: 'array-buffer', byteSize: 8 * 1024 * 1024, matchedAllocId: 'a1' },
        { ts: 3000, kind: 'alloc' as const, id: 'a2', type: 'array-buffer', byteSize: 4 * 1024 * 1024, sourceLocation: 'Leaky.vue:23' },
      ],
      unpairedIds: ['a2'],
      truncated: false,
    },
  }
}

describe('G-43 B4 renderOwnership 视图渲染', () => {
  it('概要/四类告警/资源树/时间线全部呈现（视觉编码对齐 devtools-ownership-graph.md）', () => {
    const el = document.createElement('div')
    renderOwnership(el, makeViewDataFixture())
    expect(el.textContent).toContain('2 alive / 3 total')
    expect(el.textContent).toContain('array-buffer: 2/3')
    // 四类告警
    expect(el.querySelector('.pd-own-alert-orphan')?.textContent).toContain('🔴 无主资源 orphan-1')
    expect(el.querySelector('.pd-own-alert-leak')?.textContent).toContain('⚠️ 泄漏路径 leak-1')
    expect(el.querySelector('.pd-own-chain')?.textContent).toContain('PageB.timer --borrows--> leak-1')
    expect(el.querySelector('.pd-own-alert-longborrow')?.textContent).toContain('🟡 长期借用 leak-1')
    expect(el.querySelector('.pd-own-alert-crosspage')?.textContent).toContain('跨页强引用 cross-1')
    // 资源树（owner 分组 + 借用方 + 源码行）
    const ownerRows = Array.from(el.querySelectorAll('.pd-own-owner')).map((n) => n.textContent)
    expect(ownerRows.some((t) => t?.includes('PageA'))).toBe(true)
    expect(ownerRows.some((t) => t?.includes('（无主）'))).toBe(true)
    expect(el.querySelector('.pd-own-resource')?.textContent).toContain('📍 Gallery.vue:5')
    expect(el.querySelector('.pd-own-resource')?.textContent).toContain('🟡 GalleryView')
    // 时间线：alloc/drop 配对 + 未配对高亮
    const tlRows = Array.from(el.querySelectorAll('.pd-own-tl')).map((n) => n.textContent)
    expect(tlRows[1]).toContain('↓ drop')
    expect(tlRows[1]).toContain('（↔ a1）')
    expect(el.querySelector('.pd-own-tl-unpaired')?.textContent).toContain('⚠️ 未配对')
  })

  it('无异常数据 → ✅；undefined → 空态提示', () => {
    const el = document.createElement('div')
    const data = makeViewDataFixture()
    const empty = {
      ...data,
      diagnosis: { orphans: [], leaks: [], longBorrows: [], crossPageRefs: [] },
    }
    renderOwnership(el, empty)
    expect(el.querySelector('.pd-own-ok')?.textContent).toContain('✅ 无异常')

    const el2 = document.createElement('div')
    renderOwnership(el2, undefined)
    expect(el2.textContent).toContain('暂无所有权数据')
  })
})

describe('G-43 B4 createOwnershipTracer 采集', () => {
  it('alloc→drop→诊断数据正确；存量节点补快照（面板后开不丢）；dispose 后空数据', () => {
    const graph = new OwnershipGraph()
    // 存量节点（tracer 挂接前已存在）
    graph.register({ id: 'early', type: 'array-buffer', byteSize: 1024, owner: 'PageA', sourceLocation: 'Early.vue:1' })
    const tracer = createOwnershipTracer({ graph })
    // 挂接后分配 + 泄漏（PageA 已销毁但资源仍存活）
    const buf = new Owned({ id: 'leak-1', resourceType: 'video-stream', byteSize: 3 * 1024 * 1024, owner: 'PageA', value: new ArrayBuffer(1), graph, sourceLocation: 'Player.vue:12' })
    buf.borrow('ComponentX')
    // 长期借用：borrow 边已发生 5s（诊断阈值 1000ms——borrow 边 since 改旧模拟时间流逝）
    const borrowEdge = graph.edges.find((e) => e.kind === 'borrows' && e.to === 'leak-1')
    borrowEdge!.since = Date.now() - 5000
    graph.addEdge({ kind: 'strong', from: 'PageB', to: 'early' })

    const data = tracer.collect()
    expect(data.summary.alive).toBe(2)
    expect(data.summary.total).toBe(2)
    // 四类：长期借用 + 跨页强引用（orphan/leak 需 destroyedScopes——tracer 缺省不带，容器销毁场景由宿主传入）
    expect(data.diagnosis.longBorrows).toHaveLength(1)
    expect(data.diagnosis.crossPageRefs).toHaveLength(1)
    // 时间线：存量 early 补快照 alloc + leak-1 alloc
    const allocIds = data.timeline.events.filter((e) => e.kind === 'alloc').map((e) => e.id)
    expect(allocIds).toContain('early')
    expect(allocIds).toContain('leak-1')
    expect(data.timeline.unpairedIds.sort()).toEqual(['early', 'leak-1'])
    // 资源树（owner 分组 + 借用方）
    const pageA = data.resources.find((r) => r.owner === 'PageA')
    expect(pageA?.items).toHaveLength(2)
    const leakItem = pageA?.items.find((i) => i.id === 'leak-1')
    expect(leakItem?.borrowedBy).toEqual(['ComponentX'])

    tracer.dispose()
    const after = tracer.collect()
    expect(after.summary.alive).toBe(0)
    expect(after.timeline.events).toHaveLength(0)
  })

  it('B3 页面销毁联动：StackContainer ownership → tracer 时间线 drop + 未配对清零', async () => {
    const graph = new OwnershipGraph()
    const container = createStackContainer({ ownership: { graph } })
    await container.push({ pageId: 'PageA', irId: 'home' })
    const own = container.ownershipOf('PageA')!
    const buf = own.alloc({ byteSize: 16 * 1024 * 1024, sourceLocation: 'Gallery.vue:5' })
    void buf
    const tracer = createOwnershipTracer({ graph })
    // 页面销毁（五原子第 3 步 forceDrop）→ drop 记录进时间线
    const report = await container.destroyPage(container.getCurrent()!)
    expect(report.steps).toHaveLength(5)
    const data = tracer.collect()
    const drops = data.timeline.events.filter((e) => e.kind === 'drop')
    expect(drops.length).toBe(1)
    expect(drops[0].id).toBe(buf.id)
    expect(data.timeline.unpairedIds).toHaveLength(0)
    expect(data.summary.alive).toBe(0)
    tracer.dispose()
  })

  it('B3 PageOwnership ctx 资源（alloc/register 混合）全量进入视图数据', () => {
    const graph = new OwnershipGraph()
    const ctx = createPageOwnership('PageB', { graph })
    ctx.alloc({ byteSize: 8 * 1024 })
    const tracer = createOwnershipTracer({ graph })
    const data = tracer.collect()
    expect(data.summary.alive).toBe(1)
    const group = data.resources.find((r) => r.owner === 'PageB')
    expect(group?.items).toHaveLength(1)
    tracer.dispose()
  })
})

describe('G-43 B4 panel 第十视图集成', () => {
  it('ownershipData 钩子 → 第十视图 nav + 渲染（本地面板通道）', async () => {
    const root = document.createElement('div')
    const bus: TraceBus = createTraceBus()
    const source = {
      onEvent: (cb: (e: unknown) => void) => bus.on(cb as never),
      close: () => {},
    } as never
    const panel = createDevtoolsPanel(root, {
      source,
      ownershipData: () => makeViewDataFixture(),
    })
    panel.show('ownership')
    await new Promise((r) => setTimeout(r, 40))
    const view = root.querySelector('.pd-view[data-view="ownership"]') as HTMLElement
    expect(view).not.toBeNull()
    expect(view.textContent).toContain('2 alive / 3 total')
    expect(view.querySelector('.pd-own-alert-orphan')).not.toBeNull()
    const nav = Array.from(root.querySelectorAll('.pd-nav-item')).map((el) => (el as HTMLElement).dataset.view)
    expect(nav).toContain('ownership')
  })

  it('无钩子无缓存 → 空态', async () => {
    const root = document.createElement('div')
    const bus: TraceBus = createTraceBus()
    const source = {
      onEvent: (cb: (e: unknown) => void) => bus.on(cb as never),
      close: () => {},
    } as never
    const panel = createDevtoolsPanel(root, { source })
    panel.show('ownership')
    await new Promise((r) => setTimeout(r, 40))
    const view = root.querySelector('.pd-view[data-view="ownership"]') as HTMLElement
    expect(view.textContent).toContain('暂无所有权数据')
  })

  it('WS 协议：bridge Proteus.ownership 响应 → source.ownership() 缓存 → 远程面板通道', () => {
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; readyState: number; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), readyState: 1, onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    sockets[0].onopen?.()
    const sends = sockets[0].send.mock.calls.map((c) => JSON.parse(c[0]))
    expect(sends[3].method).toBe('Proteus.ownership')
    // 模拟 bridge 响应（install remote → tracer.collect 闭包）
    sockets[0].onmessage?.({ data: JSON.stringify({ id: sends[3].id, result: { summary: { alive: 1, total: 1, bytesAlive: 8192, byType: {} }, diagnosis: { orphans: [], leaks: [], longBorrows: [], crossPageRefs: [] }, resources: [], timeline: { events: [], unpairedIds: [], truncated: false } } }) })
    const cached = source.ownership?.() as { summary: { alive: number } }
    expect(cached.summary.alive).toBe(1)
    source.close()
  })

  it('WS bridge：Proteus.ownership 命令 → options.ownership 上报', () => {
    const sends: Array<Record<string, unknown>> = []
    const fakeWs = {
      readyState: 1,
      send: (d: string) => {
        sends.push(JSON.parse(d))
      },
      close: () => {},
      OPEN: 1,
    } as unknown as WebSocket
    vi.stubGlobal('WebSocket', function () {
      return fakeWs
    })
    const bus = createTraceBus()
    const bridge = createTraceBusWsBridge(bus, { url: 'ws://relay', ownership: () => ({ summary: { alive: 5 } }) })
    fakeWs.onmessage?.({ data: JSON.stringify({ id: 42, method: 'Proteus.ownership' }) })
    const resp = sends.find((m) => m.id === 42)
    expect((resp?.result as { summary: { alive: number } }).summary.alive).toBe(5)
    bridge.close()
    vi.unstubAllGlobals()
  })
})
