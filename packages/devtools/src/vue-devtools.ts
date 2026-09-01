// packages/devtools/src/vue-devtools.ts
// ★接入 Vue 官方 DevTools：把 Proteus 事件流 → Vue DevTools Timeline 面板（@vue/devtools-api 8.x）
//   浏览器扩展装 Vue DevTools → Timeline 面板出现 "Proteus" layer → 编译/路由/API/生命周期事件可见
//   （组件树 / Pinia 状态由 Vue DevTools 原生展示——Proteus Web 端即标准 Vue 应用，零代码）
// ★安全降级：setupDevtoolsPlugin 在无扩展/无 hook 时不调用回调 → 生产零开销（对齐 plan 铁律 2）
// ★结构类型注入：api 形状兼容 @vue/devtools-api 的 DevtoolsApi（addTimelineLayer/addTimelineEvent），可 mock 单测
import type { TraceEvent } from '@proteus-vue/devtools-runtime'
import type { DevtoolsSource } from './source'

/** @vue/devtools-api DevtoolsApi 的结构类型（只取 Timeline 能力面） */
export interface VueDevtoolsApiLike {
  addTimelineLayer(options: { id: string; label: string; color?: number }): void
  addTimelineEvent(options: { layerId: string; event: unknown }): void
}

export interface VueDevtoolsTimelineOptions {
  /** Proteus 事件源（TraceBus 直连 / WS-CDP / mock） */
  source: DevtoolsSource
  /** layer 颜色（Vue DevTools Timeline 色板，缺省紫蓝） */
  color?: number
}

export interface VueDevtoolsTimeline {
  /** 卸载：取消事件订阅 */
  dispose(): void
  /** 已注册的 layer id */
  readonly layerId: string
}

const LAYER_ID = 'proteus'

/** 事件 → Vue DevTools TimelineEvent（按 traceId 分组——同链路事件归组） */
function toTimelineEvent(e: TraceEvent): unknown {
  return {
    time: e.timestamp,
    title: e.source + '.' + e.name,
    subtitle: e.phase,
    data: {
      source: e.source,
      name: e.name,
      phase: e.phase,
      traceId: e.traceId,
      payload: e.payload,
    },
    groupId: e.traceId ?? e.source,
  }
}

/**
 * 接入 Vue 官方 DevTools：注册 'proteus' Timeline layer，把事件流推送为 Timeline 事件。
 * 用法（应用侧）：setupDevtoolsPlugin({ id: 'proteus', label: 'Proteus', app }, (api) => {
 *   installProteusTimeline(api, { source })
 * })
 */
export function installProteusTimeline(api: VueDevtoolsApiLike, options: VueDevtoolsTimelineOptions): VueDevtoolsTimeline {
  api.addTimelineLayer({ id: LAYER_ID, label: 'Proteus', color: options.color ?? 11101205 })
  const off = options.source.onEvent((e: TraceEvent) => {
    api.addTimelineEvent({ layerId: LAYER_ID, event: toTimelineEvent(e) })
  })
  return {
    dispose: off,
    get layerId() {
      return LAYER_ID
    },
  }
}

// ═══════════ 自定义 Inspector（vue-devtools-plan 四个中的 Web 可落地项）═══════════
// 规划：proteus-native-tree（App 依赖）/ proteus-jsi·ifr（Skyline 依赖）/ proteus-style-safety
// （运行时拦截记录器缺失——style-safety 当前为编译期校验）/ **proteus-app-config（本次落地：数据源 getConfig 就绪 + 编辑回写）**

/** 自定义 Inspector 所需的 @vue/devtools-api 形状（结构类型注入，可 mock 单测）
 * ★state 是「分组名 → 状态行数组」对象（CustomInspectorState：`{ 分组: [{key, value}] }`）——
 *   传数组会让 Vue DevTools 渲染不出分组详情（2026-09 实测根因） */
