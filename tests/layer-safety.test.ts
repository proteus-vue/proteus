// tests/layer-safety.test.ts
// ★★LY1（2026-10-02）：**页面层级语义编译期校验**的判据（《Proteus 页面层级规范与多端一致性方案》§3.5/§4.1）
//
// 【本文件锁什么】
//   ① 四层原语 + 封闭集（合同层 contracts/layers.ts——语义模型与跨端映射的唯一来源）；
//   ② LY1 五条违规码：裸 z-index / 非法层名 / Mask 单独用 / Popout·Mask 非根容器 / 保留层名；
//   ③ **跨端映射一致性**（同原语在任一端取同一语义档位——"层级一致性可机器判定"的前提）；
//   ④ 与 style-safety 的联动：zIndex 是 FORBIDDEN（两道闸门互补，不是重复）。
//
// 【为什么这些必须是测试而不是文档】（规范 §0 结论 4/7：层级是数值、可纳入 L2 校验）
//   文档说"禁止裸 z-index"，代码里没拦住 = 迟早有人写；本仓已踩过同款
//   （sleep 红线写在 markdown 拦不住，只有工具层门禁是结构性的）。
import { describe, it, expect } from 'vitest'
import {
  LAYER_PRIMITIVES, LAYER_MAPPING, LAYER_SEMANTICS, LAYER_RESERVED,
  layerValueFor, popoutStackValue, POPOUT_STACK_LIMIT, type LayerPrimitive,
} from '../packages/contracts/src/layers'
import { validateLayerUsage, LAYER_RULE_OF } from '../packages/compiler/src/layer-safety'
import { validateProp } from '../packages/runtime/src/style-safety/validator'

describe('LY0 · 层级契约（四层语义模型 + 跨端映射）', () => {
  it('封闭集 = WeUI 四层；每层都有语义描述与完整映射', () => {
    expect([...LAYER_PRIMITIVES]).toEqual(['layer-content', 'layer-navigation', 'layer-mask', 'layer-popout'])
    for (const p of LAYER_PRIMITIVES) {
      expect(LAYER_SEMANTICS[p].weui, `${p} 必须有 WeUI 对应层名`).toBeTruthy()
      const m = LAYER_MAPPING[p]
      for (const k of ['cssZIndex', 'harmonyZIndex', 'androidTranslationZ', 'iosZPosition'] as const) {
        expect(Number.isInteger(m[k]), `${p}.${k} 必须是整数`).toBe(true)
      }
    }
  })

  it('★★层序严格递增（Content < Navigation < Mask < Popout）——跨端同序', () => {
    const order = LAYER_PRIMITIVES.map((p) => LAYER_MAPPING[p])
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1]!
      const cur = order[i]!
      expect(cur.cssZIndex, 'CSS 层序必须递增').toBeGreaterThan(prev.cssZIndex)
      expect(cur.harmonyZIndex, '鸿蒙层序必须递增').toBeGreaterThan(prev.harmonyZIndex)
      expect(cur.androidTranslationZ, 'Android 层序必须递增').toBeGreaterThan(prev.androidTranslationZ)
      expect(cur.iosZPosition, 'iOS 层序必须递增').toBeGreaterThan(prev.iosZPosition)
    }
  })

  it('★★跨端映射一致：同原语在 web/mp/android/ios 取同一语义档位（L2 可判定的前提）', () => {
    for (const p of LAYER_PRIMITIVES as readonly LayerPrimitive[]) {
      const web = layerValueFor(p, 'web')
      expect(layerValueFor(p, 'mp-skyline'), `${p}: mp-skyline 应与 web 同档`).toBe(web)
      expect(layerValueFor(p, 'mp-webview'), `${p}: mp-webview 应与 web 同档`).toBe(web)
      // Android / iOS 的点位值同为该层基值（translationZ / zPosition 语义与 CSS 档位对齐）
      const m = LAYER_MAPPING[p]
      expect(m.androidTranslationZ, `${p}: Android 用 translationZ（不是 elevation 的 0 基）`).toBe(web === 1 ? 0 : web)
      expect(m.iosZPosition, `${p}: iOS zPosition 与 CSS 档位对齐`).toBe(web === 1 ? 0 : web)
    }
  })

  it('★弹层栈值：后弹者在上（基值 + 栈深），且有栈深上限', () => {
    const base = LAYER_MAPPING['layer-popout'].cssZIndex
    expect(popoutStackValue(0)).toBe(base)
    expect(popoutStackValue(1)).toBe(base + 1)
    expect(popoutStackValue(5)).toBeGreaterThan(popoutStackValue(4)) // "后弹出的必须在上"
    expect(() => popoutStackValue(-1)).toThrow()
    expect(() => popoutStackValue(1.5)).toThrow()
    expect(POPOUT_STACK_LIMIT, '栈深上限必须定义（防递归弹层）').toBeGreaterThan(0)
  })
})

