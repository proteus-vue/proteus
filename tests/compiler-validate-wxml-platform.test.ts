// tests/compiler-validate-wxml-platform.test.ts
// ★#505 G2：wxml 产物按平台标准校验（蓝本 = glass-easel 官方 parser 错误码）——
//   DataBindingNotAllowed（wx:key 禁数据绑定）/ DuplicatedAttribute / AvoidUppercaseLetters。
//   产物正常形态永不命中，命中即编译器 bug（G1 wx:key 防回归 + 历史 class 双属性真机坑 + 大写标签映射漏）。
import { describe, it, expect } from 'vitest'
import {
  compileVueSfc,
  transformTemplateToWxml,
  scanWxmlPlatformIssues,
  validateWxmlPlatform,
  assertValidResult,
  CompilerError,
} from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 G2 scanWxmlPlatformIssues：官方错误码蓝本三检查', () => {
  it('DataBindingNotAllowed：wx:key 含 {{}} → 命中（官方：wx:key 禁用数据绑定）', () => {
    const issues = scanWxmlPlatformIssues('<view wx:for="{{list}}" wx:key="{{item.id}}">x</view>')
    expect(issues.some((i) => i.code === 'DataBindingNotAllowed' && i.message.includes('wx:key'))).toBe(true)
  })

  it('DuplicatedAttribute：class 双属性 → 命中（历史真机坑：微信仅保留其一）', () => {
    const issues = scanWxmlPlatformIssues('<view class="a" class="b">x</view>')
    expect(issues.some((i) => i.code === 'DuplicatedAttribute' && i.message.includes('class'))).toBe(true)
  })

  it('AvoidUppercaseLetters：大写标签名 → 命中（属性名豁免——camelCase 自定义属性合法）', () => {
    const issues = scanWxmlPlatformIssues('<PModal :prop="x">x</PModal>')
    expect(issues.some((i) => i.code === 'AvoidUppercaseLetters' && i.message.includes('PModal'))).toBe(true)
    // camelCase 属性（modelValue/viewBox 类）是合法绑定，不命中
    expect(scanWxmlPlatformIssues('<p-switch modelValue="{{x}}" />')).toEqual([])
  })

  it('正常产物零命中（kebab 标签 + 引号值含 = / 冒号 / wx:key 静态字段）', () => {
    const wxml = '<view class="a b" style="color:{{c}}" wx:for="{{list}}" wx:for-item="item" wx:key="id" bind:tap="fn">x</view>'
    expect(scanWxmlPlatformIssues(wxml)).toEqual([])
  })

  it('注释与闭标签不误报', () => {
    expect(scanWxmlPlatformIssues('<!-- <PModal wx:key="{{x}}"> --></view>')).toEqual([])
  })
})

describe('★#505 G2 validateWxmlPlatform + assertValidResult 接线', () => {
  it('validateWxmlPlatform：违规 → ok:false + 官方错误码', () => {
    const r = validateWxmlPlatform('<view wx:key="{{x}}">y</view>')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('[DataBindingNotAllowed]')
  })

  it('assertValidResult：wxml 平台违规 → 抛 CompilerError 指明文件', () => {
    const bad = { wxml: '<view wx:key="{{x}}">y</view>', js: 'Page({})', wxss: '', warnings: [] }
    expect(() => assertValidResult(bad, 'pages/bad.vue')).toThrowError(CompilerError)
    try {
      assertValidResult(bad, 'pages/bad.vue')
    } catch (e) {
      expect(String(e)).toContain('wxml 产物平台标准违规')
      expect(String(e)).toContain('DataBindingNotAllowed')
    }
  })
})

describe('★#505 G2 端到端：compileVueSfc 正常产物过 wxml 平台校验（零误报）', () => {
  it('复杂页面（v-for + key + 事件 + style 绑定）产物过平台校验', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst cards = ref([{ id: 1, title: "a" }])</script>\n'
        + '<template><view v-for="c in cards" :key="c.id" class="card"><text @tap="onTap" style="color:{{c.color}}">{{ c.title }}</text></view></template>',
      { filename: 'pages/g2.vue', ...opts },
    )
    // 产物 wx:key 已剥前缀为静态字段（G1）——平台校验零命中（compileVueSfc 内部 assertValidResult 已含 wxml 平台段）
    expect(r.wxml).toContain('wx:key="id"')
    expect(scanWxmlPlatformIssues(r.wxml)).toEqual([])
  })

  it('wxml 产物经 transformTemplateToWxml 单独调用同样零命中', () => {
    const { wxml } = transformTemplateToWxml('<div class="page"><h1>Title</h1><p v-if="ok" class="x">hi</p></div>', opts)
    expect(scanWxmlPlatformIssues(wxml)).toEqual([])
  })
})
