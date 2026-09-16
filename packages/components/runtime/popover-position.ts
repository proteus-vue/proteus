// src/components/runtime/popover-position.ts
// p-popover 面板定位纯函数（★方案 A spike：fixed + 像素坐标——Skyline 层叠解药）
// 与 @proteus-vue/shared 的 Rect 类型/measureRect L2 抽象配套：组件经 adapter.measureRect 测 trigger rect →
// computePopoverPosition 算视口像素坐标 → 面板 position:fixed + left/top（浮到层叠顶层）。
// 纯数学无环境依赖——任何端（node 单测 / Web / MP）确定性一致。
// ★降级契约：measureRect 失败/不支持 → 组件回退静态 .p-popover-{placement} 绝对锚定（终案行为不变）。
import type { Rect } from '@proteus-vue/shared'

export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface PopoverPositionInput {
  /** trigger 元素视口矩形（measureRect 返回） */
  trigger: Rect
  /** 方向（缺省 bottom，对齐组件默认） */
  placement?: PopoverPlacement
  /** 与 trigger 间隙（默认 6px，对齐 CSS calc(100% + 6px)） */
  gap?: number
}

export interface PopoverPosition {
  left: number
  top: number
  placement: PopoverPlacement
}

/**
 * 由 trigger 视口矩形计算面板的 fixed 视口坐标（锚定在 trigger 的边缘 + gap）。
 * top/left 即 position:fixed 的值（measureRect 返回的是视口相对坐标——与 fixed 坐标系一致）。
 * 对齐既有的 .p-popover-{placement} 相对锚定语义（bottom = trigger 下方、top = 上方、left/right = 侧方）。
 */
export function computePopoverPosition(input: PopoverPositionInput): PopoverPosition {
  const placement: PopoverPlacement = input.placement ?? 'bottom'
  const gap = input.gap ?? 6
  const t = input.trigger
  switch (placement) {
    case 'top':
      return { left: t.left, top: t.top - gap, placement: 'top' }
    case 'bottom':
      return { left: t.left, top: t.bottom + gap, placement: 'bottom' }
    case 'left':
      return { left: t.left - gap, top: t.top, placement: 'left' }
    case 'right':
      return { left: t.right + gap, top: t.top, placement: 'right' }
  }
}
