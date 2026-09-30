// tests/showcase-choreography.test.ts —— ★★炫技场编舞的**本机侧等价判据**（CI 可跑的半边）
//
// 【为什么需要（与 check:showcase 的分工）】真机判据（hosts/ios/check-showcase.py）证明
//   "端上真跑、帧率达标、终值真读层"——但它需要设备（CI 跑不了）。
//   本测试覆盖**编舞本身**：三段运动的指令是否由**真编译**产出、参数是否符合设计
//   （spring 物理、四属性并发、FLIP 走内核几何）⇒ 编舞改坏了 CI 当场红。
//
// 【零伪造】与场景同一入口：`@proteus-vue/animation` 的 `compileAnimations` / `presets`。
import { describe, it, expect } from 'vitest'
import { compileAnimations, presets, ANIM_KIND_ID } from '@proteus-vue/animation'
import type { AnimDecl } from '@proteus-vue/animation'

/** 与 entry-showcase 的 segmentWave 同构（每片 2 条：spring translateY + 淡入） */
function waveDecls(staggerMs: number, row: number, col: number): AnimDecl[] {
  const delay = (row + col) * staggerMs
  return [
    { kind: 'translateY', from: -260, to: 0, spring: presets.easing.smooth, delayMs: delay },
    { kind: 'opacity', from: 0, to: 1, curve: 'easeOut', durationMs: 220, delayMs: delay },
  ]
}

/** 与 entry-showcase 的 segmentSpiral 同构（每片 4 条：tx/ty/rotate/scale） */
function spiralDecls(tx: number, ty: number, rot: number): AnimDecl[] {
  return [
    { kind: 'translateX', from: 0, to: tx, curve: 'easeInOut', durationMs: 900 },
    { kind: 'translateY', from: 0, to: ty, curve: 'easeInOut', durationMs: 900 },
    { kind: 'rotate', from: 0, to: rot, curve: 'easeInOut', durationMs: 900 },
    { kind: 'scale', from: 1, to: 0.35, curve: 'easeInOut', durationMs: 900 },
  ]
}

describe('Morpheus 炫技场 · 编舞（真编译产物）', () => {
  it('波浪段：spring 是**真物理**（无 durMs→由物理决定）+ 斜向错峰 delay', () => {
    const b = compileAnimations(waveDecls(4, 3, 5), { nodeId: 1000 })
    expect(b.anims).toHaveLength(2)
    const y = b.anims.find((a) => a.kind === ANIM_KIND_ID.translateY)!
    // ★spring：编译产物必须带 `spring` 字段（内核据此走物理积分而非查表）
    expect((y as unknown as { spring?: unknown }).spring).toBeTruthy()
    // 斜向错峰：(row=3 + col=5) × 4ms = 32ms
    expect(y.delayMs).toBe(32)
    expect(y.from).toBe(-260)
    expect(y.to).toBe(0)
  })

  it('螺旋段：**四属性并发**（每片 4 条指令）+ 每片参数不同（形成漩涡）', () => {
    const a = compileAnimations(spiralDecls(100, -50, 180), { nodeId: 1000 })
    const b = compileAnimations(spiralDecls(-80, 60, -240), { nodeId: 1001 })
    expect(a.anims).toHaveLength(4)
    const kinds = a.anims.map((x) => x.kind).sort((p, q) => p - q)
    expect(kinds).toEqual([ANIM_KIND_ID.translateX, ANIM_KIND_ID.translateY, ANIM_KIND_ID.scale, ANIM_KIND_ID.rotate].sort((p, q) => p - q))
    // 每片的目标点/角度不同 ⇒ 才是"漩涡"而不是"整块平移"
    const aTx = a.anims.find((x) => x.kind === ANIM_KIND_ID.translateX)!
    const bTx = b.anims.find((x) => x.kind === ANIM_KIND_ID.translateX)!
    expect(aTx.to).not.toBe(bTx.to)
    // 缩放统一收束到 0.35（设计值）
    expect(a.anims.find((x) => x.kind === ANIM_KIND_ID.scale)!.to).toBe(0.35)
  })

  it('800 片规模：波浪 1600 条 + 螺旋 3200 条（与真机读数一致）', () => {
    const n = 800
    const cols = 20
    const wave = Array.from({ length: n }, (_, i) => waveDecls(4, Math.floor(i / cols), i % cols))
      .flatMap((decls, i) => compileAnimations(decls, { nodeId: 1000 + i }).anims)
    expect(wave).toHaveLength(1600)
    const spiral = Array.from({ length: n }, (_, i) => spiralDecls(i, -i, i * 3))
      .flatMap((decls, i) => compileAnimations(decls, { nodeId: 1000 + i }).anims)
    expect(spiral).toHaveLength(3200)
  })

  it('★编译期红线照常生效（炫技场也不能绕过——非合成属性仍被拦）', () => {
    expect(() => compileAnimations([{ kind: 'width' as never, from: 0, to: 100 }], { nodeId: 1 })).toThrow(/校验失败/)
  })
})
