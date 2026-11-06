/**
 * symbols.ts —— 文件内符号面板的状态与流程（决策 #1454，⌘⇧O）
 *
 * 【对标】VS Code 的 "Go to Symbol in File"（⌘⇧O）/ JetBrains 的 ⌘F12：
 *   弹一个**可输入过滤**的列表，选中即跳。
 *
 * 【与 chooser / refs 的区别】那两个列表是"候选固定、只能上下选"；
 *   符号动辄几十上百个，必须**边打边过滤**，否则和滚动列表没区别。
 */
import { readonly, ref } from 'vue'
import type { EditorView } from '@codemirror/view'
import type { SymbolItem } from './bridge'
import { symbolsAt } from './nav'

interface SymbolsState {
  items: SymbolItem[]
  x: number
  y: number
}

const state = ref<SymbolsState | null>(null)
export const symbolsState = readonly(state)

let resolveFn: ((s: SymbolItem | null) => void) | null = null

export function pickSymbol(items: SymbolItem[], x: number, y: number): Promise<SymbolItem | null> {
  /* 连按 ⌘⇧O：先把上一次未决的 resolve 成 null，避免 Promise 永远挂着 */
  resolveFn?.(null)
  return new Promise((resolve) => {
    resolveFn = resolve
    state.value = { items, x, y }
  })
}

export function settleSymbol(s: SymbolItem | null): void {
  state.value = null
  const r = resolveFn
  resolveFn = null
  r?.(s)
}

/**
 * ⌘⇧O 的完整流程：取符号 → 空则就地提示 → 弹面板让用户选 → 回调跳转。
 * 放在这里而不是组件里：`CodePanel` 已贴着 1000 行上限，只留一行调用。
 */
export async function gotoFileSymbol(opts: {
  view: EditorView | null
  path: string
  hint: (msg: string) => void
  jump: (s: SymbolItem) => void
}): Promise<void> {
  const { view, path, hint } = opts
  if (!view || !path) return
  const items = await symbolsAt(view, path)
  if (!items.length) return hint('这个文件里没有可跳转的符号')
  const c = view.coordsAtPos(view.state.selection.main.head)
  const pick = await pickSymbol(items, c?.left ?? 160, (c?.bottom ?? 160) + 8)
  if (pick) opts.jump(pick)
}
