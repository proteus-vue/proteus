// tests/devtools-panel.test.ts —— @proteus-vue/devtools（devtools-plan UI 层）
// 五视图渲染函数（时间轴泳道/火焰图/状态/路由/根因）+ 面板装配（事件流 → 视图更新 + tab 切换）+ WS 数据源（CDP Proteus.event 协议）
// ★Vue DevTools 接入：installProteusTimeline（Timeline layer + 事件映射）+ createTraceBusSource（TraceBus 直连源）
// @vitest-environment happy-dom（DOM 渲染断言）
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createDevtoolsPanel,
  createDevtoolsWsSource,
  installProteusTimeline,
  installProteusInspectors,
  createTraceBusSource,
  renderTimeline,
  renderFlamegraph,
  renderState,
  renderRoute,
  renderErrors,
  renderComponents,
  renderPages,
  renderGraph,
  installComponentTrace,
  createTooltipLayer,
  bindTooltip,
  createTimelineZoom,
  createPluginRegistry,
  createMemoryStorage,
  createCommandRegistry,
  resolveActivationOrder,
  createNetworkPlugin,
} from '@proteus-vue/devtools'
import type { DevtoolsSource } from '@proteus-vue/devtools'
import { createTraceBus } from '@proteus-vue/devtools-runtime'
import type { TraceEvent, TraceSource, TimelineSpan } from '@proteus-vue/devtools-runtime'

function ev(source: TraceSource, phase: 'start' | 'end' | 'point' | 'error', name: string, timestamp: number, traceId?: string, payload?: unknown): TraceEvent {
  return { source, phase, name, timestamp, traceId, payload }
}

