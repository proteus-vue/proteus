// packages/router/src/tree.ts
// 路由表构建（docs/proteus-router-plan M2）—— 扁平 RouteBlock[] → 嵌套 RouteNode[]
// 嵌套两条路径（显式优先）：
//   规则 B：parent 显式指定（覆盖 path 推导）
//   规则 A：path 前缀推导（/home + /home/profile 父子）
// 可复现：sortByPath 稳定排序，codegen 输出稳定 diff（对 git / AI 友好）
import type { GlobalRouteDefaults, RouteBlock, RouteNode } from './types'
import { RouteValidationError } from './schema'
import { mergeMeta } from './merge'

export interface RouteTreeTrace {
  /** 嵌套推导决策（--trace-router 反查源码依据） */
  (msg: string): void
}

/** path 分段排序（稳定）：先按段数少→多，再按字典序，保证产物可复现 */
export function sortByPath(nodes: RouteNode[]): RouteNode[] {
  const segs = (n: RouteNode): number => n.path.split('/').filter(Boolean).length
  return nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const d = segs(a.n) - segs(b.n)
      if (d !== 0) return d
      if (a.n.path < b.n.path) return -1
      if (a.n.path > b.n.path) return 1
      return a.i - b.i // 稳定：同 path 保持原顺序
    })
    .map((x) => x.n)
}

/** 规则 A：按 path 前缀找最长匹配父节点（/home/profile → /home；兼容无斜杠推导 path：pages/user/profile → pages/user） */
function findParentByPath(nodes: RouteNode[], node: RouteNode): RouteNode | null {
  const segs = node.path.split('/').filter(Boolean)
  for (let i = segs.length - 1; i >= 1; i--) {
    const prefix = segs.slice(0, i).join('/')
    // 同时匹配 `/home` 与 `pages/user` 两种语义（显式声明 / derivePath 推导）
    const match = nodes.find((n) => n.path === prefix || n.path === `/${prefix}`)
    if (match && match !== node) return match
  }
  return null
}

/**
 * 构建嵌套路由树（两遍扫描）：
 * 第一遍：建节点（合并默认 meta / lazy）+ byName 索引；
 * 第二遍：parent 显式（规则 B）优先挂载，否则 path 前缀推导（规则 A），都无 → 根
 * 找不到 parent / parent 成环 → 报错（含 loc）
 * @param trace --trace-router：输出每条路由的嵌套决策（显式 parent / path 推导 / 根）
 */
export function buildRouteTree(
  blocks: RouteBlock[],
  defaults: GlobalRouteDefaults = {},
  trace?: (msg: string) => void,
): RouteNode[] {
  const nodes: RouteNode[] = blocks.map((b) => ({
    ...b,
    children: [],
    meta: mergeMeta(defaults.meta, b.meta),
    lazy: b.lazy ?? defaults.lazy ?? true,
  }))

  const byName = new Map(nodes.filter((n) => n.name).map((n) => [n.name!, n]))
  const roots: RouteNode[] = []

  for (const node of nodes) {
    if (node.parent) {
      // 规则 B：显式 parent（覆盖 path 推导）
      const p = byName.get(node.parent)
      if (!p) throw new RouteValidationError(`parent "${node.parent}" 未找到`, node.loc)
      p.children.push(node)
      trace?.(`[route] ${node.path} → ${p.path}（显式 parent "${node.parent}"，规则 B 覆盖 path 推导）`)
    } else {
      // 规则 A：path 前缀推导
      const parentByPath = findParentByPath(nodes, node)
      if (parentByPath) {
        parentByPath.children.push(node)
        trace?.(`[route] ${node.path} → ${parentByPath.path}（path 前缀推导，规则 A）`)
      } else {
        roots.push(node)
        trace?.(`[route] ${node.path} → 根路由`)
      }
    }
  }

  // 环检测：沿 parent 链走（仅显式 parent 节点），visited 冲突即成环
  for (const node of nodes) {
    if (!node.parent) continue
    const seen = new Set<string>()
    let cur: RouteNode | undefined = node
    while (cur) {
      if (seen.has(cur.path)) {
        throw new RouteValidationError(`parent 引用成环：${[...seen, cur.path].join(' → ')}`, node.loc)
      }
      seen.add(cur.path)
      cur = cur.parent ? byName.get(cur.parent) : undefined
    }
  }

  return sortByPath(roots)
}
