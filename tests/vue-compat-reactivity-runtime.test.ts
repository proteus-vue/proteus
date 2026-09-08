// tests/vue-compat-reactivity-runtime.test.ts
// ★2026-09-08 立项（proteus-reactivity-runtime-plan 选项 A spke）：编译器对 reactive/readonly 族走运行时 @vue/reactivity 真 Proxy。
//   验收：①产物注入 require('@vue/reactivity')（按需——仅用 reactive 族/守卫的页面，纯 ref 页不注入）
//        ②reactive/readonly/浅族 → this.<name> = reactive(...)（runtime-init 真 Proxy，非普通 data 内联）
//        ③isReactive/isReadonly/isProxy/isShallow/toRaw → 运行时守卫（this.<r> = isReactive(this.<x>)）
//        ④setData 桥（effect 读透 proxy → 变更重跑 setData）+ onUnload 解绑
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '../packages/compiler/src/index'

const opts = { px2rpx: true, rpxRatio: 2 }

function compile(script: string, template: string, filename = 'pages/probe.vue') {
  return compileVueSfc(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`, { filename, ...opts })
}

describe('reactivity-runtime spke（reactive 族走运行时 @vue/reactivity）', () => {
  it('reactive → runtime-init 真 Proxy + 注入 @proteus-vue/runtime require（含桥用 effect）', () => {
    const r = compile(
      "import { reactive, isReactive } from 'vue'\nconst s = reactive({ name: 'x' })\nconst ok = isReactive(s)",
      '<view>{{ s.name }}</view>',
    ) as any
    expect(r.js).toMatch(/require\('@proteus-vue\/runtime'\)/)
    // reactive 不再内联成 data 字面量（data 只有占位 null）
    expect(r.js).toMatch(/this\.s = reactive\(\{ name: 'x' \}\)/)
    // isReactive 走运行时守卫 + 参数 this 化
    expect(r.js).toMatch(/this\.ok = isReactive\(this\.s\)/)
    // initial data 占位
    expect(r.js).toMatch(/s:\s*null/)
    // setData 桥 + 解绑
    expect(r.js).toMatch(/__proteusSyncReactive/)
    expect(r.js).toMatch(/effect\(function/)
    expect(r.js).toMatch(/__proteusDisposeReactive/)
  })

  it('readonly/shallowReactive/shallowReadonly → runtime-init 真 Proxy', () => {
    const r = compile(
      "import { readonly, shallowReactive, shallowReadonly, isReadonly, isProxy } from 'vue'\nconst ro = readonly({ a: 1 })\nconst sr = shallowReactive({ b: 2 })\nconst sro = shallowReadonly({ c: 3 })\nconst r1 = isReadonly(ro)\nconst r2 = isProxy(sr)",
      '<view>{{ ro.a }}</view>',
    ) as any
    expect(r.js).toMatch(/this\.ro = readonly\(\{ a: 1 \}\)/)
    expect(r.js).toMatch(/this\.sr = shallowReactive\(\{ b: 2 \}\)/)
    expect(r.js).toMatch(/this\.sro = shallowReadonly\(\{ c: 3 \}\)/)
    expect(r.js).toMatch(/this\.r1 = isReadonly\(this\.ro\)/)
    expect(r.js).toMatch(/this\.r2 = isProxy\(this\.sr\)/)
  })

  it('纯 ref 页面不注入 @proteus-vue/runtime（按需，普通页面保持纯内联轻量）', () => {
    const r = compile("import { ref } from 'vue'\nconst x = ref(0)", '<view>{{ x }}</view>') as any
    expect(r.js).not.toMatch(/@proteus-vue\/runtime/)
    expect(r.js).toMatch(/x:\s*0/)
  })

  it('reactive 未被模板引用（仅方法内用法）也走运行时 + 桥（无 data 占位冲突）', () => {
    const r = compile(
      "import { reactive } from 'vue'\nconst s = reactive({ n: 1 })\nfunction bump() { s.n += 1 }",
      '<view><button bindtap="bump">bump</button></view>',
    ) as any
    expect(r.js).toMatch(/this\.s = reactive\(\{ n: 1 \}\)/)
    expect(r.js).toMatch(/__proteusSyncReactive\(name\)/)
    expect(r.js).toMatch(/effect\(function/)
  })
})