export interface VueDevtoolsInspectorApiLike {
  addInspector(options: { id: string; label: string; icon?: string }): void
  on: {
    getInspectorTree(cb: (payload: { inspectorId: string; rootNodes?: unknown[] }) => void): void
    getInspectorState(cb: (payload: { inspectorId: string; nodeId: string; state?: Record<string, Array<{ key: string; value: unknown }>> }) => void): void
    editInspectorState(cb: (payload: { inspectorId: string; nodeId: string; path: string[]; state: { value: unknown } }) => void): void
  }
}

export interface ProteusInspectorsOptions {
  /** 应用配置读取（缺省空对象；业务侧传 getConfig） */
  getConfig?: () => Record<string, unknown>
  /** 配置更新（编辑回写——Web 端响应式更新白给；缺省 no-op） */
  setConfig?: (patch: Record<string, unknown>) => void
  /**
   * style-safety 拦截记录读取（G-31 runtime guard.records()；提供则注册 proteus-style-safety inspector）
   * 对齐 vue-devtools-plan §3：`p.state = [{ key: 'rejected', value: getRejectedRecords() }]`
   */
  getStyleSafetyRecords?: () => Array<{ prop: string; value: unknown; reason: string; ts: number }>
  /**
   * 路由表（父引用嵌套树 → proteus-router Inspector：Vue DevTools 内置 Router 面板只认 vue-router，
   * 我们用自己的路由 → 自定义 Inspector 展示路由树 + 详情）
   */
  pages?: { routes: Array<{ name: string; path: string; parent?: string; subPackage?: string; meta?: Record<string, unknown> }> }
  /**
   * 导航记录（动态数据 → proteus-router Inspector 的「导航记录」节点：当前路由 + 最近导航历史，
   * 对齐 vue-router 面板的 Router 记录形态；由 install 侧聚合 router 事件提供）
   * 记录含完整导航状态：from/to/耗时/时间/traceId/守卫链
   */
  getRouterState?: () => {
    currentRoute?: string
    records: Array<{
      from: string
      to: string
      query?: Record<string, string>
      durationMs: number
      timestamp: number
      traceId?: string
      guards: Array<{ name: string; result: 'next' | 'cancel' | 'redirect' | 'error' }>
    }>
  }
}

export interface ProteusInspectors {
  dispose(): void
}

/** 按 path 构建嵌套 patch（editInspectorState 的 path → setConfig DeepPartial）
 * ★groupKey 兼容：Vue DevTools 编辑 Inspector state 的 path 可能含分组名前缀（如 ['resolved','app','name']）——剥掉首段 */
function pathToPatch(path: string[], value: unknown, groupKey?: string): Record<string, unknown> {
  let p = path
  if (groupKey && p[0] === groupKey) p = p.slice(1)
  const root: Record<string, unknown> = {}
  let cur = root
  for (let i = 0; i < p.length - 1; i++) {
    const next: Record<string, unknown> = {}
    cur[p[i]] = next
    cur = next
  }
  cur[p[p.length - 1]] = value
  return root
}

/** config 顶层键 → Inspector 状态行（平铺多行，Vue DevTools 分组下直接展示各配置项） */
function configToStateRows(config: Record<string, unknown>): Array<{ key: string; value: unknown }> {
  const keys = Object.keys(config)
  return keys.length ? keys.map((k) => ({ key: k, value: config[k] })) : [{ key: '(empty)', value: {} }]
}

const APP_CONFIG_INSPECTOR = 'proteus-app-config'
const STYLE_SAFETY_INSPECTOR = 'proteus-style-safety'
const ROUTER_INSPECTOR = 'proteus-router'
/** InspectorNodeTag 颜色（textColor/backgroundColor 必填 number） */
const TAG_STYLE = { textColor: 0xffffff, backgroundColor: 0x1a7af8 }

/** 路由表 → 嵌套树节点（parent 引用构建父子层级；无 parent/父缺失 → 根）
 * ★currentRoute 命中 → 节点加「当前」tag（高亮，Router Inspector 直观看到当前所在路由） */
