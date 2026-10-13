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

  it('★★#889：绑定数字字面量 :radius="12" 折入（此前静默丢弃、回落 preset）', () => {
    const g = glassOf(build(`<view><pg-glass preset="card" :radius="12" /></view>`, { glassResolver }))!
    expect(g).toBeTruthy()
    expect(g.radius).toBe(12) // 此前恒为 card 预设的 16（绑定数字被丢）
  })

  it('★#889：绑定动态表达式 :radius="r" 仍不折（回落 preset——诚实边界）', () => {
    const g = glassOf(build(`<view><pg-glass preset="card" :radius="r" /></view>`, { glassResolver }))!
    expect(g.radius).toBe(16) // card 预设
  })

  // ★★★决策 #900：材质 id 折入（宿主按此派发 GPU 管线）。
  describe('★★★材质 id（material · 决策 #900）', () => {
    it('缺省 ⇒ glass', () => {
      expect(glassOf(build(`<view><pg-glass preset="card" /></view>`, { glassResolver }))!.material).toBe('glass')
    })
    it('显式 material="backdropBlur" 折入', () => {
      expect(glassOf(build(`<view><pg-glass preset="card" material="backdropBlur" /></view>`, { glassResolver }))!.material).toBe('backdropBlur')
    })
    it('绑定字符串字面量 :material="\'frosted\'" 折入', () => {
      expect(glassOf(build(`<view><pg-glass preset="card" :material="'frosted'" /></view>`, { glassResolver }))!.material).toBe('frosted')
    })
    it('未知材质 ⇒ 回落 glass（不静默给未知 id）', () => {
      expect(glassOf(build(`<view><pg-glass preset="card" material="nope" /></view>`, { glassResolver }))!.material).toBe('glass')
    })
  })

  // ★★★#898：文档 Props 用法端到端（每种写法都折进 IR）——防「文档写了、实现不认」的静默缺口。
  describe('★★★文档 Props 用法全覆盖（指南 31-liquid-glass）', () => {
    it('intensity：档位字符串 / 绑定数字 / 静态数字 ⇒ 同一 blur', () => {
      const card = getGlassPreset('card').blur // 16
      const want = Math.round(card * 1.4) // thick / 1.4
      expect(glassOf(build(`<view><pg-glass preset="card" intensity="thick" /></view>`, { glassResolver }))!.blur).toBe(want)
      expect(glassOf(build(`<view><pg-glass preset="card" :intensity="1.4" /></view>`, { glassResolver }))!.blur).toBe(want)
      expect(glassOf(build(`<view><pg-glass preset="card" intensity="1.4" /></view>`, { glassResolver }))!.blur).toBe(want)
    })
    it('tint：覆盖预设并转内核 #RRGGBBAA', () => {
      const g = glassOf(build(`<view><pg-glass preset="card" tint="rgba(0,0,0,0.4)" /></view>`, { glassResolver }))!
      expect(g.tint).toBe('#00000066') // 0.4*255≈102=0x66
    })
    it('radius：绑定数字 / 静态数字 都覆盖预设', () => {
      expect(glassOf(build(`<view><pg-glass preset="card" :radius="16" /></view>`, { glassResolver }))!.radius).toBe(16)
      expect(glassOf(build(`<view><pg-glass preset="card" radius="16" /></view>`, { glassResolver }))!.radius).toBe(16)
    })
    it('★#898：border：绑定布尔 :border="false" 折入（此前静默丢弃、回落预设 true）', () => {
      expect(glassOf(build(`<view><pg-glass preset="card" :border="false" /></view>`, { glassResolver }))!.border).toBe(false)
      expect(glassOf(build(`<view><pg-glass preset="card" :border="true" /></view>`, { glassResolver }))!.border).toBe(true)
      expect(glassOf(build(`<view><pg-glass preset="card" border="false" /></view>`, { glassResolver }))!.border).toBe(false)
    })
    it('noise：绑定数字 / 静态数字 都覆盖预设', () => {
      expect(glassOf(build(`<view><pg-glass preset="card" :noise="0.05" /></view>`, { glassResolver }))!.noise).toBe(0.05)
      expect(glassOf(build(`<view><pg-glass preset="card" noise="0.05" /></view>`, { glassResolver }))!.noise).toBe(0.05)
    })
    it('fallback：合法取值不炸（App 折叠面不透传——降级是运行时/端决策）', () => {
      const g = glassOf(build(`<view><pg-glass preset="card" fallback="flat" /></view>`, { glassResolver }))!
      expect(g).toBeTruthy()
    })
    it('缺省写法（仅 preset）⇒ 全部回落该预设', () => {
      const p = getGlassPreset('card')
      const g = glassOf(build(`<view><pg-glass preset="card" /></view>`, { glassResolver }))!
      expect(g.radius).toBe(p.radius)
      expect(g.border).toBe(p.border)
      expect(g.noise).toBe(p.noise)
    })
  })
})
