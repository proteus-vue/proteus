// packages/icons/src/index.ts
// @proteus-vue/icons —— ★Keryx OS 级图标库（Proteus UI 的"方言层"）
//   图标即数据（SVG path 单一真源，非字体）：语义名 → { d(outline), filled?, viewBox, category }，三端同源渲染
//   （Web 内联 <svg> / MP Path2D / App 内核 svg_path）。含 A/S/T/H/V→C/Q 归一化 + 960→24 网格缩放。
export type { IconDef } from './set'
export {
  ICON_SET,
  ICON_NAMES,
  ICON_ALIASES,
  ICON_ALIAS_NAMES,
  ICON_CATEGORIES,
  FILLED_SUFFIX,
  UNKNOWN_ICON,
} from './set'

export { normalizePath, isKernelCompatible } from './normalize'
export { scalePath, type ScaleOptions } from './transform'

import type { IconDef } from './set'
import { ICON_SET, ICON_ALIASES, FILLED_SUFFIX, UNKNOWN_ICON } from './set'
import { normalizePath } from './normalize'

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** 归一化缓存（`name → {d, filled?, viewBox, category}`）——避免每次消费重复转换。 */
const normalizedCache = new Map<string, IconDef>()

/**
 * 解析图标名：别名（官方 type / 语义等价 / 早期 camel）→ **主名**；已是主名或未知则原样返回。
 * （`-filled` 变体后缀由 `iconByName`/`hasIcon` 处理。）
 */
export function resolveIconName(name: string): string {
  if (hasOwn(ICON_SET, name)) return name
  return ICON_ALIASES[name] ?? name
}

/**
 * 取语义名的图标（别名自动解析；**`<name>-filled` 取 filled 变体**，无 filled 则回退 outline；
 * 未知 ⇒ `UNKNOWN_ICON` 显式占位，不静默）。
 */
export function iconByName(name: string): IconDef {
  const isFilled = name.endsWith(FILLED_SUFFIX)
  const base = resolveIconName(isFilled ? name.slice(0, -FILLED_SUFFIX.length) : name)
  const def = ICON_SET[base]
  if (!def) return UNKNOWN_ICON
  if (!isFilled) return def
  return { d: def.filled ?? def.d, viewBox: def.viewBox ?? '0 0 24 24', category: def.category }
}

/**
 * 取**内核可吃**的图标（`d` 已归一为仅绝对 M/L/C/Q/Z）——App 内核 `svg_path.rs` / Web `<svg>` /
 * MP `Path2D` 三端同吃这一份。
 * @param name 语义名（含别名 / `-filled` 变体；未知 ⇒ 占位图标）
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

/** 是否已知图标名（**含别名 + `-filled` 变体**——官方 type / 历史名 / 变体均视为已知）。 */
export function hasIcon(name: string): boolean {
  const base = name.endsWith(FILLED_SUFFIX) ? name.slice(0, -FILLED_SUFFIX.length) : name
  return hasOwn(ICON_SET, base) || hasOwn(ICON_ALIASES, base)
}

/** 该图标是否有 filled 变体（供预览页/工具判断是否可切到 filled）。 */
export function hasFilled(name: string): boolean {
  const base = resolveIconName(name.endsWith(FILLED_SUFFIX) ? name.slice(0, -FILLED_SUFFIX.length) : name)
  return !!ICON_SET[base]?.filled
}
