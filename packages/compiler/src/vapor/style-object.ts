// packages/compiler/src/vapor/style-object.ts —— ★★★**`:style` 对象字面量逐键展开**（2026-10-03）
//
// 【这一层解决什么（本仓实测的静默缺陷）】`<p-text :style="{ width: w, color: c }">` 此前
//   产出**两条都叫 `paint.style` 的槽位**（同一个键、同一求值器），而内核的 `SET_STYLE`
//   只认**字段级键**（`layout.width` / `paint.color` …）——`paint.style` 这个整键会被内核
//   归入 paint-only 后**忽略** ⇒ **静默失效**；更糟的是模板侧诊断声称"由订阅表以 SET_STYLE
//   逐键下发"（**假承诺**——它并没有逐键）。
//
// 【正解：静态键在编译期展开】对象字面量的**键是编译期已知的**（`{ width: w }` 的键就是
//   `width`）⇒ 每个键展开成**一条独立绑定**（各带自己的值表达式）：
//     · 布局字段（width/height/…）⇒ `layout.<field>`（内核 SET_STYLE 真改几何 ✓）；
//     · 绘制字段（color/backgroundColor/fontSize/…）⇒ `paint.<field>`（**值由桥转给宿主**——
//       内核的 f32 通道装不下颜色字符串；宿主拿扁平字段名更新 spec 并重建绘制指令）。
//   ★全部为字面量值的对象（`{ width: 100, color: '#fff' }`）⇒ **折进静态 style**（零槽位，
//     与 `style="width: 100; color: #fff"` 完全等价——比建槽位更省）。
//
// 【与既有两个通道的关系（一处实现，不新增语义）】
//   · 静态 `style="…"` ⇒ `parseStaticStyle`（模板侧，保持原样）；
//   · `:style="'width:' + w + 'px'"` ⇒ 既有的 `stylePropKeyFromExpr` 单键降级（保持原样）；
//   · `:style="{ … }"` ⇒ **本模块**（新增的唯一分支）。
//
// 【诚实边界（本批）】① **变量形态**（`:style="s"`）键名编译期不可知 ⇒ 无法逐键下发（诊断给替代路径）；
//   ② 计算键 `{ [k]: v }` / 展开 `{ ...base }` / 嵌套对象（`margin: { top: 1 }`）⇒ 逐条诊断；
//   ③ 字符串类**布局**值（`flexDirection: 'row'` 等）不可动态（内核 f32 通道）⇒ 诊断（可放静态 style）。
import { parse as babelParse } from '@babel/parser'

/** 对象字面量的一条成员（键 + 值源码） */
export interface StyleObjectEntry {
  /** 静态键名（kebab/camel 均可——调用方归一化） */
  key: string
  /** 值表达式源码（**去掉尾随单位拼接**后的形态，如 `w + 'px'` ⇒ `w`） */
  valueSrc: string
  /** 值恰为字面量时的静态值（数字/字符串）——两侧（fold / 建槽）判据同源 */
  constValue?: string | number
  /** 源码行（诊断定位） */
  line?: number
}

export interface StyleObjectParseResult {
  /** 静态键的成员（可展开） */
  entries: StyleObjectEntry[]
  /** 无法处理的成员说明（计算键 / 展开 / 嵌套对象——调用方产诊断） */
  problems: Array<{ kind: 'computed' | 'spread' | 'nested'; key?: string; line?: number }>
}

const isLiteralValue = (n: { type?: string; value?: unknown }): string | number | undefined => {
  if (n.type === 'NumericLiteral' && typeof n.value === 'number') return n.value
  if (n.type === 'StringLiteral' && typeof n.value === 'string') return n.value
  return undefined
}

/**
 * 解析 `:style="…"` 的表达式——**仅认顶层对象字面量**。
 * @returns `null` ⇒ 不是对象字面量（调用方走既有单键降级 / 变量形态诊断）。
 */