function buildRouterTree(
  routes: Array<{ name: string; path: string; parent?: string; subPackage?: string; meta?: Record<string, unknown> }>,
  currentRoute?: string,
): Array<{ id: string; label: string; tags?: Array<{ label: string; textColor: number; backgroundColor: number }>; children?: unknown[] }> {
  const byName = new Map(routes.map((r) => [r.name, r]))
  const childrenOf = new Map<string, Array<{ name: string; path: string; parent?: string; subPackage?: string; meta?: Record<string, unknown> }>>()
  const roots: Array<{ name: string; path: string; parent?: string; subPackage?: string; meta?: Record<string, unknown> }> = []
  for (const r of routes) {
    if (r.parent && byName.has(r.parent)) {
      const list = childrenOf.get(r.parent) ?? []
      list.push(r)
      childrenOf.set(r.parent, list)
    } else {
      roots.push(r)
    }
  }
  const CURRENT_STYLE = { textColor: 0xffffff, backgroundColor: 0x07c160 }
  const toNode = (r: { name: string; path: string; parent?: string; subPackage?: string; meta?: Record<string, unknown> }): {
    id: string
    label: string
    tags?: Array<{ label: string; textColor: number; backgroundColor: number }>
    children?: unknown[]
  } => ({
    id: r.name,
    label: (r.meta?.title as string | undefined) ?? r.name,
    // ★当前路由高亮（path 匹配 → 绿色「当前」tag）
    tags: [
      ...(r.path === currentRoute ? [{ label: '当前', ...CURRENT_STYLE }] : []),
      { label: r.path, ...TAG_STYLE },
    ],
    children: (childrenOf.get(r.name) ?? []).map(toNode),
  })
  return roots.map(toNode)
}

/**
 * 注册自定义 Inspector（vue-devtools-plan §3 可落地项）：
 *   `proteus-app-config`——App Config 当前生效值 + 编辑回写（对齐规划 §6 双向调试的 Web 形态）
 *   `proteus-style-safety`——运行时拦截记录（G-31 guard.records()，需提供 getStyleSafetyRecords）
 *   `proteus-router`——路由嵌套树 + 详情（★Vue DevTools 内置 Router 面板只认 vue-router，自研路由需自定义 Inspector）
 * 用法（应用侧）：setupDevtoolsPlugin({ id: 'proteus', label: 'Proteus', app }, (api) => {
 *   installProteusInspectors(api, { getConfig, setConfig, getStyleSafetyRecords, pages })
 * })
 */
