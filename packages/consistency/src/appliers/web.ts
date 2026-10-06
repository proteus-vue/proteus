// packages/consistency/src/appliers/web.ts
// ★★★G-61 B3（2026-10-05）：**Web Applier（A 档）**（L-C · plan §7.1）
//
// 【A 档的语义（★别误会这个文件）】Web 端**不接管渲染**——浏览器原生 CSSOM 继续渲染，
//   真实浏览器算出来的值**就是**唯一基准（决策 #546/#548 的 A 档）。
//   ⇒ 本文件**不是"把 IR 变成 Web CSS"的转换器**（那是 B 档）；它做两件事：
//     ① **IR 探针**：把 IR 与浏览器实算值**逐属性比对**（判据①的消费面——`compareIrToComputed`）
//     ② **基准形态归一**：浏览器 `getComputedStyle` 的原始字符串 → 与 IR 同口径的值
//        （颜色 `rgb(...)` → `#rrggbb[aa]`；长度 `12px` → 数值；`normal`/`none` 等关键字）
//
// 【为什么归一化必须与 IR 侧同一套规则】判据①要求"逐属性可判等"——若两侧各写一套归一化，
//   比较就退化成"两套规则谁的宽容度高"，而不是"IR 与浏览器是否一致"。
//   ⇒ 本文件的 `normalizeComputedValue` 是**这条判据的比对侧唯一实现**（B1 的 parity 测试
//     用它；B5 的常驻门禁也用它）。
//
// 【零依赖纪律】本文件不 import `@proteus-vue/*`（见 consistency 包头注）——IR 值按**结构**判定。

/** 浏览器 computed 值的归一化（→ 与 IR 同口径） */
export type NormalizedComputed =
  | number // px 数值 / 无单位数值（opacity 等）
  | string // 颜色 #rrggbb[aa] / 枚举关键字 / 剩余形态
  | { ratio: number; base: string } // （Web 侧一般不产出——resolved 已是 px；保留以对称）

/**
 * CSS 颜色文本 → `#rrggbb[aa]`（与 CSE 的 `computeColor` **同输出序**：CSS4 低 8 位 alpha）。
 * 不认识的形态 ⇒ 原样返回（由比对层报差异——不猜）。
 */
export function normalizeComputedColor(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (!v) return v
  if (/^#[0-9a-f]{3,8}$/.test(v)) return v
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v)
  if (!m) return v
  const ch = (s: string): number => Math.max(0, Math.min(255, Math.round(Number(s))))
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0')
  const base = '#' + hex2(ch(m[1]!)) + hex2(ch(m[2]!)) + hex2(ch(m[3]!))
  if (m[4] === undefined) return base
  const a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
  if (!Number.isFinite(a) || a >= 1) return base
  return base + hex2(Math.round(a * 255))
}

/**
 * 浏览器 computed 值 → 与 IR 同口径（`compareIrToComputed` 的比对侧）。
 * @param cssProp CSS 属性名（kebab-case；决定关键字归一策略）
 */
export function normalizeComputedValue(raw: string, cssProp: string): NormalizedComputed {
  const v = raw.trim()
  if (v === '') return v
  // 颜色族
  if (cssProp === 'color' || cssProp.endsWith('-color')) return normalizeComputedColor(v)
  // px 长度
  if (/^-?[\d.]+px$/.test(v)) return Number(v.slice(0, -2))
  // 纯数值（opacity / flex-grow / z-index / line-height 无单位时也可能是 px…）
  if (/^-?[\d.]+$/.test(v)) return Number(v)
  // letter-spacing / word-spacing 的 `normal` 等价于 0（本仓 B2 实测抓到的等价形态）
  if (v === 'normal' && (cssProp === 'letter-spacing' || cssProp === 'word-spacing')) return 0
  // 百分比（resolved 保留的——如 border-radius 的 `50%`）
  if (/^-?[\d.]+%$/.test(v)) {
    const pct = Number(v.slice(0, -1))
    if (cssProp.includes('radius')) return { ratio: pct / 100, base: 'borderRadius' }
    return { ratio: pct / 100, base: 'percent' }
  }
  return v.toLowerCase()
}

/** IR 值（StyleIR 字段值）→ 与浏览器 computed 同口径 */
export function normalizeIrValue(value: unknown): NormalizedComputed | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    // 颜色已在 CSE 归一（#rrggbb[aa]）——直通小写
    return /^#/.test(value) ? value.toLowerCase() : value.toLowerCase()
  }
  if (typeof value === 'object' && 'kind' in (value as Record<string, unknown>)) {
    const l = value as { kind: string; dp?: number; ratio?: number; base?: string; name?: string; offset?: number; fallback?: number }
    if (l.kind === 'absolute' && typeof l.dp === 'number') return l.dp
    if (l.kind === 'ratio' && typeof l.ratio === 'number') return { ratio: l.ratio, base: l.base ?? 'unknown' }
    if (l.kind === 'auto') return 'auto'
    // ★★★内置环境变量（2026-10-08 · 决策 #593）：Web 原生 `var(--pf-X)`（框架基础样式在 :root 定义；浏览器解析）
    if (l.kind === 'env' && typeof l.name === 'string') { return l.offset ? 'calc(var(' + l.name + ') + ' + l.offset + 'px)' : 'var(' + l.name + ')' }
  }
  return undefined // 结构化值（boxShadow/transform 等）不参与逐属性判等（另表比对）
}

