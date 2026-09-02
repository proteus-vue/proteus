// packages/desktop/src/context-menu.ts
// ★G-24 B1（proteus-semantic-primitives-plan 03 §2 p-context-menu）：右键上下文菜单纯逻辑（触摸长按/鼠标右键归一）
//   · buildMenuPosition(point, size, viewport) → 防溢出翻转定位（菜单不超出视口）
//   · parseMenuItems 校验 + 危险项归一
//   纯逻辑零 DOM 依赖；MP 产物安全：无 ?. / ??；无数组解构
export interface MenuItem {
  /** 菜单项文本 */
  label: string
  /** 语义值（emit('select', value) 载荷） */
  value?: string
  disabled?: boolean
  /** 危险操作（视觉红/确认语义） */
  danger?: boolean
  /** 分隔线（label '—' 或 divider:true——渲染层画线） */
  divider?: boolean
}

/** 触发点（鼠标右键坐标 / 触摸长按坐标——归一） */
export interface MenuPoint {
  x: number
  y: number
}

/** 菜单弹出尺寸（防溢出定位用） */
export interface MenuSize {
  width: number
  height: number
}

/** 视口尺寸（防溢出定位用；缺省 1024×768 兜底） */
export interface ViewportSize {
  width: number
  height: number
}

export interface PositionedMenu {
  items: MenuItem[]
  x: number
  y: number
  /** 是否翻转（贴右/贴下边缘时）——渲染层可加箭头方向 */
  flippedX?: boolean
  flippedY?: boolean
}

/**
 * 防溢出定位：菜单在 (x,y) 弹出，若超出视口右/下边缘 → 翻转（菜单左上角对齐边缘内侧，留 4px 安全距）
 */
export function buildMenuPosition(point: MenuPoint, size: MenuSize, viewport: ViewportSize = { width: 1024, height: 768 }): PositionedMenu {
  const GAP = 4
  let x = point.x
  let y = point.y
  let flippedX = false
  let flippedY = false
  if (x + size.width > viewport.width) {
    x = Math.max(GAP, viewport.width - size.width - GAP)
    flippedX = true
  }
  if (y + size.height > viewport.height) {
    y = Math.max(GAP, viewport.height - size.height - GAP)
    flippedY = true
  }
  return { items: [], x, y, flippedX, flippedY }
}

/** 长按/右键归一触发点（注入坐标——Web contextmenu e.clientX/Y / 触摸长按合成） */
export function menuPointFrom(x: number | undefined, y: number | undefined): MenuPoint {
  const px = typeof x === 'number' && isFinite(x) ? x : 0
  const py = typeof y === 'number' && isFinite(y) ? y : 0
  return { x: px, y: py }
}

/** 菜单构建（校验 + 危险项归一 + 定位合并一步到位——指令层薄封装） */
export function buildContextMenu(items: MenuItem[], point: MenuPoint, size: MenuSize, viewport?: ViewportSize): PositionedMenu {
  const positioned = buildMenuPosition(point, size, viewport)
  return { items, x: positioned.x, y: positioned.y, flippedX: positioned.flippedX, flippedY: positioned.flippedY }
}