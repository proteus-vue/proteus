/**
 * editorExtras.ts —— 编辑器的「基础编辑体验」扩展（决策 #1427）
 *
 * 【为什么单独成文件】① `CodePanel.vue` 已 999 行顶到硬上限（`check:file-size`）；
 *   ② 这些能力属于编辑器内核层，与文件读写/标签/诊断无关，放这里更清楚。
 *
 * 【这一批补什么】对照主流 IDE，我们缺的是"打字手感"层面的默认件：
 *   · **代码折叠**（foldGutter + 折叠快捷键）—— 打开 500 行的 `App.vue` 时必备；
 *   · （括号自动闭合 `closeBrackets` 依赖 `@codemirror/autocomplete`，待装）
 *   · **多光标**（⌥ 拖动列选 + crosshair 光标形态）；
 *   · 以及原本散落在 `CodePanel` 里的括号匹配 / 缩进 / 选区绘制 / 特殊字符 / 选中词高亮。
 *
 * 【★刻意不接 `searchKeymap`】它会占用 `Mod-f`，而本仓现在的 `⌘F` 是**仓库搜索**（SearchBox）。
 *   要改成"⌘F 文件内查找 / ⇧⌘F 仓库搜索"（主流分工）属于**行为变更**，需与用户确认后再做，
 *   不能顺手把既有快捷键抢走。
 */
import { bracketMatching, foldGutter, indentOnInput, indentUnit } from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'
import {
  crosshairCursor,
  drawSelection,
  highlightSpecialChars,
  rectangularSelection,
} from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'

export function editorExtras(): Extension[] {
  return [
    /* 选区与特殊字符：没有 `drawSelection` 时选区在部分主题下几乎看不见 */
    drawSelection(),
    highlightSpecialChars(),
    /* 括号匹配高亮（自动补另一半需要 `@codemirror/autocomplete` 的 closeBrackets，依赖未装） */
    bracketMatching(),
    indentOnInput(),
    /* 缩进固定 2 空格：仓库里 .vue/.ts 都是 2 空格；跟文件推断在 tab/space 混用时反而跳 */
    EditorState.tabSize.of(2),
    indentUnit.of('  '),
    /* 折叠：行号右侧出现折叠箭头；`foldKeymap` 提供 ⌘⌥[ / ⌘⌥] */
    foldGutter({ openText: '▾', closedText: '▸' }),
    /* 选中词时弱化高亮同文件其它相同词 */
    highlightSelectionMatches(),
    /* 多光标：⌥ 拖动列选 + `crosshairCursor` 让光标形态提示"现在处于列选模式" */
    rectangularSelection(),
    crosshairCursor(),
  ]
}
