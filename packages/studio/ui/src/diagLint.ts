/**
 * diagLint.ts —— 把 `diag.ts` 的诊断**映射成 CodeMirror 的 Diagnostic**（决策 #1416）
 *
 * 【为什么单独成文件】① `CodePanel.vue` 已顶到 1000 行硬上限（check:file-size）；
 *   ② 这是纯函数式的"数据 → 渲染坐标"翻译，跟编辑器生命周期无关，独立更好测、也更好复用
 *      （将来若给 diff 视图也画波浪线，直接调用这里）。
 *
 * 【坐标换算的坑】tsc / eslint 给的都是 **1-based 行、列**，而 CodeMirror 要**绝对偏移**：
 *   · 行号要夹紧到 `1..doc.lines` —— 用户刚删了几行时，旧诊断会指到不存在的行；
 *   · 列号要夹紧到行尾 —— 否则偏移会跨行，波浪线画到下一行去。
 */
import type { Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import { diagsOf } from './diag'

/** 让波浪线覆盖到"一个词"的末尾，比单字符更容易用鼠标点中 */
const WORD_STOP = /[\s,;()[\]{}.:'"`]/

export function lintOf(view: EditorView, path: string): Diagnostic[] {
  if (!path) return []
  const doc = view.state.doc
  const out: Diagnostic[] = []
  for (const d of diagsOf(path)) {
    const ln = Math.min(Math.max(1, d.line), doc.lines)
    const line = doc.line(ln)
    const from = Math.min(line.from + Math.max(0, d.col - 1), line.to)
    let to = from
    while (to < line.to && !WORD_STOP.test(doc.sliceString(to, to + 1))) to++
    out.push({
      from,
      to: Math.max(to, Math.min(from + 1, line.to)),
      /* eslint 的 warning 用橙色波浪线，别和类型错误混成一种颜色 */
      severity: d.severity === 'warning' ? 'warning' : 'error',
      source: d.source ?? 'tsc',
      message: `${d.code}: ${d.message}`,
    })
  }
  return out
}
