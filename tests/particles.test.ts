// tests/particles.test.ts —— ★#389b Hero 粒子场引擎单元测试（逻辑层；WebGL 缺失走优雅回退）
// @vitest-environment happy-dom（canvas/document）
import { describe, it, expect } from 'vitest'
import { particleCountFor, createParticleField } from '../website/src/playground/particles'

describe('WebGL 语义粒子场（#389b）', () => {
  it('粒子数按面积推算并夹紧 [140, max]；零面积 = 0', () => {
    expect(particleCountFor(0, 0)).toBe(0)
    expect(particleCountFor(100, 100)).toBe(140)
    expect(particleCountFor(1440, 900)).toBeLessThanOrEqual(900)
    expect(particleCountFor(1440, 900)).toBeGreaterThanOrEqual(140)
    expect(particleCountFor(4000, 2000, 900)).toBe(900)
    expect(particleCountFor(1440, 900, 300)).toBe(300)
  })

  it('WebGL 不可用（jsdom 无 context）→ 优雅返回 null，不抛错', () => {
    const canvas = document.createElement('canvas')
    expect(createParticleField(canvas)).toBeNull()
  })
})
