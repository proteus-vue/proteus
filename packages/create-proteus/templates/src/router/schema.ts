// packages/router/src/schema.ts
// 路由 schema 校验（docs/proteus-router-plan M1）—— 手写校验，无第三方依赖
// 校验失败：不吞错，抛出 RouteValidationError（含 loc 精确定位，支撑 --trace-router 反查源码）
import type { RouteBlock, RouteMeta } from './types'

/** 路由校验错误：带源码定位（文件:行:列），供 CLI 报错与 --trace-router 使用 */
export class RouteValidationError extends Error {
  loc: { file: string; line: number; column: number }

  constructor(message: string, loc: { file: string; line: number; column: number }) {
    super(`[router] ${loc.file}:${loc.line}:${loc.column} ${message}`)
    this.name = 'RouteValidationError'
    this.loc = loc
  }
}

/** meta.transition 合法枚举（对齐 RouteMeta 类型 + M4 的 Skyline routeType 映射） */
const TRANSITIONS = ['slideUp', 'slideDown', 'halfScreen', 'scaleDown', 'none'] as const

/** 命名路由规范：小驼峰（^[a-z][a-zA-Z0-9]*$） */
const NAME_RE = /^[a-z][a-zA-Z0-9]*$/

/** JSON 可序列化检查（meta 禁止 Function / RegExp / undefined；递归限深 3 防环） */
function isSerializable(value: unknown, depth = 0): boolean {
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return true
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') return false
  if (value instanceof RegExp || value instanceof Date) return false
  if (depth > 3) return true
  if (Array.isArray(value)) return value.every((v) => isSerializable(v, depth + 1))
  if (t === 'object') {
    return Object.values(value as Record<string, unknown>).every((v) => isSerializable(v, depth + 1))
  }
  return false
}

/** 校验单个 <route> 块内容（path/name/redirect/meta/lazy/transition），失败抛 RouteValidationError */
export function validateSchema(
  parsed: Record<string, unknown>,
  loc: { file: string; line: number; column: number },
): RouteBlock {
  // path：必填、string、以 / 开头
  if (typeof parsed.path !== 'string' || parsed.path.length === 0) {
    throw new RouteValidationError('<route> 缺少 path（必须以 / 开头的字符串）', loc)
  }
  if (!parsed.path.startsWith('/')) {
    throw new RouteValidationError(`path "${parsed.path}" 必须以 / 开头`, loc)
  }

  // name：可选、命名规范
  let name: string | undefined
  if (parsed.name !== undefined && parsed.name !== null) {
    if (typeof parsed.name !== 'string' || !NAME_RE.test(parsed.name)) {
      throw new RouteValidationError(
        `name "${String(parsed.name)}" 不合法（须匹配 ^[a-z][a-zA-Z0-9]*$）`,
        loc,
      )
    }
    name = parsed.name
  }

  // redirect：string，与 parent 互斥
  let redirect: string | undefined
  if (parsed.redirect !== undefined && parsed.redirect !== null) {
    if (typeof parsed.redirect !== 'string') {
      throw new RouteValidationError('redirect 必须是字符串（目标 path）', loc)
    }
    redirect = parsed.redirect
    if (parsed.parent !== undefined && parsed.parent !== null) {
      throw new RouteValidationError('redirect 与 parent 互斥，只能二选一', loc)
    }
  }

  // parent：string（引用存在性在 scan 收口后统一校验）
  let parent: string | undefined
  if (parsed.parent !== undefined && parsed.parent !== null) {
    if (typeof parsed.parent !== 'string') {
      throw new RouteValidationError('parent 必须是字符串（另一路由的 name）', loc)
    }
    parent = parsed.parent
  }

  // meta：纯对象 + JSON 可序列化
  let meta: RouteMeta = {}
  if (parsed.meta !== undefined && parsed.meta !== null) {
    if (typeof parsed.meta !== 'object' || Array.isArray(parsed.meta)) {
      throw new RouteValidationError('meta 必须是对象', loc)
    }
    if (!isSerializable(parsed.meta)) {
      throw new RouteValidationError('meta 必须可序列化（禁止 Function/RegExp/undefined），逻辑请放 router.guards', loc)
    }
    meta = parsed.meta as RouteMeta
    if (meta.transition !== undefined && !(TRANSITIONS as readonly string[]).includes(meta.transition)) {
      throw new RouteValidationError(
        `meta.transition "${String(meta.transition)}" 非法（可选：${TRANSITIONS.join(' / ')}）`,
        loc,
      )
    }
  }

  // lazy：boolean（默认 true 由全局 defaults 决定，M2 tree.ts 解析；此处仅透传显式声明）
  let lazy: boolean | undefined
  if (parsed.lazy !== undefined && parsed.lazy !== null) {
    if (typeof parsed.lazy !== 'boolean') {
      throw new RouteValidationError('lazy 必须是布尔值', loc)
    }
    lazy = parsed.lazy
  }

  return { loc, path: parsed.path, name, redirect, parent, meta, lazy, componentPath: loc.file }
}

/** 全局唯一性校验：path / name 重复报错（指向两个文件:行号） */
export function checkDuplicates(routes: RouteBlock[]): void {
  const byPath = new Map<string, RouteBlock>()
  const byName = new Map<string, RouteBlock>()
  for (const r of routes) {
    const dupPath = byPath.get(r.path)
    if (dupPath) {
      throw new RouteValidationError(`path "${r.path}" 重复（与 ${dupPath.loc.file}:${dupPath.loc.line} 冲突）`, r.loc)
    }
    byPath.set(r.path, r)
    if (r.name) {
      const dupName = byName.get(r.name)
      if (dupName) {
        throw new RouteValidationError(`name "${r.name}" 重复（与 ${dupName.loc.file}:${dupName.loc.line} 冲突）`, r.loc)
      }
      byName.set(r.name, r)
    }
  }
}

/** parent 引用存在性校验（收口：所有块已知后统一检查，parent 必须指向另一个 name） */
export function validateParentRefs(routes: RouteBlock[]): void {
  const names = new Set(routes.map((r) => r.name).filter((n): n is string => Boolean(n)))
  for (const r of routes) {
    if (r.parent && !names.has(r.parent)) {
      throw new RouteValidationError(`parent "${r.parent}" 未找到（须为另一路由的 name）`, r.loc)
    }
  }
}
