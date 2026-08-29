// tests/pinia-mp-compile.test.ts
// ★pinia-plan 12：Pinia MP 编译接入——P1 模板 store 绑定（编译产物断言）+ P3 共享模块放行（resolveSharedModule pinia 白名单）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { compileVueSfc } from '../packages/compiler/src'
import { resolveSharedModule } from '../packages/plugin-vite/src/plugin'

const compile = (src: string, name = 'pinia.vue'): { wxml: string; js: string } => {
  const r = compileVueSfc(src, { filename: name })
  return { wxml: r.wxml, js: r.js }
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