function mockSource(): DevtoolsSource & { push: (e: TraceEvent) => void } {
  const handlers: Array<(e: TraceEvent) => void> = []
  return {
    onEvent: (cb) => {
      handlers.push(cb)
      return () => {
        const i = handlers.indexOf(cb)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    close: () => {
      handlers.length = 0
    },
    push: (e) => {
      for (const h of handlers) h(e)
    },
  }
}

describe('视图渲染函数', () => {
  it('renderTimeline：泳道分组 + span 线段（宽度/位置 + pending/point 类名）', () => {
    const root = document.createElement('div')
    renderTimeline(root, {
      spans: [
        { id: '1', source: 'lifecycle', name: 'boot', start: 0, end: 100, durationMs: 100, selfMs: 0, children: [], depth: 0 },
        { id: '2', source: 'router', name: 'nav', start: 10, durationMs: 0, children: [], depth: 0, pending: true },
        { id: '3', source: 'router', name: 'dot', start: 20, end: 20, durationMs: 0, children: [], depth: 0 },
      ],
    })
    const lanes = root.querySelectorAll('.pd-lane')
    expect(lanes.length).toBe(2) // lifecycle + router 两泳道
    expect(root.querySelector('.pd-lane-label')?.textContent).toBe('lifecycle')
    const spans = root.querySelectorAll('.pd-span')
    expect(spans.length).toBe(3)
    expect(spans[1].classList.contains('pd-span-pending')).toBe(true)
    expect(spans[2].classList.contains('pd-span-dot')).toBe(true)
    // hover 浮层数据（attachTip → data-tip 标记 + 耗时行）
    expect((spans[0] as HTMLElement).dataset.tip).toBeDefined()
  })

  it('renderFlamegraph：按 depth 分行堆叠 + 宽度 ∝ 耗时 + selfMs 标注', () => {
    const root = document.createElement('div')
    renderFlamegraph(root, {
      nodes: [
        { id: '1', source: 'lifecycle', name: 'boot', startMs: 0, durationMs: 100, selfMs: 30, children: [], depth: 0 },
        { id: '2', source: 'api', name: 'req', startMs: 10, durationMs: 40, selfMs: 40, children: [], depth: 1 },
      ],
    })
    const blocks = root.querySelectorAll('.pd-fg-node')
    expect(blocks.length).toBe(2)
    expect((blocks[1] as HTMLElement).style.top).toBe('22px') // depth 1 第二行
    expect(blocks[0].textContent).toContain('30ms')
    expect((blocks[0] as HTMLElement).dataset.tip).toBeDefined()
  })

  it('renderFlamegraph 对比模式：±10% 高亮（regression 红 / improvement 绿）+ 汇总列表 + 浮层 delta', () => {
    const root = document.createElement('div')
    renderFlamegraph(root, {
      nodes: [
        { id: '1', source: 'lifecycle', name: 'boot', startMs: 0, durationMs: 100, selfMs: 30, children: [], depth: 0 },
        { id: '2', source: 'api', name: 'req', startMs: 10, durationMs: 40, selfMs: 40, children: [], depth: 1 },
      ],
      compare: [
        { source: 'api', name: 'req', aMs: 20, bMs: 40, deltaPct: 100, verdict: 'regression' },
        { source: 'lifecycle', name: 'boot', aMs: 60, bMs: 30, deltaPct: -50, verdict: 'improvement' },
      ],
    })
    const reg = root.querySelector('.pd-fg-reg') as HTMLElement
    const imp = root.querySelector('.pd-fg-imp') as HTMLElement
    expect(reg).not.toBeNull()
    expect(reg.textContent).toContain('req')
    expect(imp).not.toBeNull()
    expect(imp.textContent).toContain('boot')
    // 汇总列表：标题含计数 + 行内 delta
    const cmp = root.querySelector('.pd-cmp') as HTMLElement
    expect(cmp).not.toBeNull()
    expect(cmp.querySelector('.pd-cmp-head')?.textContent).toContain('1 处回归')
    expect(cmp.querySelectorAll('.pd-cmp-row').length).toBe(2)
    expect(cmp.querySelector('.pd-cmp-regression .pd-cmp-delta')?.textContent).toContain('+100%')
  })

  it('renderState：store 列表 + inspector key-value 树 + 类型着色 + 滑块（steps > 0 时出现）', () => {
    const root = document.createElement('div')
    const onTimeTravel = vi.fn()
    renderState(
      root,
      { snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 2, label: 'x', ok: true } }] }, steps: [{ index: 0, storeId: 'cart', type: 'patch', payload: {}, timestamp: 1, before: {}, after: {} }] },
      { onTimeTravel },
    )
    expect(root.querySelector('.pd-store-head')?.textContent).toContain('cart')
    // key-value 树：键 + 类型着色值
    const kvs = root.querySelectorAll('.pd-kv')
    expect(kvs.length).toBe(4) // (root) + items + label + ok
    expect(root.querySelector('.pd-kv-key')?.textContent).toBe('(root)')
    const itemsRow = Array.from(kvs).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'items')
    expect(itemsRow?.querySelector('.pd-kv-value')?.classList.contains('pd-t-number')).toBe(true)
    const okRow = Array.from(kvs).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'ok')
    expect(okRow?.querySelector('.pd-kv-value')?.classList.contains('pd-t-boolean')).toBe(true)
    const range = root.querySelector('.pd-range') as HTMLInputElement
    expect(range).not.toBeNull()
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    expect(onTimeTravel).toHaveBeenCalledWith(0)
  })

  it('renderState：嵌套对象可折叠（点击展开子键）', () => {
    const root = document.createElement('div')
    renderState(root, {
      snapshot: { version: 1, takenAt: 1, stores: [{ id: 'user', state: { profile: { name: 'p', age: 3 } } }] },
      steps: [],
    })
    const profileRow = Array.from(root.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'profile')
    expect(profileRow?.querySelector('.pd-kv-value')?.textContent).toContain('Object')
    // 展开前子键不可见
    expect(Array.from(root.querySelectorAll('.pd-kv-key')).some((k) => k.textContent === 'name')).toBe(false)
    profileRow?.dispatchEvent(new Event('click'))
    expect(Array.from(root.querySelectorAll('.pd-kv-key')).some((k) => k.textContent === 'name')).toBe(true)
    expect(Array.from(root.querySelectorAll('.pd-kv-key')).some((k) => k.textContent === 'age')).toBe(true)
  })

  it('renderRoute：导航链 + 守卫徽章（next/redirect 类名）+ 耗时', () => {
    const root = document.createElement('div')
    renderRoute(root, {
      records: [
        {
          id: 'n1',
          from: { path: '/a' },
          to: { path: '/b' },
          guards: [
            { name: 'auth', durationMs: 5, result: 'next' },
            { name: 'perm', durationMs: 5, result: 'redirect' },
          ],
          durationMs: 10,
          traceId: 't1',
          timestamp: 1,
        },
      ],
    })
    expect(root.querySelector('.pd-route')?.textContent).toBe('/a')
    const guards = root.querySelectorAll('.pd-guard')
    expect(guards.length).toBe(2)
    expect(guards[0].classList.contains('pd-guard-next')).toBe(true)
    expect(guards[1].classList.contains('pd-guard-redirect')).toBe(true)
    expect((guards[0] as HTMLElement).dataset.tip).toBeDefined()
  })

  it('renderErrors：根因卡片（attribution + 影响 chips + 复现步骤 + 根因高亮）', () => {
    const root = document.createElement('div')
    renderErrors(root, {
      reports: [
        {
          rootCause: { source: 'api', name: 'refreshToken', timestamp: 100 },
          attribution: 'token 失效',
          chain: [
            { source: 'lifecycle', name: 'coreReady', timestamp: 90 },
            { source: 'api', name: 'refreshToken', timestamp: 100 },
          ],
          impactSources: ['lifecycle', 'api'],
          repro: ['导航 navigate /admin → 等待结果'],
        },
      ],
    })
    expect(root.querySelector('.pd-error-attr')?.textContent).toContain('token 失效')
    expect(root.querySelectorAll('.pd-chip').length).toBe(2)
    expect(root.querySelector('.pd-repro li')?.textContent).toContain('导航')
    expect(root.querySelector('.pd-chain-root')?.textContent).toBe('api.refreshToken')
  })

  it('空数据 → 显示空态文案（不误报）', () => {
    const root = document.createElement('div')
    renderErrors(root, { reports: [] })
    expect(root.querySelector('.pd-empty')?.textContent).toContain('暂无异常')
  })
})