export function parseStyleObject(expCode: string): StyleObjectParseResult | null {
  const src = expCode.trim()
  if (!src.startsWith('{')) return null
  let ast: unknown
  try {
    ast = babelParse(`(${src})`, { sourceType: 'module', plugins: ['typescript'] })
  } catch {
    return null   // 解析失败 ⇒ 不是我们能处理的对象形态（调用方按既有路径处理）
  }
  const wrapOffset = 1   // 我们包了一层括号 ⇒ 源码偏移 +1
  const expr = (ast as { program?: { body?: Array<{ expression?: { type?: string; properties?: unknown[] } }> } })
    ?.program?.body?.[0]?.expression
  if (!expr || expr.type !== 'ObjectExpression') return null

  const out: StyleObjectParseResult = { entries: [], problems: [] }
  for (const raw of expr.properties ?? []) {
    const p = raw as {
      type?: string
      computed?: boolean
      key?: { type?: string; name?: string; value?: unknown }
      value?: { type?: string; value?: unknown; start?: number; end?: number }
      argument?: { start?: number; end?: number }
      start?: number
      end?: number
    }
    if (p.type === 'SpreadElement') {
      out.problems.push({ kind: 'spread' })
      continue
    }
    if (p.computed) {
      out.problems.push({ kind: 'computed' })
      continue
    }
    const key = p.key?.type === 'Identifier' ? String(p.key.name) : p.key?.type === 'StringLiteral' ? String(p.key.value) : undefined
    if (!key) {
      out.problems.push({ kind: 'computed' })
      continue
    }
    // 嵌套对象（`margin: { top: 1 }`）⇒ 单独诊断（本批不支持——展开语义要与静态 style 的
    //   `margin: {…}` 一致才安全，属独立批次）
    if (p.value?.type === 'ObjectExpression' || p.value?.type === 'ArrayExpression') {
      out.problems.push({ kind: 'nested', key })
      continue
    }
    const vStart = p.value?.start
    const vEnd = p.value?.end
    if (vStart === undefined || vEnd === undefined) {
      out.problems.push({ kind: 'computed', key })
      continue
    }
    const rawValueSrc = src.slice(vStart - wrapOffset, vEnd - wrapOffset)
    const constValue = isLiteralValue(p.value ?? {})
    out.entries.push({
      key,
      valueSrc: stripUnitConcat(rawValueSrc.trim()),
      ...(constValue !== undefined ? { constValue } : {}),
    })
  }
  return out
}

/**
 * 去掉**尾随单位拼接**：`w + 'px'` / `w + "px"` ⇒ `w`（`px` 是单位说明，不是值的一部分——
 *   内核要的是 f32；与既有的 `styleValueExprFromExpr` 同一取向）。
 *   ★只剥**尾随**的字面量拼接；中间含字符串的表达式（`'a' + b`）不动（让下游诊断）。
 */
export function stripUnitConcat(valueSrc: string): string {
  const m = /^([\s\S]+?)\s*\+\s*(['"])(?:px|rpx|vw|vh|%)\2\s*$/.exec(valueSrc)
  return m ? m[1]!.trim() : valueSrc
}

/**
 * ★**键名 → 引擎 propKey**（**唯一映射表**：template.ts 诊断与 deps.ts 展开共用）。
 *
 * 分类依据与 `slotKindOf` / 内核 `apply_style_key` 的登记表对齐：
 *   · 布局数值键 ⇒ `layout.<field>`（内核真改几何）；
 *   · 绘制键 ⇒ `paint.<field>`（内核归 paint-only；**值由桥转给宿主**）。
 * @returns null ⇒ 不支持（调用方产诊断）
 */
export function mapStyleObjectKey(key: string): string | null {
  const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  // 布局数值键（内核 apply_style_key 已登记的那些——**只收数值语义的**）
  const LAYOUT_NUMERIC = new Set([
    'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
    'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'top', 'left',
  ])
  if (LAYOUT_NUMERIC.has(camel)) return `layout.${camel}`
  // 绘制键（宿主 mkCmd 认的扁平字段：backgroundColor / color / fontSize / borderRadius / …）
  const PAINT = new Set(['backgroundColor', 'color', 'fontSize', 'borderRadius', 'borderColor', 'borderWidth', 'opacity'])
  if (PAINT.has(camel)) return `paint.${camel}`
  return null
}

/** 该 propKey 是否**绘制类**（桥要转给宿主，而不是发给内核——内核 f32 装不下字符串） */
export function isPaintPropKey(propKey: string): boolean {
  return propKey.startsWith('paint.')
}

/** 对象字面量是否**全部为字面量值**（⇒ 折进静态 style，零槽位；两侧判据同源） */
export function isAllConstantObject(parsed: StyleObjectParseResult): boolean {
  return parsed.problems.length === 0 && parsed.entries.length > 0 && parsed.entries.every((e) => e.constValue !== undefined)
}
