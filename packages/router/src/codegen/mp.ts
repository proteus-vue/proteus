// packages/router/src/codegen/mp.ts
// M4 — 小程序端 codegen（docs/proteus-router-plan 04）：RouteNode[] → app.json 页配置
// ★Skyline 是 MPA：children 不能原生嵌套 → 平铺 pages 数组，嵌套信息降级为 meta.__parent
//   （运行时 tabBar / layout 消费）；routeType 由运行时 navigateTo 传参（page.json 无需声明，真机归档）
// 合并策略：mergeAppJson(existing, generated)——<route> 字段 > 用户手写 app.json > 默认值
import type { RouteNode, RouteMeta } from '../types'
import { mpRouteType } from '../transforms/transform-transition'

export interface MpPageConfig {
  path: string
  routeType?: string
  /** 嵌套父路由（降级保留：小程序无原生嵌套） */
  __parent?: string
  /** M6：redirect 字段（小程序无原生 redirect——运行时 onLoad redirectTo 模拟；此处标注供 codegen/运行时消费） */
  redirect?: string
  componentFramework: 'glass-easel'
  renderer: 'skyline'
  styleIsolation: 'isolated'
  lazyCodeLoading: 'requiredComponents'
}

/** 嵌套树 → 平铺条目（node + 父链信息：小程序无原生嵌套，__parent 降级保留） */
export function flattenNodes(nodes: RouteNode[], parent?: string): Array<{ node: RouteNode; parent?: string }> {
  const out: Array<{ node: RouteNode; parent?: string }> = []
  for (const n of nodes) {
    out.push({ node: n, parent })
    if (n.children.length > 0) {
      out.push(...flattenNodes(n.children, n.name ?? n.path))
    }
  }
  return out
}

/** 单节点 → 页配置（path 由路由 path 去首斜杠；routeType 映射；redirect 标注） */
export function toPageConfig(node: RouteNode, parent?: string): MpPageConfig {
  const cfg: MpPageConfig = {
    path: node.path.replace(/^\//, ''),
    componentFramework: 'glass-easel',
    renderer: 'skyline',
    styleIsolation: 'isolated',
    lazyCodeLoading: 'requiredComponents',
  }
  const rt = mpRouteType(node.meta.transition)
  if (rt) cfg.routeType = rt
  if (parent) cfg.__parent = parent
  if (node.redirect) cfg.redirect = node.redirect
  return cfg
}

export interface MpTabBarItem {
  name: string
  text: string
  icon?: string
}

export interface MpTabBarConfig {
  color?: string
  selectedColor?: string
  list: MpTabBarItem[]
}

/** 小程序原生 tabBar 硬边界：仅首页级 + 最多 5 个（超出告警降级，见 M6 §3.3） */
const MP_TAB_LIMIT = 5

/**
 * 生成 app.json 的路由相关字段（pages 数组 + Skyline 全局配置 + tabBar）
 * @param tabBar M6：proteus.config router.tabBar（list[i].name 对应 RouteNode.name）；缺省时按 meta.isTab 推导
 */
export function generateMpConfig(
  nodes: RouteNode[],
  tabBar?: MpTabBarConfig,
): { pages: MpPageConfig[]; componentFramework: string; renderer: string; lazyCodeLoading: string; tabBar?: unknown } {
  const pages = flattenNodes(nodes).map(({ node, parent }) => toPageConfig(node, parent))
  const out: { pages: MpPageConfig[]; componentFramework: string; renderer: string; lazyCodeLoading: string; tabBar?: unknown } = {
    pages,
    componentFramework: 'glass-easel',
    renderer: 'skyline',
    lazyCodeLoading: 'requiredComponents',
  }
  const list = tabBar?.list ?? []
  if (list.length > 0) {
    if (list.length > MP_TAB_LIMIT) {
      console.warn(`[proteus] tabBar 声明 ${list.length} 项超过小程序原生上限 ${MP_TAB_LIMIT}——多余 tab 需自定义底部栏（M6 §3.3 降级）`)
    }
    out.tabBar = {
      color: tabBar?.color ?? '#999999',
      selectedColor: tabBar?.selectedColor ?? '#007AFF',
      list: list.map((item) => {
        const entry: { pagePath: string; text: string; iconPath?: string } = {
          pagePath: pages.find((p) => p.path === item.name)?.path ?? item.name,
          text: item.text,
        }
        if (item.icon) entry.iconPath = item.icon
        return entry
      }),
    }
  }
  return out
}

/**
 * 合并：<route> 生成的路由字段 > 用户手写 app.json 同名字段 > 默认值
 * @param existing 用户手写/编译器已有 app.json（不覆盖其自定义字段）
 * @param generated generateMpConfig 产物
 */
export function mergeAppJson(existing: Record<string, unknown>, generated: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // 先铺 generated（<route> 优先），再补 existing 中未冲突的自定义字段
  for (const [k, v] of Object.entries(generated)) out[k] = v
  for (const [k, v] of Object.entries(existing)) {
    if (!(k in out)) out[k] = v
  }
  return out
}

/** 校验用：RouteMeta 携带 transition（类型辅助） */
export function transitionOf(meta: RouteMeta | undefined): RouteMeta['transition'] {
  return meta?.transition
}