describe('State 视图（对标 Vue DevTools Pinia 面板）', () => {
  it('store 选择器：多 store chips + 选中高亮 + 点击 → onSelectStore', () => {
    const root = document.createElement('div')
    const onSelect = vi.fn()
    renderState(
      root,
      {
        snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 2 } }, { id: 'user', state: { name: 'p' } }] },
        steps: [],
        selectedStore: 'cart',
      },
      { onSelectStore: onSelect },
    )
    const chips = root.querySelectorAll('.pd-store-chip')
    expect(chips.length).toBe(2)
    expect(chips[0].classList.contains('pd-store-chip-active')).toBe(true)
    ;(chips[1] as HTMLElement).click()
    expect(onSelect).toHaveBeenCalledWith('user')
    // 详情跟随选中 store
    expect(root.querySelector('.pd-store-head')?.textContent).toContain('cart')
  })

  it('actions 时间线：action/patch 徽章 + 名称 + 点击行 → onTimeTravel', () => {
    const root = document.createElement('div')
    const onTimeTravel = vi.fn()
    renderState(
      root,
      {
        snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 1 } }] },
        steps: [
          { index: 0, storeId: 'cart', type: 'action', payload: { id: 'cart', name: 'add' }, timestamp: 100, before: {}, after: {} },
          { index: 1, storeId: 'cart', type: 'patch', payload: { id: 'cart', items: 2 }, timestamp: 200, before: {}, after: {} },
        ],
        selectedStore: 'cart',
      },
      { onTimeTravel },
    )
    const rows = root.querySelectorAll('.pd-tl-row')
    expect(rows.length).toBe(2)
    expect(rows[0].querySelector('.pd-tl-badge')?.textContent).toBe('patch') // 倒序：最新（index 1）在上
    expect(rows[0].querySelector('.pd-tl-name')?.textContent).toBe('?')
    expect(rows[1].querySelector('.pd-tl-badge')?.textContent).toBe('action')
    expect(rows[1].querySelector('.pd-tl-name')?.textContent).toBe('add')
    ;(rows[1] as HTMLElement).click()
    expect(onTimeTravel).toHaveBeenCalledWith(0)
  })

  it('面板：store.action → 时间线（action 徽章）；store.patch → 快照 + 时间线', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('store', 'point', 'store.action', 100, undefined, { id: 'cart', name: 'add' }))
    source.push(ev('store', 'point', 'store.patch', 200, undefined, { id: 'cart', items: 2 }))
    await new Promise((r) => setTimeout(r, 40))
    panel.show('state')
    const stateView = root.querySelector('.pd-view[data-view="state"]') as HTMLElement
    expect(stateView.querySelectorAll('.pd-tl-row').length).toBe(2)
    expect(stateView.querySelector('.pd-tl-badge')?.textContent).toBe('patch') // 最新在上（patch 后到）
    expect(stateView.querySelectorAll('.pd-store-chip').length).toBe(1)
    // 快照 items 值（根行摘要之外找 items 键）
    const itemsRow = Array.from(stateView.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'items')
    expect(itemsRow?.querySelector('.pd-kv-value')?.textContent).toBe('2')
    panel.destroy()
  })
})

describe('面板装配', () => {
  it('事件流 → 时间轴视图更新 + 侧栏导航切换 + 连接状态 + destroy 清理', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    expect(root.querySelectorAll('.pd-nav-item').length).toBe(8) // timeline/flamegraph/state/route/errors/components/pages/graph
    expect(root.querySelector('.pd-header-status')?.textContent).toContain('连接中')
    // 推事件（渲染 16ms 节流）
    source.push(ev('lifecycle', 'start', 'boot', 100))
    source.push(ev('lifecycle', 'end', 'boot', 200))
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // 已连接状态（收到事件）
        expect(root.querySelector('.pd-header-status')?.textContent).toContain('已连接')
        expect(root.querySelector('.pd-dot')?.classList.contains('pd-dot-on')).toBe(true)
        // 默认 timeline 视图可见
        const timelineView = root.querySelector('.pd-view[data-view="timeline"]') as HTMLElement
        expect(timelineView.classList.contains('pd-view-active')).toBe(true)
        expect(timelineView.querySelectorAll('.pd-span').length).toBe(1)
        // 切到 errors
        panel.show('errors')
        expect((root.querySelector('.pd-view[data-view="errors"]') as HTMLElement).classList.contains('pd-view-active')).toBe(true)
        // 推 error → 根因卡片
        source.push(ev('api', 'error', 'refreshToken', 300, 't1', { status: 401 }))
        setTimeout(() => {
          const errorsView = root.querySelector('.pd-view[data-view="errors"]') as HTMLElement
          expect(errorsView.querySelector('.pd-error-attr')?.textContent).toContain('token 失效')
          panel.destroy()
          expect(root.children.length).toBe(0)
          resolve()
        }, 30)
      }, 30)
    })
  })

  it('route 视图：router nav 事件聚合为导航记录', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('router', 'start', 'navigate /admin', 1000, 't1', { from: { path: '/index' }, to: { path: '/admin' } }))
    source.push(ev('router', 'end', 'navigate /admin', 1050, 't1'))
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        panel.show('route')
        const routeView = root.querySelector('.pd-view[data-view="route"]') as HTMLElement
        expect(routeView.querySelectorAll('.pd-nav').length).toBe(1)
        expect(routeView.querySelector('.pd-nav-meta')?.textContent).toContain('50ms')
        panel.destroy()
        resolve()
      }, 30)
    })
  })

  it('火焰图对比模式：两次录制 → 汇总列表 + 回归高亮块（变慢节点标红）', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    const recBtn = root.querySelector('.pd-fg-controls .pd-btn') as HTMLButtonElement
    const flameView = root.querySelector('.pd-view[data-view="flamegraph"]') as HTMLElement
    // 第一次录制：refreshToken 200ms
    recBtn.click() // 开始
    source.push(ev('api', 'start', 'refreshToken', 1000))
    source.push(ev('api', 'end', 'refreshToken', 1200))
    recBtn.click() // 停止 → baseline
    // 第二次录制：refreshToken 400ms（变慢 → regression）
    recBtn.click() // 开始
    source.push(ev('api', 'start', 'refreshToken', 2000))
    source.push(ev('api', 'end', 'refreshToken', 2400))
    recBtn.click() // 停止 → compare vs baseline
    panel.show('flamegraph')
    expect(flameView.querySelector('.pd-cmp-head')?.textContent).toContain('1 处回归')
    const reg = flameView.querySelector('.pd-fg-reg') as HTMLElement
    expect(reg).not.toBeNull()
    expect(reg.textContent).toContain('refreshToken')
    panel.destroy()
  })
})

