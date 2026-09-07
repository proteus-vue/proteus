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
  PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR,
  renderTimeline,
  renderFlamegraph,
  renderState,
  renderRoute,
  renderErrors,
  renderComponents,
  renderPages,
  renderGraph,
  renderDevice,
  detectRuntimePlatform,
  detectBrowserVersion,
  detectMpLibVersion,
  installComponentTrace,
  createTooltipLayer,
  bindTooltip,
  createTimelineZoom,
  createPluginRegistry,
  createMemoryStorage,
  createCommandRegistry,
  resolveActivationOrder,
  createNetworkPlugin,
  serializeStoreSnapshot,
  parseStoreSnapshot,
  findSensitiveKeys,
  serializeSession,
  parseSession,
  buildDomTree,
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
  it('renderDevice：★M8 概览卡片 + 能力表格 + 内存曲线；空态；字段缺失防御', () => {
    // 完整数据：平台卡 + UA + 能力表（✅/❌ + 标注）+ 内存曲线（采样柱）
    const root = document.createElement('div')
    renderDevice(root, {
      info: {
        platform: 'web',
        userAgent: 'Mozilla/5.0 Test UA',
        screen: { dpr: 2, width: 375, height: 812, safeBottom: 34 },
        memory: { jsHeapLimit: 2172649472, totalJSHeapSize: 10485760, usedJSHeapSize: 5242880 },
        capabilities: [
          { capability: 'clipboard', platform: 'web', priority: 1, required: true, fallback: 'share', supported: true, runsInWorklet: true, platforms: ['web', 'skyline'] },
          { capability: 'worklet-anim', platform: 'web', priority: 0, required: false, supported: false, platforms: ['skyline'] },
        ],
      },
      memory: [
        { t: 1, used: 5242880, total: 10485760, limit: 2172649472 },
        { t: 2, used: 6291456, total: 12582912, limit: 2172649472 },
      ],
    })
    // 概览卡：平台 + 基础库 + 屏幕 + JS 堆（内存信息存在时）
    const cards = root.querySelectorAll('.pd-dev-card')
    expect(cards.length).toBe(4)
    expect(cards[0].textContent).toContain('web')
    expect(cards[2].textContent).toContain('375×812 @2x')
    expect(cards[3].textContent).toContain('5.0 MB')
    // ★内存利用率按 used/total（1 位小数——防 used/limit 大分母四舍五入成 0%）
    expect(cards[3].textContent).toContain('50.0% 已用')
    expect(root.querySelector('.pd-dev-ua')?.textContent).toContain('Test UA')
    // 能力表：✅/❌ + 标注（required/fallback/worklet/平台覆盖）
    const capRows = root.querySelectorAll('.pd-dev-cap')
    expect(capRows.length).toBe(2)
    expect(capRows[0].classList.contains('pd-dev-cap-ok')).toBe(true)
    expect(capRows[0].textContent).toContain('clipboard')
    expect(capRows[0].textContent).toContain('required')
    expect(capRows[0].textContent).toContain('→ share')
    expect(capRows[0].textContent).toContain('worklet')
    expect(capRows[1].classList.contains('pd-dev-cap-no')).toBe(true)
    // 内存曲线：采样柱 + 最新统计
    expect(root.querySelectorAll('.pd-dev-mem-col').length).toBe(2)
    expect(root.querySelector('.pd-dev-mem-stat')?.textContent).toContain('6.0 MB')
    // 空态
    const empty = document.createElement('div')
    renderDevice(empty, { memory: [] })
    expect(empty.querySelector('.pd-empty')).not.toBeNull()
    // ★字段缺失防御（远程桥未配置钩子返回 {} 不崩溃）
    const partial = document.createElement('div')
    renderDevice(partial, { info: {} as never, memory: [] })
    expect(partial.querySelector('.pd-dev-cap')).toBeNull()
  })

  it('★M8 平台/基础库检测：detectRuntimePlatform 优先 window（web 模拟层注册 wx 也不误判 skyline）+ detectBrowserVersion/detectMpLibVersion', () => {
    // ★用户实测回归：@proteus-vue/web 小程序语义模拟层注册 wx 全局 → detectPlatform 误判 skyline；window 存在 → 必须 web
    vi.stubGlobal('wx', { setStorageSync: () => {} })
    expect(detectRuntimePlatform()).toBe('web')
    vi.unstubAllGlobals()
    // 浏览器内核版本（web 基础库降级展示）
    expect(detectBrowserVersion('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36')).toBe('Chrome 126.0.0.0')
    expect(detectBrowserVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X) Gecko/20100101 Firefox/127.0')).toBe('Firefox 127.0')
    expect(detectBrowserVersion(undefined)).toBeUndefined()
    expect(detectBrowserVersion('curl/8.0')).toBeUndefined()
    // 小程序基础库（wx SDKVersion）
    expect(detectMpLibVersion({ getAppBaseInfo: () => ({ SDKVersion: '3.2.0' }) })).toBe('3.2.0')
    expect(detectMpLibVersion({ getSystemInfoSync: () => ({ SDKVersion: '3.1.5' }) })).toBe('3.1.5')
    expect(detectMpLibVersion({})).toBeUndefined()
  })

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

  it('renderFlamegraph：★嵌套堆叠（子块画在父块内相对定位）+ source 配色 + selfMs 标注', () => {
    const root = document.createElement('div')
    renderFlamegraph(root, {
      nodes: [
        {
          id: '1', source: 'lifecycle', name: 'boot', startMs: 0, durationMs: 100, selfMs: 30, depth: 0,
          children: [{ id: '2', source: 'api', name: 'req', startMs: 10, durationMs: 40, selfMs: 40, depth: 1, children: [] }],
        },
      ],
    })
    const blocks = root.querySelectorAll('.pd-fg-node')
    expect(blocks.length).toBe(2)
    // 根：占满窗口（0-100ms）
    expect((blocks[0] as HTMLElement).style.left).toBe('0.00%')
    expect((blocks[0] as HTMLElement).style.width).toBe('100.00%')
    // ★子块相对父定位（left 10/100=10%、宽 40/100=40%）→ 经典火焰图嵌套堆叠；子容器存在（下一行）
    expect((blocks[1] as HTMLElement).style.left).toBe('10.00%')
    expect((blocks[1] as HTMLElement).style.width).toBe('40.00%')
    expect(root.querySelector('.pd-fg-children')).not.toBeNull()
    expect(blocks[0].textContent).toContain('30ms')
    expect((blocks[0] as HTMLElement).dataset.tip).toBeDefined()
  })

  it('renderFlamegraph：★合成「录制会话」根——顶层多根（顺序不重叠）也呈堆叠：会话宽块在下层操作', () => {
    const root = document.createElement('div')
    renderFlamegraph(root, {
      nodes: [
        { id: '1', source: 'router', name: 'navigate /user', startMs: 0, durationMs: 30, selfMs: 30, children: [], depth: 0 },
        { id: '2', source: 'api', name: 'GET /list', startMs: 40, durationMs: 20, selfMs: 20, children: [], depth: 0 },
      ],
    })
    const blocks = root.querySelectorAll('.pd-fg-node')
    // 会话根 + 两个真实操作
    expect(blocks.length).toBe(3)
    const session = blocks[0] as HTMLElement
    expect(session.classList.contains('pd-fg-session')).toBe(true)
    expect(session.textContent).toContain('录制会话')
    // 会话宽块 = 整个录制窗口（0-60ms）
    expect(session.style.left).toBe('0.00%')
    expect(session.style.width).toBe('100.00%')
    // 真实操作成为会话根子块：子容器在会话块下方（堆叠），相对会话定位
    const childrenBox = session.parentElement?.querySelector('.pd-fg-children')
    expect(childrenBox).not.toBeNull()
    expect(blocks[1].textContent).toContain('navigate /user')
    expect(blocks[2].textContent).toContain('GET /list')
    // 会话根不可聚焦（无真实数据 id）
    const onFocus = vi.fn()
    const root2 = document.createElement('div')
    renderFlamegraph(
      root2,
      {
        nodes: [
          { id: '1', source: 'router', name: 'navigate /user', startMs: 0, durationMs: 30, selfMs: 30, children: [], depth: 0 },
          { id: '2', source: 'api', name: 'GET /list', startMs: 40, durationMs: 20, selfMs: 20, children: [], depth: 0 },
        ],
      },
      { onFocus },
    )
    const session2 = root2.querySelector('.pd-fg-session') as HTMLElement
    session2.click()
    expect(onFocus).not.toHaveBeenCalled()
    // 点真实操作仍可聚焦
    const real = root2.querySelectorAll('.pd-fg-node')[1] as HTMLElement
    real.click()
    expect(onFocus).toHaveBeenCalledWith('1')
    // 聚焦（zoom）时渲染真实子树不加会话包装
    const root3 = document.createElement('div')
    renderFlamegraph(
      root3,
      {
        nodes: [
          { id: '1', source: 'router', name: 'navigate /user', startMs: 0, durationMs: 30, selfMs: 30, children: [], depth: 0 },
        ],
        focus: { id: '1', source: 'router', name: 'navigate /user', startMs: 0, durationMs: 30, selfMs: 30, children: [], depth: 0 },
        breadcrumb: [{ id: '1', name: 'router.navigate /user' }],
      },
    )
    expect(root3.querySelector('.pd-fg-session')).toBeNull()
    expect(root3.querySelectorAll('.pd-fg-node').length).toBe(1)
  })

  it('renderFlamegraph：★点击块 → onFocus（聚焦缩放）；focus 子树渲染 + 面包屑 + 返回上级', () => {
    const tree = {
      id: '1', source: 'lifecycle', name: 'boot', startMs: 0, durationMs: 100, selfMs: 30, depth: 0,
      children: [{ id: '2', source: 'api', name: 'req', startMs: 10, durationMs: 40, selfMs: 40, depth: 1, children: [] }],
    }
    const root = document.createElement('div')
    const onFocus = vi.fn()
    const onFocusUp = vi.fn()
    renderFlamegraph(root, { nodes: [tree] }, { onFocus, onFocusUp })
    // 点击子块 → onFocus(子 id)
    const blocks = root.querySelectorAll('.pd-fg-node')
    ;(blocks[1] as HTMLElement).click()
    expect(onFocus).toHaveBeenCalledWith('2')
    // 聚焦渲染：只渲染焦点子树 + 面包屑（祖先链）+ 返回上级
    const root2 = document.createElement('div')
    renderFlamegraph(
      root2,
      {
        nodes: [tree],
        focus: tree.children[0],
        breadcrumb: [
          { id: '1', name: 'lifecycle.boot' },
          { id: '2', name: 'api.req' },
        ],
      },
      { onFocus, onFocusUp },
    )
    expect(root2.querySelectorAll('.pd-fg-node').length).toBe(1) // 焦点子树只剩 req
    const crumb = root2.querySelector('.pd-fg-crumb') as HTMLElement
    expect(crumb.textContent).toContain('api.req')
    ;(root2.querySelector('.pd-fg-up') as HTMLElement).click()
    expect(onFocusUp).toHaveBeenCalled()
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
    // ★拖动（input）只更新提示不触发恢复；释放（change）才触发一次
    range.value = '0'
    range.dispatchEvent(new Event('input'))
    expect(onTimeTravel).not.toHaveBeenCalled()
    range.dispatchEvent(new Event('change'))
    expect(onTimeTravel).toHaveBeenCalledTimes(1)
    expect(onTimeTravel).toHaveBeenCalledWith(0)
    // ★travelIndex → 滑块初始位置（rerender 后保持）
    const root2 = document.createElement('div')
    renderState(
      root2,
      {
        snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 2 } }] },
        steps: [
          { index: 0, storeId: 'cart', type: 'patch', payload: {}, timestamp: 1, before: {}, after: {} },
          { index: 1, storeId: 'cart', type: 'patch', payload: {}, timestamp: 2, before: {}, after: {} },
        ],
        travelIndex: 0,
      },
    )
    expect((root2.querySelector('.pd-range') as HTMLInputElement).value).toBe('0')
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

  it('renderState：★双向调试值编辑——点值 → 输入 → Enter 提交（storeId + path + value）；非法输入还原', () => {
    const onEditValue = vi.fn()
    const root = document.createElement('div')
    renderState(
      root,
      { snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 2, label: 'x', profile: { name: 'p' } } }] }, steps: [] },
      { onEditValue },
    )
    const itemsRow = Array.from(root.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'items') as HTMLElement
    // 可编辑标记（有钩子才可点）
    expect(itemsRow.querySelector('.pd-kv-value')?.classList.contains('pd-kv-editable')).toBe(true)
    // 点值 → 输入框（值去引号：number → '2'）
    ;(itemsRow.querySelector('.pd-kv-value') as HTMLElement).click()
    const input = root.querySelector('.pd-kv-edit') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('2')
    // 改 2 → 3 → Enter 提交：storeId + path + 解析后值
    input.value = '3'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onEditValue).toHaveBeenCalledWith('cart', ['items'], 3)
    // 嵌套路径：profile.name（展开后点值编辑 → path 含父链）
    const profileRow = Array.from(root.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'profile') as HTMLElement
    profileRow.dispatchEvent(new Event('click'))
    const nameRow = Array.from(root.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'name') as HTMLElement
    ;(nameRow.querySelector('.pd-kv-value') as HTMLElement).click()
    const input2 = root.querySelector('.pd-kv-edit') as HTMLInputElement
    input2.value = 'q'
    input2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onEditValue).toHaveBeenCalledWith('cart', ['profile', 'name'], 'q')
    // 非法 number 输入 → 还原（输入框消失，不回调）
    ;(itemsRow.querySelector('.pd-kv-value') as HTMLElement).click()
    const input3 = root.querySelector('.pd-kv-edit') as HTMLInputElement
    input3.value = 'abc'
    input3.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onEditValue).toHaveBeenCalledTimes(2) // 无第三次
    expect(root.querySelector('.pd-kv-edit')).toBeNull()
    // Esc 取消同样还原
    ;(itemsRow.querySelector('.pd-kv-value') as HTMLElement).click()
    const input4 = root.querySelector('.pd-kv-edit') as HTMLInputElement
    input4.value = '99'
    input4.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onEditValue).toHaveBeenCalledTimes(2)
    expect(root.querySelector('.pd-kv-edit')).toBeNull()
    // 无钩子 → 不可编辑（components 等只读场景）
    const root2 = document.createElement('div')
    renderState(root2, { snapshot: { version: 1, takenAt: 1, stores: [{ id: 'cart', state: { items: 2 } }] }, steps: [] })
    expect(root2.querySelector('.pd-kv-value')?.classList.contains('pd-kv-editable')).toBe(false)
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

  it('★P0 导出：store.patch 快照（去 id 键）→ exportSnapshot 序列化 stores/steps（Blob 下载）', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('store', 'point', 'store.patch', 100, undefined, { id: 'cart', items: 1, user: { name: 'p' } }))
    await new Promise((r) => setTimeout(r, 40))
    const json = JSON.parse(panel.exportSnapshot())
    expect(json.kind).toBe('proteus-store-snapshot')
    expect(json.version).toBe(1)
    // ★去 id：快照 stores 的 state 不含元数据 id 键
    expect(json.stores).toEqual([{ id: 'cart', state: { items: 1, user: { name: 'p' } } }])
    expect(json.steps).toEqual([{ index: 0, storeId: 'cart', type: 'patch', name: 'patch', payload: { id: 'cart', items: 1, user: { name: 'p' } }, timestamp: 100 }])
    panel.destroy()
  })

  it('★P0 导入：importSnapshot 重建数据（视图出 store）+ onApplyState 应用（pinia 恢复）', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const apply = vi.fn()
    const panel = createDevtoolsPanel(root, { source, onApplyState: apply })
    panel.show('state')
    const json = serializeStoreSnapshot({
      stores: [{ id: 'cart', state: { items: 3 } }],
      steps: [
        { index: 0, storeId: 'cart', type: 'patch', name: 'patch', payload: { id: 'cart', items: 1 }, timestamp: 100 },
        { index: 1, storeId: 'cart', type: 'patch', name: 'patch', payload: { id: 'cart', items: 2 }, timestamp: 200 },
      ],
    })
    panel.importSnapshot(json)
    await new Promise((r) => setTimeout(r, 40))
    const stateView = root.querySelector('.pd-view[data-view="state"]') as HTMLElement
    expect(stateView.querySelectorAll('.pd-store-chip').length).toBe(1)
    const itemsRow = Array.from(stateView.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'items')
    expect(itemsRow?.querySelector('.pd-kv-value')?.textContent).toBe('3')
    expect(stateView.querySelectorAll('.pd-tl-row').length).toBe(2)
    // ★应用：导入的最新快照写回应用侧
    expect(apply).toHaveBeenCalledWith([{ id: 'cart', state: { items: 3 } }])
    panel.destroy()
  })

  it('★P0 导入：非法 JSON / 非快照对象 → 忽略（面板不崩、onApplyState 不调）', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const apply = vi.fn()
    const panel = createDevtoolsPanel(root, { source, onApplyState: apply })
    panel.importSnapshot('not json')
    panel.importSnapshot('{"a":1}')
    panel.importSnapshot('{"kind":"other","stores":[]}')
    await new Promise((r) => setTimeout(r, 30))
    expect(apply).not.toHaveBeenCalled()
    panel.destroy()
  })

  it('★M10 导出确认（M7.3）：state 含敏感键 → window.confirm 列出字段；拒绝 → 不下发返回空；确认 → 正常导出', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('store', 'point', 'store.patch', 100, 't1', { id: 'user', token: 'abc', name: 'P' }))
    await new Promise((r) => setTimeout(r, 40))
    panel.show('state')
    const origConfirm = window.confirm
    // 拒绝：confirm 返回 false → 不下载（返回空）
    window.confirm = () => false
    expect(panel.exportSnapshot()).toBe('')
    // 确认：正常导出（快照 JSON）
    window.confirm = () => true
    const json = panel.exportSnapshot()
    expect(json).toContain('proteus-store-snapshot')
    expect(json).toContain('token')
    window.confirm = origConfirm
    // 无敏感键 → 直接导出（无确认弹窗路径不崩）
    const root2 = document.createElement('div')
    const source2 = mockSource()
    const panel2 = createDevtoolsPanel(root2, { source: source2 })
    source2.push(ev('store', 'point', 'store.patch', 200, 't2', { id: 'cart', items: 1 }))
    await new Promise((r) => setTimeout(r, 40))
    const json2 = panel2.exportSnapshot()
    expect(json2).toContain('proteus-store-snapshot')
    expect(json2).toContain('items')
    expect(json2).not.toContain('token')
    panel.destroy()
    panel2.destroy()
  })

  it('★P0 时间旅行：滑块/步骤行 → onTimeTravel(index) + onApplyState(restoreAt 快照：各 store 在 index 时刻状态)', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const onTT = vi.fn()
    const apply = vi.fn()
    const panel = createDevtoolsPanel(root, { source, onTimeTravel: onTT, onApplyState: apply })
    // cart 两次 patch（步骤 0/1）+ user 一次 patch（步骤 2）
    source.push(ev('store', 'point', 'store.patch', 100, undefined, { id: 'cart', items: 1 }))
    source.push(ev('store', 'point', 'store.patch', 200, undefined, { id: 'cart', items: 2 }))
    source.push(ev('store', 'point', 'store.patch', 300, undefined, { id: 'user', name: 'u' }))
    await new Promise((r) => setTimeout(r, 40))
    panel.show('state')
    const stateView = root.querySelector('.pd-view[data-view="state"]') as HTMLElement
    const range = stateView.querySelector('.pd-range') as HTMLInputElement
    // 回放到步骤 0：cart 取 items:1（user 尚无 patch ≤0 → 不出现）
    range.value = '0'
    range.dispatchEvent(new Event('change'))
    expect(onTT).toHaveBeenCalledWith(0)
    expect(apply).toHaveBeenLastCalledWith([{ id: 'cart', state: { items: 1 } }])
    // 回放到步骤 2：cart 最新 items:2 + user name
    range.value = '2'
    range.dispatchEvent(new Event('change'))
    expect(apply).toHaveBeenLastCalledWith([{ id: 'cart', state: { items: 2 } }, { id: 'user', state: { name: 'u' } }])
    panel.destroy()
  })

  it('★P0 before/after：patch 步骤带真实差异（hover diff 提示挂 data-tip）；action 步骤无 diff', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('store', 'point', 'store.patch', 100, undefined, { id: 'cart', items: 1 }))
    source.push(ev('store', 'point', 'store.action', 150, undefined, { id: 'cart', name: 'add' }))
    source.push(ev('store', 'point', 'store.patch', 200, undefined, { id: 'cart', items: 2 }))
    await new Promise((r) => setTimeout(r, 40))
    panel.show('state')
    const stateView = root.querySelector('.pd-view[data-view="state"]') as HTMLElement
    const rows = Array.from(stateView.querySelectorAll('.pd-tl-row'))
    // 倒序：patch(#2, items 1→2) 在最上（有 diff）→ action(#1) → patch(#0, 首次无 before)
    expect(rows[0].getAttribute('data-tip')).not.toBeNull()
    expect(rows[1].getAttribute('data-tip')).toBeNull() // action 无状态变更
    panel.destroy()
  })

  it('renderState：导入快照按钮 → 选文件 → onImport(JSON 文本)', async () => {
    const root = document.createElement('div')
    const onImport = vi.fn()
    renderState(root, { snapshot: { version: 1, takenAt: 1, stores: [] }, steps: [] }, { onImport })
    const btn = Array.from(root.querySelectorAll('.pd-btn')).find((b) => b.textContent === '导入快照 JSON') as HTMLButtonElement
    expect(btn).toBeDefined()
    const input = root.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['{"kind":"proteus-store-snapshot"}'], 'snap.json', { type: 'application/json' })
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change'))
    await new Promise((r) => setTimeout(r, 20))
    expect(onImport).toHaveBeenCalledWith('{"kind":"proteus-store-snapshot"}')
  })
})

