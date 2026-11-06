/**
 * editorMenu.ts —— 代码编辑器右键菜单（决策 #1448）
 *
 * 【为什么单独一个文件】原来菜单只有 5 项（保存/撤销/重做/全选/复制路径），
 *   用户反馈"太少"。补齐到和主流 IDE 一致后项数翻倍，而 `CodePanel.vue` 已贴着
 *   1000 行硬上限 ⇒ 整块搬出来，组件只留一句 `openEditorMenu(e)`。
 *
 * 【分层】
 *   菜单项与账号、文件、视图无关，只依赖"当前编辑器 + 几个已有动作" ⇒
 *   用 `setEditorMenuDeps` 注入（避免把 view/cur/paths 一路透传）。
 *
 * 【能力边界】
 *   · 剪切/复制走 Rust `copy_text`（ObjC 桥），粘贴走 `pbpaste` —— webview 的
 *     `navigator.clipboard` 在 Tauri 里不一定可用，不能靠它；
 *   · 撤销/重做用 `undoDepth/redoDepth` **禁用**而不是静默失败（菜单项灰掉才算说清楚）；
 *   · 格式化暂不提供（没有格式化器，放个假菜单项比没有更糟）。
 */
import { redo, redoDepth, toggleComment, undo, undoDepth } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { copyText, readClipboard } from './bridge'
import { openMenu, type MenuItem } from './contextmenu'

/* 行操作/注释/多选的动作注册（决策 #1452）从这里转出，`CodePanel` 少一行 import */
export { registerEditorActions } from './editorActions'
export { gotoFileSymbol } from './symbols'
export { installAutoSave } from './autosave'

export interface EditorMenuDeps {
  getView: () => EditorView | null
  getPath: () => string
  /** 当前文件是否有未保存修改（决定"保存"是否可点） */
  isDirty: () => boolean
  save: () => void
  copyPath: (p: string) => void
  /** 就地提示（"已复制"/"读不到剪贴板"这类） */
  hint: (msg: string) => void
  gotoDefinition: () => void
  findReferences: () => void
  renameSymbol: () => void
}

let deps: EditorMenuDeps | null = null

export function setEditorMenuDeps(d: EditorMenuDeps): void {
  deps = d
}

function items(): MenuItem[] {
  const v = deps?.getView() ?? null
  const sel = v?.state.selection.main
  const hasSel = !!sel && !sel.empty
  const canUndo = !!v && undoDepth(v.state) > 0
  const canRedo = !!v && redoDepth(v.state) > 0
  return [
    { id: 'save', label: '保存', accel: '⌘S', disabled: !deps?.isDirty() },
    { id: 's1', label: '', sep: true },
    { id: 'undo', label: '撤销', accel: '⌘Z', disabled: !canUndo },
    { id: 'redo', label: '重做', accel: '⇧⌘Z', disabled: !canRedo },
    { id: 's2', label: '', sep: true },
    { id: 'cut', label: '剪切', accel: '⌘X', disabled: !hasSel },
    { id: 'copy', label: '复制', accel: '⌘C', disabled: !hasSel },
    { id: 'paste', label: '粘贴', accel: '⌘V' },
    { id: 's3', label: '', sep: true },
    { id: 'def', label: '跳转定义', accel: 'F12' },
    { id: 'refs', label: '查找引用', accel: '⇧F12' },
    { id: 'rename', label: '重命名符号', accel: 'F2' },
    { id: 's4', label: '', sep: true },
    { id: 'selectAll', label: '全选', accel: '⌘A' },
    { id: 'comment', label: '切换注释', accel: '⌘/' },
    { id: 's5', label: '', sep: true },
    { id: 'copyPath', label: '复制相对路径' },
    { id: 'copyName', label: '复制文件名' },
  ]
}

/** 剪切/复制：先走 Rust 写剪贴板，再决定要不要删掉选区 */
async function cutOrCopy(cut: boolean): Promise<void> {
  const v = deps?.getView()
  if (!v) return
  const sel = v.state.selection.main
  if (sel.empty) return
  await copyText(v.state.sliceDoc(sel.from, sel.to)).catch(() => {})
  if (cut) v.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' }, selection: { anchor: sel.from } })
  deps?.hint(cut ? '已剪切' : '已复制')
}

async function paste(): Promise<void> {
  const v = deps?.getView()
  if (!v) return
  try {
    const text = await readClipboard()
    if (!text) return
    const sel = v.state.selection.main
    v.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
    })
  } catch {
    deps?.hint('读不到剪贴板')
  }
}

export function openEditorMenu(e: MouseEvent): void {
  if (!deps?.getPath()) return
  openMenu(e, items(), (id) => {
    const v = deps?.getView() ?? null
    switch (id) {
      case 'save':
        deps?.save()
        break
      case 'undo':
        if (v) undo(v)
        break
      case 'redo':
        if (v) redo(v)
        break
      case 'cut':
        void cutOrCopy(true)
        break
      case 'copy':
        void cutOrCopy(false)
        break
      case 'paste':
        void paste()
        break
      case 'def':
        deps?.gotoDefinition()
        break
      case 'refs':
        deps?.findReferences()
        break
      case 'rename':
        deps?.renameSymbol()
        break
      case 'selectAll':
        if (v) v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } })
        break
      case 'comment':
        /* `toggleComment` 是 StateCommand（解构 `{state, dispatch}`），不能直接传 EditorView */
        if (v) toggleComment({ state: v.state, dispatch: (tr) => v.dispatch(tr) })
        break
      case 'copyPath':
        if (deps?.getPath()) deps.copyPath(deps.getPath())
        break
      case 'copyName': {
        const p = deps?.getPath() ?? ''
        if (!p) break
        const name = p.split('/').filter(Boolean).pop() ?? p
        void copyText(name).catch(() => {})
        deps?.hint(`已复制 ${name}`)
        break
      }
    }
  })
}