describe('Vue DevTools 接入：Timeline 适配器', () => {
  function mockApi() {
    const calls: Array<{ method: string; options: unknown }> = []
    return {
      calls,
      api: {
        addTimelineLayer: (options: unknown) => calls.push({ method: 'addTimelineLayer', options }),
        addTimelineEvent: (options: unknown) => calls.push({ method: 'addTimelineEvent', options }),
      },
    }
  }

  it('installProteusTimeline：注册 proteus layer + 事件映射（time/title/data/groupId）', () => {
    const { calls, api } = mockApi()
    const source = mockSource()
    const tl = installProteusTimeline(api as never, { source })
    expect(tl.layerId).toBe('proteus')
    // layer 注册
    const layer = calls[0] as { method: string; options: { id: string; label: string } }
    expect(layer.method).toBe('addTimelineLayer')
    expect(layer.options.id).toBe('proteus')
    expect(layer.options.label).toBe('Proteus')
    // 推事件 → TimelineEvent 映射
    source.push(ev('api', 'error', 'refreshToken', 1000, 't1', { status: 401 }))
    const evt = calls[1] as { method: string; options: { layerId: string; event: { time: number; title: string; data: { source: string }; groupId: string } } }
    expect(evt.method).toBe('addTimelineEvent')
    expect(evt.options.layerId).toBe('proteus')
    expect(evt.options.event.time).toBe(1000)
    expect(evt.options.event.title).toBe('api.refreshToken')
    expect(evt.options.event.data.source).toBe('api')
    expect(evt.options.event.groupId).toBe('t1') // 按 traceId 分组
    tl.dispose()
    source.push(ev('api', 'point', 'after-dispose', 2000))
    expect(calls.length).toBe(2) // dispose 后不再推送
  })

  it('无 traceId → groupId 回退为 source', () => {
    const { calls, api } = mockApi()
    const source = mockSource()
    const tl = installProteusTimeline(api as never, { source })
    source.push(ev('router', 'start', 'nav', 500))
    const evt = calls[1] as { options: { event: { groupId: string } } }
    expect(evt.options.event.groupId).toBe('router')
    tl.dispose()
  })

  it('installProteusInspectors：注册 app-config inspector + getInspectorState 当前值 + editInspectorState 回写（path → 嵌套 patch）', () => {
    let config = { app: { name: 'Demo' }, features: { glass: true } }
    const calls: Array<{ method: string; options: unknown }> = []
    const stateCbs: Array<(p: { inspectorId: string; nodeId: string; state?: Array<{ key: string; value: unknown }> }) => void> = []
    const editCbs: Array<(p: { inspectorId: string; nodeId: string; path: string[]; state: { value: unknown } }) => void> = []
    const api = {
      addInspector: (options: unknown) => calls.push({ method: 'addInspector', options }),
      on: {
        getInspectorState: (cb: never) => stateCbs.push(cb as never),
        editInspectorState: (cb: never) => editCbs.push(cb as never),
      },
    }
    const inspectors = installProteusInspectors(api as never, {
      getConfig: () => config as Record<string, unknown>,
      setConfig: (patch) => {
        config = { ...config, ...(patch as Record<string, unknown>) }
      },
    })
    // 注册
    const registered = calls[0] as { options: { id: string; label: string } }
    expect(registered.method).toBe('addInspector')
    expect(registered.options.id).toBe('proteus-app-config')
    expect(registered.options.label).toBe('App Config')
    // getInspectorState → resolved 分组
    const payload = { inspectorId: 'proteus-app-config', nodeId: 'root' }
    stateCbs[0](payload)
    expect(payload.state?.[0].key).toBe('resolved')
    expect((payload.state?.[0].value as { app: { name: string } }).app.name).toBe('Demo')
    // 非本 inspector → 不响应（state 保持 undefined）
    const otherPayload = { inspectorId: 'other', nodeId: 'root' }
    stateCbs[0](otherPayload)
    expect(otherPayload.state).toBeUndefined()
    // editInspectorState → path 构建嵌套 patch 回写
    editCbs[0]({ inspectorId: 'proteus-app-config', nodeId: 'root', path: ['app', 'name'], state: { value: 'Proteus' } })
    expect(config.app.name).toBe('Proteus')
    inspectors.dispose()
  })

  it('createTraceBusSource：TraceBus 事件 → DevtoolsSource 分发', () => {
    const bus = createTraceBus()
    bus.setEnabled(true)
    const source = createTraceBusSource(bus)
    const received: TraceEvent[] = []
    const off = source.onEvent((e) => received.push(e))
    bus.emit('lifecycle', 'point', 'boot', undefined, 't9')
    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({ source: 'lifecycle', name: 'boot', traceId: 't9' })
    off()
    bus.emit('lifecycle', 'point', 'boot-2')
    expect(received.length).toBe(1)
  })
})

describe('WS 数据源（CDP Proteus.event 协议）', () => {
  it('连接 → Proteus.enable → Proteus.event 重组 TraceEvent 分发；断线重连；close 停止', () => {
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    const received: TraceEvent[] = []
    const off = source.onEvent((e) => received.push(e))
    expect(sockets.length).toBe(1)
    sockets[0].onopen?.()
    // enable 命令发出
    expect(sockets[0].send).toHaveBeenCalledWith(JSON.stringify({ id: 1, method: 'Proteus.enable' }))
    // 收到 Proteus.event
    sockets[0].onmessage?.({
      data: JSON.stringify({ method: 'Proteus.event', params: { source: 'api', phase: 'error', name: 'timeout', payload: { status: 500 }, timestamp: 100, traceId: 't9' } }),
    })
    expect(received.length).toBe(1)
    expect(received[0]).toMatchObject({ source: 'api', phase: 'error', name: 'timeout', traceId: 't9' })
    // 非 Proteus.event 消息忽略
    sockets[0].onmessage?.({ data: JSON.stringify({ method: 'Runtime.consoleAPICalled' }) })
    expect(received.length).toBe(1)
    off()
    source.close()
  })

  it('连接后请求 Proteus.appInfo → 响应缓存 → appInfo() 返回（pages/依赖图数据源）', () => {
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    sockets[0].onopen?.()
    const sends = sockets[0].send.mock.calls.map((c) => JSON.parse(c[0]))
    expect(sends.length).toBe(2)
    expect(sends[1].method).toBe('Proteus.appInfo')
    // appInfo 命令响应（含 id 且无 method）→ 缓存
    sockets[0].onmessage?.({ data: JSON.stringify({ id: 2, result: { routes: [{ name: 'index', path: 'pages/index' }] } }) })
    expect(source.appInfo?.()).toEqual({ routes: [{ name: 'index', path: 'pages/index' }] })
    source.close()
  })
})