describe('Store 快照导出/导入（snapshot-io 纯逻辑）', () => {
  it('serializeStoreSnapshot → parseStoreSnapshot roundtrip 保留 stores + steps', () => {
    const json = serializeStoreSnapshot({
      stores: [{ id: 'cart', state: { items: 2, meta: { v: 1 } } }],
      steps: [{ index: 0, storeId: 'cart', type: 'patch', name: 'patch', payload: { id: 'cart', items: 2 }, timestamp: 100 }],
    })
    const parsed = parseStoreSnapshot(json)
    expect(parsed).toEqual({
      stores: [{ id: 'cart', state: { items: 2, meta: { v: 1 } } }],
      steps: [{ index: 0, storeId: 'cart', type: 'patch', name: 'patch', payload: { id: 'cart', items: 2 }, timestamp: 100 }],
    })
  })

  it('★M10 findSensitiveKeys：递归命中 password/token/authorization/idcard/phone（嵌套/数组）；无命中空', () => {
    const hits = findSensitiveKeys([
      { id: 'user', state: { profile: { token: 'x' }, list: [{ password: 'y' }, { apiToken: 'z' }], name: 'P' } },
      { id: 'safe', state: { count: 1 } },
    ])
    expect(hits).toEqual([{ storeId: 'user', keys: ['token', 'password', 'apiToken'] }])
    expect(findSensitiveKeys([{ id: 'a', state: { ok: true, name: 'x' } }])).toEqual([])
  })

  it('★M11 serializeSession → parseSession roundtrip：事件日志 + 设备 + store 快照保留；非法 → null；坏行过滤', () => {
    const json = serializeSession({
      events: [
        { source: 'router', phase: 'start', name: 'navigate /a', timestamp: 100, traceId: 't1' },
        { source: 'api', phase: 'error', name: 'req.fail', timestamp: 200, payload: { status: 500 } },
      ],
      device: { platform: 'web', capabilities: [] },
      stores: [{ id: 'cart', state: { items: 2 } }],
      steps: [{ index: 0, storeId: 'cart', type: 'patch', name: 'patch', payload: {}, timestamp: 100 }],
    })
    const parsed = parseSession(json)
    expect(parsed?.events).toEqual([
      { source: 'router', phase: 'start', name: 'navigate /a', timestamp: 100, traceId: 't1' },
      { source: 'api', phase: 'error', name: 'req.fail', timestamp: 200, payload: { status: 500 } },
    ])
    expect(parsed?.device).toEqual({ platform: 'web', capabilities: [] })
    expect(parsed?.stores).toEqual([{ id: 'cart', state: { items: 2 } }])
    expect(parsed?.steps.length).toBe(1)
    // 非法：非 JSON / 非会话 / 版本不符 → null
    expect(parseSession('x')).toBeNull()
    expect(parseSession('{"kind":"other","events":[]}')).toBeNull()
    expect(parseSession('{"kind":"proteus-session","version":2,"events":[]}')).toBeNull()
    // 坏行过滤：非法 source/phase/name 行剔除，合法行保留
    const mixed = parseSession(
      JSON.stringify({
        kind: 'proteus-session',
        version: 1,
        events: [
          { source: 'router', phase: 'start', name: 'ok', timestamp: 1 },
          { source: 'hacker', phase: 'start', name: 'bad', timestamp: 1 },
          { source: 'router', phase: 'weird', name: 'bad', timestamp: 1 },
          { source: 'router', phase: 'end', name: '', timestamp: 1 },
        ],
      }),
    )
    expect(mixed?.events.length).toBe(1)
  })

  it('parseStoreSnapshot：非法 JSON / 非快照对象 / 坏行 → null 或过滤', () => {
    expect(parseStoreSnapshot('not json')).toBeNull()
    expect(parseStoreSnapshot('{"a":1}')).toBeNull()
    expect(parseStoreSnapshot('{"kind":"other","stores":[]}')).toBeNull()
    expect(parseStoreSnapshot('{"kind":"proteus-store-snapshot","stores":null}')).toBeNull()
  })
})

