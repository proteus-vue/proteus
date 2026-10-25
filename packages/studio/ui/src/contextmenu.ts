// ui/src/contextmenu.ts —— 全局自适应右键菜单的状态（决策 #1234 / #1239）
//
// 【为什么是"一个菜单 + 一份上下文"而不是每个组件各写一个】
//   右键菜单的难点从来不是画一个框，而是：**谁来关**（点外面 / Esc / 滚动 / 窗口失焦）、
//   **谁来定位**、**同一时刻只能有一个**。
//   这些是全局问题，每个组件各写一份必然出现"两个菜单同时开着"。
//
// 【★定位必须"先量后放"】（2026-10-25 修）：上一版用"估算高度 × 项数"判断要不要上翻，
//   估错了就把菜单丢到离鼠标很远的地方（用户截图：点在下半屏，菜单弹到上半屏）。
//   现在只记**锚点**（鼠标点），组件渲染后用**真实尺寸**决定最终位置：
//     贴右下 → 翻转；翻转后仍越界 → 夹到 8px 边距。永不用估算值定位置。
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
  /** 鼠标锚点（client 坐标） */
  anchorX: number
  anchorY: number
  /** 实际渲染位置（由 ContextMenu 量完再写） */
  x: number
  y: number
  items: MenuItem[]
  /** 键盘高亮的下标（-1 = 无） */
  active: number
  pick: ((id: string) => void) | null
}

export const menuState = reactive<MenuState>({
  open: false,
  anchorX: 0,
  anchorY: 0,
  x: 0,
  y: 0,
  items: [],
  active: -1,
  pick: null,
})

const EDGE = 8

export function openMenu(
  e: MouseEvent | { clientX: number; clientY: number },
  items: MenuItem[],
  pick: (id: string) => void,
): void {
  menuState.items = items
  menuState.pick = pick
  menuState.active = -1
  menuState.anchorX = Math.round(e.clientX)
  menuState.anchorY = Math.round(e.clientY)
  // 先放到锚点（渲染时透明，量完由 place() 纠正 —— 见 ContextMenu 的 measure 流程）
  menuState.x = menuState.anchorX
  menuState.y = menuState.anchorY
  menuState.open = true
}

/** 用**真实尺寸**把菜单放到锚点附近（贴边翻转；越界夹住） */
export function placeMenu(w: number, h: number, vw: number, vh: number): void {
  const { anchorX, anchorY } = menuState
  let x = anchorX
  let y = anchorY
  if (x + w > vw - EDGE) x = anchorX - w // 往左展开，右边贴住鼠标
  if (y + h > vh - EDGE) y = anchorY - h // 往上展开，下边贴住鼠标
  // 翻转后仍越界（菜单比窗口还高）⇒ 夹到边距，至少不飞出屏幕
  x = Math.min(Math.max(EDGE, x), Math.max(EDGE, vw - w - EDGE))
  y = Math.min(Math.max(EDGE, y), Math.max(EDGE, vh - h - EDGE))
  menuState.x = Math.round(x)
  menuState.y = Math.round(y)
}

export function closeMenu(): void {
  menuState.open = false
  menuState.pick = null
  menuState.active = -1
}

export function pickItem(id: string): void {
  const fn = menuState.pick
  closeMenu()
  fn?.(id)
}

/** 键盘上下移动（跳过分隔线与禁用项，可循环） */
export function moveActive(delta: number): void {
  const n = menuState.items.length
  if (n === 0) return
  let i = menuState.active
  for (let step = 0; step < n; step += 1) {
    i = (i + delta + n) % n
    const it = menuState.items[i]
    if (it && !it.sep && !it.disabled) {
      menuState.active = i
      return
    }
  }
}

/** 当前高亮项（分隔线/禁用项不算） */
export function activeItem(): MenuItem | null {
  const it = menuState.items[menuState.active]
  return it && !it.sep && !it.disabled ? it : null
}
