// packages/fluid/src/nav.ts
// ★Fluid System S3（导航）：工具栏溢出折叠纯逻辑——容器放不下时多余项收进「更多」
//   车机/平板场景核心：有限容器宽度下的导航项裁剪（「朴素但正确」——容器不可测 → 不折叠全显示，铁律 G-22.2）
export interface ToolbarOverflowOptions {
  /** 导航项总数 */
  count: number
  /** 容器宽度（px；≤0 = 不可测 → 不折叠） */
  containerWidth: number
  /** 单导航项宽度（px；缺省 80） */
  itemWidth?: number
  /** 「更多」按钮宽度（px；缺省 48） */
  moreWidth?: number
}

/**
 * 计算可见导航项数：全部放得下 → count（不折叠）；溢出 → floor((容器-more)/itemWidth) 钳制 [1, count-1]
 * - 容器宽度不可测（MP 无 ResizeObserver / 初始 0）→ 返回 count（不折叠全显示——降级「朴素但正确」）
 * - count ≤ 1 → count（单项目标无折叠意义）
 */
export function calcVisibleToolbarItems(options: ToolbarOverflowOptions): number {
  const count = options.count
  if (count <= 0) return 0
  if (count === 1) return 1
  const containerWidth = options.containerWidth
  if (!(containerWidth > 0)) return count
  const itemWidth = options.itemWidth && options.itemWidth > 0 ? options.itemWidth : 80
  const moreWidth = options.moreWidth && options.moreWidth > 0 ? options.moreWidth : 48
  // 全部项 + 更多按钮放得下 → 不折叠
  if (count * itemWidth + moreWidth <= containerWidth) return count
  // 溢出：可见 = floor((容器 - 更多) / 项宽)，至少 1 项、至多 count-1（留 1 项给「更多」）
  const visible = Math.floor((containerWidth - moreWidth) / itemWidth)
  const clamped = Math.max(1, Math.min(visible, count - 1))
  return clamped
}
