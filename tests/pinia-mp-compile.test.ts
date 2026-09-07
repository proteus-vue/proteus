// tests/pinia-mp-compile.test.ts
// ★pinia-plan 12：Pinia MP 编译接入——P1 模板 store 绑定（编译产物断言）+ P3 共享模块放行（resolveSharedModule pinia 白名单）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import { resolveSharedModule } from '../packages/plugin-vite/src/plugin'

const compile = (src: string, name = 'pinia.vue'): { wxml: string; js: string; warnings: string[] } => {
  const r = compileVueSfc(src, { filename: name })
  return { wxml: r.wxml, js: r.js, warnings: r.warnings }
}

describe('P1：模板 store 绑定（script/store-binding）', () => {
  const SFC = `<template>
    <p>{{ store.current ? store.current.title : '未播放' }}（{{ store.playing ? '播放中' : '已暂停' }}）</p>
    <p>音量：{{ store.volumePercent }}%（历史 {{ store.historyCount }} 首）</p>
  </template>
  <script setup>
import { usePlayerStore } from '../stores/player'
const store = usePlayerStore()
  </script>`

  it('wxml：store 前缀剥离（{{ store.current.title }} → {{ current.title }}）', () => {
    const { wxml } = compile(SFC)
    expect(wxml).toContain('{{ current ? current.title : \'未播放\' }}')
    expect(wxml).not.toContain('store.current')
    expect(wxml).toContain('{{ playing ? \'播放中\' : \'已暂停\' }}')
    expect(wxml).toContain('{{ volumePercent }}%')
  })

  it('js：onLoad 注入 $subscribe → setData（字段映射 + 实例属性 store）', () => {
    const { js } = compile(SFC)
    expect(js).toContain('this.store = usePlayerStore()') // runtimeInit
    expect(js).toContain('this.setData({ current: __self.store.current')
    expect(js).toContain('this.store.$subscribe')
    expect(js).toContain('__self.setData({ current: __self.store.current')
    expect(js).toContain('volumePercent: __self.store.volumePercent')
  })

  it('无 store 变量 / 无模板引用 → 不注入绑定', () => {
    const { js, wxml } = compile('<template><p>{{ count }}</p></template><script setup>const count = ref(1)</script>')
    expect(js).not.toContain('$subscribe')
    expect(wxml).toContain('{{ count }}')
  })
})

describe('P2：store 方法事件包装（inline handler 扩展）', () => {
  const SFC = `<template>
    <button @click="store.toggle()">切换</button>
    <button @click="store.play({ title: 'X', durationSec: 5 })">播放</button>
    <button @click="store.setVolume(store.volume - 0.1)">音量-</button>
    <button @click="store.setVolume(store.volume + 0.1)">音量+</button>
  </template>
  <script setup>
import { usePlayerStore } from '../stores/player'
const store = usePlayerStore()
  </script>`

  it('wxml：bindtap 指向包装方法；js：生成 proteusStoreXxx（this.store. 调用 + store. 引用改写）', () => {
    const { wxml, js } = compile(SFC)
    expect(wxml).toContain('bindtap="proteusStoreToggleNoArgs"')
    expect(wxml).toContain('bindtap="proteusStorePlaytitleXdurationSec5"')
    expect(js).toContain('this.store.toggle()')
    expect(js).toContain("this.store.play({ title: 'X', durationSec: 5 })")
    // ★+/- 区分（Minus/Plus 映射，避免同名方法冲突覆盖）
    expect(js).toContain('this.store.setVolume(this.store.volume - 0.1)')
    expect(js).toContain('this.store.setVolume(this.store.volume + 0.1)')
    expect(js).toContain('proteusStoreSetVolumestorevolumeMinus01')
    expect(js).toContain('proteusStoreSetVolumestorevolumePlus01')
    // 不再警告复杂表达式
    expect(js).not.toContain('proteusStoreSetVolumestorevolume01')
  })

  it('非 store 事件（复杂表达式）仍警告', () => {
    const { js, warnings } = compile('<template><button @click="a.b()">x</button></template>')
    expect(js).not.toContain('proteusStore')
  })
})

describe('B6：页面 onUnload 自动 $dispose store（lifecycle-plan）', () => {
  it('useXxxStore 页面 → onUnload 注入 $dispose + 置空（防内存泄漏）', () => {
    const { js } = compile(
      `<template><p>{{ store.volume }}</p></template>\n  <script setup>\nimport { usePlayerStore } from '../stores/player'\nconst store = usePlayerStore()\n  </script>`,
    )
    expect(js).toContain('if (this.store && this.store.$dispose) { this.store.$dispose(); this.store = null }')
    expect(js).toContain('onUnload() {')
  })

  it('无 store 变量 → 不注入 $dispose', () => {
    const { js } = compile('<template><p>{{ count }}</p></template><script setup>const count = ref(1)</script>')
    expect(js).not.toContain('$dispose')
  })
})

describe('P3：共享模块放行（resolveSharedModule pinia 白名单）', () => {
  it('pinia 及其依赖链 → 解析（放行）', () => {
    const repoRoot = path.resolve(__dirname, '..')
    const r = resolveSharedModule(repoRoot, path.join(repoRoot, 'examples/pages/pinia-demo.vue'), '../stores/player')
    expect(r?.relNoExt).toBe('examples/stores/player')
  })

  it('其他第三方（lodash 等）→ 仍跳过', () => {
    expect(resolveSharedModule('/proj', '/proj/pages/a.vue', 'lodash')).toBeNull()
    expect(resolveSharedModule('/proj', '/proj/pages/a.vue', 'axios')).toBeNull()
  })
})
