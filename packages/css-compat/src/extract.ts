// packages/css-compat/src/extract.ts
// G-21 css-compat B1：从 SFC 源码提取 <style> 块内容（CLI css:check 扫描 .vue 用）
// 复用 @vue/compiler-sfc parse（与 compiler 包同款），正确处理多 style 块 / scoped / lang
import { parse } from '@vue/compiler-sfc'

export interface ExtractedStyle {
  content: string
  scoped: boolean
  lang: string | null
  line: number
}

/** 提取 SFC 中全部 <style> 块（含 lang/scoped 元信息；解析失败返回空） */
export function extractStyleBlocks(source: string): ExtractedStyle[] {
  try {
    const { descriptor, errors } = parse(source, { filename: 'proteus-extract.vue' })
    if (errors.length) return []
    return descriptor.styles.map((s) => ({
      content: s.content,
      scoped: Boolean(s.scoped),
      lang: s.lang ?? null,
      line: s.loc.start.line,
    }))
  } catch {
    return []
  }
}