describe('Tooltip 浮层', () => {
  afterEach(() => {
    document.querySelectorAll('.pd-tooltip').forEach((el) => el.remove())
    vi.useRealTimers()
  })

  it('createTooltipLayer：show 渲染标题 + 详情行 + visible；hide 清空隐藏', () => {
    const layer = createTooltipLayer()
    expect(layer.visible).toBe(false)
    layer.show({ title: 'lifecycle.boot', lines: ['耗时 100ms', '阶段 completed'] }, 10, 10)
    expect(layer.visible).toBe(true)
    const tip = document.querySelector('.pd-tooltip') as HTMLElement
    expect(tip).not.toBeNull()
    expect(tip.querySelector('.pd-tooltip-title')?.textContent).toBe('lifecycle.boot')
    expect(Array.from(tip.querySelectorAll('.pd-tooltip-line')).map((l) => l.textContent)).toEqual(['耗时 100ms', '阶段 completed'])
    layer.hide()
    expect(layer.visible).toBe(false)
    expect(tip.style.display).toBe('none')
  })

  it('createTooltipLayer：视口边缘翻转（右侧放不下 → 左侧定位）', () => {
    const layer = createTooltipLayer()
    layer.show({ title: 't', lines: ['l'] }, window.innerWidth - 10, 10)
    const tip = document.querySelector('.pd-tooltip') as HTMLElement
    expect(parseFloat(tip.style.left)).toBeLessThan(window.innerWidth - 10)
    layer.hide()
  })

  it('bindTooltip：150ms 防抖（快速划过不显示）+ resolve null 不显示 + 解绑后不触发', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const el = document.createElement('div')
    el.dataset.tip = ''
    el.textContent = 'boot'
    root.appendChild(el)
    const nullEl = document.createElement('div')
    nullEl.dataset.tip = ''
    nullEl.textContent = 'skip'
    root.appendChild(nullEl)
    const layer = createTooltipLayer()
    const resolve = vi.fn((t: HTMLElement) => (t.textContent === 'skip' ? null : { title: 'hit', lines: [t.textContent ?? ''] }))
    const unbind = bindTooltip(root, layer, resolve)
    // 快速划过：150ms 内移出 → 不显示
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 }))
    root.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    vi.advanceTimersByTime(200)
    expect(layer.visible).toBe(false)
    // resolve null → 不显示
    nullEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 }))
    vi.advanceTimersByTime(200)
    expect(layer.visible).toBe(false)
    // 稳定 hover 150ms → 显示
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }))
    vi.advanceTimersByTime(150)
    expect(resolve).toHaveBeenCalled()
    expect(layer.visible).toBe(true)
    expect(document.querySelector('.pd-tooltip-title')?.textContent).toBe('hit')
    // 解绑后不再触发
    unbind()
    layer.hide()
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 20, clientY: 20 }))
    vi.advanceTimersByTime(200)
    expect(layer.visible).toBe(false)
    root.remove()
  })

  it('面板：hover timeline span → tooltip 显示事件详情（attachTip 数据贯通）', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('lifecycle', 'start', 'boot', 100))
    source.push(ev('lifecycle', 'end', 'boot', 200))
    vi.advanceTimersByTime(40) // 16ms 节流渲染
    const span = root.querySelector('.pd-span') as HTMLElement
    expect(span).not.toBeNull()
    expect(span.dataset.tip).toBeDefined()
    span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 10, clientY: 10 }))
    vi.advanceTimersByTime(200)
    expect(document.querySelector('.pd-tooltip-title')?.textContent).toBe('lifecycle.boot')
    expect(document.querySelector('.pd-tooltip-line')?.textContent).toBe('耗时 100ms')
    panel.destroy()
    root.remove()
  })
})

