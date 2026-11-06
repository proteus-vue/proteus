/**
 * rename.ts —— F2 重命名的输入框状态与**跨文件应用**（决策 #1444）
 *
 * 【分工】
 *   · `askRenameName`：弹输入框（`RenameBox.vue` 渲染），Promise 返回用户输入；
 *   · `applyRename`：把 tsserver 给的位置真正落到文本上；
 *   · `runRename`：完整流程（查询 → 校验 → 输入 → 应用 → 报告）。
 *   组件只调 `runRename` 一句，行数与状态都不落进 `CodePanel`。
 *
 * 【安全边界】
 *   · **已打开且有未保存修改**的文件**一个都不动**：写盘会把它冲掉 ⇒ 整体拒绝并报出文件名；
 *   · 其它文件走"读 → 改 → 写"（`write_text` 带 mtime，文件被别人改过会自动失败）；
 *   · 当前文件走 `view.dispatch`，保留 undo 历史、仍是"未保存"状态。
 *
 * 【★顺序陷阱】tsserver 的 `locs` **不保证升序**（实测同一文件先给使用处再给定义处），
 *   必须**倒序**替换，否则前面的改动会把后面的偏移顶走。
 */
import { readonly, ref } from 'vue'
import type { EditorView } from '@codemirror/view'
import { readSource, writeText, type RenameFile, type RenameSpan } from './bridge'
import { renameTarget } from './nav'
import { hideHint } from './hint'

/* ── 输入框 ─────────────────────────────────────────────────────────────── */
interface RenameAsk {
  initial: string
  x: number
  y: number
  /** 会被**直接写盘**的文件数（0 = 只改当前文件，不需要二次确认） */
  affected: number
}
const ask = ref<RenameAsk | null>(null)
export const renameAsk = readonly(ask)

let resolveFn: ((v: string | null) => void) | null = null

export function askRenameName(
  initial: string,
  x: number,
  y: number,
  /** 有文件会被直接写盘时，输入框会要求**再按一次 Enter**（不可撤销，得让人知道） */
  affected = 0,
): Promise<string | null> {
  resolveFn?.(null)
  return new Promise((resolve) => {
    resolveFn = resolve
    ask.value = { initial, x, y, affected }
  })
}

export function settleRename(v: string | null): void {
  ask.value = null
  const r = resolveFn
  resolveFn = null
  r?.(v)
}

/* ── 应用 ─────────────────────────────────────────────────────────────── */
export interface ApplyResult {
  changed: number
  failed: string[]
  /** 已写盘的外部文件（调用方据此丢弃缓存 state） */
  written: string[]
}

/** 把一段文本里的所有 span 换成 newName（倒序替换） */
function replaceInText(text: string, spans: RenameSpan[], newName: string): string {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const off = (line: number, col: number) => (starts[line - 1] ?? 0) + col - 1
  const sorted = [...spans].sort((a, b) => b.startLine - a.startLine || b.startCol - a.startCol)
  let out = text
  for (const s of sorted) {
    const from = off(s.startLine, s.startCol)
    const to = off(s.endLine, s.endCol)
    if (to < from) continue
    out = out.slice(0, from) + newName + out.slice(to)
  }
  return out
}

export async function applyRename(opts: {
  view: EditorView | null
  curPath: string
  files: RenameFile[]
  newName: string
  isDirty: (p: string) => boolean
}): Promise<ApplyResult> {
  const { view, curPath, files, newName, isDirty } = opts

  /* ① 整体安全门：任何"已打开且未保存"的文件都不碰（避免半途而废 + 冲掉用户改动） */
  const dirty = files.filter((f) => f.path !== curPath && isDirty(f.path)).map((f) => f.path)
  if (dirty.length) return { changed: 0, failed: dirty, written: [] }

  let changed = 0
  const failed: string[] = []
  const written: string[] = []

  for (const f of files) {
    if (f.path === curPath) {
      if (!view) {
        failed.push(f.path)
        continue
      }
      const doc = view.state.doc
      const changes = [...f.spans]
        .sort((a, b) => b.startLine - a.startLine || b.startCol - a.startCol)
        .map((s) => ({
          from: doc.line(s.startLine).from + s.startCol - 1,
          to: doc.line(s.endLine).from + s.endCol - 1,
          insert: newName,
        }))
      view.dispatch({ changes })
      changed += changes.length
      continue
    }
    try {
      const src = await readSource(f.path)
      await writeText(f.path, replaceInText(src.text, f.spans, newName), src.mtime_us)
      written.push(f.path)
      changed += f.spans.length
    } catch {
      failed.push(f.path)
    }
  }
  return { changed, failed, written }
}

/** tsserver 的原因文案是英文 ⇒ 常见几条翻成中文；没命中就原样显示（不丢信息） */
function localizeRenameMsg(m: string): string {
  const t = m.trim()
  if (!t) return ''
  if (t.includes("defined in a 'node_modules' folder")) return '不能重命名依赖（node_modules）里的符号'
  if (t.includes('You cannot rename this element')) return '这个位置不能重命名'
  return t
}

/** 完整流程：查询 → 校验 → 输入 → 应用 → 报告 */
export async function runRename(opts: {
  view: EditorView | null
  path: string
  pos?: number
  /** 第二参 `sticky`：常驻提示（等结果期间用） */
  hint: (msg: string, sticky?: boolean) => void
  isDirty: (p: string) => boolean
  /** 外部文件写盘成功后的回调（调用方丢弃对应缓存 state） */
  onExternalWrite?: (p: string) => void
}): Promise<void> {
  const { view, path, pos, hint } = opts
  /* ★先给**常驻**反馈：首次 rename 会触发 tsserver 加载整个项目（实测 4.7s），
     期间什么都不显示，用户只会看到鼠标转圈、以为卡死（实测反馈）。 */
  hint('正在分析符号…', true)
  const res = await renameTarget(view, path, pos)
  if (!res) return hint('重命名超时：首次需要加载项目，请再按一次 F2')
  /* tsserver 的原因最准（"不能重命名 node_modules 里的符号"这类只有它知道），翻成中文再显示 */
  if (!res.canRename) return hint(localizeRenameMsg(res.message) || '这个位置不能重命名')
  if (!res.files.length) return hint('没有找到可重命名的地方')

  /* 分析完成：收掉"正在分析…"，输入框自带操作提示 */
  hideHint()
  const at = pos ?? view?.state.selection.main.head ?? 0
  const c = view?.coordsAtPos(at)
  /* ★除当前文件外都会被**直接写盘**（不进 undo）⇒ 有外部文件时输入框要多确认一次 */
  const affected = res.files.filter((f) => f.path !== path).length
  const name = await askRenameName(res.displayName, c?.left ?? 160, (c?.bottom ?? 160) + 8, affected)
  if (!name || name === res.displayName) {
    hideHint()
    return
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return hint('名字不合法：只允许字母/数字/_/$，且不能以数字开头')

  const { changed, failed, written } = await applyRename({
    view,
    curPath: path,
    files: res.files,
    newName: name,
    isDirty: opts.isDirty,
  })
  for (const p of written) opts.onExternalWrite?.(p)

  if (failed.length) {
    const names = failed.map((p) => p.split('/').pop() ?? p).join('、')
    hint(`已改 ${changed} 处；这些文件有未保存修改，跳过：${names}`)
  } else if (!changed) {
    hint('没有改动任何位置')
  } else {
    hint(`已重命名 ${changed} 处`)
  }
}
