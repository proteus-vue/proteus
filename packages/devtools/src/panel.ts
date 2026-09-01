// packages/devtools/src/panel.ts
// DevTools 面板装配（devtools-plan UI 层）：tab 布局 + 数据层收集器 + 五视图渲染
//   Timeline / Flamegraph / Errors 直接喂数据层收集器；Route 用轻量适配（router nav 事件 → NavRecord）；
//   State 展示 store 事件聚合快照 + 步骤列表（跨进程只读展示，timeTravel 命令经回调下发）
// ★铁律 1：UI 只消费事件流（TraceBus 唯一入口），不直接碰运行时
import {
  createTimelineCollector,
  createFlamegraphCollector,
  createErrorDiagnoser,
} from '@proteus-vue/devtools-runtime'
import type { TraceEvent, NavRecord, FlameNode, FlameCompareEntry } from '@proteus-vue/devtools-runtime'
import type { DevtoolsSource } from './source'
import { renderTimeline } from './views/timeline'
import { createTimelineZoom } from './views/timeline-interaction'
import { renderFlamegraph } from './views/flamegraph'
import type { FlamegraphViewData } from './views/flamegraph'
import { renderState } from './views/state'
import { renderRoute } from './views/route'
import { renderErrors } from './views/errors'
import { renderComponents } from './views/components'
import type { ComponentNodeData } from './views/components'
import type { DomTreeNode } from './component-trace'
import { renderPages } from './views/pages'
import type { PagesViewData, PageRouteData } from './views/pages'
import { renderGraph } from './views/graph'
import { renderDevice } from './views/device'
import type { DeviceInfo, DeviceMemorySample } from './views/device'
import { serializeStoreSnapshot, parseStoreSnapshot, findSensitiveKeys } from './snapshot-io'
import type { StoreRestoreEntry, SensitiveKeyHit } from './snapshot-io'
import { serializeSession, parseSession } from './session-io'
import type { SessionBundle } from './session-io'
import { createTooltipLayer, bindTooltip, resolveTipData } from './tooltip'
import { createPluginRegistry, createMemoryStorage, createCommandRegistry } from './plugins'
import type { DevToolsPlugin, KVStorage, PluginContext } from './plugins'

export interface DevtoolsPanelOptions {
  source: DevtoolsSource
  /** 时间旅行命令下发（缺省 no-op——业务侧适配器接入后生效） */
  onTimeTravel?: (index: number) => void
  /** ★P1：状态应用（时间旅行回放 / 导入快照恢复共用）——panel 把 restore 快照交给 caller（install → pinia.$patch）；缺省仅面板内回放 */
  onApplyState?: (stores: StoreRestoreEntry[]) => void
  /** ★P1：组件视图选中 → 页面元素高亮（install 侧 scrollIntoView + 描边闪烁） */
  onSelectComponent?: (id: number) => void
  /** M9 插件：第三方自定义视图/事件订阅/命令（激活拓扑序，循环依赖报错，崩溃隔离） */
  plugins?: DevToolsPlugin[]
  /** 插件持久化存储（缺省内存 KV） */
  storage?: KVStorage
  /** ★pages/依赖图面板：应用路由表 + 页面栈（缺省取 source.appInfo() 路由表；均无 → 空态） */
  pages?: PagesViewData
  /** ★M8 设备面板：环境/能力信息钩子（本地面板 install 侧采集；缺省取 source.deviceInfo() 远程命令缓存；均无 → 空态） */
  deviceInfo?: () => DeviceInfo
}

export interface DevtoolsPanel {
  destroy(): void
  /** 切换视图（'timeline' | 'flamegraph' | 'state' | 'route' | 'errors' | 'components' | 'pages' | 'graph' | 'device'） */
  show(view: string): void
  /** ★P0：导出 store 快照 JSON（序列化 + Blob 下载，文件名 proteus-store-snapshot.json；返回序列化文本供程序化消费） */
  exportSnapshot(): string
  /** ★P0：导入 store 快照 JSON（解析校验 → 数据重建 → 视图刷新 → onApplyState 应用回应用） */
  importSnapshot(json: string): void
  /** ★M11 可观测性（M8.2）：导出 SessionBundle（可重放事件日志 + 设备 + store 快照；Blob 下载 proteus-session.json；返回序列化文本） */
  exportSession(): string
  /** ★M11 可观测性（M8.2）：导入 SessionBundle（清空聚合 → 重放事件全视图重建 → onApplyState 应用最新状态） */
  importSession(json: string): void
}

const VIEWS = ['timeline', 'flamegraph', 'state', 'route', 'errors', 'components', 'pages', 'graph', 'device'] as const

const VIEW_ICONS: Record<string, string> = {
  timeline: '⊞',
  flamegraph: '▤',
  state: '☰',
  route: '⇄',
  errors: '✕',
  components: '◫',
  pages: '▦',
  graph: '⌬',
  device: '⚙',
}

