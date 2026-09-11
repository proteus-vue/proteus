// tests/wireframe.test.ts —— ★2026-09-11 零依赖 WebGL 线框核心：icosahedron 几何构建（纯逻辑）
//   WebGL 上下文无法在 jsdom 测试 → 只锁几何算法（顶点/边数/单位球），渲染由浏览器截图验证。
import { describe, it, expect } from 'vitest'
import { buildIcosahedron } from '../website/src/visual/wireframe'

describe('零依赖线框核心：icosahedron 几何', () => {
  it('正二十面体：30 条边 → gl.LINES 需 60 个顶点（120 浮点索引 × 3 分量 = 180）', () => {
    const { positions, vertexCount } = buildIcosahedron()
    expect(vertexCount).toBe(60)        // drawArrays 顶点数 = 30 边 × 2 端点
    expect(vertexCount / 2).toBe(30)    // 线段数 = 30（icosahedron 边数）
    expect(positions.length).toBe(180)  // 60 顶点 × 3 分量
  })

  it('所有顶点在单位球面上（归一化）', () => {
    const { positions } = buildIcosahedron()
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2])
      expect(r).toBeCloseTo(1, 5)
    }
  })

  it('恰有 12 个唯一顶点（icosahedron 顶点数）', () => {
    const { positions } = buildIcosahedron()
    const uniq = new Set<string>()
    for (let i = 0; i < positions.length; i += 3) {
      uniq.add([positions[i], positions[i + 1], positions[i + 2]].map((v) => v.toFixed(4)).join(','))
    }
    expect(uniq.size).toBe(12)
  })

  it('每条边等长（正二十面体边长一致）', () => {
    const { positions } = buildIcosahedron()
    const lens: number[] = []
    for (let i = 0; i < positions.length; i += 6) {
      lens.push(Math.hypot(positions[i] - positions[i + 3], positions[i + 1] - positions[i + 4], positions[i + 2] - positions[i + 5]))
    }
    const min = Math.min(...lens), max = Math.max(...lens)
    expect(max - min).toBeLessThan(1e-6) // 30 条边严格等长
  })
})
