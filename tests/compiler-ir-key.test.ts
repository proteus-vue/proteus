// tests/compiler-ir-key.test.ts
// ★#505 G1（微信官方 wx:key 语义对齐——文档：wx:key 直接指定 item 的字段名字符串，禁用数据绑定；
//   item 为字符串/数值时用 *this）。旧实现仅收简单标识符，:key="item.id"（对象数组最常用写法）整个被丢。
import { describe, it, expect } from 'vitest'
import { transformTemplateToWxml, compileVueSfc } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★#505 G1 wx:key 官方语义对齐', () => {
  it('裸标识符 :key="idx" → wx:key="idx"（既有形态不变）', () => {
    const { wxml } = transformTemplateToWxml('<view v-for="(item, idx) in list" :key="idx">{{ item }}</view>', opts)
    expect(wxml).toContain('wx:key="idx"')
  })

  it(':key="item.id"（v-for 项.字段）→ wx:key="id"（剥项前缀——微信 wx:key 即 item 的字段名）', () => {
    const { wxml, warnings } = transformTemplateToWxml('<view v-for="item in list" :key="item.id">{{ item }}</view>', opts)
    expect(wxml).toContain('wx:key="id"')
    expect(wxml).not.toContain('wx:key="item.id"')
    expect(warnings).toEqual([])
  })

  it(':key="c.id"（自定义项名）→ wx:key="id"', () => {
    const { wxml } = transformTemplateToWxml('<view v-for="c in cards" :key="c.id">x</view>', opts)
    expect(wxml).toContain('wx:key="id"')
  })

  it(':key="item"（基础值数组——项本身）→ wx:key="*this"（官方保留关键字）', () => {
    const { wxml } = transformTemplateToWxml('<view v-for="item in list" :key="item">x</view>', opts)
    expect(wxml).toContain('wx:key="*this"')
  })

  it('无 v-for 的 :key 裸标识符 → 保持（微信解释为 item 字段名，由外部 v-for 提供）', () => {
    const { wxml, warnings } = transformTemplateToWxml('<view :key="id">x</view>', opts)
    expect(wxml).toContain('wx:key="id"')
    expect(warnings).toEqual([])
  })

  it('表达式形态（运算/字符串拼接）→ 编译期警告并忽略（不静默丢代码）', () => {
    const { wxml, warnings } = transformTemplateToWxml('<view v-for="item in list" :key="item.id + \'\'">x</view>', opts)
    expect(wxml).not.toContain('wx:key')
    expect(warnings.join('\n')).toContain('wx:key 需静态字段名或 *this')
  })

  it('嵌套/外层项引用（前缀非本元素项名）→ 诚实警告（无法静态映射）', () => {
    const { wxml, warnings } = transformTemplateToWxml('<view v-for="inner in inners" :key="outer.id">x</view>', opts)
    expect(wxml).not.toContain('wx:key="outer.id"')
    expect(warnings.join('\n')).toContain('非本元素 v-for 项')
  })
})

describe('★#505 G1 端到端（compileVueSfc）', () => {
  it('对象数组页面：:key="c.id" → wx:key="id"（不再丢）+ 编译自校验过', () => {
    const r = compileVueSfc(
      '<script setup lang="ts">import { ref } from "vue"\nconst cards = ref([{ id: 1 }])</script>\n<template><view v-for="c in cards" :key="c.id" class="cell">{{ c.id }}</view></template>',
      { filename: 'pages/key.vue', ...opts },
    )
    expect(r.wxml).toContain('wx:key="id"')
    expect(r.wxml).toContain('wx:for-item="c"')
    expect(r.warnings).toEqual([])
  })
})
