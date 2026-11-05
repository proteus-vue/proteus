/**
 * chooser.ts —— 「多个定义，选一个」的状态与 Promise 桥（决策 #1442）
 *
 * 【为什么需要】tsserver 对**重载 / interface 合并声明 / 联合类型**会返回多个位置。
 *   原来只取第一条，用户永远跳到第一个、没得选。这里在 >1 时弹一个列表：
 *   点击或 ↑↓ + Enter 选择，Esc / 点空白取消。
 *
 * 【为什么用 Promise】调用方（`CodePanel.jumpToDef`）只想要"最终跳哪"，
 *   不希望自己维护"选择器是否打开 / 选了谁"。`chooseDefinition` 返回 Promise，
 *   用户选完或取消时 resolve —— 调用点就是一句 `await`。
 */
import { readonly, ref } from 'vue'
import type { EditorView } from '@codemirror/view'
import type { DefTarget } from './nav'

export interface ChooserItem {
  target: DefTarget
  /** 文件名（末段） */
  name: string
  /** 目录（末两级，弱化显示） */
  dir: string
}

export interface ChooserState {
  items: ChooserItem[]
  /** 视口坐标（fixed 定位） */
  x: number
  y: number
}

const state = ref<ChooserState | null>(null)
export const chooserState = readonly(state)

let resolveFn: ((t: DefTarget | null) => void) | null = null

function toItem(t: DefTarget): ChooserItem {
  const parts = t.path.split('/').filter(Boolean)
  const name = parts[parts.length - 1] ?? t.path
  /* 末两级目录：完整路径在 460px 里放不下，且末两级足够分辨同名文件 */
  const dir = parts.slice(-3, -1).join('/')
  return { target: t, name, dir: dir ? `${dir}/` : '' }
}

/** 弹出选择器；返回选中项，取消返回 null */
export function chooseDefinition(list: DefTarget[], x: number, y: number): Promise<DefTarget | null> {
  /* 若已有一个没结束的选择（连按 F12），先把它当作取消，避免 Promise 永远挂着 */
  resolveFn?.(null)
  return new Promise((resolve) => {
    resolveFn = resolve
    state.value = { items: list.map(toItem), x, y }
  })
}

/** 组件里调用：选中 / 取消 */
export function settleDefinition(t: DefTarget | null): void {
  state.value = null
  const r = resolveFn
  resolveFn = null
  r?.(t)
}

/**
 * 在编辑器某位置弹出（F12 用光标、⌘+单击用鼠标位置）。
 * 坐标拿不到（滚动到视口外）就退回左上角附近，至少能操作。
 */
export function chooseDefinitionAt(
  list: DefTarget[],
  view: EditorView | null,
  pos: number,
): Promise<DefTarget | null> {
  if (!view) return Promise.resolve(list[0] ?? null)
  const c = view.coordsAtPos(pos)
  return chooseDefinition(list, c?.left ?? 120, (c?.bottom ?? 120) + 8)
}
