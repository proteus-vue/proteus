// tests/desktop-cursor-glow.test.ts —— ★G-24 B5（#389d）：v-p-cursor-glow 指针跟随光晕
//   验证点：① 创建/销毁生命周期（元素挂载/移除）② 指针跟随（lerp 插值 → transform 位移）
//   ③ reduced-motion / 触屏环境 → 静默不启用 ④ 双光斑结构（主紫 + 副青）
// @vitest-environment happy-dom（DOM + matchMedia 模拟）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCursorGlow, prefersReducedMotion, hasFinePointer } from '../packages/desktop/src/cursor-glow'
import { createCursorGlowDirective } from '../packages/desktop/src/directives'

function mockMatchMedia(matches: Record<string, boolean>): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: matches[q] ?? false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
}

describe('G-24 B5 v-p-cursor-glow（指针跟随光晕）', () => {
  beforeEach(() => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': false, '(pointer: fine)': true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.querySelectorAll('.p-cursor-glow').forEach((el) => el.remove())
  })

  it('创建：光晕层挂到 body（双光斑 aria-hidden）', () => {
    const host = document.createElement('div')
    const h = createCursorGlow(host)
    expect(h).not.toBeNull()
    const el = document.querySelector('.p-cursor-glow') as HTMLElement
    expect(el).not.toBeNull()
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.querySelectorAll('div').length).toBe(2) // 主光斑 + 副光斑
    h!.destroy()
    expect(document.querySelector('.p-cursor-glow')).toBeNull()
  })

  it('指针跟随：pointermove 后 rAF 帧 transform 位移趋近目标（lerp=1 立即贴合）', async () => {
    const host = document.createElement('div')
    const h = createCursorGlow(host, { lerp: 1 })
    expect(h).not.toBeNull()
    const el = document.querySelector('.p-cursor-glow') as HTMLElement
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 200 }))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(el.style.transform).toContain('translate3d(300px')
    expect(el.style.transform).toContain('200px')
    h!.destroy()
  })

  it('降级：prefers-reduced-motion → null（静默不启用）', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true, '(pointer: fine)': true })
    const host = document.createElement('div')
    expect(createCursorGlow(host)).toBeNull()
  })

  it('降级：触屏环境（pointer:coarse）→ null', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': false, '(pointer: fine)': false })
    const host = document.createElement('div')
    expect(createCursorGlow(host)).toBeNull()
  })

  it('守卫纯函数：prefersReducedMotion / hasFinePointer', () => {
    mockMatchMedia({ '(prefers-reduced-motion: reduce)': true, '(pointer: fine)': true })
    expect(prefersReducedMotion()).toBe(true)
    expect(hasFinePointer()).toBe(true)
  })

  it('指令：v-p-cursor-glow mounted 创建 / unmounted 销毁', () => {
    const dir = createCursorGlowDirective()
    const el = document.createElement('div')
    dir.mounted!(el, { value: undefined } as never)
    expect(document.querySelector('.p-cursor-glow')).not.toBeNull()
    dir.unmounted!(el)
    expect(document.querySelector('.p-cursor-glow')).toBeNull()
  })
})
