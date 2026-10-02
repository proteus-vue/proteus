// tests/scroll-safety.test.ts
// ★★SC2（2026-10-02）：**可停靠滚动容器**的声明面判据
//   （《Proteus_可停靠滚动容器与滚动编排能力方案》§6.1 封闭集 / §6.2 五条硬约束 / §6.3 逃生口）
//
// 【本文件锁什么】
//   ① 统一抽象：**两个场景（Sheet / 页面容器）只差三个参数**（modal / anchor / initial）——
//      不是两个组件（方案 §0.1 的地基）；
//   ② 五条硬约束各自能报码、合规能放行（方案 §6.2）；
//   ③ 档位上限与递增（鸿蒙 `bindSheet` 最多 3 档——方案 §5.1 坑①）；
//   ④ 默认 `overscroll.mode='custom'`（方案 §3.4：默认走 system 会把核心卖点丢一半）；
//   ⑤ 逃生口封闭（方案 §6.3）。
import { describe, it, expect } from 'vitest'
import {
  DETENT_LIMIT, NESTED_POLICIES, DOCK_ANCHORS, DEFAULT_OVERSCROLL,
  detentRatio, isSheetLike,
} from '../packages/contracts/src/scroll'
import { validateScrollUsage, SCROLL_RULE_OF, parseDetentsLiteral } from '../packages/compiler/src/scroll-safety'
import { compileVueSfc } from '../packages/compiler/src/index'

/** 合规的 Sheet 声明（作为各用例的基线，只改一处以定位判据） */
const okSheet = (extra = ''): string =>
  `<sheet detents="[0.4, 1]" initial="0.4" nested="content-first" ${extra}><view /></sheet>`

describe('① 统一抽象（方案 §0.1：两个场景是一个模型）', () => {
  it('modal / anchor / initial 是**参数**——同一份封闭集覆盖 Sheet 与页面容器', () => {
    // Sheet 式：模态 + 距底
    expect(isSheetLike({ modal: true, anchor: 'bottom' })).toBe(true)
    // 页面级容器：非模态 + 距顶 —— 同一抽象的另一组参数值
    expect(isSheetLike({ modal: false, anchor: 'top' })).toBe(false)
    expect([...DOCK_ANCHORS]).toEqual(['top', 'bottom'])
  })

  it('默认回弹 = custom（方案 §3.4：默认必须是框架自算，否则跨端手感必然不一致）', () => {
    expect(DEFAULT_OVERSCROLL.mode).toBe('custom')
    expect(DEFAULT_OVERSCROLL.damping).toBeGreaterThan(0)
    expect(DEFAULT_OVERSCROLL.damping).toBeLessThan(1)
  })

  it('档位上限 = 3（方案 §5.1：鸿蒙 bindSheet 硬限制，取最小公倍数）', () => {
    expect(DETENT_LIMIT).toBe(3)
  })
})

describe('② 档位解析与序（分数 / 关键字 / px 三形态）', () => {
  it('parseDetentsLiteral：字面量三形态；表达式 ⇒ null（不静默）', () => {
    expect(parseDetentsLiteral("['40%', '100%']")).toEqual([0.4, 1])
    expect(parseDetentsLiteral('[0.4, 1]')).toEqual([0.4, 1])
    expect(parseDetentsLiteral("[0.4, 'full', 'header']")).toEqual([0.4, 'full', 'header'])
    expect(parseDetentsLiteral('[a, b]')).toBeNull()
  })
  it('detentRatio：header < half < full（参考序）；分数原样', () => {
    expect(detentRatio('header')).toBeLessThan(detentRatio('half'))
    expect(detentRatio('half')).toBeLessThan(detentRatio('full'))
    expect(detentRatio(0.4)).toBe(0.4)
  })
})

