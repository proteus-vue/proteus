/**
 * editorFormat.ts —— 「格式化文档」动作（决策 #1462）
 *
 * 【兑现的诚实边界】`editorMenu.ts` 的头注释从 #1448 起就写着「格式化暂不提供
 *   （没有格式化器，放个假菜单项比没有更糟）」。本单把这条边界真正填上：命令、参数、
 *   风格配置全在 Rust 侧 `format.rs` 固定，前端只传 (path, 当前 buffer 文本)。
 *
 * 【★只改 buffer，不写盘】格式化结果用一次 `view.dispatch` 整篇替换：
 *   · 保留 CodeMirror 的 undo 历史 ⇒ ⌘Z 一步回退，误按不会毁文件；
 *   · 不改变「未保存」判定（它本来就按 doc 与 base 比），保存仍走 `write_text` 的
 *     mtime 冲突检测 + 原子替换；
 *   · 选区用 `ChangeSet.mapPos` 映射，格式化后光标不会跳到文件开头。
 *
 * 【快捷键与菜单共用同一个执行函数】`registerFormatAction` 走 `onAction`（键位由
 *   keybindings.ts 决定），`editorMenu.ts` 的右键项直接调 `formatDocument`；两边不各自
 *   实现一遍，避免「菜单能格式化、快捷键不能」这类分叉。
 */
import type { EditorView } from '@codemirror/view'
import { formatText } from './bridge'
import { onAction } from './keybindings'
import { isReadonlyPath } from './nav'
import { pushToast, type ToastKind } from './toast'

type Notify = (msg: string, kind?: ToastKind) => void

/** 防重入：格式化是异步 IPC，连按两次会把第二份结果盖在第一份上（且 undo 变两步）。 */
let busy = false

export async function formatDocument(view: EditorView | null, path: string, notify: Notify = pushToast): Promise<void> {
  if (!view || !path || busy) return
  if (isReadonlyPath(path)) {
    notify('只读文件不提供格式化', 'info')
    return
  }
  const doc = view.state.doc.toString()
  busy = true
  try {
    const out = await formatText(path, doc)
    if (out === doc) {
      notify('已经是格式化状态', 'info')
      return
    }
    const changes = view.state.changes({ from: 0, to: doc.length, insert: out })
    const sel = view.state.selection.main
    view.dispatch({
      changes,
      selection: { anchor: changes.mapPos(sel.from), head: changes.mapPos(sel.to) },
    })
    notify('已格式化（⌘Z 可撤销）')
  } catch (e) {
    /* Rust 侧会把「没有 parser / 依赖没装 / 超时」说成人话；这里只负责不吞掉它 */
    notify(`格式化失败：${e instanceof Error ? e.message : String(e)}`, 'err')
  } finally {
    busy = false
  }
}

/** 注册 `editor.formatDocument`。★焦点保护：搜索框 / 输入框里按 ⇧⌥F 不能改代码。 */
export function registerFormatAction(getView: () => EditorView | null, getPath: () => string): Array<() => void> {
  return [
    onAction('editor.formatDocument', () => {
      const v = getView()
      if (v?.hasFocus) void formatDocument(v, getPath())
    }),
  ]
}
