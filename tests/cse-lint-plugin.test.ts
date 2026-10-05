// tests/cse-lint-plugin.test.ts
// ★★★G-61 B4：**CSE lint 插件（Web 端 lint 接入 = P6）**——构建链真实拦截
//
// 【为什么必须有这条（不能只测 lintCse 纯函数）】P6 的判据是「Profile 外写法在 **Web 端也报错**」——
//   纯函数对了不等于**构建链会拦**（本仓实测教训：机制写在 markdown 拦不住；接线必须机器验证）。
//   本测试直接跑插件的 `transform` 钩子（含 `this.error` 通道——退出方式与真实 vite 构建一致）。
import { describe, it, expect } from 'vitest'
import { cseLintPlugin } from '../packages/plugin-vite/src/cse-lint-plugin'

/** 跑插件的 transform（模拟 vite：this.error 抛错 ⇒ 收集） */
function runPlugin(source: string, opts: Parameters<typeof cseLintPlugin>[0] = {}): { errors: string[]; warned: string[] } {
  const plugin = cseLintPlugin(opts)
  const transform = (plugin as unknown as { transform: (code: string, id: string) => unknown }).transform.bind({
    error(msg: string): never {
      throw new Error(msg)
    },
    warn(): void {},
  })
  const errors: string[] = []
  const warned: string[] = []
  const origWarn = console.warn
  console.warn = (m?: unknown) => warned.push(String(m))
  try {
    transform(source, '/proj/src/page.vue')
  } catch (e) {
    errors.push((e as Error).message)
  } finally {
    console.warn = origWarn
  }
  return { errors, warned }
}

const OK_SFC = `<template><view class="a">x</view></template>
<style>.a { color: #111111; display: flex }</style>`

const BAD_UNENUMERABLE = `<template><view class="a" :class="someVar">x</view></template>
<script setup>const someVar = 'x'</script>
<style>.a { color: #111111 }</style>`

const BAD_ID = `<template><view class="a">x</view></template>
<style>#main { color: #111111 }</style>`

const BAD_IMPORTANT = `<template><view class="a">x</view></template>
<style>.a { color: #111111 !important }</style>`

describe('★★★G-61 B4 · CSE lint 插件（构建链拦截——P6）', () => {
  it('合法 SFC：零诊断（零侵入——transform 返回 null）', () => {
    const r = runPlugin(OK_SFC)
    expect(r.errors).toEqual([])
    expect(r.warned).toEqual([])
  })

  it('★不可枚举 :class ⇒ **构建报错**（E-CSS-004——Web 端同样拦）', () => {
    const r = runPlugin(BAD_UNENUMERABLE)
    expect(r.errors.length, '应阻断构建').toBe(1)
    expect(r.errors[0]).toContain('E-CSS-004')
  })

  it('W 族（ID 选择器 / !important）⇒ 打印 warn 不阻断', () => {
    const r = runPlugin(BAD_ID)
    expect(r.errors).toEqual([])
    expect(r.warned.join('\n')).toContain('W-CSS-103')
    const r2 = runPlugin(BAD_IMPORTANT)
    expect(r2.errors).toEqual([])
    expect(r2.warned.join('\n')).toContain('W-CSS-102')
  })

  it('Profile 外声明（E-CSS-003）⇒ 构建报错（D4：基准自身合法）', () => {
    const r = runPlugin(
      `<template><view class="a">x</view></template><style>.a { float: left }</style>`,
      { target: 'web', unsupportedDecls: [{ prop: 'float', accept: [] }] },
    )
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('E-CSS-003')
  })

  it('Skyline 目标：grid ⇒ W-CSS-105（可降级，warn）；Web 目标不触发', () => {
    const grid = `<template><view class="a">x</view></template><style>.a { display: grid }</style>`
    const sky = runPlugin(grid, { target: 'skyline', unsupportedDecls: [{ prop: 'display', accept: ['flex', 'block', 'none'] }] })
    expect(sky.warned.join('\n')).toContain('W-CSS-105')
    const web = runPlugin(grid, { target: 'web' })
    expect(web.warned.join('\n')).not.toContain('W-CSS-105')
  })

  it('level=off ⇒ 完全不介入（逃生通道）', () => {
    const r = runPlugin(BAD_UNENUMERABLE, { level: 'off' })
    expect(r.errors).toEqual([])
    expect(r.warned).toEqual([])
  })
})
