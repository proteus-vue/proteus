// tests/test-core-unified.test.ts
// ★test-framework：统一测试 API —— mountComponent 双端挂载 + stateOf/textOf 统一断言（06 分层断言）
// 同一份 SFC 源码 → web（@vue/test-utils 真实渲染）/ mp（逻辑层 + WXML）→ 状态断言跨端共用
// @vitest-environment happy-dom（plan §3：esbuild TextEncoder instanceof 检查在 jsdom 跨 realm 崩；happy-dom 保留 node 全局）
import { describe, expect, it } from 'vitest'
import { mountComponent, stateOf, textOf, tap } from '@proteus-vue/test-core'
import type { MountedHost } from '@proteus-vue/test-core'

const COUNTER_SFC = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
const label = 'counter'
function increment() {
  count.value++
}
</script>
<template>
  <view class="c">
    <text>{{ label }}: {{ count }}</text>
    <button @click="increment">+1</button>
  </view>
</template>`

describe('mountComponent（统一挂载 API：双端同一份 SFC）', () => {
  it('web：真实渲染 + 状态读取 + 事件触发（@vue/test-utils）', async () => {
    const host = (await mountComponent(COUNTER_SFC, { platform: 'web' })) as MountedHost & {
      vm: { count: number; label: string; increment: () => void; $nextTick(): Promise<void> }
      text: () => string
    }
    expect(host.vm.count).toBe(1)
    expect(stateOf(host).count).toBe(1) // 统一状态读取
    expect(stateOf(host).label).toBe('counter')
    expect(textOf(host)).toContain('counter: 1') // 统一文本
    host.vm.increment()
    expect(stateOf(host).count).toBe(2) // ref 同步变更
    // ★web 渲染更新在微任务队列（nextTick flush）——文本断言前 await（MP 无 DOM 全同步）
    await host.vm.$nextTick()
    expect(textOf(host)).toContain('counter: 2')
  })

  it('mp：逻辑层 + WXML 双断言（mountMpComponent）', async () => {
    const host = (await mountComponent(COUNTER_SFC, { platform: 'mp' })) as MountedHost & {
      data: { count: number; label: string }
      wxml: string
      increment: () => void
    }
    expect(stateOf(host).count).toBe(1) // 统一状态读取（mp: data 快照）
    expect(stateOf(host).label).toBe('counter')
    expect(host.wxml).toContain('button') // MP 结构断言（DOM 各自断言，06 铁律）
    host.increment() // MP 方法调用（逻辑层）
    expect(stateOf(host).count).toBe(2)
  })

  it('同一用例双端复用：状态断言只写一份（06 分层断言）', async () => {
    const runShared = (host: MountedHost & { vm?: { count: number; increment: () => void }; increment?: () => void }): void => {
      // ★跨端共用断言：只碰状态（不写 div/view）
      const inc = host.vm ? host.vm.increment : (host as { increment: () => void }).increment
      expect(stateOf(host).count).toBe(1)
      inc()
      expect(stateOf(host).count).toBe(2)
    }
    const web = (await mountComponent(COUNTER_SFC, { platform: 'web' })) as never
    const mp = (await mountComponent(COUNTER_SFC, { platform: 'mp' })) as never
    runShared(web)
    runShared(mp)
  })

  it('tap 统一事件分发（Web wrapper 内元素 trigger）', async () => {
    const host = (await mountComponent(COUNTER_SFC, { platform: 'web' })) as unknown as {
      find: (sel: string) => { trigger: (e: string) => void }
      // stateOf 读取通道（vm.$.setupState）
      vm: { $: { setupState: { count: number } } }
    }
    // DOM 定位属于各端断言（06 铁律：跨端共享部分只碰逻辑/状态），定位到 button 再走统一 tap
    const btn = host.find('button')
    await tap(btn)
    expect(stateOf(host).count).toBe(2) // click → increment → count 2
  })
})
