/**
 * editorActions.ts —— 编辑器的**行级 / 注释 / 多选**动作（决策 #1452）
 *
 * 【为什么单独一个文件】这些动作各要一条快捷键，全部塞进 `CodePanel.vue` 会直接顶破
 *   1000 行上限；而它们只依赖"当前 view"，与文件、标签、诊断都无关 ⇒ 天然适合独立。
 *
 * 【★焦点保护】注册表是**全局捕获**（window capture）。如果焦点在搜索框 / 重命名输入框里，
 *   按 `⌥↑` 本意是"光标移到段首"，绝不能跑去移动代码行 ⇒ 每个动作都先判 `view.hasFocus`。
 *
 * 【快捷键在 keybindings.ts】这里只实现"做什么"，键位（VS Code / JetBrains / 自定义）都在注册表。
 */
import {
  copyLineDown,
  copyLineUp,
  cursorMatchingBracket,
  deleteLine,
  moveLineDown,
  moveLineUp,
  toggleComment,
} from '@codemirror/commands'
import { selectSelectionMatches } from '@codemirror/search'
import type { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { onAction } from './keybindings'
import { registerFormatAction } from './editorFormat'

/**
 * ★**StateCommand → Command 适配**：`selectSelectionMatches()` 返回的命令解构
 * `{state, dispatch}`，而我们的 `run()` 传的是 `EditorView`。结构上虽然相似，
 * 但直接当 `Command` 用会在某些路径下把参数当 `undefined`（实测线上崩过一次）。
 * 显式转一层，语义清楚、类型也不会骗人。
 */
/** CodeMirror 的 `Command`（收 EditorView）—— `@codemirror/view` 没导出这个类型，自己声明 */
type Cmd = (v: EditorView) => boolean
const asCommand = (sc: (t: { state: EditorView['state']; dispatch: (tr: Transaction) => void }) => boolean): Cmd =>
  (v) => sc({ state: v.state, dispatch: (tr) => v.dispatch(tr) })

export function registerEditorActions(
  getView: () => EditorView | null,
  getPath: () => string,
): Array<() => void> {
  /** 只在编辑器真的聚焦时执行（见文件头"焦点保护"） */
  const run = (cmd: Cmd) => () => {
    const v = getView()
    if (v?.hasFocus) cmd(v)
  }

  return [
    /* ★除 `deleteLine` 外**全是 StateCommand**（签名 `({state, dispatch}) => boolean`）：
       直接当 `Command`（收 EditorView）调用会解构错、丢 `this.dispatch` ⇒ 必须过 `asCommand`。 */
    onAction('editor.moveLineUp', run(asCommand(moveLineUp))),
    onAction('editor.moveLineDown', run(asCommand(moveLineDown))),
    onAction('editor.copyLineUp', run(asCommand(copyLineUp))),
    onAction('editor.copyLineDown', run(asCommand(copyLineDown))),
    onAction('editor.deleteLine', run(deleteLine)),
    onAction('editor.toggleComment', run(asCommand(toggleComment))),
    onAction('editor.selectAllMatches', run(asCommand(selectSelectionMatches))),
    onAction('editor.jumpBracket', run(asCommand(cursorMatchingBracket))),
    /* 决策 #1462：格式化不是行级动作，但需要同一个 view/path ⇒ 从这里统一注册，
       `CodePanel.vue` 的 offActions 一行都不用加（它已贴 1000 行上限）。 */
    ...registerFormatAction(getView, getPath),
  ]
}
