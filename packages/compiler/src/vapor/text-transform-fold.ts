// packages/compiler/src/vapor/text-transform-fold.ts
// ★★★`text-transform` 的**编译期折叠**（2026-10-18 · 批 B F3）——App 折叠面与 MP 编译期共用。
//
// 【为什么需要两套落点（同一语义）】
//   · **App 三端**：文本是共享运行期的字符串 ⇒ 在 JS 文本出口变换（`slot-runtime/text-transform.ts`），
//     宿主零改动；
//   · **MP/Skyline**：官方样式属性表**没有 `text-transform`**（已核官方文档 110 条属性）⇒ 该端只能
//     **编译期把静态文本改掉**；动态绑定文本无通道（编译期**如实诊断**）。
//   ⇒ 两处的**值域/校验/类名解析**必须同源（否则'同一个 .cls 在 App 与 MP 表现不同'），故本文件是
//     那部分共用的唯一实现：封闭集、类名表解析、元素有效值解析。
//
// 【CSS 继承】`text-transform` 可继承 ⇒ 元素自身无声明时沿用父元素有效值（由调用方维护"父值"）。

/** CSS `text-transform` 的封闭集（与 slot-runtime 的 TEXT_TRANSFORM_VALUES 同集） */
export const TEXT_TRANSFORM_VALUES = ['none', 'uppercase', 'lowercase', 'capitalize'] as const

export type TextTransformValue = (typeof TEXT_TRANSFORM_VALUES)[number]

/** 该值是否受支持（大小写不敏感；`none` 也算受支持——语义为"重置为默认"） */
export function isTextTransformValue(v: string | undefined): v is TextTransformValue {
  return typeof v === 'string' && (TEXT_TRANSFORM_VALUES as readonly string[]).includes(v.trim().toLowerCase())
}

/**
 * 从样式表文本析出「类名 → text-transform」表（**MP 编译期通道的输入**）。
 *
 * 只收**单类选择器**（`.cls{…}`）：复合/后代选择器在 MP 端不保证匹配（与 App 折叠面同口径）。
 * ★**必须先剥注释**：注释里常写 `text-transform: uppercase` 之类的说明文字——不剥会被当成声明
 *   （实测：某条规则被注释块错位吃掉 ⇒ 该类名的变换静默失效，真机白屏级差异）。
 *
 * @param css 原始样式文本（已去掉 `<style>` 标签）
 * @param put 收集器（类名 → 值）；重复出现 ⇒ 后者覆盖（近似 CSS 源序）
 */
export function collectTextTransformByClass(css: string, put: (cls: string, v: TextTransformValue) => void = () => {}): Map<string, TextTransformValue> {
  const out = new Map<string, TextTransformValue>()
  const emit = (cls: string, v: TextTransformValue): void => { out.set(cls, v); put(cls, v) }
  const noComment = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(noComment))) {
    const sel = m[1]!.trim()
    const decls = m[2]!
    const tm = /(?:^|;)\s*text-transform\s*:\s*([a-z-]+)/i.exec(decls)
    if (!tm) continue
    const v = tm[1]!.toLowerCase()
    if (!isTextTransformValue(v) || v === 'none') continue
    const sm = /^\.([\w-]+)$/.exec(sel)
    if (sm) emit(sm[1]!, v)
  }
  return out
}

/** 解析某元素的**自身**声明的 `text-transform`（内联 style 优先于类名表；都没声明 ⇒ undefined） */
export function ownTextTransform(
  inlineStyle: string | undefined,
  classes: readonly string[],
  table: ReadonlyMap<string, string> | undefined,
): TextTransformValue | undefined {
  if (inlineStyle) {
    const m = /(?:^|;)\s*text-transform\s*:\s*([a-z-]+)/i.exec(inlineStyle)
    if (m && isTextTransformValue(m[1])) {
      const v = m[1].trim().toLowerCase() as TextTransformValue
      if (v !== 'none') return v   // none = 重置 ⇒ 返回 undefined 让调用方用"默认"语义
    }
  }
  if (table) {
    let found: TextTransformValue | undefined
    for (const cn of classes) {
      const v = table.get(cn)
      if (v !== undefined && isTextTransformValue(v)) found = v  // 最后一个匹配的类胜（近似源序）
    }
    if (found !== undefined && found !== 'none') return found
  }
  return undefined
}
