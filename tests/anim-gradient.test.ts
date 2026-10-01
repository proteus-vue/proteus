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
} from '@proteus-vue/animation'

describe('渐变填充（v1）· 校验器', () => {
  const ok = { kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#f2ead6' }, { offset: 1, color: '#7d8ea6', alpha: 0.2 }] }

  it('合法声明（线性/径向）零问题', () => {
    expect(validateGradientFill(ok)).toEqual([])
    expect(validateGradientFill({ kind: 'radial', cx: 0.5, cy: 0.4, r: 0.8, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] })).toEqual([])
    // 径向缺省 cx/cy/r（由 radialNormalized 落定）
    expect(validateGradientFill({ kind: 'radial', stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] })).toEqual([])
  })

  it('★错误可定位：kind / 色标数量 / 升序 / 颜色六位 / alpha 范围 / r 正数', () => {
    const e1 = validateGradientFill({ kind: 'diagonal', stops: [] })
    expect(e1.some((x) => x.path === 'fillGradient.kind')).toBe(true)

    const e2 = validateGradientFill({ kind: 'linear', angle: 90, stops: [{ offset: 0, color: '#fff' }] })
    expect(e2.some((x) => x.path === 'fillGradient.stops' && /2\.\.8/.test(x.message))).toBe(true)

    const e3 = validateGradientFill({ kind: 'linear', angle: 90, stops: [{ offset: 0.5, color: '#ffffff' }, { offset: 0.3, color: '#000000' }] })
    expect(e3.some((x) => x.path === 'stops[1].offset' && /升序/.test(x.message))).toBe(true)

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

  it('★契约键名表完整（门禁 check-gradient-contract 的事实源）', () => {
    for (const k of ['fillGradient', 'kind', 'linear', 'radial', 'angle', 'stops', 'offset', 'color', 'alpha', 'cx', 'cy']) {
      expect(GRADIENT_CONTRACT_KEYS as readonly string[], `键名 ${k}`).toContain(k)
    }
  })
})