describe('③ 五条硬约束（方案 §6.2）', () => {
  it('SC001：档位超过 3 ⇒ 报错（不静默截断）；递增违反 ⇒ 报错；缺失 ⇒ 报错', () => {
    const over = validateScrollUsage(`<sheet detents="[0.2, 0.4, 0.6, 0.8]" initial="0.2" nested="none" />`)
    expect(over.map((v) => v.code)).toContain('SC001')
    expect(over.find((v) => v.code === 'SC001')!.message).toContain(String(DETENT_LIMIT))

    const notIncreasing = validateScrollUsage(`<sheet detents="[1, 0.4]" initial="1" nested="none" />`)
    expect(notIncreasing.map((v) => v.code)).toContain('SC001')
    expect(notIncreasing.find((v) => v.code === 'SC001')!.message).toContain('递增')

    const missing = validateScrollUsage(`<sheet initial="0.4" nested="none" />`)
    expect(missing.map((v) => v.code)).toContain('SC001')
  })

  it('SC002：nested 缺省 ⇒ 报错（iOS 默认扩展 / Android 默认不扩展 ⇒ 禁止依赖默认值）', () => {
    const v = validateScrollUsage(`<sheet detents="[0.4, 1]" initial="0.4" />`)
    expect(v.map((x) => x.code)).toContain('SC002')
    expect(v.find((x) => x.code === 'SC002')!.message).toContain('iOS')
    // 非封闭集取值也拦
    const bad = validateScrollUsage(`<sheet detents="[0.4, 1]" initial="0.4" nested="whatever" />`)
    expect(bad.map((x) => x.code)).toContain('SC002')
    // 封闭集三值都放行（逐个构造，避免 replace 的引号嵌套）
    for (const p of NESTED_POLICIES) {
      const decl = `<sheet detents="[0.4, 1]" initial="0.4" nested="${p}" />`
      expect(validateScrollUsage(decl), `nested="${p}" 应放行`).toEqual([])
    }
  })

  it('SC003：initial 不在 detents 中 ⇒ 报错；是其中一项 ⇒ 放行', () => {
    const bad = validateScrollUsage(`<sheet detents="[0.4, 1]" initial="0.75" nested="none" />`)
    expect(bad.map((v) => v.code)).toContain('SC003')
    const ok = validateScrollUsage(`<sheet detents="[0.4, 1]" initial="1" nested="none" />`)
    expect(ok).toEqual([])
  })

  it('SC004：overscroll.mode=system ⇒ **警告级**（方案 §3.4：警告 + 登记允许差异清单，不阻断）', () => {
    const v = validateScrollUsage(
      `<sheet detents="[0.4, 1]" initial="0.4" nested="none" :overscroll="{ damping: 0.55, maxOffset: 120, mode: 'system' }" />`,
    )
    expect(v.map((x) => x.code)).toContain('SC004')
    expect(v.find((x) => x.code === 'SC004')!.hint).toContain('allow-differences')
    // custom（默认）不报
    const ok = validateScrollUsage(
      `<sheet detents="[0.4, 1]" initial="0.4" nested="none" :overscroll="{ damping: 0.55, maxOffset: 120, mode: 'custom' }" />`,
    )
    expect(ok).toEqual([])
  })

  it('SC005：逃生口（滚动回调 / 自定义物理 / 命令式停靠 / 动态 detents）⇒ 报错', () => {
    expect(validateScrollUsage(`<sheet detents="[0.4, 1]" initial="0.4" nested="none" @scroll="onS" />`).map((v) => v.code)).toContain('SC005')
    expect(validateScrollUsage(`<sheet detents="[0.4, 1]" initial="0.4" nested="none" :physics="fn" />`).map((v) => v.code)).toContain('SC005')
    expect(validateScrollUsage(`<sheet detents="[0.4, 1]" initial="0.4" nested="none" :detent-index="i" />`).map((v) => v.code)).toContain('SC005')
    // 动态 detents：声明面只接受字面量（编译期无法校验 ⇒ 提示而非静默放过）
    expect(validateScrollUsage(`<sheet :detents="dyn" initial="0.4" nested="none" />`).map((v) => v.code)).toContain('SC005')
  })

  it('违规码都有方案条目可追溯（对外表述不靠记忆）', () => {
    for (const code of ['SC001', 'SC002', 'SC003', 'SC004', 'SC005'] as const) {
      expect(SCROLL_RULE_OF[code], `${code} 必须有方案条目`).toMatch(/方案 §/)
    }
  })
})

describe('④ 合规声明放行（两个场景的目标写法，方案 §2.2）', () => {
  it('Sheet 弹层（模态 + 距底 + 半屏起 + undimmed）', () => {
    const v = validateScrollUsage(
      `<sheet detents="[0.4, 1]" initial="0.4" nested="content-first" :overscroll="{ damping: 0.55, maxOffset: 120, mode: 'custom' }" undimmed-from="0.4" />`,
    )
    expect(v).toEqual([])
  })
  it('页面级内容容器（非模态 + 距顶 + 两档）', () => {
    const v = validateScrollUsage(
      `<dock-container detents="[header, full]" initial="full" nested="header-first" two-level="next-page" />`,
    )
    expect(v).toEqual([])
  })
  it('注释里的示例标签不参与校验（不误报）', () => {
    const v = validateScrollUsage(`<!-- 示例：<sheet detents="[0.4]" /> 这样写是错的 -->\n<view />`)
    expect(v).toEqual([])
  })
})

describe('⑤ 编译主链集成（方案 §6.2 的"编译期报错"落点）', () => {
  it('违规 ⇒ 抛错；合规 ⇒ 通过；system ⇒ **仅警告**（方案 §3.4 警告 + 登记，不阻断构建）', () => {
    // ① 档位超限：走 compileVueSfc ⇒ 必须抛（不是"警告"）
    expect(() =>
      compileVueSfc(`<template><sheet detents="[0.1,0.2,0.3,0.4]" initial="0.1" nested="none" /></template>`),
    ).toThrow(/SC001/)
    // ② nested 缺省同样抛（iOS/Android 默认相反——禁止依赖默认）
    expect(() =>
      compileVueSfc(`<template><sheet detents="[0.4, 1]" initial="0.4" /></template>`),
    ).toThrow(/SC002/)
    // ③ 合规：正常产出
    const ok = compileVueSfc(`<template><sheet detents="[0.4, 1]" initial="0.4" nested="content-first" /></template>`)
    expect(ok.wxml).toContain('sheet')
    // ④ overscroll.mode='system'：**不抛**，但 warnings 里必须有 SC004（登记提示）
    const warn = compileVueSfc(
      `<template><sheet detents="[0.4, 1]" initial="0.4" nested="none" ` +
        `:overscroll="{ damping: 0.55, maxOffset: 120, mode: 'system' }" /></template>`,
    )
    expect(warn.warnings.some((w) => w.includes('SC004')), 'system 应产生 SC004 警告').toBe(true)
  })
})
