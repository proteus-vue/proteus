// tests/overrides.test.ts
// ★底线循环 ①③：规则覆盖机制（AI / proteus.config.ts rules 段改写或禁用编译规则，即时生效）
// 验证：customTags 新增标签、mapping 改写映射、disabled 禁用规则（template/style/script 各阶段）
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  compileVueSfc,
  transformTemplateToWxml,
  transformStyleToWxss,
  transformScriptToPage,
} from '../packages/compiler/src'
import type { TransformRuleOverrides } from '../packages/compiler/src'

const opts = { px2rpx: true, rpxRatio: 2 }
const rules = (r: TransformRuleOverrides) => ({ ...opts, rules: r })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('规则覆盖：customTags（新增标签映射，循环 ①）', () => {
  it('未注册标签 → 自定义小程序标签', () => {
    const { wxml } = transformTemplateToWxml('<my-widget>hi</my-widget>', rules({ customTags: { 'my-widget': 'view' } }))
    expect(wxml).toContain('<view>hi</view>')
  })

  it('未配置时未知标签仍按 kebab-case 原样输出', () => {
    const { wxml } = transformTemplateToWxml('<my-widget>hi</my-widget>', opts)
    expect(wxml).toContain('<my-widget>hi</my-widget>')
  })

  it('customTags 经 compileVueSfc 全链路生效，且产物自校验通过', () => {
    const result = compileVueSfc('<template><my-widget>hi</my-widget></template>', { rules: { customTags: { 'my-widget': 'view' } } })
    expect(result.wxml).toContain('<view>hi</view>')
  })
})

describe('规则覆盖：mapping（改写映射，循环 ③）', () => {
  it('改写 tag/link-to-view：a → text（而非默认 view）', () => {
    const { wxml } = transformTemplateToWxml('<a href="/x">link</a>', rules({ mapping: { 'tag/link-to-view': { a: 'text' } } }))
    expect(wxml).toContain('<text')
    expect(wxml).not.toContain('<view')
  })

  it('改写 tag/div-to-view：div → custom-view', () => {
    const { wxml } = transformTemplateToWxml('<div>block</div>', rules({ mapping: { 'tag/div-to-view': { div: 'custom-view' } } }))
    expect(wxml).toContain('<custom-view>block</custom-view>')
  })

  it('样式选择器重写与改写后的映射一致（div → custom-view）', () => {
    const wxss = transformStyleToWxss('div .item { margin: 8px; }', rules({ mapping: { 'tag/div-to-view': { div: 'custom-view' } } }))
    expect(wxss.split('\n').find((l) => l.includes('.item'))).toBe('custom-view .item { margin: 16rpx; }')
    expect(wxss.split('\n').find((l) => l.includes('.item'))).not.toContain(' view ')
  })

  it('未知规则 ID 覆盖 → 编译期警告（防配置笔误）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    transformTemplateToWxml('<div>hi</div>', rules({ mapping: { 'not/exist': { div: 'x' } } }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未注册的规则 ID'))
  })
})

describe('规则覆盖：disabled（禁用规则，循环 ③）', () => {
  it('禁用 tag/heading-to-text：h1 不再映射（原样输出 + 警告）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { wxml } = transformTemplateToWxml('<h1>title</h1>', rules({ disabled: ['tag/heading-to-text'] }))
    expect(wxml).toContain('<h1>title</h1>')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tag/heading-to-text'))
  })

  it('禁用 directive/v-if：v-if 忽略（元素保留，无 wx:if）', () => {
    const { wxml } = transformTemplateToWxml('<p v-if="show">a</p>', rules({ disabled: ['directive/v-if'] }))
    expect(wxml).not.toContain('wx:if')
    expect(wxml).toContain('<text class="proteus-p">a</text>')
  })

  it('禁用 event/click-to-tap + event/modifier-catch：@click 原样输出', () => {
    const { wxml } = transformTemplateToWxml('<button @click="go">go</button>', rules({ disabled: ['event/click-to-tap', 'event/modifier-catch'] }))
    expect(wxml).toContain('bindclick="go"')
    expect(wxml).not.toContain('bindtap')
  })

  it('禁用 style/px-to-rpx：px 保留', () => {
    const wxss = transformStyleToWxss('.home { padding: 48px; }', rules({ disabled: ['style/px-to-rpx'] }))
    expect(wxss).toContain('padding: 48px')
    expect(wxss).not.toContain('96rpx')
  })

  it('禁用 style/semantic-base-wxss：不注入基础样式', () => {
    const wxss = transformStyleToWxss('.x { color: red; }', rules({ disabled: ['style/semantic-base-wxss'] }))
    expect(wxss).not.toContain('.proteus-h1')
    expect(wxss).toContain('.x { color: red; }')
  })

  it('禁用 script/const-to-data：data 不再提取', () => {
    const { js } = transformScriptToPage('const count = ref(0)', opts, { rules: { disabled: ['script/const-to-data'] } })
    expect(js).not.toContain('data:')
  })

  it('禁用 script/onload-params：不再注入默认 onLoad', () => {
    const { js } = transformScriptToPage('const count = ref(0)', opts, { rules: { disabled: ['script/onload-params'] } })
    expect(js).not.toContain('onLoad(options)')
  })

  it('禁用 script/nav-handler：不再注入 proteusNavigateTo', () => {
    const { js } = transformScriptToPage('const a = ref(1)', opts, { usesNavigate: true, rules: { disabled: ['script/nav-handler'] } })
    expect(js).not.toContain('proteusNavigateTo')
  })

  it('禁用规则后 trace 不再记录该规则（决策链反映生效行为）', () => {
    const result = compileVueSfc('<template><p v-if="show">a</p></template>', { rules: { disabled: ['directive/v-if'] } })
    expect(result.trace?.some((e) => e.ruleId === 'directive/v-if')).toBe(false)
  })
})

describe('compileVueSfc 产物 trace（循环 ②）', () => {
  it('编译结果携带完整决策链（template/script/style 三阶段）', () => {
    const result = compileVueSfc('<script setup lang="ts">const c = ref(0)</script>\n<template><h1>{{ c }}</h1></template>\n<style>.x { padding: 8px; }</style>', {})
    const ids = (result.trace ?? []).map((e) => e.ruleId)
    expect(ids).toContain('tag/heading-to-text')
    expect(ids).toContain('script/const-to-data')
    expect(ids).toContain('style/px-to-rpx')
  })
})
