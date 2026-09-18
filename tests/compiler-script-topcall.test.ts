// tests/compiler-script-topcall.test.ts
// ★2026-09-07 G12 复测真机 bug 回归：顶层副作用调用注入 onLoad 时漏 this 化——
//   semantic-primitives-demo 顶层 `refreshSplit()`（方法名册成员）注入 onLoad 后仍裸名
//   → 真机/开发者工具 ReferenceError: refreshSplit is not defined（onLoad 崩，页面失效）。
// 修复：initLineSeq 的 topLevelCalls 段与显式 onLoad body 同规则过 rewriteBareMethodCalls——
//   方法名册成员 → this.x()；runtimeInit 实例引用（链式 base）→ this.x.y()；import/全局非名册保持。
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'

const opts = { px2rpx: true, rpxRatio: 2 }

describe('★G12 复测真机 bug：顶层副作用调用注入 onLoad 的 this 化（方法名册成员）', () => {
  it('方法名册成员顶层调用 → onLoad 注入 this.refreshSplit()（此前裸名 ReferenceError）', () => {
    const src = '<script setup lang="ts">\n'
      + 'function refreshSplit(): void { thisSet(1) }\n'
      + 'function thisSet(n: number): void { void n }\n'
      + 'refreshSplit()\n'
      + '</script>\n<template><view class="x">t</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/topcall.vue', ...opts })
    // methods 成员在位
    expect(r.js).toContain('refreshSplit() {')
    expect(r.js).toContain('thisSet(n) {')
    // onLoad 注入段 this 化（不再裸 refreshSplit()）
    const onLoadIdx = r.js.indexOf('onLoad(')
    const onLoadBlock = r.js.slice(onLoadIdx, onLoadIdx + 400)
    expect(onLoadBlock).toContain('this.refreshSplit()')
    expect(onLoadBlock).not.toContain('this.thisSet(') // 顶层仅 refreshSplit() 一个调用
  })

  it('runtimeInit 实例链式调用注入 → this.host.registerFallback(...)（const host + 顶层链式副作用）', () => {
    const src = '<script setup lang="ts">\n'
      + 'const host = createDevHost()\n'
      + 'host.registerFallback(\'takePhoto\', () => ({ path: null }))\n'
      + '</script>\n<template><view>t</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/topcall2.vue', ...opts })
    expect(r.js).toContain('registerFallback(\'takePhoto\', () => ({ path: null }))')
    // const host 编译为实例属性（runtimeInit 通道）→ 注入段 this.host 化
    expect(r.js).toMatch(/onLoad\([^)]*\)\s*\{[\s\S]*?this\.host\.registerFallback\(/)
  })

  it('非名册外部函数（import/全局）注入保持裸名（不误加 this）', () => {
    const src = '<script setup lang="ts">\n'
      + 'import { initAppConfig } from \'./app-config\'\n'
      + 'initAppConfig({ v: 1 })\n'
      + '</script>\n<template><view>t</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/topcall3.vue', ...opts })
    // initAppConfig 非方法名册 → 保持裸名（编译期无法解析 import 的警告属既有行为）
    expect(r.js).toMatch(/onLoad\([^)]*\)\s*\{[\s\S]*?initAppConfig\(\{ v: 1 \}\)/)
  })

  it('★同族坑①：顶层 if 语句不被误当函数调用注入（fn=if 误抓 → onResize 裸引用进 onLoad）', () => {
    const src = '<script setup lang="ts">\n'
      + 'function onResize(): void { void 0 }\n'
      + 'if (typeof window !== \'undefined\') window.addEventListener(\'resize\', onResize)\n'
      + '</script>\n<template><view>t</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/ifstmt.vue', ...opts })
    const onLoadIdx = r.js.indexOf('onLoad(')
    const onLoadBlock = r.js.slice(onLoadIdx, onLoadIdx + 300)
    // if 语句不再整行注入（此前 extractTopLevelCalls 把 if(...) 当 fn 调用抓取 → onLoad 首行含裸 onResize）
    expect(onLoadBlock).not.toContain('window.addEventListener')
    expect(onLoadBlock).not.toContain('if (typeof window')
  })

  it('★同族坑②：runtimeInit 初始化表达式引用其它实例 → this.host.getMetrics()（dev-host 形态）', () => {
    const src = '<script setup lang="ts">\n'
      + 'const host = createDevHost()\n'
      + 'const metrics = host.getMetrics()\n'
      + '</script>\n<template><view>t</view></template>'
    const r = compileVueSfc(src, { filename: 'pages/rtchain.vue', ...opts })
    // 前序实例先赋值（源码序），后续引用 this 化
    const onLoadIdx = r.js.indexOf('onLoad(')
    const block = r.js.slice(onLoadIdx, onLoadIdx + 300)
    expect(block).toContain('this.host = createDevHost()')
    expect(block).toContain('this.metrics = this.host.getMetrics()')
    expect(block).not.toContain('= host.getMetrics()')
  })

  it('★同族坑③：组件模式顶层副作用注入 attached（此前 topLevelCalls 仅页面使用——组件顶层调用静默丢）', () => {
    const src = '<script setup lang="ts">\n'
      + 'import { initAppConfig } from \'./app-config\'\n'
      + 'function boot(): void { void 0 }\n'
      + 'initAppConfig({ v: 1 })\n'
      + 'boot()\n'
      + '</script>\n<template><view>t</view></template>'
    const r = compileVueSfc(src, { filename: 'components/ctopcall/index.vue', isComponent: true, ...opts })
    // 组件 attached：外部 init 前置 + 方法成员 this 化后置
    const attachedIdx = r.js.indexOf('attached(')
    const block = r.js.slice(attachedIdx, attachedIdx + 300)
    expect(block).toContain('initAppConfig({ v: 1 })')
    expect(block).toContain('this.boot()')
  })
})
