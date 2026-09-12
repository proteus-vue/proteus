// tests/compiler-component-nav.test.ts
// ★2026-09-13 真机 bug 回归锁：组件内 `<a href>` / `<router-link>` 的导航 handler 丢失。
//
// 故障（小程序真机实测「点击 p-button 无反应」）：Showcase 目录页把 `<a href>` 放进
//   自定义组件 `catalog-list`，编译产物 WXML 有 `bindtap="proteusNavigateTo"`，但组件 JS 的
//   `methods` 为空——点击命中不存在的方法 → 静默无反应。
//   根因：template 阶段组件根节点用 `{ ...ctx, isComponentRoot: true }` **浅拷贝** ctx；
//     `ctx.usesNavigate = true` 写在拷贝上，原始 ctx 收不到（原始值标志不回传）→ script 阶段
//     `extra.usesNavigate=false` → 不注入 `proteusNavigateTo`。
//     （Set/Array 因是引用共享而能回传，故只有 primitive 标志受影响——极易漏。）
//   同一浅拷贝还把 `isComponentRoot` 泄漏给所有后代 → 每个子元素都被追加 `{{rootClass}}`。
//
// 本文件锁三件事（组件 + 页面两态都要对）：
//   ① 组件含 <a href> → WXML 有 bindtap + JS methods 有 proteusNavigateTo（两处同时存在，否则点击失效）
//   ② 组件含 <router-link to> → 同上
//   ③ rootClass 只在根节点出现（不泄漏到后代）；页面模式行为不变
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'

const RULES = { disabled: [], mapping: {}, customTags: {} }

function compile(src: string, isComponent: boolean) {
  return compileVueSfc(src, {
    filename: isComponent ? 'components/nav-card/index.vue' : 'pages/nav-page.vue',
    isComponent,
    px2rpx: true,
    rpxRatio: 2,
    rules: RULES,
  })
}

const SFC_A = `<script setup lang="ts">
const items = [{ name: 'p-button', route: '/subpackages/components/pages/p-button' }]
</script>
<template>
  <view class="card">
    <a v-for="it in items" :key="it.name" :href="it.route">
      <text>{{ it.name }}</text>
    </a>
  </view>
</template>`

const SFC_LINK = `<script setup lang="ts"></script>
<template>
  <view class="card">
    <router-link to="/pages/about"><text>关于</text></router-link>
  </view>
</template>`

describe('★组件内导航链接：handler 注入 + rootClass 不泄漏（2026-09-13 真机回归锁）', () => {
  it('★组件含 <a href> → WXML bindtap 与 JS methods.proteusNavigateTo 必须同时存在', () => {
    const r = compile(SFC_A, true)
    expect(r.wxml, 'WXML 应绑定 proteusNavigateTo').toContain('proteusNavigateTo')
    // ★关键：产物 JS 必须真的定义该方法（此前 methods 为空 → 点击无反应）
    expect(r.js, '组件 methods 应注入 proteusNavigateTo').toMatch(/proteusNavigateTo\s*\(/)
    expect(r.js, '方法须在 Component methods 块内').toContain('methods: {')
    // 结构合法性：Component({...}) 且方法闭合
    expect(r.js).toContain('Component({')
  })

  it('★组件含 <router-link to> → 同上（两处同时存在）', () => {
    const r = compile(SFC_LINK, true)
    expect(r.wxml).toContain('proteusNavigateTo')
    expect(r.js).toMatch(/proteusNavigateTo\s*\(/)
  })

  it('页面模式（回归）：<a href> 仍正确注入（页面方法在顶层）', () => {
    const r = compile(SFC_A, false)
    expect(r.wxml).toContain('proteusNavigateTo')
    expect(r.js).toMatch(/proteusNavigateTo\s*\(/)
    expect(r.js).toContain('Page({')
  })

  it('★rootClass 只在根节点出现（不泄漏到后代元素）', () => {
    // 用「根 + 多层子元素」结构：若 isComponentRoot 未消费即清除，会沿子树泄漏到每个后代
    // （真机：给组件传 class 级联到全部子元素）。破坏性验证：移除消费即清除 → count 变 4。
    const deep = `<template>
  <view class="card">
    <view class="inner">
      <text>a</text>
      <text>b</text>
    </view>
    <text>c</text>
  </view>
</template>`
    const r = compile(deep, true)
    const count = (r.wxml.match(/rootClass/g) ?? []).length
    expect(count, `rootClass 应只出现 1 次（根本身），实际 ${count} 次——泄漏到后代`).toBe(1)
  })

  it('组件无 <a>/<router-link> → 不注入导航方法（避免无谓产物）', () => {
    const noNav = compile('<script setup lang="ts"></script>\n<template><view class="x"><text>hi</text></view></template>', true)
    expect(noNav.js).not.toContain('proteusNavigateTo')
    expect(noNav.wxml).not.toContain('proteusNavigateTo')
  })
})
