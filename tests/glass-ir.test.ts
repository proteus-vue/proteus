// tests/glass-ir.test.ts —— ★★★玻璃材质 IR 折叠（自研液态玻璃 · 决策 #818）
//
// 【它防什么】「即使手机系统没有液态玻璃能力也能提供近似最新系统的液态玻璃」——玻璃在**构建期**
//   经 `glassResolver`（复用 `@proteus-vue/glass` 的 `resolveGlass` 唯一真源）折成内核 `style.glass`
//   （`{blur,tint,radius,border,borderSide,noise,saturation}`，tint 为内核可吃的 `#RRGGBBAA`）。
//   本测试钉：① `<pg-glass preset=tabBar>` ⇒ 折出与预设一致的 glass 字段；② tint 转 hex（非 rgba）；
//   ③ 无 preset ⇒ 仍折（custom 兜底）；④ 无 glassResolver ⇒ 不折（既有行为，零回归）。
import { describe, it, expect } from 'vitest'
import { buildLayoutTemplate } from '@proteus-vue/compiler'
import { glassResolver } from '../packages/cli/src/app-component-registry'
import { getGlassPreset } from '../packages/glass/src/index'

const build = (tpl: string, opts?: { glassResolver?: typeof glassResolver }) =>
  buildLayoutTemplate(`<template>${tpl}</template>`, 'x.vue', undefined, undefined, undefined, undefined, false, opts)
const glassOf = (r: ReturnType<typeof build>) =>
  (r.template.nodes as Array<{ style: Record<string, unknown> }>).find((n) => n.style.glass)?.style.glass as
    | Record<string, unknown>
    | undefined

describe('★★玻璃材质 IR 折叠（pg-glass → style.glass）', () => {
  it('preset=tabBar ⇒ 折出 glass 字段（blur/tint/border/saturation）', () => {
    const g = glassOf(build(`<view><pg-glass preset="tabBar" /></view>`, { glassResolver }))!
    expect(g).toBeTruthy()
    const preset = getGlassPreset('tabBar')
    expect(g.blur).toBe(preset.blur) // 20
    expect(g.border).toBe(preset.border) // true
    expect(g.borderSide).toBe(preset.borderSide ?? 'all') // top
    expect(g.saturation).toBe(1) // 提彩凭据（宿主可调）
  })

  it('★tint 转内核可吃 #RRGGBBAA（非 rgba())', () => {
    const g = glassOf(build(`<view><pg-glass preset="tabBar" /></view>`, { glassResolver }))!
    expect(String(g.tint)).toMatch(/^#[0-9a-f]{6}[0-9a-f]{2}$/)
    // tabBar tint = rgba(255,255,255,0.15) ⇒ #ffffff26（0.15*255≈38=0x26）
    expect(g.tint).toBe('#ffffff26')
  })

  it('无 preset ⇒ 仍折（custom 兜底），不炸', () => {
    const g = glassOf(build(`<view><pg-glass /></view>`, { glassResolver }))
    expect(g).toBeTruthy()
  })

  it('无 glassResolver ⇒ 不折（既有行为零回归）', () => {
    const g = glassOf(build(`<view><pg-glass preset="tabBar" /></view>`))
    expect(g).toBeUndefined()
  })
})
