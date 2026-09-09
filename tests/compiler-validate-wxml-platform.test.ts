// tests/compiler-validate-wxml-platform.test.ts
// ★#505 G2：wxml 产物按平台标准校验（蓝本 = glass-easel 官方 parser 错误码）——
//   DataBindingNotAllowed（wx:key 禁数据绑定）/ DuplicatedAttribute / AvoidUppercaseLetters /
//   UnsupportedSyntax（绑定表达式含 ?.）/ InvalidAttribute（wx:key·for-item·index 无 for 悬挂；wx:else/elif 悬挂）/ DuplicatedStylePropertyNames（纯静态 style 重复键）。
//   产物正常形态永不命中，命中即编译器 bug（G1 wx:key 防回归 + 历史 class 双属性真机坑 + 大写标签映射漏 + ?. 透传坑 + codegen 重构回归）。
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

describe('★#505 G2 scanWxmlPlatformIssues：官方错误码蓝本七检查', () => {
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

  it('★2026-09-07 官方深扒：UnsupportedSyntax——绑定表达式含 ?. 可选链命中（官方 expr.rs 运算符表无 ?.）', () => {
    // 属性绑定形态 {{ a?.b }} → 命中
    const attr = scanWxmlPlatformIssues('<view hidden="{{!a?.b}}">x</view>')
    expect(attr.some((i) => i.code === 'UnsupportedSyntax' && i.message.includes('?.'))).toBe(true)
    // 文本插值形态同样命中（表达式经平台解析）
    const text = scanWxmlPlatformIssues('<view>{{ a?.list[0]?.name }}</view>')
    expect(text.some((i) => i.code === 'UnsupportedSyntax')).toBe(true)
    // ★2026-09-09 真机证据推翻官方文档：wcc 实测拒绝 {{a ?? b}}（model-demo 模拟器启动失败实证）——
    //   ?? 加入 UnsupportedSyntax（fail-closed）；? 三元后跟 . 数字（a? .5）非可选链——不误报
    expect(scanWxmlPlatformIssues('<view hidden="{{a ?? b}}">x</view>').some((i) => i.code === 'UnsupportedSyntax' && i.message.includes('??'))).toBe(true)
  })

  it('正常产物零命中（kebab 标签 + 引号值含 = / 冒号 / wx:key 静态字段）', () => {
    const wxml = '<view class="a b" style="color:{{c}}" wx:for="{{list}}" wx:for-item="item" wx:key="id" bind:tap="fn">x</view>'
    expect(scanWxmlPlatformIssues(wxml)).toEqual([])
  })

  it('注释与闭标签不误报', () => {
    expect(scanWxmlPlatformIssues('<!-- <PModal wx:key="{{x}}"> --></view>')).toEqual([])
  })

  it('★2026-09-07 官方深扒二轮：InvalidAttribute——wx:key / wx:for-item 无 wx:for 悬挂命中（官方 ForList 仅 for 存在时消费）', () => {
    const r = scanWxmlPlatformIssues('<view wx:key="id">x</view>')
    expect(r.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:key'))).toBe(true)
    const r2 = scanWxmlPlatformIssues('<view wx:for-item="it" wx:for-index="i">x</view>')
    expect(r2.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:for-item'))).toBe(true)
    // 有 wx:for 的正常形态零命中（wx:key 恒随 for）
    expect(scanWxmlPlatformIssues('<view wx:for="{{list}}" wx:for-item="it" wx:for-index="i" wx:key="id">x</view>')).toEqual([])
  })

  it('★2026-09-07 官方深扒二轮：InvalidAttribute——wx:else/elif 悬挂命中（官方分支组要求紧跟 if 链），配对链零误报', () => {
    // 悬挂：wx:else 前兄弟不是 wx:if/elif
    const r = scanWxmlPlatformIssues('<view>a</view><view wx:else>b</view>')
    expect(r.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:else'))).toBe(true)
    // 悬挂：wx:elif 在 wx:else 之后（链已闭合）
    const r2 = scanWxmlPlatformIssues('<view wx:if="{{a}}">1</view><view wx:else>2</view><view wx:elif="{{b}}">3</view>')
    expect(r2.some((i) => i.code === 'InvalidAttribute' && i.message.includes('wx:elif'))).toBe(true)
    // 配对链零命中（if → elif → else，跨行/自闭合均合法）
    expect(scanWxmlPlatformIssues('<view wx:if="{{a}}">1</view>\n<view wx:elif="{{b}}">2</view>\n<view wx:else>3</view>')).toEqual([])
    expect(scanWxmlPlatformIssues('<view wx:if="{{a}}" /><view wx:else />')).toEqual([])
    // 注释夹在链中不破坏配对
    expect(scanWxmlPlatformIssues('<view wx:if="{{a}}">1</view><!-- 中间 --><view wx:else>2</view>')).toEqual([])
  })

  it('★2026-09-07 三轮取证：DuplicatedStylePropertyNames——纯静态 style 重复键命中（官方仅对 Value::Static 拆分查重），动态/引号分号不误报', () => {
    // 静态重复键 → 命中
    const r = scanWxmlPlatformIssues('<view style="color:red;color:blue">x</view>')
    expect(r.some((i) => i.code === 'DuplicatedStylePropertyNames' && i.message.includes('color'))).toBe(true)
    // 合法静态多键 → 零命中
    expect(scanWxmlPlatformIssues('<view style="color:red;background:#fff">x</view>')).toEqual([])
    // 动态/混合 style（含 {{}}）→ 官方不静态查重，跳过零命中
    expect(scanWxmlPlatformIssues('<view style="{{styleStr}}">x</view>')).toEqual([])
    expect(scanWxmlPlatformIssues('<view style="color:{{c}}">x</view>')).toEqual([])
    // 引号内分号不误拆（font-family 值含 ;）
    expect(scanWxmlPlatformIssues("<view style=\"font-family:'A;B',sans-serif;color:red\">x</view>")).toEqual([])
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
