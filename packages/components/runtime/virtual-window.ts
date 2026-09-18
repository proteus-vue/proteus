// src/components/runtime/virtual-window.ts —— 虚拟窗口纯函数（组件库 B7）
// 长列表只渲染可视区：输入滚动位置/行高/视口高/缓冲行/总数 → 输出可视窗口 { start, count }
// 纯函数无 vue 依赖（共享模块 B0 机制编译进 MP 产物）；窗口数学可独立单测（10k 数据 → 恒定行数）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构

export interface VirtualWindow {
  start: number
  count: number
}

/**
 * 计算可视窗口：start = floor(scrollTop / itemHeight)；count = 视口行数 + 缓冲（截断到列表末尾）
 * 边界：滚过末尾（start ≥ total）→ count = 0（空窗口，占位仍撑高度）
 */
export function getVirtualWindow(
  scrollTop: number,
  itemHeight: number,
  height: number,
  buffer: number,
  total: number,
): VirtualWindow {
  const start = Math.min(total, Math.max(0, Math.floor(scrollTop / itemHeight)))
  const viewCount = Math.ceil(height / itemHeight) + buffer
  const count = Math.min(viewCount, Math.max(0, total - start))
  return { start, count }
}
