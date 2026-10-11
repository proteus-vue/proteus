// packages/icons/src/index.ts
// @proteus-vue/icons —— ★Keryx OS 级图标库（Proteus UI 的"方言层"）
//   图标即数据（SVG path 单一真源，非字体）：语义名 → { d, viewBox }，三端同源渲染
//   （Web 内联 <svg> / MP Path2D / App 内核 svg_path）。含 A/S/T→C/Q 归一化（内核 svg_path.rs 拒 A/S/T）。
export type { IconDef } from './set'
export { ICON_SET, ICON_NAMES, ICON_ALIASES, ICON_ALIAS_NAMES, ICON_CATEGORIES, UNKNOWN_ICON } from './set'

export { normalizePath, isKernelCompatible } from './normalize'

import type { IconDef } from './set'
import { ICON_SET, ICON_ALIASES, UNKNOWN_ICON } from './set'
import { normalizePath } from './normalize'

/** 归一化缓存（`name → {d(viewBox 归一), viewBox}`）——避免每次消费重复转换。 */
const normalizedCache = new Map<string, IconDef>()

/**
 * 解析图标名：别名（官方 type / 语义等价 / 早期 camelCase）→ **主名**；已是主名或未知则原样返回。
 * 消费端统一经此归一（主名表保持干净、无重复路径）。未知名交由 `iconByName` 落到显式占位。
 */
export function resolveIconName(name: string): string {
  if (Object.prototype.hasOwnProperty.call(ICON_SET, name)) return name
  return ICON_ALIASES[name] ?? name
}

/** 取语义名的图标（别名自动解析；未知 ⇒ `UNKNOWN_ICON` 显式占位，不静默）。 */
export function iconByName(name: string): IconDef {
  return ICON_SET[resolveIconName(name)] ?? UNKNOWN_ICON
}

/**
 * 取**内核可吃**的图标（`d` 已归一为仅绝对 M/L/C/Q/Z）——App 内核 `svg_path.rs` / Web `<svg>` /
 * MP `Path2D` 三端同吃这一份。
 * @param name 语义名（含别名；未知 ⇒ 占位图标）
 * @param raw  true = 返回原始（未归一）路径（供 Web 现代浏览器直接用，省一次转换）
 */
export function normalizedIcon(name: string, raw = false): IconDef {
  const def = iconByName(name)
  const vb = def.viewBox ?? '0 0 24 24'
  if (raw) return { d: def.d, viewBox: vb, category: def.category }
  const key = `${name}|${def.d}`
  const hit = normalizedCache.get(key)
  if (hit) return hit
  const out: IconDef = { d: normalizePath(def.d), viewBox: vb, category: def.category }
  normalizedCache.set(key, out)
  return out
}

/** 是否已知图标名（**含别名**——官方 type / 历史名均视为已知，避免误报未知）。 */
export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_SET, name) || Object.prototype.hasOwnProperty.call(ICON_ALIASES, name)
}