describe('LY1 · 层级语义编译期校验（五条违规码 + 合规放行）', () => {
  it('LY001：裸 z-index 数值 ⇒ 违规（style 与 :style 两种写法都拦）', () => {
    const a = validateLayerUsage(`<view style="z-index: 5">x</view>`)
    expect(a.map((v) => v.code)).toContain('LY001')
    const b = validateLayerUsage(`<view :style="{ zIndex: 10 }">x</view>`)
    expect(b.map((v) => v.code)).toContain('LY001')
    // 合规：layer 属性放行；无层级声明的普通元素放行
    expect(validateLayerUsage(`<view layer="layer-content">x</view>`)).toEqual([])
    expect(validateLayerUsage(`<view style="width: 10px">x</view>`)).toEqual([])
  })

  it('LY002：非法层名 ⇒ 违规（封闭集——拼写错误不许静默无效）', () => {
    const v = validateLayerUsage(`<view layer="layer-top">x</view>`)
    expect(v.map((x) => x.code)).toContain('LY002')
    expect(v[0]!.message).toContain('层-top' in {} ? '' : 'layer-top')
  })

  it('LY003：layer-mask 单独使用 ⇒ 违规（WeUI：Mask 配合 Popout）', () => {
    const bad = validateLayerUsage(`<view><view layer="layer-mask"></view></view>`)
    expect(bad.map((v) => v.code)).toContain('LY003')
    // 配对后放行
    const good = validateLayerUsage(
      `<view><view layer="layer-popout">d</view><view layer="layer-mask"></view></view>`,
    )
    expect(good.filter((v) => v.code === 'LY003')).toEqual([])
  })

  it('★★LY004：Popout / Mask 嵌套在深层容器 ⇒ 违规（跨容器层级不生效——最危险的静默陷阱）', () => {
    const deep = validateLayerUsage(
      `<view><view><view layer="layer-popout">d</view></view></view>`,
    )
    expect(deep.map((v) => v.code)).toContain('LY004')
    expect(deep[0]!.message, '必须给出祖先链（可定位）').toContain('祖先链')
    // 根的直接子级放行
    const ok = validateLayerUsage(`<view><view style="flex:1">x</view><view layer="layer-popout">d</view></view>`)
    expect(ok.filter((v) => v.code === 'LY004')).toEqual([])
  })

  it('LY005：声明框架保留层 layer-transition ⇒ 违规（转场层由宿主内部管理）', () => {
    const v = validateLayerUsage(`<view layer="layer-transition">x</view>`)
    expect(v.map((x) => x.code)).toContain('LY005')
    expect([...LAYER_RESERVED]).toContain('layer-transition')
  })

  it('违规码都有规范条目可追溯（对外表述不靠记忆）', () => {
    for (const code of ['LY001', 'LY002', 'LY003', 'LY004', 'LY005'] as const) {
      expect(LAYER_RULE_OF[code], `${code} 必须有规范条目`).toMatch(/规范 §/)
    }
  })
})

describe('LY1 × style-safety 联动（两道互补闸门）', () => {
  it('zIndex 在运行时白名单里是 FORBIDDEN（与编译期 LY001 互补，不是重复）', () => {
    const r = validateProp('zIndex', 10, 'web')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/STS004|已禁用/)
  })
})