describe('Timeline 缩放/平移交互', () => {
  const rect = { left: 0, top: 0, width: 400, height: 22 }

  function setup() {
    const container = document.createElement('div')
    Object.defineProperty(container, 'getBoundingClientRect', { value: () => rect, configurable: true })
    const spans: TimelineSpan[] = [
      { id: '1', source: 'lifecycle', name: 'boot', start: 0, end: 100, durationMs: 100, selfMs: 0, children: [], depth: 0 },
      { id: '2', source: 'router', name: 'nav', start: 200, end: 300, durationMs: 100, selfMs: 0, children: [], depth: 0 },
    ]
    const changes: Array<{ start: number; end: number }> = []
    const zoom = createTimelineZoom(container, () => spans, { onWindowChange: (w) => changes.push(w) })
    return { container, spans, changes, zoom }
  }

  it('wheel 上滚 → 以光标为锚点缩小窗口（锚点时刻保持）', () => {
    const { container, changes, zoom } = setup()
    // 光标在 50%（clientX=200/宽 400）放大：全窗 0~300 → 250 宽，锚点 150 保持
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 10, bubbles: true, cancelable: true }))
    expect(changes.length).toBe(1)
    const w = zoom.getWindow() as { start: number; end: number }
    expect(w.end - w.start).toBeCloseTo(300 / 1.2, 5)
    expect(w.start + (w.end - w.start) * 0.5).toBeCloseTo(150, 5)
  })

  it('全窗时下滚缩小 → 钳制回全窗（不越界）', () => {
    const { container, zoom } = setup()
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 200, clientY: 10, bubbles: true, cancelable: true }))
    const w = zoom.getWindow() as { start: number; end: number }
    expect(w.start).toBe(0)
    expect(w.end).toBe(300)
  })

  it('拖拽平移：左拖（看更晚）→ 窗口右移', () => {
    const { container, zoom } = setup()
    // 先放大两次留出平移空间：300/1.2/1.2 ≈ 208.33，窗 45.83~254.17
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: 200, clientY: 10, bubbles: true, cancelable: true }))
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: 200, clientY: 10, bubbles: true, cancelable: true }))
    const before = zoom.getWindow() as { start: number; end: number }
    // 左拖 40px → 时间窗口向晚（start 增大）
    container.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 200, clientY: 10, bubbles: true }))
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 160, clientY: 10, bubbles: true }))
    container.dispatchEvent(new MouseEvent('mouseup', { clientX: 160, clientY: 10, bubbles: true }))
    const after = zoom.getWindow() as { start: number; end: number }
    const span = before.end - before.start
    expect(after.start).toBeCloseTo(before.start + (40 / 400) * span, 5)
  })

  it('双击 → 重置回全窗', () => {
    const { container, zoom } = setup()
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: 200, clientY: 10, bubbles: true, cancelable: true }))
    expect((zoom.getWindow() as { end: number }).end).toBeLessThan(300)
    container.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    const w = zoom.getWindow() as { start: number; end: number }
    expect(w.start).toBe(0)
    expect(w.end).toBe(300)
  })

  it('destroy 解绑监听：此后 wheel 不再变更窗口', () => {
    const { container, changes, zoom } = setup()
    zoom.destroy()
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 10, bubbles: true, cancelable: true }))
    expect(zoom.getWindow()).toBeNull()
    expect(changes.length).toBe(0)
  })
  it('renderTimeline 虚拟滚动：spacer 总高 + 仅视口内泳道分块渲染（万级 span 场景）', () => {
    const root = document.createElement('div')
    const spans: TimelineSpan[] = []
    for (let i = 0; i < 50; i++) {
      spans.push({ id: String(i), source: 'src' + i, name: 'evt' + i, start: i * 100, end: i * 100 + 50, durationMs: 50, selfMs: 0, children: [], depth: 0 })
    }
    renderTimeline(root, { spans, virtual: { scrollTop: 0, viewHeight: 300 } })
    const spacer = root.querySelector('.pd-timeline-spacer') as HTMLElement
    expect(spacer).not.toBeNull()
    expect(spacer.style.height).toBe(50 * 26 + 'px') // 1300px 总高
    // 300px 视口 + 2 泳道 overscan → 14 条泳道（远小于 50）
    const lanes = root.querySelectorAll('.pd-lane')
    expect(lanes.length).toBe(14)
    expect((lanes[0] as HTMLElement).style.position).toBe('absolute')
    expect((lanes[0] as HTMLElement).style.top).toBe('0px')
  })

  it('renderTimeline 虚拟滚动：scrollTop 变化 → 渲染不同分块（滚动换页）', () => {
    const root = document.createElement('div')
    const spans: TimelineSpan[] = []
    for (let i = 0; i < 50; i++) {
      spans.push({ id: String(i), source: 'src' + i, name: 'evt' + i, start: i * 100, end: i * 100 + 50, durationMs: 50, selfMs: 0, children: [], depth: 0 })
    }
    renderTimeline(root, { spans, virtual: { scrollTop: 0, viewHeight: 300 } })
    const first = root.querySelector('.pd-lane-label')?.textContent
    // 滚到第 30 行附近（scrollTop = 26*30）
    renderTimeline(root, { spans, virtual: { scrollTop: 780, viewHeight: 300 } })
    const labels = Array.from(root.querySelectorAll('.pd-lane-label')).map((l) => l.textContent)
    expect(labels).not.toContain(first)
    expect(labels[0]).toBe('src28') // startIdx = floor((780-52)/26) = 28
  })
})

describe('Timeline 窗口过滤', () => {
  it('renderTimeline 提供 window → 只渲染相交 span（缩放场景不渲染窗口外）', () => {
    const root = document.createElement('div')
    renderTimeline(root, {
      spans: [
        { id: '1', source: 'lifecycle', name: 'boot', start: 0, end: 100, durationMs: 100, selfMs: 0, children: [], depth: 0 },
        { id: '2', source: 'router', name: 'nav', start: 200, end: 300, durationMs: 100, selfMs: 0, children: [], depth: 0 },
      ],
      window: { start: 150, end: 350 },
    })
    const spans = root.querySelectorAll('.pd-span')
    expect(spans.length).toBe(1)
    expect(spans[0].textContent).toContain('nav')
    // 刻度尺仍按窗口渲染
    expect(root.querySelectorAll('.pd-ruler > span').length).toBe(5)
  })
})

