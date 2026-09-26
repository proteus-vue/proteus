// tests/fluid-focus-nav.test.ts
// ★★焦点导航引擎回归锁（2026-09-26，专家报告 P1-4）
// 背景：七位专家一致命中「TV/车机的 nav: focus-tree/focus-row 与 caps.dpad/keyboard 只是声明」——
//   没有方向键处理、没有 roving tabindex、海报卡不可聚焦 → 遥控器无法操作。
//   本文件锁死**几何空间导航算法**（navigateFocus）：这是遥控/键盘形态可用性的地基。
import { describe, it, expect } from 'vitest'
import { navigateFocus, clampOrWrap, type FocusRect } from '../packages/fluid/src/focus-nav'

/** 构造 2×3 网格（每格 100×50，gap 0）——模拟「Hero + 海报行」或按钮组 */
const grid: FocusRect[] = [
  { id: 'r0c0', x: 0, y: 0, width: 100, height: 50 },
  { id: 'r0c1', x: 100, y: 0, width: 100, height: 50 },
  { id: 'r0c2', x: 200, y: 0, width: 100, height: 50 },
  { id: 'r1c0', x: 0, y: 60, width: 100, height: 50 },
  { id: 'r1c1', x: 100, y: 60, width: 100, height: 50 },
  { id: 'r1c2', x: 200, y: 60, width: 100, height: 50 },
]

describe('★★焦点导航引擎（遥控/键盘形态的可用性地基）', () => {
  const at = (id: string) => grid.find((g) => g.id === id)!

  it('首次进入：优先 preferredFirst（TV/车机惯例——进入即可操作主按钮）', () => {
    expect(navigateFocus(null, grid, 'down', { preferredFirst: 'r1c1' })).toBe('r1c1')
  })

  it('首次进入无偏好：取几何最左上（阅读顺序起点）', () => {
    expect(navigateFocus(null, grid, 'right')).toBe('r0c0')
  })

  it('同水平行内左右移动（不跳到下一行——交叉轴权重生效）', () => {
    expect(navigateFocus(at('r0c0'), grid, 'right')).toBe('r0c1')
    expect(navigateFocus(at('r0c1'), grid, 'right')).toBe('r0c2')
    expect(navigateFocus(at('r0c2'), grid, 'left')).toBe('r0c1')
    expect(navigateFocus(at('r0c1'), grid, 'left')).toBe('r0c0')
  })

  it('上下移动：跨行但保持同列（主轴距离 + 交叉轴打分）', () => {
    expect(navigateFocus(at('r0c1'), grid, 'down')).toBe('r1c1')
    expect(navigateFocus(at('r1c2'), grid, 'up')).toBe('r0c2')
  })

  it('★边界：无候选返回 null（调用方决定 wrap 或停住——不越界乱跳）', () => {
    expect(navigateFocus(at('r0c2'), grid, 'right')).toBeNull()
    expect(navigateFocus(at('r0c0'), grid, 'left')).toBeNull()
    expect(navigateFocus(at('r0c0'), grid, 'up')).toBeNull()
  })

  it('★焦点行（TV 海报流）：横排卡片之间左右可达，且不误跳到上方 Hero', () => {
    const poster: FocusRect[] = [
      { id: 'hero', x: 0, y: 0, width: 400, height: 200 },
      { id: 'c0', x: 0, y: 220, width: 150, height: 90 },
      { id: 'c1', x: 170, y: 220, width: 150, height: 90 },
      { id: 'c2', x: 340, y: 220, width: 150, height: 90 },
    ]
    const h = poster.find((p) => p.id === 'hero')!
    const c0 = poster.find((p) => p.id === 'c0')!
    expect(navigateFocus(c0, poster, 'right')).toBe('c1')   // 行内右移
    expect(navigateFocus(c0, poster, 'up')).toBe('hero')     // 上行（Hero）
    // ★Hero（宽 400，中心 200）下行 → 几何最近邻是 c1（中心 245，距 45）而非 c0（距 125）——
    //   这是「交叉轴对齐优先」的正确行为（tvOS/Leanback 同款：下行落在视线正下方）。
    expect(navigateFocus(h, poster, 'down')).toBe('c1')
    // 若 Hero 与 c0 左对齐（常见布局），则下行落在 c0（视线正下方）
    const leftAlignedHero = { id: 'hero', x: 0, y: 0, width: 150, height: 200 }
    expect(navigateFocus(leftAlignedHero, poster, 'down')).toBe('c0')
  })

  it('大热区优先：交叉轴对齐的近邻胜过斜向远者（车机大瓦片场景）', () => {
    const tiles: FocusRect[] = [
      { id: 'btn', x: 0, y: 0, width: 120, height: 80 },
      { id: 'far-aligned', x: 300, y: 0, width: 120, height: 80 },   // 正右方（对齐）
      { id: 'near-shifted', x: 140, y: 90, width: 120, height: 80 }, // 更近但斜下
    ]
    expect(navigateFocus(tiles[0]!, tiles, 'right')).toBe('far-aligned')
  })

  it('空候选集 → null（不抛错）', () => {
    expect(navigateFocus(null, [], 'right')).toBeNull()
    expect(navigateFocus(at('r0c0'), [], 'right')).toBeNull()
  })

  it('clampOrWrap：边界钳制 vs 循环（两种形态策略）', () => {
    expect(clampOrWrap(5, 3, false)).toBe(2)  // 钳到末尾
    expect(clampOrWrap(-1, 3, false)).toBe(0) // 钳到开头
    expect(clampOrWrap(3, 3, true)).toBe(0)   // 循环回首
    expect(clampOrWrap(-1, 3, true)).toBe(2)  // 循环回尾
    expect(clampOrWrap(0, 0, true)).toBe(-1)  // 空集
  })
})
