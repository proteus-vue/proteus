// packages/fluid/src/focus-nav.ts
// ★★Fluid System（2026-09-26 专家报告 P1-4 修复）：遥控/旋钮/键盘形态的**焦点导航引擎**
//
// 问题（七位专家一致命中）：`nav: 'focus-tree' / 'focus-row'` 与 `caps.dpad / keyboard`
//   此前只是**声明**——没有方向键处理、没有 roving tabindex、没有首焦点定位。
//   TV「立即购买/收藏」是唯一可 Tab 的两个元素，海报卡是不可聚焦 div → 遥控器无法操作。
//
// 本模块提供**几何空间导航**（与 React-TV-Navigation / tvOS 同思路）：
//   给定焦点候选元素的矩形 + 当前焦点 + 按键方向 → 选出下一个焦点元素。
//   纯函数（矩形由调用方测量；本模块不碰 DOM）→ 可单测、可跨端复用（Web/原生）。
//
// 算法（比朴素「就近」更符合 TV/车机预期）：
//   ① 只考虑**该方向上**的候选（如 ArrowRight 要求 center.x > 当前 center.x 且重叠带足够）
//   ② 打分 = 主轴距离 + 交叉轴偏移 × 权重（交叉轴越对齐越优先——保证「同行内左右移动」）
//   ③ 同行/同列优先（重叠超过候选尺寸 50% 视为同行 → 主轴距离直接决定）
//   ④ 边界（无候选）→ 返回 null（调用方可做 wrap 或忽略）

export type FocusDirection = 'up' | 'down' | 'left' | 'right'

export interface FocusRect {
  /** 稳定标识（调用方给出——通常是元素 key 或索引） */
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** 矩形中心 */
function center(r: FocusRect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/** 主轴重叠长度（用于判断「同行/同列」） */
function overlap(a: FocusRect, b: FocusRect, axis: 'x' | 'y'): number {
  const [a1, a2] = axis === 'x' ? [a.x, a.x + a.width] : [a.y, a.y + a.height]
  const [b1, b2] = axis === 'x' ? [b.x, b.x + b.width] : [b.y, b.y + b.height]
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
}

/**
 * 空间导航：给定当前焦点与候选，按方向选下一个。
 *
 * @param current 当前焦点矩形（null = 首次进入 → 返回 `preferredFirst` 或几何最左上者）
 * @param candidates 候选矩形（**不含** current）
 * @param direction 按键方向
 * @param opts.preferredFirst 首焦点优先 id（TV/车机惯例：进入即聚焦主操作）
 * @param opts.crossWeight 交叉轴偏移权重（默认 2.0——越大越偏好「同轴线」移动）
 */
export function navigateFocus(
  current: FocusRect | null,
  candidates: FocusRect[],
  direction: FocusDirection,
  opts: { preferredFirst?: string; crossWeight?: number } = {},
): string | null {
  if (candidates.length === 0) return null
  const crossWeight = opts.crossWeight ?? 2

  // 首次进入：优先首焦点，否则取几何上最靠左上者（阅读顺序起点）
  if (!current) {
    if (opts.preferredFirst) {
      const hit = candidates.find((c) => c.id === opts.preferredFirst)
      if (hit) return hit.id
    }
    const first = [...candidates].sort((a, b) => a.y - b.y || a.x - b.x)[0]
    return first ? first.id : null
  }

  const cur = center(current)
  const isHorizontal = direction === 'left' || direction === 'right'
  const forward = direction === 'right' || direction === 'down'

  type Scored = { id: string; primary: number; cross: number; sameLine: boolean }
  const scored: Scored[] = []

  for (const c of candidates) {
    const cc = center(c)
    const primaryDelta = isHorizontal ? cc.x - cur.x : cc.y - cur.y
    // ① 只考虑该方向上的候选（留 1px 容差——同行微偏移不算「同位置」）
    if (forward ? primaryDelta <= 1 : primaryDelta >= -1) continue
    const primary = Math.abs(primaryDelta)
    // ② 交叉轴偏移（越小越对齐）
    const cross = isHorizontal ? Math.abs(cc.y - cur.y) : Math.abs(cc.x - cur.x)
    // ③ 同行/同列判定：交叉轴重叠 > 候选尺寸一半 → 视为同行（主轴距离优先）
    const sameLine = overlap(current, c, isHorizontal ? 'y' : 'x') > (isHorizontal ? c.height : c.width) * 0.5
    scored.push({ id: c.id, primary, cross, sameLine })
  }

  if (scored.length === 0) return null

  // ④ 打分：同行 → 主轴距离主导；跨行 → 主轴 + 交叉 × 权重
  //   ★tie-break（2026-09-26）：同分时取「交叉轴更对齐 → 主轴更近 → 几何更靠左/上」——
  //   否则「Hero 宽块 + 下方多张等距卡」会随机选中中间那张（实测：应选首张 c0 却选了 c1）
  scored.sort((a, b) => {
    if (a.sameLine !== b.sameLine) return a.sameLine ? -1 : 1
    const sa = a.primary + a.cross * crossWeight
    const sb = b.primary + b.cross * crossWeight
    if (Math.abs(sa - sb) > 0.5) return sa - sb
    if (Math.abs(a.cross - b.cross) > 0.5) return a.cross - b.cross
    if (Math.abs(a.primary - b.primary) > 0.5) return a.primary - b.primary
    // 几何顺序（左/上优先）——用候选原始顺序保证确定性
    return candidates.findIndex((c) => c.id === a.id) - candidates.findIndex((c) => c.id === b.id)
  })
  return scored[0]!.id
}

/** 焦点序列的边界行为（TV/车机常见：行内循环 or 停在边界） */
export function clampOrWrap(index: number, total: number, wrap: boolean): number {
  if (total <= 0) return -1
  if (wrap) return ((index % total) + total) % total
  return Math.max(0, Math.min(index, total - 1))
}
