// tests/anim-gradient.test.ts —— ★★渐变填充（v1 静态 paint）的契约测试
//
// 【这一批是什么（2026-10-01 · 用户："按你的继续扩展试试，看有没有必要"）】
//   引擎的矢量语汇此前只有**纯色填充**——"墨韵/柔光"只能靠多层椭圆预混色逼近。
//   渐变（线性/径向）是把这个逼近换成真渐变的最后一块拼图。
//
// 【本测试守什么（CI 可跑——无需设备）】
//   · 校验器：色标数量/升序/颜色六位/alpha 范围/径向参数——每条错误必须**可定位**；
//   · **角度数学钉住**（跨语言契约：Swift/Kotlin 同式）——0°=向上/90°=向右/180°=向下；
//   · 径向缺省落定；契约键名表（门禁的事实源）完整性。
import { describe, it, expect } from 'vitest'
import {
  validateGradientFill,
  linearGradientEndpoints,
  radialNormalized,
  GRADIENT_CONTRACT_KEYS,
  validateGlowSpec,
  glowLayers,
  GLOW_LAYERS,
} from '@proteus-vue/animation'

describe('渐变填充（v1）· 校验器', () => {
  const ok = { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#f2ead6' }, { offset: 1, color: '#7d8ea6', alpha: 0.2 }] }

  it('合法声明（线性/径向）零问题', () => {
    expect(validateGradientFill(ok)).toEqual([])
    expect(validateGradientFill({ kind: 'radial', cx: 0.5, cy: 0.4, r: 0.8, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] })).toEqual([])
    // 径向缺省 cx/cy/r（由 radialNormalized 落定）
    expect(validateGradientFill({ kind: 'radial', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] })).toEqual([])
  })

  // ★★★硬色标（2026-10-08 · 用户抓出「iOS/鸿蒙背景页导航后仍是首页」）：**相等 offset = 硬边**
  //   ——Web CSS `linear-gradient(a 25%, b 25%)` 是同位置两色标（硬边），本引擎 CSS 编译产物真实会发
  //   （棋盘平铺 tile 就靠它）。旧"`严格升序`"校验会把整条渐变拒掉 ⇒ 内核建树失败 ⇒ 整屏空白。
  //   ⇒ 判据 = **非降序**（相等允许、逆序拒绝）；本用例锁定"相等接受 / 逆序拒绝"两侧。
  it('★硬色标：相等 offset 接受（硬边）· 逆序仍拒绝', () => {
    const eq = validateGradientFill({ kind: 'linear', angle: 45, stops: [
      { offset: 0.25, color: '#cdd3ef' }, { offset: 0.25, color: '#000000', alpha: 0 },
      { offset: 0.75, color: '#000000', alpha: 0 }, { offset: 0.75, color: '#cdd3ef' },
    ] })
    expect(eq, '相等 offset（硬边）应被接受').toEqual([])
    const desc = validateGradientFill({ kind: 'linear', angle: 90, stops: [{ offset: 0.5, color: '#ffffff' }, { offset: 0.3, color: '#000000' }] })
    expect(desc.some((x) => x.path === 'stops[1].offset' && /逆序/.test(x.message))).toBe(true)
  })

  it('★错误可定位：kind / 色标数量 / 逆序 / 颜色六位 / alpha 范围 / r 正数', () => {
    const e1 = validateGradientFill({ kind: 'diagonal', stops: [] })
    expect(e1.some((x) => x.path === 'fillGradient.kind')).toBe(true)

    const e2 = validateGradientFill({ kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#fff' }] })
    expect(e2.some((x) => x.path === 'fillGradient.stops' && /2\.\.8/.test(x.message))).toBe(true)

    const e3 = validateGradientFill({ kind: 'linear', angle: 90, stops: [{ offset: 0.5, color: '#ffffff' }, { offset: 0.3, color: '#000000' }] })
    expect(e3.some((x) => x.path === 'stops[1].offset' && /逆序/.test(x.message))).toBe(true)

    // ★8 位颜色被明确拒绝（CSS4 vs #AARRGGBB 两端分歧的根因——见 gradient.ts 文件头）
    const e4 = validateGradientFill({ kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#ff553380' }, { offset: 1, color: '#000000' }] })
    expect(e4.some((x) => x.path === 'stops[0].color' && /六位/.test(x.hint))).toBe(true)

    const e5 = validateGradientFill({ kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffffff', alpha: 1.5 }, { offset: 1, color: '#000000' }] })
    expect(e5.some((x) => x.path === 'stops[0].alpha')).toBe(true)

    const e6 = validateGradientFill({ kind: 'radial', r: 0, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] })
    expect(e6.some((x) => x.path === 'fillGradient.r')).toBe(true)
  })

  it('★角度数学（跨语言契约的钉子）：0°=向上 · 90°=向右 · 180°=向下 · 270°=向左', () => {
    const close = (a: number, b: number) => Math.abs(a - b) < 1e-9
    const up = linearGradientEndpoints(0)
    expect(close(up.x0, 0.5) && close(up.x1, 0.5)).toBe(true)
    expect(close(up.y0, 1) && close(up.y1, 0)).toBe(true) // 从下（纸）到上

    const right = linearGradientEndpoints(90)
    expect(close(right.y0, 0.5) && close(right.y1, 0.5)).toBe(true)
    expect(close(right.x0, 0) && close(right.x1, 1)).toBe(true)

    const down = linearGradientEndpoints(180)
    expect(close(down.y0, 0) && close(down.y1, 1)).toBe(true)

    const left = linearGradientEndpoints(270)
    expect(close(left.x0, 1) && close(left.x1, 0)).toBe(true)

    // 45°：向右上（dx=+√2/2, dy=-√2/2）
    const diag = linearGradientEndpoints(45)
    expect(close(diag.x0, 0.5 - Math.SQRT2 / 4)).toBe(true)
    expect(close(diag.y0, 0.5 + Math.SQRT2 / 4)).toBe(true)
  })

  it('★径向缺省落定（两端宿主读到的永远是落定后的值）', () => {
    expect(radialNormalized({ kind: 'radial', stops: [] })).toEqual({ cx: 0.5, cy: 0.5, r: 1 })
    expect(radialNormalized({ kind: 'radial', cx: 0.2, cy: 0.3, r: 0.6, stops: [] })).toEqual({ cx: 0.2, cy: 0.3, r: 0.6 })
  })

  it('★★发光（glow v1）：分层描边算法钉值（Swift/Kotlin 必须同式——门禁守键名、单测守数学）', () => {
    const spec = { color: '#ffcc66', radius: 10, alpha: 0.8 }
    const layers = glowLayers(spec, 1)
    expect(layers.length).toBe(GLOW_LAYERS)
    // 逐层钉值：boost = radius×k/N；alpha = a0×(1-(k-1)/N)²
    expect(layers[0]!.boostPx).toBeCloseTo(10 * (1 / 5), 6)
    expect(layers[0]!.alpha).toBeCloseTo(0.8, 6)
    expect(layers[4]!.boostPx).toBeCloseTo(10, 6)
    expect(layers[4]!.alpha).toBeCloseTo(0.8 * (1 - 4 / 5) ** 2, 6) // 0.032
    // 单调性：宽度递增、alpha 递减（"由内到外"的唯一形态）
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i]!.boostPx).toBeGreaterThan(layers[i - 1]!.boostPx)
      expect(layers[i]!.alpha).toBeLessThan(layers[i - 1]!.alpha)
    }
    // 强度乘子：0 ⇒ 全透明（"熄光"）；0.5 ⇒ 半数
    expect(glowLayers(spec, 0).every((l) => l.alpha === 0)).toBe(true)
    expect(glowLayers(spec, 0.5)[0]!.alpha).toBeCloseTo(0.4, 6)
    // 越界强度钳位（与全部通道同一纪律）
    expect(glowLayers(spec, 5)[0]!.alpha).toBeCloseTo(0.8, 6)
  })

  it('★发光校验器：颜色六位 / radius 正数 / alpha 0..1（错误可定位）', () => {
    expect(validateGlowSpec({ color: '#ffcc66', radius: 12, alpha: 0.6 })).toEqual([])
    expect(validateGlowSpec({ color: '#ffcc6680', radius: 12, alpha: 0.6 }).some((x) => x.path === 'glow.color')).toBe(true)
    expect(validateGlowSpec({ color: '#ffcc66', radius: 0, alpha: 0.6 }).some((x) => x.path === 'glow.radius')).toBe(true)
    expect(validateGlowSpec({ color: '#ffcc66', radius: 12, alpha: 1.5 }).some((x) => x.path === 'glow.alpha')).toBe(true)
  })

  it('★契约键名表完整（门禁 check-gradient-contract 的事实源）', () => {
    for (const k of ['fillGradient', 'kind', 'linear', 'radial', 'angle', 'stops', 'offset', 'color', 'alpha', 'cx', 'cy', 'glow', 'radius']) {
      expect(GRADIENT_CONTRACT_KEYS as readonly string[], `键名 ${k}`).toContain(k)
    }
  })
})