export function createDevtoolsPanel(root: HTMLElement, options: DevtoolsPanelOptions): DevtoolsPanel {
  const { source, onTimeTravel } = options

  // ★布局骨架（Vue DevTools 质感）：顶栏 + 侧栏导航 + 内容区
  root.classList.add('pd-panel')
  root.replaceChildren()

  const header = document.createElement('div')
  header.className = 'pd-header'
  const title = document.createElement('div')
  title.className = 'pd-header-title'
  title.textContent = 'Proteus DevTools'
  header.appendChild(title)
  const status = document.createElement('div')
  status.className = 'pd-header-status'
  const dot = document.createElement('span')
  dot.className = 'pd-dot'
  const statusText = document.createElement('span')
  statusText.textContent = '连接中'
  status.appendChild(dot)
  status.appendChild(statusText)
  header.appendChild(status)
  root.appendChild(header)

  const bodyRow = document.createElement('div')
  bodyRow.className = 'pd-body-row'
  const sidebar = document.createElement('div')
  sidebar.className = 'pd-sidebar'
  const content = document.createElement('div')
  content.className = 'pd-content'
  bodyRow.appendChild(sidebar)
  bodyRow.appendChild(content)
  root.appendChild(bodyRow)

  // ★hover 浮层：视图渲染时 attachTip 挂数据 → 面板统一 resolve（元素 → TooltipData）
  const tooltip = createTooltipLayer()
  const unbindTip = bindTooltip(root, tooltip, (target) => resolveTipData(target))

  const views = new Map<string, HTMLElement>()
  const containers = new Map<string, HTMLElement>()
  // ★M9 插件宿主状态（registerView 引用 pluginViews → 声明先于视图注册）
  const pluginViews = new Map<string, { name: string; render: (container: HTMLElement) => void }>()
  const pluginSubs: Array<{ name: string; cb: (e: TraceEvent) => void }> = []
  const crashedPlugins = new Map<string, string>()
  for (const v of VIEWS) {
    const item = document.createElement('div')
    item.className = 'pd-nav-item'
    item.dataset.view = v
    const icon = document.createElement('span')
    icon.className = 'pd-nav-icon'
    icon.textContent = VIEW_ICONS[v]
    const label = document.createElement('span')
    label.textContent = v
    item.appendChild(icon)
    item.appendChild(label)
    sidebar.appendChild(item)
    const container = document.createElement('div')
    container.className = 'pd-view'
    container.dataset.view = v
    views.set(v, container)
    containers.set(v, container)
    content.appendChild(container)
  }
  /** 动态注册视图（M9 插件 addView → 侧栏导航项 + 内容容器；show 遍历 views Map 天然支持动态项） */
  function registerView(id: string, label: string, icon: string | undefined, render: (container: HTMLElement) => void, pluginName: string): void {
    if (views.has(id)) return
    const item = document.createElement('div')
    item.className = 'pd-nav-item'
    item.dataset.view = id
    const ic = document.createElement('span')
    ic.className = 'pd-nav-icon'
    ic.textContent = icon ?? '▸'
    const lb = document.createElement('span')
    lb.textContent = label
    item.appendChild(ic)
    item.appendChild(lb)
    sidebar.appendChild(item)
    const container = document.createElement('div')
    container.className = 'pd-view'
    container.dataset.view = id
    views.set(id, container)
    containers.set(id, container)
    pluginViews.set(id, { name: pluginName, render })
    content.appendChild(container)
  }

  // ★M9 插件宿主：存储/命令/注册表/广播/崩溃隔离（activateAll 异步 → 激活后 scheduleRender 渲染插件视图）
  const storage = options.storage ?? createMemoryStorage()
  const commands = createCommandRegistry()
  const registry = createPluginRegistry(options.plugins ?? [])
  function broadcastToPlugins(e: TraceEvent): void {
    for (const s of pluginSubs.slice()) s.cb(e)
  }
  function crashPlugin(name: string, err: unknown): void {
    crashedPlugins.set(name, err instanceof Error ? err.message : String(err))
    // 卸载该插件全部订阅（核心与其他插件不受影响）
    for (let i = pluginSubs.length - 1; i >= 0; i--) {
      if (pluginSubs[i].name === name) pluginSubs.splice(i, 1)
    }
  }

  // ★timeline 时间窗口交互：wheel 缩放 + 拖拽平移 + 双击重置（窗口变更 → 节流 rerender）
  const zoom = createTimelineZoom(containers.get('timeline') as HTMLElement, () => timeline.spans(), {
    onWindowChange: () => scheduleRender(),
  })

  // ★timeline 虚拟滚动：容器自身纵向滚动 + scrollTop 跟踪（万级 span 分块渲染）
  const timelineView = containers.get('timeline') as HTMLElement
  let tlScrollTop = 0
  let tlViewHeight = 300
  const onTimelineScroll = () => {
    tlScrollTop = timelineView.scrollTop
    scheduleRender()
  }
  timelineView.addEventListener('scroll', onTimelineScroll)

  function show(view: string): void {
    for (const [k, el] of views) el.classList.toggle('pd-view-active', k === view)
    for (const el of Array.from(sidebar.children)) el.classList.toggle('pd-nav-active', (el as HTMLElement).dataset.view === view)
    // ★M8：设备视图激活时采样内存曲线（离开即停）
    if (view === 'device') startMemorySampling()
    else stopMemorySampling()
  }
  sidebar.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('.pd-nav-item') as HTMLElement | null
    if (t?.dataset.view) show(t.dataset.view)
  })

  // 数据层收集器
  const timeline = createTimelineCollector()
  const flame = createFlamegraphCollector()
  const errors = createErrorDiagnoser()
  /** Route 轻量适配：router nav 事件 → NavRecord */
  const navs: NavRecord[] = []
  const inflightNav = new Map<string, { record: NavRecord; endTs?: number }>()
  /** State 聚合：store 事件快照（按 storeId 最新；★去 id 键——payload { id, ...state } 的 id 是元数据非状态） */
  const storeSnapshots = new Map<string, Record<string, unknown>>()
  /** ★P0：store 补丁历史（storeId → [{ stepIndex, state }]）——时间旅行 restore 快照 / 步骤 before·after diff 的数据源 */
  const storePatchHistory = new Map<string, Array<{ stepIndex: number; state: Record<string, unknown> }>>()
  const storeSteps: Array<{ index: number; storeId: string; type: 'patch' | 'action'; name: string; payload: unknown; timestamp: number }> = []
  let stepSeq = 0
  let selectedStore = ''
  /** Components 聚合：component.mount/unmount 事件 → 组件树节点（id → 节点，含 props/state 快照） */
  const componentNodes = new Map<number, ComponentNodeData>()
  /** ★P1.5：选中组件 DOM 树（component.inspect 事件下发 → 详情面板展示） */
  const componentDom = new Map<number, DomTreeNode>()
  /** ★P1：选中组件 id（0 = 未选中；详情面板 + 页面高亮） */
  let selectedComponent = 0

  /** ★当前时间旅行回放位置（null = 未回放/最新；滑块 change 释放时更新，rerender 后保持） */
  let travelIndex: number | null = null

  // ★M11 可观测性（M8.2）：会话事件日志（导出/导入的唯一真相源——重放即全视图重建；不含回声/去重事件）
  const sessionEvents: TraceEvent[] = []
  const SESSION_EVENT_CAP = 20000
  function pushSessionEvent(e: TraceEvent): void {
    sessionEvents.push(e)
    if (sessionEvents.length > SESSION_EVENT_CAP) sessionEvents.shift()
  }

  // ★M8 设备面板：内存采样（面板进程 performance.memory——本地面板与应用同进程数值准确；
  //   远程面板显示面板宿主浏览器内存；无 performance.memory 环境不启动采样）
  const memorySamples: DeviceMemorySample[] = []
  let memoryTimer: ReturnType<typeof setInterval> | null = null
  const MEMORY_SAMPLE_MS = 1000
  function sampleMemory(): void {
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapLimit: number } }
    const mem = perf.memory
    if (!mem) return
    memorySamples.push({ t: Date.now(), used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapLimit })
    if (memorySamples.length > 60) memorySamples.shift()
    scheduleRender()
  }
  function startMemorySampling(): void {
    if (memoryTimer) return
    memoryTimer = setInterval(sampleMemory, MEMORY_SAMPLE_MS)
    sampleMemory()
  }
  function stopMemorySampling(): void {
    if (memoryTimer) {
      clearInterval(memoryTimer)
      memoryTimer = null
    }
  }

  function handleEvent(e: TraceEvent): boolean {
    // ★回放回声：store.patch state 已存在于补丁历史（时间旅行 $patch 恢复触发）——
    //   只更新快照树（显示回放后应用状态），不追加步骤/历史、不进 timeline（避免 rerender 重建滑块）
    if (e.source === 'store' && e.payload && typeof e.payload === 'object') {
      const p = e.payload as Record<string, unknown>
      if (typeof p.id === 'string' && !/action/i.test(e.name)) {
        const state: Record<string, unknown> = {}
        for (const k of Object.keys(p)) if (k !== 'id') state[k] = p[k]
        const hist = storePatchHistory.get(p.id) ?? []
        if (hist.some((h) => JSON.stringify(h.state) === JSON.stringify(state))) {
          storeSnapshots.set(p.id, state)
          if (!selectedStore) selectedStore = p.id
          return true
        }
      }
    }
    timeline.ingest(e)
    flame.ingest(e)
    errors.ingest(e)
    // Route 适配
    if (e.source === 'router') {
      if (e.phase === 'start' && /nav/i.test(e.name)) {
        const p = (e.payload ?? {}) as { from?: { path?: string }; to?: { path?: string; query?: Record<string, string> } }
        const id = e.traceId ?? e.name + '-' + e.timestamp
        inflightNav.set(id, {
          record: {
            id,
            from: { path: p.from?.path ?? '?' },
            to: { path: p.to?.path ?? e.name, query: p.to?.query },
            guards: [],
            durationMs: 0,
            traceId: e.traceId,
            timestamp: e.timestamp,
          },
        })
      } else if (e.phase === 'end' && /nav/i.test(e.name)) {
        const id = e.traceId ?? e.name + '-' + e.timestamp
        const nav = inflightNav.get(id)
        if (nav) {
          nav.record.durationMs = Math.max(0, e.timestamp - nav.record.timestamp)
          navs.push(nav.record)
          inflightNav.delete(id)
          if (navs.length > 500) navs.shift()
        }
      } else if (/guard/i.test(e.name)) {
        // ★守卫事件（point/error）→ 附加到最近开始的进行中导航（守卫徽章）
        let target: { record: NavRecord } | null = null
        let targetTs = -Infinity
        for (const nav of inflightNav.values()) {
          if (nav.record.timestamp > targetTs) {
            target = nav
            targetTs = nav.record.timestamp
          }
        }
        if (target) {
          let result: 'next' | 'redirect' | 'cancel' | 'error' = 'next'
          if (/redirect/i.test(e.name)) result = 'redirect'
          else if (/cancel/i.test(e.name)) result = 'cancel'
          else if (/error/i.test(e.name)) result = 'error'
          target.record.guards.push({ name: e.name, durationMs: 0, result })
        }
      }
    }
    // State 聚合：store.patch → 快照 + 步骤；store.action → 步骤（action 名）
    if (e.source === 'store') {
      if (e.payload && typeof e.payload === 'object') {
        const p = e.payload as Record<string, unknown>
        if (typeof p.id === 'string') {
          const index = stepSeq++
          const isAction = /action/i.test(e.name)
          // ★正常变更（非回声——回声已在函数头处理）：追加快照 + 补丁历史 + 步骤；滑块回到最新
          if (isAction) {
            storeSteps.push({
              index,
              storeId: p.id,
              type: 'action',
              name: String(p.name ?? '?'),
              payload: e.payload,
              timestamp: e.timestamp,
            })
            if (storeSteps.length > 1000) storeSteps.shift()
          } else {
            // ★patch：去 id 存 state 快照 + 追加补丁历史（时间旅行 restore / before·after diff 用）
            const state: Record<string, unknown> = {}
            for (const k of Object.keys(p)) if (k !== 'id') state[k] = p[k]
            storeSnapshots.set(p.id, state)
            if (!selectedStore) selectedStore = p.id
            const list = storePatchHistory.get(p.id) ?? []
            list.push({ stepIndex: index, state })
            storePatchHistory.set(p.id, list)
            storeSteps.push({
              index,
              storeId: p.id,
              type: 'patch',
              name: 'patch',
              payload: e.payload,
              timestamp: e.timestamp,
            })
            if (storeSteps.length > 1000) storeSteps.shift()
          }
          // ★新真实变更 → 时间旅行位置回到最新
          travelIndex = null
        }
      }
    }
    // Components 聚合：mount → 建/计数节点；unmount → 移除；inspect → DOM 树
    if (e.source === 'component' && e.payload && typeof e.payload === 'object') {
      const p = e.payload as { id?: number; name?: string; parentId?: number; dom?: DomTreeNode }
      if (typeof p.id === 'number') {
        // ★inspect 先判（含 'mount' 无关词；独立事件）
        if (/inspect/i.test(e.name)) {
          componentDom.set(p.id, p.dom ?? { tag: '?', children: [] })
        } else if (/unmount/i.test(e.name)) {
          // ★unmount 先判（'component.unmount' 含 'mount' 子串——顺序反了会误入 mount 分支）
          componentNodes.delete(p.id)
          componentDom.delete(p.id)
        } else if (/mount/i.test(e.name)) {
          const existing = componentNodes.get(p.id)
          componentNodes.set(p.id, {
            id: p.id,
            name: p.name ?? 'Anonymous',
            parentId: p.parentId,
            ts: e.timestamp,
            count: (existing?.count ?? 0) + 1,
            // ★P1：mount 时刻 props/state 快照（序列化后 JSON-safe；详情面板展示）
            props: (p as { props?: unknown }).props,
            state: (p as { state?: unknown }).state,
          })
        }
      }
    }
    // ★M11 会话日志（M8.2）：非回声事件进日志（回声已在函数头 return；导出的唯一真相源）
    pushSessionEvent(e)
    return true
  }

  // 火焰图录制控制（工具按钮）+ 对比模式：上次完成录制为 baseline，再次停止时 diff（±10% 高亮）
  // ★声明在 rerender 前：rerender 渲染后重挂按钮（renderFlamegraph replaceChildren 会清空容器）
  const fgControls = document.createElement('div')
  fgControls.className = 'pd-fg-controls'
  const recBtn = document.createElement('button')
  recBtn.className = 'pd-btn'
  recBtn.textContent = '开始录制'
  /** 上次完成录制（对比基线）；再次停止 → flame.compare(baseline) */
  let baseline: FlameNode[] | null = null
  let compareEntries: FlameCompareEntry[] = []
  /** ★火焰图聚焦（zoom）：点击块聚焦其子树 + 面包屑；新录制/返回上级重置 */
  let flameFocus: FlameNode | null = null
  let flamePath: FlameNode[] = []
  /** 按 id 找火焰图节点 + 祖先链（roots 递归） */
  function findFlameNode(id: string): { node: FlameNode; path: FlameNode[] } | null {
    const path: FlameNode[] = []
    const walk = (n: FlameNode): boolean => {
      path.push(n)
      if (n.id === id) return true
      for (const c of n.children) if (walk(c)) return true
      path.pop()
      return false
    }
    for (const r of flame.roots()) if (walk(r)) return { node: path[path.length - 1] as FlameNode, path: path.slice() }
    return null
  }
  recBtn.addEventListener('click', () => {
    // ★新录制：清空聚焦（节点 id 重建）
    flameFocus = null
    flamePath = []
    if (flame.recording) {
      flame.stop()
      recBtn.textContent = '开始录制'
      // 对比模式：有基线 → 本次 vs 上次；当前树成为新基线（支持连续多次录制两两对比）
      // ★baseline 存 roots()（嵌套树）而非 nodes() 扁平列表——compare 递归遍历，扁平会重复计数 children
      if (baseline) compareEntries = flame.compare(baseline)
      else compareEntries = []
      baseline = flame.roots()
    } else {
      compareEntries = []
      flame.start()
      recBtn.textContent = '停止录制'
    }
    rerender()
  })
  fgControls.appendChild(recBtn)

  // ─── ★P0：状态快照导出 / 导入 / 时间旅行 restore ───────────────────────────────
  /** 回放到第 index 步时的 restore 快照（各 store 取 stepIndex <= index 的最后一次 patch 状态） */
  function restoreAt(index: number): StoreRestoreEntry[] {
    const out: StoreRestoreEntry[] = []
    for (const [id, history] of storePatchHistory) {
      let state: Record<string, unknown> | null = null
      for (const h of history) {
        if (h.stepIndex <= index) state = h.state
        else break
      }
      if (state) out.push({ id, state })
    }
    return out
  }

  /** ★双向调试：路径写入（中间节点缺失 → 中止不改坏结构） */
  function setPathAt(obj: Record<string, unknown>, path: Array<string | number>, value: unknown): boolean {
    if (path.length === 0) return false
    let cur: unknown = obj
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i] as string
      const next = (cur as Record<string, unknown>)[k]
      if (next === null || typeof next !== 'object') return false
      cur = next
    }
    const last = path[path.length - 1] as string
    if (Array.isArray(cur)) {
      ;(cur as unknown[])[Number(last)] = value
    } else {
      ;(cur as Record<string, unknown>)[last] = value
    }
    return true
  }

  /** ★双向调试：值编辑写回（面板快照先更新 + 本地 onApplyState + 远程命令双通道——与 timeTravel 同语义） */
  function editStoreValue(storeId: string, path: Array<string | number>, value: unknown): void {
    const cur = storeSnapshots.get(storeId)
    if (!cur) return
    // JSON 深克隆（铁律 3：状态必须 JSON-safe）→ 路径写入 → 面板快照更新 + 双通道写回
    const next = JSON.parse(JSON.stringify(cur)) as Record<string, unknown>
    if (!setPathAt(next, path, value)) return
    storeSnapshots.set(storeId, next)
    options.onApplyState?.([{ id: storeId, state: next }])
    source.sendCommand?.('Proteus.restoreStores', { stores: [{ id: storeId, state: next }] })
    // 回声去重：$patch 回声 state 不在历史 → 作为真实变更追加步骤（时间线可见编辑记录）
    scheduleRender()
  }

  /** 导出快照 JSON（serializeStoreSnapshot 纯逻辑 + Blob 下载；无 createObjectURL 环境仅返回文本）
   *  ★M10 权限最小化（M7.3）：state 含敏感键（password/token/authorization/idcard/phone）→ 二次确认弹窗列出字段；拒绝则不下发 */
  function exportSnapshot(): string {
    const stores = Array.from(storeSnapshots.entries()).map((kv) => ({ id: kv[0], state: kv[1] }))
    const json = serializeStoreSnapshot({ stores, steps: storeSteps.map((s) => ({ index: s.index, storeId: s.storeId, type: s.type, name: s.name, payload: s.payload, timestamp: s.timestamp })) })
    // ★M7.3：敏感键二次确认（列 store + 字段；确认函数缺省 window.confirm，无确认环境直接放行）
    const sensitive = findSensitiveKeys(stores)
    if (sensitive.length) {
      const summary = sensitive.map((h) => `${h.storeId}: ${h.keys.join(', ')}`).join('；')
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`快照包含敏感字段（将一并导出）：\n${summary}\n\n确认导出？`) : true
      if (!ok) return ''
    }
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return json
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'proteus-store-snapshot.json'
    a.click()
    URL.revokeObjectURL(url)
    return json
  }

  /** 导入快照 JSON：parseStoreSnapshot 校验 → 数据重建（stores/steps/patch 历史）→ 刷新 → onApplyState 应用回应用 */
  function importSnapshot(json: string): void {
    const parsed = parseStoreSnapshot(json)
    if (!parsed) return
    storeSnapshots.clear()
    storePatchHistory.clear()
    storeSteps.length = 0
    stepSeq = 0
    selectedStore = ''
    for (const s of parsed.stores) {
      storeSnapshots.set(s.id, s.state)
      if (!selectedStore) selectedStore = s.id
    }
    for (const st of parsed.steps) {
      const index = stepSeq++
      storeSteps.push({ index, storeId: st.storeId, type: st.type, name: st.name, payload: st.payload, timestamp: st.timestamp })
      if (st.type === 'patch' && st.payload && typeof st.payload === 'object') {
        // ★重建补丁历史：patch 步骤 payload 含 id（与实时记录一致）——去 id 还原 state
        const p = st.payload as Record<string, unknown>
        const state: Record<string, unknown> = {}
        for (const k of Object.keys(p)) if (k !== 'id') state[k] = p[k]
        const list = storePatchHistory.get(st.storeId) ?? []
        list.push({ stepIndex: index, state })
        storePatchHistory.set(st.storeId, list)
      }
    }
    scheduleRender()
    // ★应用恢复：快照状态写回应用侧（install → pinia.$patch）；无 pinia 时仅面板内展示
    options.onApplyState?.(Array.from(storeSnapshots.entries()).map((kv) => ({ id: kv[0], state: kv[1] })))
  }

  /** ★M11 可观测性（M8.2）：导出 SessionBundle（可重放事件日志 + 设备 + store 快照；Blob 下载 proteus-session.json） */
  function exportSession(): string {
    const json = serializeSession({
      events: sessionEvents,
      device: options.deviceInfo ? options.deviceInfo() : ((source.deviceInfo?.() as DeviceInfo | undefined) ?? undefined),
      stores: Array.from(storeSnapshots.entries()).map((kv) => ({ id: kv[0], state: kv[1] })),
      steps: storeSteps.map((s) => ({ index: s.index, storeId: s.storeId, type: s.type, name: s.name, payload: s.payload, timestamp: s.timestamp })),
    })
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return json
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'proteus-session.json'
    a.click()
    URL.revokeObjectURL(url)
    return json
  }

  /** ★M11 可观测性（M8.2）：导入 SessionBundle——清空聚合 → 重放事件全视图重建（timeline/errors/router-nav/store/组件）→ onApplyState 应用最新状态 */
  function importSession(json: string): void {
    const parsed = parseSession(json)
    if (!parsed) return
    // 清空全部聚合（collector + 适配聚合）——重放从零重建
    timeline.clear()
    errors.clear()
    navs.length = 0
    inflightNav.clear()
    storeSnapshots.clear()
    storePatchHistory.clear()
    storeSteps.length = 0
    stepSeq = 0
    travelIndex = null
    selectedStore = ''
    componentNodes.clear()
    componentDom.clear()
    selectedComponent = 0
    sessionEvents.length = 0
    // 重放（handleEvent 单真相源：聚合 + 会话日志一起重建；火焰图为录制作用域不重建）
    for (const e of parsed.events) handleEvent(e)
    // 应用侧恢复：最新 store 状态写回（对齐 importSnapshot 语义）
    options.onApplyState?.(Array.from(storeSnapshots.entries()).map((kv) => ({ id: kv[0], state: kv[1] })))
    scheduleRender()
  }

  /** 时间旅行（滑块 change 释放触发）：记录回放位置 + 命令下发（onTimeTravel 旧语义）+ 真实 restore 应用（本地 onApplyState / 远程 sendCommand 双通道） */
  function timeTravel(index: number): void {
    travelIndex = index
    options.onTimeTravel?.(index)
    const restore = restoreAt(index)
    // ★本地悬浮面板：同页直接 $patch；远程面板（WS 源）：命令下发 → relay → 应用侧执行（无 onApplyState 的路径）
    options.onApplyState?.(restore)
    source.sendCommand?.('Proteus.restoreStores', { stores: restore })
  }

  function rerender(): void {
    tlViewHeight = timelineView.clientHeight || 300
    renderTimeline(containers.get('timeline') as HTMLElement, { spans: timeline.spans(), window: zoom.getWindow() ?? undefined, virtual: { scrollTop: tlScrollTop, viewHeight: tlViewHeight } })
    // ★火焰图聚焦数据（焦点子树 + 面包屑）
    function fgData(): FlamegraphViewData {
      // ★渲染用 roots（嵌套树）——nodes() 扁平列表会重复渲染 children
      const data: FlamegraphViewData = { nodes: flame.roots(), compare: compareEntries.length ? compareEntries : undefined }
      if (flameFocus && flamePath.length) {
        data.focus = flameFocus
        data.breadcrumb = flamePath.map((n) => ({ id: n.id, name: n.source + '.' + n.name }))
      }
      return data
    }
    renderFlamegraph(containers.get('flamegraph') as HTMLElement, fgData(), {
      // ★点击块 → 聚焦缩放（zoom 到该节点子树）
      onFocus: (id) => {
        const found = findFlameNode(id)
        if (found) {
          flameFocus = found.node
          flamePath = found.path
          scheduleRender()
        }
      },
      // ★返回上级（面包屑上一级；根 → 退出聚焦）
      onFocusUp: () => {
        if (flamePath.length > 1) {
          const parent = findFlameNode(flamePath[flamePath.length - 2].id)
          if (parent) {
            flameFocus = parent.node
            flamePath = parent.path
          } else {
            flameFocus = null
            flamePath = []
          }
        } else {
          flameFocus = null
          flamePath = []
        }
        scheduleRender()
      },
    })
    const flameContainer = containers.get('flamegraph') as HTMLElement
    flameContainer.insertBefore(fgControls, flameContainer.firstChild)
    renderErrors(containers.get('errors') as HTMLElement, { reports: errors.diagnose() })
    renderRoute(containers.get('route') as HTMLElement, { records: navs })
    renderState(
      containers.get('state') as HTMLElement,
      {
        snapshot: { version: 1, takenAt: Date.now(), stores: Array.from(storeSnapshots.entries()).map((kv) => ({ id: kv[0], state: kv[1] })) },
        // ★P0：真实 before/after（patch 步骤：该 store 补丁历史中前一条/本条状态；action 步骤无状态变更）
        steps: storeSteps.map((s) => {
          let before: Record<string, unknown> = {}
          let after: Record<string, unknown> = {}
          if (s.type === 'patch') {
            const hist = storePatchHistory.get(s.storeId) ?? []
            const idx = hist.findIndex((h) => h.stepIndex === s.index)
            if (idx >= 0) {
              after = hist[idx].state
              if (idx > 0) before = hist[idx - 1].state
            }
          }
          return { index: s.index, storeId: s.storeId, type: s.type, payload: s.payload, timestamp: s.timestamp, before, after }
        }),
        selectedStore,
        // ★滑块回放位置（rerender 后保持；新真实变更重置为最新）
        travelIndex: travelIndex ?? undefined,
      },
      {
        onTimeTravel: timeTravel,
        onSelectStore: (id) => {
          selectedStore = id
          scheduleRender()
        },
        onExport: exportSnapshot,
        onImport: importSnapshot,
        // ★M11 可观测性（M8.2）：会话导出/导入（完整还原另一环境）
        onExportSession: exportSession,
        onImportSession: importSession,
        // ★双向调试：值编辑 → 面板快照 + 本地/远程双通道写回（$patch 真实状态）
        onEditValue: editStoreValue,
      },
    )
    // Components / Pages / Graph 视图
    // ★M8 设备面板：本地面板取 options.deviceInfo 钩子；远程面板取 source.deviceInfo() 命令缓存（均无 → 空态）
    const deviceInfo = options.deviceInfo ? options.deviceInfo() : ((source.deviceInfo?.() as DeviceInfo | undefined) ?? undefined)
    renderDevice(containers.get('device') as HTMLElement, { info: deviceInfo, memory: memorySamples.slice() })
    renderComponents(
      containers.get('components') as HTMLElement,
      { nodes: Array.from(componentNodes.values()), selectedId: selectedComponent || undefined, dom: selectedComponent ? componentDom.get(selectedComponent) : undefined },
      {
        // ★P1：点击选中（同 id 再点取消选中）；首次选中 → 页面元素高亮回调
        onSelect: (id) => {
          if (selectedComponent === id) {
            selectedComponent = 0
          } else {
            selectedComponent = id
            options.onSelectComponent?.(id)
          }
          scheduleRender()
        },
      },
    )
    renderPages(containers.get('pages') as HTMLElement, resolvePagesData())
    renderGraph(containers.get('graph') as HTMLElement, { routes: resolvePagesData().routes })
    // M9 插件视图渲染（崩溃 → 占位提示；render 抛错 → 当场标记崩溃，核心不崩）
    for (const [id, pv] of pluginViews) {
      const container = containers.get(id) as HTMLElement
      const err = crashedPlugins.get(pv.name)
      if (err !== undefined) {
        renderPluginCrash(container, pv.name, err)
      } else {
        try {
          pv.render(container)
        } catch (e) {
          crashPlugin(pv.name, e)
          renderPluginCrash(container, pv.name, e instanceof Error ? e.message : String(e))
        }
      }
    }
  }

  /** 插件崩溃占位（面板提示「插件崩溃」，核心不受影响） */
  function renderPluginCrash(container: HTMLElement, name: string, err: string): void {
    container.replaceChildren()
    const card = document.createElement('div')
    card.className = 'pd-plugin-crash'
    const t = document.createElement('div')
    t.className = 'pd-plugin-crash-title'
    t.textContent = '插件崩溃：' + name
    const m = document.createElement('div')
    m.className = 'pd-plugin-crash-msg'
    m.textContent = err
    card.appendChild(t)
    card.appendChild(m)
    container.appendChild(card)
  }

  /** 渲染节流（事件高频 → 16ms 帧窗口） */
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRender(): void {
    if (renderTimer) return
    renderTimer = setTimeout(() => {
      renderTimer = null
      rerender()
    }, 16)
  }
  /** pages 数据：options.pages 优先 → source.appInfo()（Proteus.appInfo 协议，{ routes }）兜底 */
  function resolvePagesData(): PagesViewData {
    if (options.pages) return options.pages
    const info = source.appInfo?.() as { routes?: PageRouteData[] } | undefined
    return { routes: info?.routes ?? [] }
  }
  let statusConnected = false
  const off = source.onEvent((e: TraceEvent) => {
    // ★回放回声（store.patch 历史值）已提前处理——handleEvent 返回 false 时跳过 rerender（拖动中不重建滑块）
    if (!handleEvent(e)) {
      broadcastToPlugins(e)
      return
    }
    broadcastToPlugins(e)
    scheduleRender()
    // ★连接状态：收到首个事件 → 已连接（无 onStatus 数据源的兼容路径；WS 源走下方 onStatus）
    if (!statusConnected) {
      statusConnected = true
      dot.classList.add('pd-dot-on')
      statusText.textContent = '已连接'
    }
  })
  // ★连接状态跟随数据源：WS 连上即「已连接」（不再等首个事件——面板先开/应用后跑时避免一直「连接中」）；
  //   断开显示「已断开」，重连成功自动恢复
  const offStatus = source.onStatus?.((s) => {
    if (s === 'connected' && !statusConnected) {
      statusConnected = true
      dot.classList.add('pd-dot-on')
      statusText.textContent = '已连接'
    } else if (s === 'closed') {
      statusConnected = false
      dot.classList.remove('pd-dot-on')
      statusText.textContent = '已断开'
    }
  })

  // 挂载录制按钮（初始：flamegraph 容器最前）
  ;(containers.get('flamegraph') as HTMLElement).insertBefore(fgControls, (containers.get('flamegraph') as HTMLElement).firstChild)

  // ★M9 命令面板（palette）：⚡ 按钮 → 下拉列出已注册命令，点击执行
  root.style.position = 'relative'
  const paletteBtn = document.createElement('button')
  paletteBtn.className = 'pd-btn pd-palette-btn'
  paletteBtn.textContent = '⚡'
  paletteBtn.title = '命令面板'
  const palette = document.createElement('div')
  palette.className = 'pd-palette'
  palette.style.display = 'none'
  function openPalette(): void {
    palette.replaceChildren()
    const ids = commands.list()
    if (ids.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'pd-palette-empty'
      empty.textContent = '暂无命令'
      palette.appendChild(empty)
    } else {
      for (const id of ids) {
        const item = document.createElement('div')
        item.className = 'pd-palette-item'
        item.textContent = id
        item.addEventListener('click', () => {
          commands.run(id)
          palette.style.display = 'none'
        })
        palette.appendChild(item)
      }
    }
    palette.style.display = 'block'
  }
  paletteBtn.addEventListener('click', () => {
    if (palette.style.display === 'none') openPalette()
    else palette.style.display = 'none'
  })
  header.insertBefore(paletteBtn, status)
  root.appendChild(palette)

  show('timeline')
  rerender()

  // ★M9 插件激活：拓扑序（循环依赖 → activateAll 抛错，捕获提示）；单个插件崩溃不阻塞其余
  if ((options.plugins ?? []).length) {
    registry
      .activateAll((plugin) => {
        const pluginName = plugin.name
        return {
          name: pluginName,
          bus: {
            on(cb) {
              const wrapped = (e: TraceEvent) => {
                try {
                  cb(e)
                } catch (err) {
                  crashPlugin(pluginName, err)
                }
              }
              pluginSubs.push({ name: pluginName, cb: wrapped })
              return () => {
                for (let i = pluginSubs.length - 1; i >= 0; i--) {
                  if (pluginSubs[i].cb === wrapped) pluginSubs.splice(i, 1)
                }
              }
            },
          },
          panel: {
            addView(id, opts) {
              registerView(id, opts.label, opts.icon, opts.render, pluginName)
            },
          },
          commands,
          storage,
        }
      })
      .then(() => scheduleRender())
      .catch((err: unknown) => {
        // 循环依赖等激活级错误：面板状态区提示，面板主体不受影响
        console.error('[proteus-devtools] 插件激活失败', err)
        statusText.textContent = '插件激活失败'
      })
  }

  return {
    destroy() {
      off()
      offStatus?.()
      unbindTip()
      tooltip.dispose()
      zoom.destroy()
      timelineView.removeEventListener('scroll', onTimelineScroll)
      stopMemorySampling()
      pluginSubs.length = 0
      source.close()
      if (renderTimer) clearTimeout(renderTimer)
      root.replaceChildren()
    },
    show,
    exportSnapshot,
    importSnapshot,
    exportSession,
    importSession,
  }
}