describe('M9 插件机制', () => {
  function ctxOf(p: { name: string; setup: (c: { bus: { on: (cb: (e: never) => void) => () => void }; panel: { addView: (id: string, o: { label: string; render: () => void }) => void }; commands: ReturnType<typeof createCommandRegistry>; storage: ReturnType<typeof createMemoryStorage> }) => void }) {
    return {
      name: p.name,
      bus: { on: () => () => {} },
      panel: { addView: () => {} },
      commands: createCommandRegistry(),
      storage: createMemoryStorage(),
    }
  }

  it('resolveActivationOrder：依赖拓扑排序 + 独立插件；循环依赖返回环路径', () => {
    const a = { name: 'a', version: '1', peerDependencies: ['b'], setup: () => {} }
    const b = { name: 'b', version: '1', setup: () => {} }
    const c = { name: 'c', version: '1', setup: () => {} }
    expect(resolveActivationOrder([a, b, c]).order).toEqual(['b', 'c', 'a']) // 依赖先激活
    const x = { name: 'x', version: '1', peerDependencies: ['y'], setup: () => {} }
    const y = { name: 'y', version: '1', peerDependencies: ['z'], setup: () => {} }
    const z = { name: 'z', version: '1', peerDependencies: ['x'], setup: () => {} }
    const res = resolveActivationOrder([x, y, z])
    expect(res.cycle).toEqual(['x', 'y', 'z', 'x']) // 环路径报错提示
  })

  it('PluginRegistry：拓扑激活 + 崩溃隔离（setup 抛错 → crashed，其余 active）', async () => {
    const order: string[] = []
    const good = { name: 'good', version: '1', peerDependencies: ['dep'], setup: () => void order.push('good') }
    const bad = { name: 'bad', version: '1', setup: () => { order.push('bad'); throw new Error('boom') } }
    const dep = { name: 'dep', version: '1', setup: () => void order.push('dep') }
    const registry = createPluginRegistry([good, bad, dep])
    const entries = await registry.activateAll(ctxOf as never)
    expect(order.indexOf('dep')).toBeLessThan(order.indexOf('good')) // 依赖先激活
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]))
    expect(byName.good.status).toBe('active')
    expect(byName.dep.status).toBe('active')
    expect(byName.bad.status).toBe('crashed')
    expect(byName.bad.error).toBe('boom')
  })

  it('面板 M9：插件 addView 注册侧栏项 + 事件流入（network 瀑布渲染耗时）', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source, plugins: [createNetworkPlugin()] })
    await new Promise((r) => setTimeout(r, 40)) // 激活 + 渲染
    const nav = Array.from(root.querySelectorAll('.pd-nav-item')).map((el) => (el as HTMLElement).dataset.view)
    expect(nav).toContain('network')
    panel.show('network')
    source.push(ev('api', 'start', 'fetchOrder', 1000, 't1'))
    source.push(ev('api', 'end', 'fetchOrder', 1200, 't1'))
    await new Promise((r) => setTimeout(r, 40))
    const netView = root.querySelector('.pd-view[data-view="network"]') as HTMLElement
    expect(netView.querySelectorAll('.pd-net-row').length).toBe(1)
    expect(netView.querySelector('.pd-net-meta')?.textContent).toContain('200ms')
    panel.destroy()
  })

  it('面板 M9：插件 render 抛错 → 崩溃占位 + 核心视图不受影响', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const boom = {
      name: 'boom-view',
      version: '1',
      setup(ctx: { panel: { addView: (id: string, o: { label: string; render: () => void }) => void } }) {
        ctx.panel.addView('boom', {
          label: 'boom',
          render: () => {
            throw new Error('render boom')
          },
        })
      },
    }
    const panel = createDevtoolsPanel(root, { source, plugins: [boom as never] })
    await new Promise((r) => setTimeout(r, 40))
    panel.show('boom')
    await new Promise((r) => setTimeout(r, 40)) // rerender → render 抛错 → 崩溃占位
    expect(root.querySelector('.pd-plugin-crash')?.textContent).toContain('render boom')
    // 核心仍工作：timeline 视图正常（start+end 配对成 span）
    panel.show('timeline')
    source.push(ev('lifecycle', 'start', 'boot', 100))
    source.push(ev('lifecycle', 'end', 'boot', 200))
    await new Promise((r) => setTimeout(r, 40))
    expect(root.querySelector('.pd-span')?.textContent).toContain('boot')
    panel.destroy()
  })

  it('面板 M9：插件事件回调抛错 → 崩溃 + 订阅卸载（后续事件不抛，核心继续）', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const badcb = {
      name: 'bad-cb',
      version: '1',
      setup(ctx: { panel: { addView: (id: string, o: { label: string; render: (c: HTMLElement) => void }) => void }; bus: { on: (cb: (e: never) => void) => () => void } }) {
        ctx.panel.addView('badcb', { label: 'badcb', render: (c) => { c.textContent = 'ok' } })
        ctx.bus.on(() => {
          throw new Error('cb boom')
        })
      },
    }
    const panel = createDevtoolsPanel(root, { source, plugins: [badcb as never] })
    await new Promise((r) => setTimeout(r, 40))
    panel.show('badcb')
    source.push(ev('lifecycle', 'point', 'boot', 100)) // 触发回调 → 崩溃 + 卸载
    await new Promise((r) => setTimeout(r, 40))
    expect(root.querySelector('.pd-plugin-crash')?.textContent).toContain('cb boom')
    // 订阅已卸载：再推事件不崩溃，核心视图照常更新
    source.push(ev('lifecycle', 'point', 'boot2', 200))
    await new Promise((r) => setTimeout(r, 40))
    expect(root.querySelectorAll('.pd-span').length).toBeGreaterThanOrEqual(2)
    panel.destroy()
  })

  it('面板 M9：插件注册命令 → ⚡ 面板列出并执行；KV 存储读写', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const run = vi.fn()
    const storage = createMemoryStorage()
    const plugin = {
      name: 'cmds',
      version: '1',
      setup(ctx: { commands: ReturnType<typeof createCommandRegistry>; storage: ReturnType<typeof createMemoryStorage> }) {
        ctx.commands.register('proteus.test.cmd', () => run('proteus.test.cmd'))
        ctx.storage.set('k', 42)
      },
    }
    const panel = createDevtoolsPanel(root, { source, plugins: [plugin as never], storage })
    await new Promise((r) => setTimeout(r, 40))
    const btn = root.querySelector('.pd-palette-btn') as HTMLButtonElement
    btn.click()
    const items = Array.from(root.querySelectorAll('.pd-palette-item'))
    expect(items.length).toBe(1)
    expect(items[0].textContent).toBe('proteus.test.cmd')
    ;(items[0] as HTMLElement).click()
    expect(run).toHaveBeenCalledWith('proteus.test.cmd')
    expect(storage.get('k')).toBe(42)
    panel.destroy()
  })
})