/** 单属性比对结果 */
export interface IrCompareEntry {
  /** IR 字段名 */
  field: string
  /** 浏览器 CSS 属性名 */
  cssProp: string
  /** IR 侧（归一后） */
  ir?: NormalizedComputed
  /** 浏览器侧（归一后） */
  computed?: NormalizedComputed
  ok: boolean
  /** 差异说明（ok=false 时） */
  detail?: string
}

/** 字段 → CSS 属性（判据①的比对面映射；与 B1 parity 用例表的 `field/css` 对齐） */
export const IR_FIELD_TO_CSS: Readonly<Record<string, string>> = {
  color: 'color',
  backgroundColor: 'background-color',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  fontFamily: 'font-family',
  letterSpacing: 'letter-spacing',
  lineHeight: 'line-height',
  textAlign: 'text-align',
  textOverflow: 'text-overflow',
  textDecoration: 'text-decoration-line',
  visibility: 'visibility',
  whiteSpace: 'white-space',
  opacity: 'opacity',
  display: 'display',
  position: 'position',
  width: 'width',
  height: 'height',
  minWidth: 'min-width',
  maxWidth: 'max-width',
  minHeight: 'min-height',
  maxHeight: 'max-height',
  marginTop: 'margin-top',
  marginRight: 'margin-right',
  marginBottom: 'margin-bottom',
  marginLeft: 'margin-left',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
  borderTopWidth: 'border-top-width',
  borderRightWidth: 'border-right-width',
  borderBottomWidth: 'border-bottom-width',
  borderLeftWidth: 'border-left-width',
  borderTopColor: 'border-top-color',
  borderRightColor: 'border-right-color',
  borderBottomColor: 'border-bottom-color',
  borderLeftColor: 'border-left-color',
  borderRadius: 'border-top-left-radius',
  flexDirection: 'flex-direction',
  flexWrap: 'flex-wrap',
  justifyContent: 'justify-content',
  alignItems: 'align-items',
  alignContent: 'align-content',
  alignSelf: 'align-self',
  flexGrow: 'flex-grow',
  flexShrink: 'flex-shrink',
  rowGap: 'row-gap',
  columnGap: 'column-gap',
  overflow: 'overflow',
  pointerEvents: 'pointer-events',
  zIndex: 'z-index',
  boxSizing: 'box-sizing',
}

/** ★**IR vs 浏览器 computed 的逐属性比对**（判据①-b 的核心；A 档 Applier 的"应用"就是它） */
export function compareIrToComputed(
  irFields: Record<string, unknown>,
  computed: Record<string, string>,
  opts: { skipFields?: ReadonlySet<string> } = {},
): { entries: IrCompareEntry[]; ok: boolean; checked: number; mismatched: number } {
  const entries: IrCompareEntry[] = []
  for (const [field, cssProp] of Object.entries(IR_FIELD_TO_CSS)) {
    if (opts.skipFields?.has(field)) continue
    const raw = computed[cssProp]
    const ir = normalizeIrValue(irFields[field])
    if (raw === undefined) {
      // 浏览器未给该属性：IR 有值 ⇒ 差异；IR 也无 ⇒ 跳过（该属性不在本端计算面）
      if (ir !== undefined) entries.push({ field, cssProp, ir, ok: false, detail: '浏览器未返回该属性' })
      continue
    }
    const comp = normalizeComputedValue(raw, cssProp)
    if (ir === undefined) continue // IR 未声明 ⇒ 不比（缺省值差异由 B1 parity 的"默认值"用例管）
    const ok = valuesEqual(ir, comp)
    entries.push({ field, cssProp, ir, computed: comp, ok, ...(ok ? {} : { detail: `IR=${JSON.stringify(ir)} vs computed=${JSON.stringify(comp)}` }) })
  }
  const mismatched = entries.filter((e) => !e.ok).length
  return { entries, ok: mismatched === 0, checked: entries.length, mismatched }
}

/** 值等价（数值容差 0.01；对象比 ratio；字符串等值） */
function valuesEqual(a: NormalizedComputed, b: NormalizedComputed): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.01
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && 'ratio' in a && 'ratio' in b) {
    return Math.abs((a as { ratio: number }).ratio - (b as { ratio: number }).ratio) < 0.0001
  }
  return String(a) === String(b)
}
