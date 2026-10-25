// ui/src/contextmenu.ts —— 全局自适应右键菜单的状态（决策 #1234）
//
// 【为什么是"一个菜单 + 一份上下文"而不是每个组件各写一个】
//   右键菜单的难点从来不是画一个框，而是：**谁来关**（点外面 / Esc / 滚动 / 窗口失焦）、
//   **谁来定位**（贴边要翻转，不能被窗口裁掉）、**同一时刻只能有一个**。
//   这些是全局问题，每个组件各写一份必然出现"两个菜单同时开着"。
//   ⇒ 这里是一个极小的 store：`openMenu(event, items, onPick)`；
//     每个调用方只负责"我这个位置有哪些项"，开关/定位/互斥都在这一层。
//
// 【和原生菜单的关系】应用菜单栏（Rust 的 NSMenu，决策 #1221）是**系统级**的；
//   这里的是**内容级**的右键菜单（标签/文件/编辑器）。两者不共用代码，但动词要一致：
//   保存 / 关闭标签页 这类动作**都走同一批前端函数**，不复制第二份逻辑。
import { reactive } from 'vue'

export interface MenuItem {
  /** 动作 id（由调用方的 onPick 解释） */
  id: string
  label: string
  /** 右侧显示的快捷键提示（仅提示，真实快捷键由别处处理） */
  accel?: string
  /** 危险动作（关闭类）用 --bad */
  danger?: boolean
  disabled?: boolean
  /** 分隔线（此时其余字段忽略） */
  sep?: boolean
}

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
  pick: ((id: string) => void) | null
}

export const menuState = reactive<MenuState>({
  open: false,
  x: 0,
  y: 0,
  items: [],
  pick: null,
})

/** 菜单宽/高的估算值只用于"贴边翻转"；真实尺寸由组件量完再修正（见 ContextMenu.vue） */
const EST_W = 208
const EST_H = 34

export function openMenu(
  e: MouseEvent | { clientX: number; clientY: number },
  items: MenuItem[],
  pick: (id: string) => void,
): void {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 贴边翻转：右下角右键时向左/向上展开，否则菜单会被窗口裁掉
  const x = e.clientX + EST_W > vw - 8 ? Math.max(8, e.clientX - EST_W) : e.clientX
  const y = e.clientY + EST_H * items.length > vh - 8 ? Math.max(8, e.clientY - EST_H * items.length) : e.clientY
  menuState.items = items
  menuState.pick = pick
  menuState.x = Math.round(x)
  menuState.y = Math.round(y)
  menuState.open = true
}

export function closeMenu(): void {
  menuState.open = false
  menuState.pick = null
}

export function pickItem(id: string): void {
  const fn = menuState.pick
  closeMenu()
  fn?.(id)
}

/** 断言用：菜单当前是否开着、有哪些项。 */
export const menuOpen = (): boolean => menuState.open