describe('Components / Pages / Graph 视图', () => {
  it('renderComponents：parent 关联构建树 + 折叠（点击子行不冒泡触发父折叠）', () => {
    const root = document.createElement('div')
    renderComponents(root, {
      nodes: [
        { id: 1, name: 'App', ts: 1, count: 1 },
        { id: 2, name: 'Home', parentId: 1, ts: 2, count: 1 },
        { id: 3, name: 'Card', parentId: 2, ts: 3, count: 2 },
      ],
    })
    const rows = root.querySelectorAll('.pd-cmp-row')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('App')
    expect(rows[1].textContent).toContain('Home')
    expect(rows[2].textContent).toContain('×2') // 计数
    // 子行缩进（depth 1 → paddingLeft 22px）
    expect((rows[1] as HTMLElement).style.paddingLeft).toBe('22px')
    // 折叠根：点击子行 → 不触发父折叠（closest 判定）；点击根行 → 子层隐藏
    ;(rows[1] as HTMLElement).click()
    const subEl = (rows[0] as HTMLElement).querySelector('.pd-cmp-children') as HTMLElement
    expect(subEl.childNodes.length).toBeGreaterThan(0)
    ;(rows[0] as HTMLElement).click()
    expect(subEl.style.display).toBe('none')
    ;(rows[0] as HTMLElement).click()
    expect(subEl.style.display).toBe('block')
  })

  it('renderPages：主包/分包分组 + tab 标记 + 页面栈高亮', () => {
    const root = document.createElement('div')
    renderPages(root, {
      routes: [
        { name: 'index', path: 'pages/index', meta: { isTab: true, title: '首页' } },
        { name: 'order-list', path: 'subpackages/order/pages/list', subPackage: 'order' },
      ],
      stack: [{ route: 'pages/index' }],
    })
    expect(root.querySelector('.pd-page-stack')?.textContent).toContain('页面栈')
    expect(root.querySelector('.pd-page-current')?.textContent).toContain('pages/index')
    expect(root.querySelectorAll('.pd-page-group').length).toBe(2) // 主包 + 分包
    const metaTexts = Array.from(root.querySelectorAll('.pd-page-meta')).map((el) => el.textContent)
    expect(metaTexts.some((t) => t?.includes('tab'))).toBe(true)
  })

  it('renderGraph：路由父子树（字符线 + 根/子 + 分包标记）', () => {
    const root = document.createElement('div')
    renderGraph(root, {
      routes: [
        { name: 'index', path: 'pages/index' },
        { name: 'user', path: 'pages/user/index', parent: 'index' },
        { name: 'user-profile', path: 'pages/user/profile', parent: 'user', subPackage: 'order' },
      ],
    })
    const nodes = root.querySelectorAll('.pd-graph-node')
    expect(nodes.length).toBe(3)
    expect(root.querySelector('.pd-graph-line')?.textContent).toContain('└─') // 单根行
    expect(nodes[1].textContent).toContain('user')
    const metas = Array.from(root.querySelectorAll('.pd-graph-meta')).map((el) => el.textContent)
    expect(metas.some((m) => m?.includes('分包 order'))).toBe(true)
  })

  it('面板：component 事件聚合 → components 树（mount/unmount）', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('component', 'point', 'component.mount', 100, 'comp-1', { id: 1, name: 'App', parentId: undefined }))
    source.push(ev('component', 'point', 'component.mount', 110, 'comp-2', { id: 2, name: 'Home', parentId: 1 }))
    await new Promise((r) => setTimeout(r, 40))
    panel.show('components')
    const componentsView = root.querySelector('.pd-view[data-view="components"]') as HTMLElement
    expect(componentsView.querySelectorAll('.pd-cmp-row').length).toBe(2)
    // unmount → 移除节点
    source.push(ev('component', 'point', 'component.unmount', 120, 'comp-2', { id: 2 }))
    await new Promise((r) => setTimeout(r, 40))
    expect(componentsView.querySelectorAll('.pd-cmp-row').length).toBe(1)
    panel.destroy()
  })

  it('面板：pages 注入 → pages 清单 + graph 依赖树渲染', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, {
      source,
      pages: {
        routes: [
          { name: 'index', path: 'pages/index', meta: { isTab: true } },
          { name: 'user', path: 'pages/user/index', parent: 'index' },
        ],
      },
    })
    await new Promise((r) => setTimeout(r, 40))
    panel.show('pages')
    const pagesView = root.querySelector('.pd-view[data-view="pages"]') as HTMLElement
    expect(pagesView.querySelectorAll('.pd-page-row').length).toBeGreaterThan(0)
    panel.show('graph')
    const graphView = root.querySelector('.pd-view[data-view="graph"]') as HTMLElement
    expect(graphView.querySelectorAll('.pd-graph-node').length).toBe(2)
    panel.destroy()
  })

  it('installComponentTrace：mixin 挂载/卸载 → component 事件（id 稳定 + parentId 关联）', async () => {
    const { createApp, defineComponent } = await import('vue')
    const bus = createTraceBus({ enabled: true })
    const events: unknown[] = []
    const off = bus.on((e) => events.push(e))
    const app = createApp(defineComponent({ name: 'Root', template: '<div><Child/></div>' }))
    installComponentTrace(app, bus)
    app.component('Child', defineComponent({ name: 'Child', template: '<span/>' }))
    app.mount(document.createElement('div'))
    await new Promise((r) => setTimeout(r, 20))
    app.unmount()
    await new Promise((r) => setTimeout(r, 20))
    const mounts = events.filter((e) => (e as { name: string }).name === 'component.mount')
    expect(mounts.length).toBeGreaterThanOrEqual(2)
    // ★Vue 挂载深度优先（子先）→ 用 find 定位而非顺序
    const rootMount = mounts.find((m) => (m as { payload: { name: string } }).payload.name === 'Root') as { payload: { id: number; name: string; parentId?: number } }
    expect(rootMount.payload.name).toBe('Root')
    const child = mounts.find((m) => (m as { payload: { name: string } }).payload.name === 'Child') as { payload: { id: number; parentId?: number } }
    expect(child.payload.parentId).toBe(rootMount.payload.id) // parentId 关联根
    expect(events.some((e) => (e as { name: string }).name === 'component.unmount')).toBe(true)
    off()
  })
})
