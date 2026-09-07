// packages/style-safety/src/index.ts
// G-31 style-safety B1+B2：运行时 Validator（动态值最后闸门——01-style-runtime-safety §1.1 三层防线 ③）
//   · 属性名白名单（§3.1：✅ 直映射 / 🔶 语义组件（p-* 封装）/ ❌ forbidden）
//   · 值类型系统（§4：Length / Opacity / Color / transform 基础版；逐平台收窄 B2 后续）
//   · createStyleGuard：patch 逐属性校验 → 非法剔除/降级 + 记录 rejected（★DevTools style-safety Inspector 数据源）
// ★纯逻辑零依赖；mode 'off' 零开销（生产默认）；MP 产物安全（决策 #32/#36）

/** 白名单属性分类（✅ 直映射五端原生）：长度类 */
export const LENGTH_PROPS = [
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderRadius', 'top', 'left', 'right', 'bottom', 'gap',
  'fontSize', 'lineHeight', 'letterSpacing',
] as const

/** 颜色类（hex/rgba/theme token——编译期展开，运行时按 string 兜底） */
export const COLOR_PROPS = ['color', 'backgroundColor', 'borderColor'] as const

/** 数值类（opacity 0-1 / flex / zIndex / fontWeight） */
export const NUMERIC_PROPS = ['opacity', 'flex', 'zIndex', 'fontWeight'] as const

/** transform（CSS 矩阵 ✅ 直映射） */
export const TRANSFORM_PROPS = ['transform'] as const

/** ❌ 禁止（CSS 矩阵 ❌ 级——绕过语义层直通原生风险） */
export const FORBIDDEN_PROPS = ['display', 'float', 'position', 'backdropFilter', 'boxShadow', 'filter', 'overflow'] as const

export type StyleGuardMode = 'strict' | 'loose' | 'off'

/** 拦截记录（DevTools style-safety Inspector 数据源） */
export interface StyleRejectRecord {
  prop: string
  value: unknown
  reason: string
  ts: number
}

/** 校验结果 */
export type StyleCheckResult = { ok: true } | { ok: false; reason: string; fallback?: unknown }

/** 长度值：number（有限）| px/rem/% 字符串 | 'auto' */
export function isLength(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string') return /^\d+(\.\d+)?(px|rem|%)?$/.test(v) || v === 'auto'
  return false
}

/** opacity：0-1 有限数 */
export function isOpacity(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

/** 有限数 */
export function isFiniteNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 颜色：字符串（hex/rgba/theme token；编译期已展开，运行时按 string 兜底） */
export function isColor(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0
}

/** transform：字符串（CSS 变换函数；编译期白名单内） */
export function isTransform(v: unknown): boolean {
  return typeof v === 'string' && /^(translate|scale|rotate|skew)/.test(v)
}

/** 语义组件属性（p-* 前缀 → 组件内安全路径，放行） */
export function isSemanticProp(prop: string): boolean {
  return prop.startsWith('p-')
}

/** 降级默认值（§5 表：width/height→0、opacity→1、color→继承（undefined 剔除）、borderRadius→0） */
const FALLBACK: Record<string, unknown> = {
  width: 0,
  height: 0,
  minWidth: 0,
  maxWidth: 0,
  minHeight: 0,
  maxHeight: 0,
  padding: 0,
  margin: 0,
  borderRadius: 0,
  opacity: 1,
  flex: 0,
  zIndex: 0,
  fontSize: 0,
  lineHeight: 0,
  gap: 0,
}

/** 校验单个样式值（白名单属性 + 值类型；forbidden 属性一律拒绝） */
export function validateStyleValue(prop: string, value: unknown): StyleCheckResult {
  if (isSemanticProp(prop)) return { ok: true } // p-* 语义组件走组件内安全路径
  if ((FORBIDDEN_PROPS as readonly string[]).includes(prop)) {
    return { ok: false, reason: `属性 ${prop} 禁止（CSS 矩阵 ❌ 级——必须用 p-* 语义组件封装）` }
  }
  if ((LENGTH_PROPS as readonly string[]).includes(prop)) {
    return isLength(value) ? { ok: true } : { ok: false, reason: `${prop} 需要 Length（有限数 / px·rem·% / auto），收到 ${String(value)}`, fallback: FALLBACK[prop] }
  }
  if (prop === 'opacity') {
    return isOpacity(value) ? { ok: true } : { ok: false, reason: `opacity 需要 0-1 有限数，收到 ${String(value)}`, fallback: 1 }
  }
  if ((NUMERIC_PROPS as readonly string[]).includes(prop)) {
    return isFiniteNumber(value) ? { ok: true } : { ok: false, reason: `${prop} 需要有限数，收到 ${String(value)}`, fallback: FALLBACK[prop] }
  }
  if ((COLOR_PROPS as readonly string[]).includes(prop)) {
    return isColor(value) ? { ok: true } : { ok: false, reason: `${prop} 需要颜色字符串，收到 ${String(value)}` }
  }
  if ((TRANSFORM_PROPS as readonly string[]).includes(prop)) {
    return isTransform(value) ? { ok: true } : { ok: false, reason: `transform 仅允许 translate/scale/rotate/skew 函数，收到 ${String(value)}` }
  }
  // 未知属性：loose 放行（编译期已拦截，运行时只兜底已知风险）；strict 拒绝
  return { ok: true }
}

export interface StyleGuardOptions {
  /** strict=非法剔除+记录+warn / loose=非法剔除+记录 / off=原样放行零开销（生产默认） */
  mode?: StyleGuardMode
  /** 逐条拦截回调（DevTools 实时推送） */
  onReject?: (record: StyleRejectRecord) => void
}

export interface StyleGuard {
  /** 校验并过滤 style：非法属性剔除（strict）/ 剔除+记录（loose）；语义组件与白名单放行 */
  patch(style: Record<string, unknown>): Record<string, unknown>
  /** 拦截记录（DevTools style-safety Inspector 数据源；环形 500） */
  records(): StyleRejectRecord[]
  clear(): void
  readonly mode: StyleGuardMode
}

const MAX_RECORDS = 500

/** 创建样式守卫（动态 :style 最后闸门）：非法值永远到不了原生渲染管线 */
export function createStyleGuard(options: StyleGuardOptions = {}): StyleGuard {
  const mode: StyleGuardMode = options.mode ?? (typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__ ? 'loose' : 'off')
  const records: StyleRejectRecord[] = []

  function reject(record: StyleRejectRecord): void {
    records.push(record)
    if (records.length > MAX_RECORDS) records.shift()
    if (mode === 'strict') console.warn(`[style-safety] 拦截：${record.reason}`)
    options.onReject?.(record)
  }

  return {
    get mode() {
      return mode
    },
    patch(style) {
      if (mode === 'off') return style
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(style)) {
        const value = style[key]
        const result = validateStyleValue(key, value)
        if (result.ok) {
          out[key] = value
        } else {
          reject({ prop: key, value, reason: result.reason, ts: Date.now() })
          if (result.fallback !== undefined) out[key] = result.fallback
        }
      }
      return out
    },
    records: () => records.slice(),
    clear() {
      records.length = 0
    },
  }
}