export function installProteusInspectors(api: VueDevtoolsInspectorApiLike, options: ProteusInspectorsOptions = {}): ProteusInspectors {
  api.addInspector({ id: APP_CONFIG_INSPECTOR, label: 'App Config', icon: 'settings' })
  // ★必须有树节点可点（kit 只在 selectedNodeId 非空时请求 state——无树节点 → 永远 No Data）
  api.on.getInspectorTree((payload) => {
    if (payload.inspectorId !== APP_CONFIG_INSPECTOR) return
    payload.rootNodes = [{ id: 'root', label: 'App Config' }]
  })
  api.on.getInspectorState((payload) => {
    if (payload.inspectorId !== APP_CONFIG_INSPECTOR) return
    // ★展示优化：config 顶层键平铺成多行（分组「resolved」下直接是各配置项，非单行 value 包裹）
    payload.state = { resolved: configToStateRows(options.getConfig ? options.getConfig() : {}) }
  })
  if (options.setConfig) {
    api.on.editInspectorState((payload) => {
      if (payload.inspectorId !== APP_CONFIG_INSPECTOR) return
      // 面板改路径值 → 构建嵌套 patch 下发（对齐规划 §6：Web 端响应式数据回写）
      // ★groupKey 兼容：Vue DevTools 编辑 path 可能带分组名前缀（'resolved'）
      options.setConfig?.(pathToPatch(payload.path, payload.state.value, 'resolved'))
    })
  }
  if (options.getStyleSafetyRecords) {
    api.addInspector({ id: STYLE_SAFETY_INSPECTOR, label: 'Style Safety', icon: 'shield' })
    api.on.getInspectorTree((payload) => {
      if (payload.inspectorId !== STYLE_SAFETY_INSPECTOR) return
      payload.rootNodes = [{ id: 'root', label: 'Style Safety' }]
    })
    api.on.getInspectorState((payload) => {
      if (payload.inspectorId !== STYLE_SAFETY_INSPECTOR) return
      // ★展示优化：拦截记录平铺成多行（分组「rejected」下每条 prop 一行，展开 value/reason/ts）
      const records = (options.getStyleSafetyRecords as () => Array<{ prop: string; value: unknown; reason: string; ts: number }>)()
      payload.state = {
        rejected: records.map((r, i) => ({ key: r.prop || '#' + i, value: { value: r.value, reason: r.reason, ts: r.ts } })),
      }
    })
  }
  if (options.pages) {
    // ★Router Inspector：路由嵌套树（parent 父子层级）+ 导航记录（当前路由 + 最近导航历史）
    api.addInspector({ id: ROUTER_INSPECTOR, label: 'Router', icon: 'route' })
    api.on.getInspectorTree((payload) => {
      if (payload.inspectorId !== ROUTER_INSPECTOR) return
      const routerState = options.getRouterState?.()
      const nodes = buildRouterTree(options.pages?.routes ?? [], routerState?.currentRoute)
      // ★「导航记录」节点置顶：动态数据（当前路由 + 最近记录）——对齐 vue-router 面板的路由记录形态
      if (routerState) {
        const recordNodes = routerState.records
          .slice(-20)
          .reverse()
          .map((r) => ({
            id: 'rec-' + r.timestamp,
            // ★带参导航显示 query（如 pages/user/profile?id=1）
            label: `${r.from} → ${r.to}${r.query && Object.keys(r.query).length ? '?' + new URLSearchParams(r.query).toString() : ''}`,
            tags: [{ label: r.durationMs + 'ms', ...TAG_STYLE }],
          }))
        nodes.unshift({
          id: 'proteus-records',
          label: `导航记录 (${routerState.records.length})`,
          tags: routerState.currentRoute ? [{ label: '当前: ' + routerState.currentRoute, ...TAG_STYLE }] : undefined,
          children: recordNodes,
        })
      }
      payload.rootNodes = nodes
    })
    api.on.getInspectorState((payload) => {
      if (payload.inspectorId !== ROUTER_INSPECTOR) return
      // 导航记录分组（点「导航记录」根节点）
      if (payload.nodeId === 'proteus-records') {
        const state = options.getRouterState?.()
        payload.state = {
          导航记录: [
            { key: 'currentRoute', value: state?.currentRoute ?? '—' },
            { key: 'records', value: (state?.records ?? []).slice(-50).reverse() },
          ],
        }
        return
      }
      // 单条导航记录（完整状态：from/to/耗时/时间/traceId/守卫链）
      if (payload.nodeId.startsWith('rec-')) {
        const rec = (options.getRouterState?.()?.records ?? []).find((r) => 'rec-' + r.timestamp === payload.nodeId)
        payload.state = rec
          ? {
              导航状态: [
                { key: 'from', value: rec.from },
                { key: 'to', value: rec.to },
                { key: 'query', value: rec.query ?? {} },
                { key: 'durationMs', value: rec.durationMs },
                { key: 'timestamp', value: rec.timestamp },
                { key: 'traceId', value: rec.traceId ?? '—' },
                { key: 'guards', value: rec.guards },
              ],
            }
          : {}
        return
      }
      const route = (options.pages?.routes ?? []).find((r) => r.name === payload.nodeId)
      if (!route) {
        payload.state = {}
        return
      }
      payload.state = {
        路由: [
          { key: 'path', value: route.path },
          { key: 'parent', value: route.parent ?? '—' },
          { key: 'subPackage', value: route.subPackage ?? '—' },
          { key: 'meta', value: route.meta ?? {} },
        ],
      }
    })
  }
  return {
    dispose() {
      // @vue/devtools-api 无卸载 Inspector 的公共 API（随 plugin 生命周期）
    },
  }
}
