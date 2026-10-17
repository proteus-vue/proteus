// tests/app-icon-lowering.test.ts —— ★★★App p-icon 图标降级（P4-续 phase B，决策 #813）
//
// 【它防什么】App 端 `<p-icon name="home">` 此前是不透明标签（内部 `<svg>` 无 App 降级通路）⇒ 图标不渲染。
//   本批在**构建期**把静态 `<p-icon name=...>` 经 `opts.iconResolver` 解析为 path，降级为一个带
//   `svgPath`+`svgViewBox` 的**叶子盒**（内核据此缩放到节点盒、填充渲染）。
//   本测试钉住：① 静态名 ⇒ 降级为 view 节点（尺寸/颜色/svgPath.fill/progress/svgViewBox 齐）；
//   ② 动态 `:name` ⇒ 折成叶子盒（决策 #938：path 走运行期 `__iconPath`，不再产 VAPOR_ICON_DYNAMIC 诊断）；
//   ③ 未知名 ⇒ 不降级 + 诊断；④ 无 resolver ⇒ 不降级（既有行为）。
import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate } from '@proteus-vue/compiler'
import { iconByName, hasIcon } from '../packages/icons/src'

const resolver = (name: string): { d: string; viewBox?: string } | null => {
  if (!hasIcon(name)) return null
  const def = iconByName(name)
  return { d: def.d, viewBox: def.viewBox ?? '0 0 24 24' }
}
const build = (tpl: string, opts?: { iconResolver?: typeof resolver }) =>
  buildLayoutTemplate(`<template>${tpl}</template>`, 'x.vue', undefined, undefined, undefined, undefined, false, opts)

describe('★★p-icon App 图标降级（构建期 name→path）', () => {
  it('静态名 ⇒ 降级为 view 叶子盒（尺寸/svgPath/svgViewBox）', () => {
    const r = build(`<view><p-icon name="home" :size="28" color="#7c5cff" /></view>`, { iconResolver: resolver })
    const icon = (r.template.nodes as Array<{ tag: string; style: Record<string, unknown> }>).find((n) => n.style.svgPath)!
    expect(icon.tag).toBe('view')
    expect(icon.style.width).toBe(28)
    expect(icon.style.height).toBe(28)
    const sp = icon.style.svgPath as { d: string; fill?: boolean; progress?: number; stroke?: string }
    expect(typeof sp.d).toBe('string')
    expect(sp.fill).toBe(true) // 图标是填充形状
    expect(sp.progress).toBe(1) // 生来已画成（否则描边进度门判未画）
    expect(sp.stroke).toBe('#7c5cff')
    expect(icon.style.svgViewBox).toEqual([0, 0, 24, 24])
  })

  it('缺 :size ⇒ 默认 16；缺 color ⇒ 无 stroke/color', () => {
    const r = build(`<view><p-icon name="search" /></view>`, { iconResolver: resolver })
    const icon = (r.template.nodes as Array<{ style: Record<string, unknown> }>).find((n) => n.style.svgPath)!
    expect(icon.style.width).toBe(16)
    expect((icon.style.svgPath as { stroke?: string }).stroke).toBeUndefined()
  })

  // ★2026-10-17 同步（决策 #938）：动态 `:name` 已从「不降级 + VAPOR_ICON_DYNAMIC 诊断」升级为
  //   **折成叶子盒**（宽高/颜色在构建期折出，path 走运行期 `paint.svgPath` ⇒ `__iconPath[<expr>].d`）。
  //   判据随之改为：盒子仍产出（宽/高默认 16、颜色落到 style.color）、**不产生该诊断**（功能已支持）。
  it('动态 :name ⇒ 折成叶子盒（运行期 path 通道，不再诊断）', () => {
    const r = build(`<view><p-icon :name="n" /></view>`, { iconResolver: resolver })
    const leaf = (r.template.nodes as Array<{ tag: string; style: Record<string, unknown> }>).find(
      (n) => n.style.width === 16 && n.style.height === 16,
    )
    expect(leaf, '动态 p-icon 应折成 16×16 叶子盒').toBeTruthy()
    // 构建期不知道具体名字 ⇒ 不产静态 path（由运行期 __iconPath 补），也不应再有"未降级"诊断
    expect(r.diagnostics.some((d) => d.code === 'VAPOR_ICON_DYNAMIC')).toBe(false)
  })

  it('未知名 ⇒ 不降级 + 诊断', () => {
    const r = build(`<view><p-icon name="__nope__" /></view>`, { iconResolver: resolver })
    expect((r.template.nodes as Array<{ style: Record<string, unknown> }>).some((n) => n.style.svgPath)).toBe(false)
    expect(r.diagnostics.some((d) => d.code === 'VAPOR_ICON_UNKNOWN')).toBe(true)
  })

  it('无 iconResolver ⇒ 不降级（既有行为，逐字节不变）', () => {
    const r = build(`<view><p-icon name="home" /></view>`)
    expect((r.template.nodes as Array<{ style: Record<string, unknown> }>).some((n) => n.style.svgPath)).toBe(false)
    expect(r.diagnostics.some((d) => d.code?.startsWith('VAPOR_ICON'))).toBe(false)
  })
})