describe('面板装配', () => {
  it('事件流 → 时间轴视图更新 + 侧栏导航切换 + 连接状态 + destroy 清理', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    expect(root.querySelectorAll('.pd-nav-item').length).toBe(10) // timeline/flamegraph/state/route/errors/components/pages/graph/device/ownership
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

  it('WS 源 onStatus connected → 立即「已连接」（不等待事件；面板先开/应用后跑不再一直连接中）', () => {
    const root = document.createElement('div')
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    const panel = createDevtoolsPanel(root, { source })
    expect(root.querySelector('.pd-header-status')?.textContent).toContain('连接中')
    sockets[0].onopen?.() // WS 连上（无任何事件到达）
    expect(root.querySelector('.pd-header-status')?.textContent).toContain('已连接')
    expect(root.querySelector('.pd-dot')?.classList.contains('pd-dot-on')).toBe(true)
    panel.destroy()
    source.close()
  })

  it('★双向调试：state 值编辑 → 面板快照更新 + 本地 onApplyState + 远程 sendCommand 双通道写回', () => {
    const root = document.createElement('div')
    const applyState = vi.fn()
    const sendCommand = vi.fn()
    const source = mockSource() as DevtoolsSource & { push: (e: TraceEvent) => void } & { sendCommand?: (m: string, p?: Record<string, unknown>) => void }
    source.sendCommand = sendCommand
    const panel = createDevtoolsPanel(root, { source, onApplyState: applyState })
    // store 事件进面板（store.patch：payload 含 id + 状态）
    source.push(ev('store', 'point', 'store.patch', 100, 't1', { id: 'cart', items: 2, label: 'x' }))
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        panel.show('state')
        const stateView = root.querySelector('.pd-view[data-view="state"]') as HTMLElement
        const itemsRow = Array.from(stateView.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'items') as HTMLElement
        // 点值 → 输入 → Enter 提交
        ;(itemsRow.querySelector('.pd-kv-value') as HTMLElement).click()
        const input = stateView.querySelector('.pd-kv-edit') as HTMLInputElement
        input.value = '9'
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        // 本地：onApplyState 收到编辑后的完整状态（items 9，label 保留）
        expect(applyState).toHaveBeenCalledWith([{ id: 'cart', state: { items: 9, label: 'x' } }])
        // 远程：restoreStores 命令同语义下发
        expect(sendCommand).toHaveBeenCalledWith('Proteus.restoreStores', { stores: [{ id: 'cart', state: { items: 9, label: 'x' } }] })
        // 面板快照即时更新（后续 events 携带新状态）
        source.push(ev('store', 'point', 'store.patch', 200, 't2', { id: 'cart', items: 9, label: 'x' }))
        setTimeout(() => {
          // 回声去重：编辑后的状态已在历史 → 不追加步骤
          const stepInfo = stateView.querySelector('.pd-toolbar span')?.textContent
          expect(stepInfo).toContain('步骤 2') // 原始变更 + 编辑回声（去重后仅 2 步）
          panel.destroy()
          resolve()
        }, 30)
      }, 30)
    })
  })

  it('★M11 会话导出/导入（M8.2）：导出 SessionBundle → 新面板导入 → 时间轴 + 路由 + store 全视图还原 + 状态恢复', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    // 制造会话：路由导航 + store 变更 + error
    source.push(ev('router', 'start', 'navigate /admin', 1000, 't1', { from: { path: '/index' }, to: { path: '/admin' } }))
    source.push(ev('router', 'end', 'navigate /admin', 1050, 't1'))
    source.push(ev('store', 'point', 'store.patch', 1100, 't2', { id: 'cart', items: 2 }))
    source.push(ev('api', 'error', 'refreshToken', 1200, 't3', { status: 401 }))
    await new Promise((r) => setTimeout(r, 40))
    const sessionJson = panel.exportSession()
    expect(sessionJson).toContain('proteus-session')
    expect(sessionJson).toContain('navigate /admin')
    // 新面板（干净聚合）导入 → 全视图还原
    const apply = vi.fn()
    const root2 = document.createElement('div')
    const panel2 = createDevtoolsPanel(root2, { source: mockSource(), onApplyState: apply })
    panel2.importSession(sessionJson)
    await new Promise((r) => setTimeout(r, 40))
    // 时间轴 span 还原（1 nav + store.patch 竖线 + error 竖线 = 3）
    panel2.show('timeline')
    expect((root2.querySelector('.pd-view[data-view="timeline"]') as HTMLElement).querySelectorAll('.pd-span').length).toBe(3)
    // 路由记录还原
    panel2.show('route')
    expect((root2.querySelector('.pd-view[data-view="route"]') as HTMLElement).querySelectorAll('.pd-nav').length).toBe(1)
    // store 快照/步骤还原 + 应用恢复（最新状态写回）
    panel2.show('state')
    const stateView = root2.querySelector('.pd-view[data-view="state"]') as HTMLElement
    expect(stateView.querySelector('.pd-store-head')?.textContent).toContain('cart')
    expect(stateView.querySelectorAll('.pd-tl-row').length).toBe(1)
    expect(apply).toHaveBeenCalledWith([{ id: 'cart', state: { items: 2 } }])
    // 非法导入 → 不崩
    panel2.importSession('not json')
    panel.destroy()
    panel2.destroy()
  })

  it('★M8 设备视图：options.deviceInfo 钩子 → 概览/能力表渲染；无钩子 → 空态', () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, {
      source,
      deviceInfo: () => ({
        platform: 'web',
        userAgent: 'Mozilla/5.0',
        screen: { dpr: 1, width: 375, height: 812 },
        capabilities: [{ capability: 'clipboard', platform: 'web', priority: 0, required: false, supported: true, platforms: ['web'] }],
      }),
    })
    panel.show('device')
    const deviceView = root.querySelector('.pd-view[data-view="device"]') as HTMLElement
    expect(deviceView.classList.contains('pd-view-active')).toBe(true)
    // 概览卡（平台/基础库/屏幕——无 memory 信息则无 JS 堆卡）+ 能力表
    expect(deviceView.querySelectorAll('.pd-dev-card').length).toBe(3)
    expect(deviceView.querySelector('.pd-dev-cap-ok')?.textContent).toContain('clipboard')
    panel.destroy()
    // 无钩子（远程桥未配置）→ 空态不崩溃
    const root2 = document.createElement('div')
    const panel2 = createDevtoolsPanel(root2, { source: mockSource() })
    panel2.show('device')
    expect((root2.querySelector('.pd-view[data-view="device"]') as HTMLElement).querySelector('.pd-empty')).not.toBeNull()
    panel2.destroy()
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

  it('PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR：提供触发 fallback 的 logo（Vue DevTools 8.2.1 导航图标只渲染 descriptor.logo，undefined → 三个 inspector 同默认图标）', () => {
    expect(PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR.id).toBe('proteus')
    expect(PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR.label).toBe('Proteus')
    // ★logo 必须是「URL 形态」值（TabIcon 的 isUrlString：'/' 开头或 http(s)://）——
    //   只有 img 加载失败（@error）才切到 fallback（custom-ic-baseline-* → VueIcIcon 字典图标）
    const logo = PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR.logo
    expect(logo.startsWith('/') || logo.startsWith('http')).toBe(true)
    // ★占位值不能是真实可加载图片（否则显示图片而非三个不同字典图标）
    expect(logo).not.toMatch(/^https?:\/\//)
  })

  it('installProteusInspectors：注册 app-config inspector + 树根节点 + getInspectorState 当前值 + editInspectorState 回写（path → 嵌套 patch）', () => {
    let config = { app: { name: 'Demo' }, features: { glass: true } }
    const calls: Array<{ method: string; options: unknown }> = []
    const treeCbs: Array<(p: { inspectorId: string; rootNodes?: unknown[] }) => void> = []
    const stateCbs: Array<(p: { inspectorId: string; nodeId: string; state?: Record<string, Array<{ key: string; value: unknown }>> }) => void> = []
    const editCbs: Array<(p: { inspectorId: string; nodeId: string; path: string[]; state: { value: unknown } }) => void> = []
    const api = {
      addInspector: (options: unknown) => calls.push({ method: 'addInspector', options }),
      on: {
        getInspectorTree: (cb: never) => treeCbs.push(cb as never),
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
    const registered = calls[0] as { options: { id: string; label: string; icon: string } }
    expect(registered.method).toBe('addInspector')
    expect(registered.options.id).toBe('proteus-app-config')
    expect(registered.options.label).toBe('App Config')
    expect(registered.options.icon).toBe('settings') // ★裸 Material 名（kit 拼 custom-ic-baseline-settings 作 fallback）
    // ★树根节点（kit 只在 selectedNodeId 非空时请求 state——无树节点 → 永远 No Data）
    const treePayload = { inspectorId: 'proteus-app-config' }
    treeCbs[0](treePayload)
    expect((treePayload.rootNodes as Array<{ id: string }>)?.[0].id).toBe('root')
    // getInspectorState → resolved 分组（★对象形态：分组名 → 状态行数组；config 顶层键平铺多行）
    const payload = { inspectorId: 'proteus-app-config', nodeId: 'root' }
    stateCbs[0](payload)
    expect(Object.keys(payload.state ?? {})).toEqual(['resolved'])
    expect(payload.state?.resolved?.[0]).toEqual({ key: 'app', value: { name: 'Demo' } })
    expect(payload.state?.resolved?.[1]).toEqual({ key: 'features', value: { glass: true } })
    // 非本 inspector → 不响应（state 保持 undefined）
    const otherPayload = { inspectorId: 'other', nodeId: 'root' }
    stateCbs[0](otherPayload)
    expect(otherPayload.state).toBeUndefined()
    // editInspectorState → path 构建嵌套 patch 回写
    editCbs[0]({ inspectorId: 'proteus-app-config', nodeId: 'root', path: ['app', 'name'], state: { value: 'Proteus' } })
    expect(config.app.name).toBe('Proteus')
    // ★path 含分组名前缀（'resolved'）→ 剥掉后 patch（Vue DevTools 编辑 path 语义兼容）
    editCbs[0]({ inspectorId: 'proteus-app-config', nodeId: 'root', path: ['resolved', 'features', 'glass'], state: { value: false } })
    expect(config.features.glass).toBe(false)
    inspectors.dispose()
  })

  it('installProteusInspectors：getStyleSafetyRecords 提供 → 注册 proteus-style-safety inspector（树根节点 + rejected 记录）', () => {
    const calls: Array<{ method: string; options: unknown }> = []
    const treeCbs: Array<(p: { inspectorId: string; rootNodes?: unknown[] }) => void> = []
    const stateCbs: Array<(p: { inspectorId: string; nodeId: string; state?: Record<string, Array<{ key: string; value: unknown }>> }) => void> = []
    const api = {
      addInspector: (options: unknown) => calls.push({ method: 'addInspector', options }),
      on: {
        getInspectorTree: (cb: never) => treeCbs.push(cb as never),
        getInspectorState: (cb: never) => stateCbs.push(cb as never),
        editInspectorState: () => {},
      },
    }
    const records = [{ prop: 'display', value: 'flex', reason: '禁止', ts: 1 }]
    installProteusInspectors(api as never, { getStyleSafetyRecords: () => records })
    const ids = calls.map((c) => (c.options as { id: string }).id)
    expect(ids).toContain('proteus-style-safety')
    // ★树根节点（kit 只在 selectedNodeId 非空时请求 state）
    const treePayload = { inspectorId: 'proteus-style-safety' }
    treeCbs[treeCbs.length - 1](treePayload)
    expect((treePayload.rootNodes as Array<{ id: string }>)?.[0].id).toBe('root')
    // ★注册顺序：app-config 先、style-safety 后 → 取最后一个 getInspectorState 回调
    const last = stateCbs[stateCbs.length - 1]
    const payload = { inspectorId: 'proteus-style-safety', nodeId: 'root' }
    last(payload)
    // ★展示优化：拦截记录平铺成多行（rejected 分组下每条 prop 一行，展开 value/reason/ts）
    expect(Object.keys(payload.state ?? {})).toEqual(['rejected'])
    expect(payload.state?.rejected?.[0]).toEqual({ key: 'display', value: { value: 'flex', reason: '禁止', ts: 1 } })
    // 不提供 getStyleSafetyRecords → 不注册
    const calls2: Array<{ id: string }> = []
    installProteusInspectors({ addInspector: (o: never) => calls2.push(o as never), on: { getInspectorTree: () => {}, getInspectorState: () => {}, editInspectorState: () => {} } } as never)
    expect(calls2.some((c) => c.id === 'proteus-style-safety')).toBe(false)
  })

  it('installProteusInspectors：pages 提供 → 注册 proteus-router inspector（parent 嵌套树 + 选中路由详情）', () => {
    const calls: Array<{ method: string; options: unknown }> = []
    const treeCbs: Array<(p: { inspectorId: string; rootNodes?: unknown[] }) => void> = []
    const stateCbs: Array<(p: { inspectorId: string; nodeId: string; state?: Array<{ key: string; value: unknown }> }) => void> = []
    const api = {
      addInspector: (options: unknown) => calls.push({ method: 'addInspector', options }),
      on: {
        getInspectorTree: (cb: never) => treeCbs.push(cb as never),
        getInspectorState: (cb: never) => stateCbs.push(cb as never),
        editInspectorState: () => {},
      },
    }
    installProteusInspectors(api as never, {
      pages: {
        routes: [
          { name: 'index', path: 'pages/index', meta: { title: '首页' } },
          { name: 'user', path: 'pages/user/index', parent: 'index', meta: { title: '用户中心' } },
          { name: 'user-profile', path: 'pages/user/profile', parent: 'user', meta: { title: '个人资料' } },
        ],
      },
      getRouterState: () => ({
        currentRoute: 'pages/user/profile',
        records: [
          { from: 'index', to: 'pages/user/index', durationMs: 2, timestamp: 100, traceId: 'nav-1', guards: [{ name: 'guard beforeEach:next', result: 'next' }] },
          { from: 'pages/user/index', to: 'pages/user/profile', query: { id: '1' }, durationMs: 3, timestamp: 200, traceId: 'nav-2', guards: [{ name: 'guard beforeEach:next', result: 'next' }] },
        ],
      }),
    })
    // 注册 proteus-router
    const routerInspector = calls.find((c) => (c.options as { id: string }).id === 'proteus-router') as { options: { label: string; icon: string } }
    expect(routerInspector).toBeDefined()
    expect(routerInspector.options.label).toBe('Router')
    expect(routerInspector.options.icon).toBe('route')
    // ★嵌套树：导航记录节点置顶 + index 根 → user（parent index）→ user-profile（parent user）
    // ★取最后一个 tree 回调（app-config 也注册了树根节点）
    const treePayload = { inspectorId: 'proteus-router' }
    treeCbs[treeCbs.length - 1](treePayload)
    const roots = treePayload.rootNodes as Array<{ id: string; label: string; children?: Array<{ id: string; label: string; children?: unknown[] }> }>
    expect(roots[0].id).toBe('proteus-records') // 导航记录置顶
    expect(roots[0].label).toContain('导航记录 (2)')
    const recNodes = roots[0].children as Array<{ id: string; label: string }>
    expect(recNodes[0].label).toBe('pages/user/index → pages/user/profile?id=1') // 倒序最新在上 + query 显示
    expect(recNodes[1].label).toBe('index → pages/user/index')
    expect(roots.length).toBe(2)
    expect(roots[1].id).toBe('index')
    expect(roots[1].label).toBe('首页')
    const user = roots[1].children?.[0]
    expect(user?.id).toBe('user')
    expect(user?.label).toBe('用户中心')
    expect(user?.children?.[0] && (user.children[0] as { id: string }).id).toBe('user-profile')
    // ★当前路由高亮：currentRoute=pages/user/profile → user-profile 节点带「当前」tag
    const profileNode = (user?.children?.[0] as { tags?: Array<{ label: string }> }).tags
    expect(profileNode?.some((t) => t.label === '当前')).toBe(true)
    const indexTags = (roots[1] as { tags?: Array<{ label: string }> }).tags
    expect(indexTags?.some((t) => t.label === '当前')).toBe(false)
    // ★选中导航记录分组 → 当前路由 + 记录数组（对象分组形态）
    const recPayload = { inspectorId: 'proteus-router', nodeId: 'proteus-records' }
    stateCbs[stateCbs.length - 1](recPayload)
    expect(Object.keys(recPayload.state ?? {})).toEqual(['导航记录'])
    const recGroup = recPayload.state?.['导航记录'] ?? []
    expect(recGroup[0]).toEqual({ key: 'currentRoute', value: 'pages/user/profile' })
    expect((recGroup[1].value as Array<{ from: string }>)[0].from).toBe('pages/user/index')
    // ★选中单条记录 → 「导航状态」分组（from/to/query/耗时/时间/traceId/守卫链）
    const singlePayload = { inspectorId: 'proteus-router', nodeId: 'rec-200' }
    stateCbs[stateCbs.length - 1](singlePayload)
    const singleGroup = singlePayload.state?.['导航状态'] ?? []
    expect(singleGroup.map((s) => s.key)).toEqual(['from', 'to', 'query', 'durationMs', 'timestamp', 'traceId', 'guards'])
    expect(singleGroup.find((s) => s.key === 'query')?.value).toEqual({ id: '1' })
    expect(singleGroup.find((s) => s.key === 'traceId')?.value).toBe('nav-2')
    expect((singleGroup.find((s) => s.key === 'guards')?.value as Array<{ result: string }>)[0].result).toBe('next')
    // 选中路由节点详情（取最后一个 state 回调——app-config 也注册了）
    const statePayload = { inspectorId: 'proteus-router', nodeId: 'user-profile' }
    stateCbs[stateCbs.length - 1](statePayload)
    const routeGroup = statePayload.state?.['路由'] ?? []
    expect(routeGroup[0]).toEqual({ key: 'path', value: 'pages/user/profile' })
    expect(routeGroup[1]).toEqual({ key: 'parent', value: 'user' })
    // 非本 inspector 不响应
    const other = { inspectorId: 'other', nodeId: 'x' }
    stateCbs[stateCbs.length - 1](other)
    expect(other.state).toBeUndefined()
    // 不提供 pages → 不注册 router inspector
    const calls2: Array<{ id: string }> = []
    installProteusInspectors({ addInspector: (o: never) => calls2.push(o as never), on: { getInspectorTree: () => {}, getInspectorState: () => {}, editInspectorState: () => {} } } as never)
    expect(calls2.some((c) => c.id === 'proteus-router')).toBe(false)
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
    expect(sends.length).toBe(4) // enable + appInfo + deviceInfo + ownership
    expect(sends[1].method).toBe('Proteus.appInfo')
    expect(sends[2].method).toBe('Proteus.deviceInfo')
    expect(sends[3].method).toBe('Proteus.ownership')
    // appInfo 命令响应（含 id 且无 method）→ 缓存
    sockets[0].onmessage?.({ data: JSON.stringify({ id: 2, result: { routes: [{ name: 'index', path: 'pages/index' }] } }) })
    expect(source.appInfo?.()).toEqual({ routes: [{ name: 'index', path: 'pages/index' }] })
    // ★M8：deviceInfo 命令响应 → 缓存（设备面板数据源）
    sockets[0].onmessage?.({ data: JSON.stringify({ id: 3, result: { platform: 'web', capabilities: [] } }) })
    expect(source.deviceInfo?.()).toEqual({ platform: 'web', capabilities: [] })
    // ★G-43 B4：ownership 命令响应 → 缓存（所有权面板数据源）
    sockets[0].onmessage?.({ data: JSON.stringify({ id: 4, result: { summary: { alive: 2 } } }) })
    expect(source.ownership?.()).toEqual({ summary: { alive: 2 } })
    source.close()
  })

  it('★远程时间旅行命令：sendCommand 下发 Proteus.restoreStores（面板 → relay → 应用侧恢复）', () => {
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; readyState: number; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), readyState: 1, onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    sockets[0].onopen?.()
    source.sendCommand?.('Proteus.restoreStores', { stores: [{ id: 'player', state: { playing: false } }] })
    const sends = sockets[0].send.mock.calls.map((c) => JSON.parse(c[0]))
    const cmd = sends[sends.length - 1]
    expect(cmd.method).toBe('Proteus.restoreStores')
    expect(cmd.params).toEqual({ stores: [{ id: 'player', state: { playing: false } }] })
    expect(typeof cmd.id).toBe('number')
    // 未 OPEN 不发（不抛错）
    source.close()
    source.sendCommand?.('Proteus.restoreStores', { stores: [] })
    expect(sockets[0].send.mock.calls.length).toBe(sends.length)
  })

  it('onStatus：初始 connecting → onopen connected → onclose closed（面板「已连接」不依赖事件到达）', () => {
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    const statuses: string[] = []
    source.onStatus?.((s) => statuses.push(s))
    expect(statuses).toEqual(['connecting']) // 注册即回调当前状态
    sockets[0].onopen?.()
    expect(statuses).toEqual(['connecting', 'connected'])
    sockets[0].onclose?.()
    expect(statuses).toEqual(['connecting', 'connected', 'closed'])
    source.close()
  })

  it('★enable 未确认 → 定时重发（面板先开、应用后连也能等到数据）；确认后停止重发', () => {
    vi.useFakeTimers()
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; readyState: number; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), readyState: 1, onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    sockets[0].onopen?.()
    expect(sockets[0].send.mock.calls.length).toBe(4) // enable + appInfo + deviceInfo + ownership
    // 2s 后未确认 → 重发
    vi.advanceTimersByTime(2000)
    expect(sockets[0].send.mock.calls.length).toBe(8)
    // 收到最新一次 enable 的响应（bridge 回显当前 enableId）→ 确认，停止重发
    const latestEnableId = JSON.parse(String(sockets[0].send.mock.calls[4][0])).id
    sockets[0].onmessage?.({ data: JSON.stringify({ id: latestEnableId, result: {} }) })
    vi.advanceTimersByTime(6000)
    expect(sockets[0].send.mock.calls.length).toBe(8) // 不再重发
    source.close()
    vi.useRealTimers()
  })

  it('★enable 响应不污染 appInfo 缓存（id 区分：enable 只确认，appInfo 才写缓存）', () => {
    const sockets: Array<{ send: ReturnType<typeof vi.fn>; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; close: ReturnType<typeof vi.fn> }> = []
    const source = createDevtoolsWsSource('ws://panel', () => {
      const s = { send: vi.fn(), onopen: null, onmessage: null, onclose: null, close: vi.fn() }
      sockets.push(s)
      return s as unknown as WebSocket
    })
    sockets[0].onopen?.()
    const enableId = JSON.parse(String(sockets[0].send.mock.calls[0][0])).id
    const appInfoId = JSON.parse(String(sockets[0].send.mock.calls[1][0])).id
    sockets[0].onmessage?.({ data: JSON.stringify({ id: appInfoId, result: { routes: [{ name: 'index', path: 'pages/index' }] } }) })
    expect(source.appInfo?.()).toEqual({ routes: [{ name: 'index', path: 'pages/index' }] })
    // enable 响应（result: {}）不得覆盖路由表
    sockets[0].onmessage?.({ data: JSON.stringify({ id: enableId, result: {} }) })
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
  it('renderComponents：parent 关联构建树 + 折叠（toggle 折叠、行点击选中不冒泡折叠父行）', () => {
    const root = document.createElement('div')
    const onSelect = vi.fn()
    renderComponents(
      root,
      {
        nodes: [
          { id: 1, name: 'App', ts: 1, count: 1 },
          { id: 2, name: 'Home', parentId: 1, ts: 2, count: 1 },
          { id: 3, name: 'Card', parentId: 2, ts: 3, count: 2 },
        ],
      },
      { onSelect },
    )
    const rows = root.querySelectorAll('.pd-cmp-row')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('App')
    expect(rows[1].textContent).toContain('Home')
    expect(rows[2].textContent).toContain('×2') // 计数
    // 子行缩进（depth 1 → paddingLeft 22px）
    expect((rows[1] as HTMLElement).style.paddingLeft).toBe('22px')
    // ★P1 折叠改为 toggle 点击：子行点击 → 选中回调（不触发父折叠）；根行点击 → 选中
    const subEl = (rows[0] as HTMLElement).querySelector('.pd-cmp-children') as HTMLElement
    expect(subEl.childNodes.length).toBeGreaterThan(0)
    ;(rows[1] as HTMLElement).click()
    expect(onSelect).toHaveBeenCalledWith(2)
    expect(subEl.style.display).not.toBe('none')
    // 点击根行 toggle → 折叠（stopPropagation 不触发选中）
    const toggle = (rows[0] as HTMLElement).querySelector('.pd-kv-toggle') as HTMLElement
    toggle.click()
    expect(subEl.style.display).toBe('none')
    toggle.click()
    expect(subEl.style.display).toBe('block')
    expect(onSelect).toHaveBeenCalledTimes(1) // toggle 不触发选中
  })

  it('★P1 renderComponents：选中组件 → 详情面板（props/state inspector 树）+ 高亮行', () => {
    const root = document.createElement('div')
    renderComponents(root, {
      nodes: [
        { id: 1, name: 'App', ts: 1, count: 1, props: { title: 'demo', n: 1 }, state: { count: 0 } },
        { id: 2, name: 'Card', parentId: 1, ts: 2, count: 1 },
      ],
      selectedId: 1,
    })
    const rows = root.querySelectorAll('.pd-cmp-row')
    expect(rows[0].classList.contains('pd-cmp-active')).toBe(true)
    expect(rows[1].classList.contains('pd-cmp-active')).toBe(false)
    // 详情面板：props/state 段 + 值
    const detail = root.querySelector('.pd-cmp-detail') as HTMLElement
    expect(detail).not.toBeNull()
    expect(detail.textContent).toContain('props')
    const titleRow = Array.from(detail.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'title')
    expect(titleRow?.querySelector('.pd-kv-value')?.textContent).toBe('"demo"')
    const countRow = Array.from(detail.querySelectorAll('.pd-kv')).find((r) => r.querySelector('.pd-kv-key')?.textContent === 'count')
    expect(countRow?.querySelector('.pd-kv-value')?.textContent).toBe('0')
    // 无 selectedId → 无详情
    const root2 = document.createElement('div')
    renderComponents(root2, { nodes: [{ id: 1, name: 'App', ts: 1, count: 1 }] })
    expect(root2.querySelector('.pd-cmp-detail')).toBeNull()
  })

  it('★P1.5 buildDomTree：渲染元素树摘要（tag/id/class/子元素递归 + 深度/数量上限）', () => {
    const root = document.createElement('div')
    root.id = 'app'
    root.className = 'main container'
    const child = document.createElement('span')
    child.className = 'badge'
    root.appendChild(child)
    const deep = document.createElement('section')
    deep.appendChild(document.createElement('p'))
    root.appendChild(deep)
    const tree = buildDomTree(root)
    expect(tree).toEqual({
      tag: 'div',
      id: 'app',
      cls: ['main', 'container'],
      children: [
        { tag: 'span', cls: ['badge'], children: [] },
        { tag: 'section', children: [{ tag: 'p', children: [] }] },
      ],
    })
    // 深度上限：5 层 → 第 5 层截断为 null
    let el: HTMLElement = document.createElement('a')
    const deepRoot = document.createElement('div')
    let cur = deepRoot
    for (let i = 0; i < 8; i++) {
      cur.appendChild(el)
      cur = el
      el = document.createElement('a')
    }
    const deepTree = buildDomTree(deepRoot)
    let depth = 0
    let node: DomTreeNode | null = deepTree
    while (node && node.children.length) {
      depth++
      node = node.children[0]
    }
    expect(depth).toBeLessThanOrEqual(4)
  })

  it('★P1.5 renderComponents：dom 数据 → 详情面板 DOM 段（tag#id.cls 行）', () => {
    const root = document.createElement('div')
    renderComponents(root, {
      nodes: [{ id: 1, name: 'App', ts: 1, count: 1 }],
      selectedId: 1,
      dom: { tag: 'div', id: 'app', cls: ['main'], children: [{ tag: 'span', children: [] }] },
    })
    const detail = root.querySelector('.pd-cmp-detail') as HTMLElement
    expect(detail.textContent).toContain('DOM')
    const domNodes = Array.from(detail.querySelectorAll('.pd-dom-node'))
    expect(domNodes.length).toBe(2)
    expect(domNodes[0].textContent).toContain('div')
    expect(domNodes[0].textContent).toContain('#app')
    expect(domNodes[0].textContent).toContain('.main')
    expect(domNodes[1].textContent).toContain('span')
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

  it('★P1 面板：component.mount 带 props/state 快照 → 点击行 → onSelectComponent 高亮回调 + 详情面板；再点取消选中', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const select = vi.fn()
    const panel = createDevtoolsPanel(root, { source, onSelectComponent: select })
    source.push(ev('component', 'point', 'component.mount', 100, 'comp-1', { id: 1, name: 'App', parentId: undefined, props: { title: 'demo' }, state: { count: 1 } }))
    await new Promise((r) => setTimeout(r, 40))
    panel.show('components')
    const componentsView = root.querySelector('.pd-view[data-view="components"]') as HTMLElement
    const row = componentsView.querySelector('.pd-cmp-row') as HTMLElement
    row.click()
    expect(select).toHaveBeenCalledWith(1)
    await new Promise((r) => setTimeout(r, 40))
    // ★详情面板出现（props/state 值）
    const detail = componentsView.querySelector('.pd-cmp-detail') as HTMLElement
    expect(detail).not.toBeNull()
    expect(detail.textContent).toContain('demo')
    expect(Array.from(detail.querySelectorAll('.pd-kv')).some((r) => r.querySelector('.pd-kv-key')?.textContent === 'count')).toBe(true)
    // 再点同一行 → 取消选中（详情消失，不再回调）
    row.click()
    await new Promise((r) => setTimeout(r, 40))
    expect(select).toHaveBeenCalledTimes(1)
    expect(componentsView.querySelector('.pd-cmp-detail')).toBeNull()
    panel.destroy()
  })

  it('★P1.5 面板：component.inspect 事件 → 选中组件详情 DOM 树段（unmount 清理）', async () => {
    const root = document.createElement('div')
    const source = mockSource()
    const panel = createDevtoolsPanel(root, { source })
    source.push(ev('component', 'point', 'component.mount', 100, 'comp-1', { id: 1, name: 'App', parentId: undefined }))
    await new Promise((r) => setTimeout(r, 40))
    panel.show('components')
    const componentsView = root.querySelector('.pd-view[data-view="components"]') as HTMLElement
    ;(componentsView.querySelector('.pd-cmp-row') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 40))
    // 选中后下发 DOM 树 → 详情出现 DOM 段
    source.push(ev('component', 'point', 'component.inspect', 110, 'comp-1', { id: 1, dom: { tag: 'div', id: 'app', children: [{ tag: 'span', children: [] }] } }))
    await new Promise((r) => setTimeout(r, 40))
    const detail = componentsView.querySelector('.pd-cmp-detail') as HTMLElement
    expect(detail.textContent).toContain('DOM')
    expect(componentsView.querySelectorAll('.pd-dom-node').length).toBe(2)
    // unmount → inspect 缓存清理（再选中无 DOM 段）
    source.push(ev('component', 'point', 'component.unmount', 120, 'comp-1', { id: 1 }))
    await new Promise((r) => setTimeout(r, 40))
    source.push(ev('component', 'point', 'component.mount', 130, 'comp-1', { id: 1, name: 'App' }))
    await new Promise((r) => setTimeout(r, 40))
    ;(componentsView.querySelector('.pd-cmp-row') as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 40))
    expect(componentsView.querySelector('.pd-dom-node')).toBeNull()
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
    const rootMount = mounts.find((m) => (m as { payload: { name: string } }).payload.name === 'Root') as { payload: { id: number; name: string; parentId?: number; props?: unknown } }
    expect(rootMount.payload.name).toBe('Root')
    // ★P1：mount payload 带 props/state 快照（无 props/state → props 空对象）
    expect(rootMount.payload.props).toEqual({})
    expect('state' in rootMount.payload).toBe(false)
    const child = mounts.find((m) => (m as { payload: { name: string } }).payload.name === 'Child') as { payload: { id: number; parentId?: number } }
    expect(child.payload.parentId).toBe(rootMount.payload.id) // parentId 关联根
    expect(events.some((e) => (e as { name: string }).name === 'component.unmount')).toBe(true)
    off()
  })
})
