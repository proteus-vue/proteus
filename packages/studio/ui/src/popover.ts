// ui/src/popover.ts —— **面板弹出模型**（决策 #1482）
//
// 【为什么需要它】用户的批评很准："正常面板是**紧挨着触发入口**弹出才对"。
//   在此之前每个浮层各算各的位置：
//     · 悬停卡：自己算 `right + 8`（`FileHoverCard.pos`）
//     · 结构面板：**固定在右上角**（`top:88px; right:24px`）—— 与触发入口毫无关系
//   结果就是用户看到的：面板飞到角上、原来的卡片还自动关了，"整套逻辑是分离的"。
//
// 【本文件只做一件事】给定**触发元素矩形**与面板尺寸，算出面板该放哪。
//   所有浮层都必须走这里 —— 位置规则只留一份实现，否则第三次做面板时又会各写一套。
//
// 【三条硬约束（判据 ㊿o 验前两条）】
//   ① **紧挨**：横向间距恒为 `POPOVER_GAP`，不随面板类型变化；
//   ② **不遮挡触发入口**：优先放右侧；右侧放不下就翻到左侧，**不压在上面**；
//   ③ **级联同向**：子面板的锚点是**父面板的矩形**，不是父面板里的某一行 ——
//      这样两级面板会像台阶一样向右延伸（鼠标从父走到子是一条直线）。
export const POPOVER_GAP = 8

export interface AnchorRect {
  top: number
  left: number
  right: number
}

export interface PopoverPos {
  left: number
  top: number
  /** 实际落在锚点的哪一侧 —— 判据用它证明"翻边"发生了，而不是靠肉眼看 */
  side: 'right' | 'left'
}

/**
 * 把面板放在锚点旁边。
 * @param anchor 触发元素（或父面板）的视口矩形
 * @param size   面板尺寸；高度用**估算值**即可（只用于垂直夹取，真实高度由 max-height 兜底）
 */
export function placeBeside(
  anchor: AnchorRect,
  size: { w: number; h: number },
  gap = POPOVER_GAP,
): PopoverPos {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let side: 'right' | 'left' = 'right'
  let left = anchor.right + gap
  if (left + size.w > vw - gap) {
    side = 'left'
    left = Math.max(gap, anchor.left - gap - size.w)
  }
  /* 垂直：默认与锚点顶对齐（视线不用跳），底部放不下就整体上移，最小留 gap */
  const top = Math.max(gap, Math.min(anchor.top, vh - size.h - gap))
  return { left, top, side }
}
