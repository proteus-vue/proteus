/**
 * syntaxTheme.ts —— 语法着色的**唯一来源**（决策 #1441）
 *
 * 【为什么抽出来】
 *   原来 `studioHighlight` 定义在 `CodePanel.vue` 里。定义预览卡（`DefPeek`）也要着色，
 *   而"两处各写一套 HighlightStyle"必然出现颜色/斜体不一致 —— 用户一眼就能看出来。
 *   抽成模块后主编辑器与预览卡**共用同一个实例**：类名相同、CSS 只注入一次。
 *
 * 【为什么卡片可以直接用这些类名】
 *   `HighlightStyle` 生成的类是 `ͼ…` 这种哈希名，样式由 style-mod 注入到 document（全局）。
 *   主编辑器已通过 `syntaxHighlighting(studioHighlight)` 注入过 ⇒ 卡片里直接写 class 就生效。
 */
import { EditorState } from '@codemirror/state'
import { HighlightStyle, ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { highlightTree, tags } from '@lezer/highlight'
import { langExtension } from './langs'

/** 语法着色：把 lezer 的 token 标签映射到 `--syn-*` 色板。
 *  ★只列"读代码时真的要区分"的类别；普通变量名**刻意不给颜色**——
 *    全都有颜色等于没颜色，变量继承正文色才能让关键字/字符串/类型凸显出来。
 *  ★注释用斜体：IDE 通用语汇，且不只靠颜色区分（色觉障碍下仍可分）。 */
export const studioHighlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
    ],
    color: 'var(--syn-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.attributeValue], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: 'var(--syn-comment)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: 'var(--syn-type)',
  },
  { tag: [tags.attributeName, tags.propertyName], color: 'var(--syn-attr)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syn-fn)' },
  {
    tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.angleBracket],
    color: 'var(--syn-punct)',
  },
  { tag: tags.invalid, color: 'var(--syn-invalid)', textDecoration: 'underline wavy' },
])

/* ── 静态高亮：给"只读片段"（预览卡）用 ──────────────────────────────────── */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
/** 卡片内容来自**用户文件**，必须转义后再拼 HTML（不能直接 v-html 原文） */
const esc = (t: string): string => t.replace(/[&<>]/g, (c) => ESC[c])

/**
 * 把一段代码按行切成带 `<span class="…">` 的 HTML。
 * ★注释/字符串可能**跨行**，而 `highlightTree` 给的是扁平字符区间 ⇒ 按行裁切后分别包 span。
 * ★返回数组与输入行一一对应（空行返回空串，行号列保证高度）。
 */
export function highlightLines(code: string, langId: string): string[] {
  const plain = code.split('\n').map(esc)
  let state: EditorState
  try {
    state = EditorState.create({ doc: code, extensions: [langExtension(langId)] })
  } catch {
    return plain
  }
  /* 预览片段很短（≤80 行），强制解析完整；超时或该语言无解析器则退回纯文本 */
  const tree = ensureSyntaxTree(state, code.length, 150) ?? syntaxTree(state)
  if (!tree) return plain

  const marks: { from: number; to: number; cls: string }[] = []
  highlightTree(tree, studioHighlight, (from, to, cls) => marks.push({ from, to, cls }))
  if (!marks.length) return plain

  const out: string[] = []
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    const spans: { from: number; to: number; cls: string }[] = []
    for (const m of marks) {
      if (m.to <= line.from) continue
      /* highlightTree 按文档顺序回调（from 递增）⇒ 越过当前行即可停 */
      if (m.from >= line.to) break
      spans.push({ from: Math.max(m.from, line.from), to: Math.min(m.to, line.to), cls: m.cls })
    }
    if (!spans.length) {
      out.push(esc(line.text))
      continue
    }
    let pos = line.from
    let html = ''
    for (const s of spans) {
      if (s.from > pos) html += esc(state.doc.sliceString(pos, s.from))
      html += `<span class="${s.cls}">${esc(state.doc.sliceString(s.from, s.to))}</span>`
      pos = s.to
    }
    if (pos < line.to) html += esc(state.doc.sliceString(pos, line.to))
    out.push(html)
  }
  return out
}
