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
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'
import { diagsOf } from './diag'
import { liveOf } from './diagSync'

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
      /* 告警用橙色波浪线，与类型错误区分（颜色定义见 codepanel.css） */
      severity: d.severity === 'warning' ? 'warning' : 'error',
      source: d.source ?? 'tsc',
      message: `${d.code}: ${d.message}`,
    })
  }
  return out
}

/**
 * 把诊断**派发**到编辑器（决策 #1418/#1419）。
 * · `stale`（内存 ≠ 磁盘）时清空：磁盘诊断不能画在你改过的文本上；
 * · 但若**内存语言服务**已给出该文件的结果（`liveOf` 非 null），它对应就是当前文本 ⇒ 正常画。
 */
/** 上一次派发的签名：内容没变就**不要** dispatch（决策 #1423） */
let lastSig = ''

/** ★切换文件（`view.setState`）后必须调用：新 state 里没有任何 lint 状态，
 *  而 `lastSig` 可能正好等于"上次给这个文件派发过的内容" ⇒ 去重会误判"不用派发" ⇒ 波浪线消失。 */
export function resetDiagSig(): void {
  lastSig = ''
}

export function applyDiagnostics(view: EditorView, path: string, stale: boolean): boolean {
  const list = stale && !liveOf(path) ? [] : lintOf(view, path)
  /* ★为什么要签名去重（用户反馈：鼠标悬在波浪线上时提示框会"闪跳一下"）：
     `setDiagnostics` 是一次真实事务，CodeMirror 会据此**重建** lint 状态与悬停提示；
     而诊断数据经常"内容没变但对象换了"（每次 tsserver/eslint 推送都是新数组），
     于是悬停期间被反复重画 ⇒ 提示框关掉重开 = 闪跳。
     去重后：只有诊断**真的变了**才派发。 */
  const sig =
    path + '|' + list.map((d) => `${d.from}:${d.to}:${d.severity}:${d.source}:${d.message}`).join(';')
  if (sig === lastSig) return false
  lastSig = sig
  view.dispatch(setDiagnostics(view.state, list))
  return true
}

/** 强制重画（含签名重置）：切文件/pub 后调用，避免去重把这次派发当成"已经派过" */
export function repaintDiag(view: EditorView, path: string, stale: boolean): void {
  resetDiagSig()
  applyDiagnostics(view, path, stale)
}
