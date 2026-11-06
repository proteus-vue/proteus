/**
 * refs.ts —— 「查找引用」的结果面板状态（决策 #1443）
 *
 * 与 `chooser.ts`（多定义）同一套模式：面板是单例，用 Promise 把"选了哪一条"交给调用方，
 * 调用点只写一句 `await`。区别是这里可能几十条、每条带行文本，需要独立组件渲染。
 */
import { readonly, ref } from 'vue'
import type { EditorView } from '@codemirror/view'
import type { RefItem } from './bridge'

export interface RefRow {
  item: RefItem
  /** 文件名（末段） */
  name: string
  /** 目录（末两级，弱化显示） */
  dir: string
}

export interface RefPanelState {
  rows: RefRow[]
  x: number
  y: number
}

const state = ref<RefPanelState | null>(null)
export const refPanelState = readonly(state)

let resolveFn: ((r: RefItem | null) => void) | null = null

function toRow(item: RefItem): RefRow {
  const parts = item.path.split('/').filter(Boolean)
  const name = parts[parts.length - 1] ?? item.path
  const dir = parts.slice(-3, -1).join('/')
  return { item, name, dir: dir ? `${dir}/` : '' }
}

/** 弹出引用列表；返回选中项，取消返回 null */
export function pickReference(rows: RefRow[], x: number, y: number): Promise<RefItem | null> {
  /* 连按 ⇧F12：先把上一次未决的 resolve 成 null，避免 Promise 永远挂着 */
  resolveFn?.(null)
  return new Promise((resolve) => {
    resolveFn = resolve
    state.value = { rows, x, y }
  })
}

/** 组件里调用：选中 / 取消 */
export function settleReference(item: RefItem | null): void {
  state.value = null
  const r = resolveFn
  resolveFn = null
  r?.(item)
}

/** 在编辑器某位置弹出（坐标拿不到就退回左上附近） */
export function pickReferenceAt(
  items: RefItem[],
  view: EditorView | null,
  pos: number,
): Promise<RefItem | null> {
  if (!view) return Promise.resolve(items[0] ?? null)
  const c = view.coordsAtPos(pos)
  return pickReference(items.map(toRow), c?.left ?? 120, (c?.bottom ?? 120) + 8)
}
