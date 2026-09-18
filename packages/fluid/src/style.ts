// packages/fluid/src/style.ts
// ★#495d Skyline style 序列化：Skyline 只认 style 字符串（style="{{obj}}" 对象绑定不生效——WebView/Web 支持对象，
//   双端行为差 → 柔性组件 computed 统一输出字符串；Web :style 字符串同样合法）
//   camelCase → kebab-case；空值跳过（undefined/null/''）；'k: v; k2: v2'
export function styleToString(style: Record<string, string | number | undefined | null>): string {
  const parts: string[] = []
  for (const key of Object.keys(style)) {
    const v = style[key]
    if (v === undefined || v === null || v === '') continue
    parts.push(`${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${v}`)
  }
  return parts.join('; ')
}
