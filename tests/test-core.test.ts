// tests/test-core.test.ts
// ★test-framework M3：createMockContext（唯一 wx 来源）+ mountMpComponent（逻辑 + WXML 双断言）
import { describe, it, expect, afterEach } from 'vitest'
import { createMockContext, mountMpComponent } from '../packages/test-core/src/index'

describe('createMockContext（唯一 wx 来源）', () => {
  let ctx: ReturnType<typeof createMockContext> | undefined
  afterEach(() => ctx?.cleanup())

  it('storage 内存实现：set/get/remove/clear 真实往返', () => {
    ctx = createMockContext()
    ctx.wx.storage.setStorageSync('k', { a: 1 })
    expect(ctx.wx.storage.getStorageSync('k')).toEqual({ a: 1 })
    expect(ctx.wx.storage.setStorageSync).toHaveBeenCalledWith('k', { a: 1 })
    ctx.wx.storage.removeStorageSync('k')
    expect(ctx.wx.storage.getStorageSync('k')).toBeUndefined()
    ctx.wx.storage.setStorageSync('a', 1)
    ctx.wx.storage.clearStorageSync()
    expect(ctx.store.size).toBe(0)
  })

  it('初始 storage + router/ui 可断言', () => {
    ctx = createMockContext({ storage: { pre: 'x' } })
    expect(ctx.wx.storage.getStorageSync('pre')).toBe('x')
    ctx.wx.router.navigateTo({ url: '/pages/a' })
    ctx.wx.ui.showToast({ title: 'hi' })
    expect(ctx.wx.router.navigateTo).toHaveBeenCalledWith({ url: '/pages/a' })
    expect(ctx.wx.ui.showToast).toHaveBeenCalledWith({ title: 'hi' })
  })

  it('Page/Component/App 构造器捕获注册配置', () => {
    ctx = createMockContext()
    const pageConfig = { data: { count: 0 }, onLoad() {} }
    // 模拟页面注册（全局 Page 已被 stub）
    ;(globalThis as Record<string, unknown>).Page(pageConfig)
    expect(ctx.registrations.page).toBe(pageConfig)
    ctx.cleanup()
    expect((globalThis as Record<string, unknown>).wx).toBeUndefined() // 恢复
  })

  it('getCurrentPages / getSystemInfoSync mock', () => {
    ctx = createMockContext({ pages: [{ route: 'pages/a' }] })
    expect(ctx.getCurrentPages()).toHaveLength(1)
    expect(ctx.wx.getSystemInfoSync()).toHaveProperty('platform', 'devtools')
  })
})

describe('mountMpComponent（SFC → 逻辑层 + WXML 双断言）', () => {
  let ctx: ReturnType<typeof createMockContext> | undefined
  afterEach(() => ctx?.cleanup())

  const SFC = `
<template><button class="p-btn" :disabled="disabled">{{ label }}</button></template>
<script setup lang="ts">
import { ref } from 'vue'
const disabled = ref(true)
const label = '确认'
</script>
`

  it('WXML 结构 + data 逻辑断言', () => {
    const { wxml, instance, context } = mountMpComponent(SFC)
    ctx = context
    expect(wxml).toContain('button')
    expect(instance.data).toHaveProperty('disabled', true)
    expect(instance.data).toHaveProperty('label', '确认')
  })

  it('setData 追踪（更新序列可断言）', () => {
    const { instance, context } = mountMpComponent(SFC)
    ctx = context
    instance.setData({ count: 1 })
    instance.setData({ count: 2 })
    expect(instance.setData.calls).toEqual([{ count: 1 }, { count: 2 }])
  })

  it('wx 唯一来源贯穿（mount 内 ctx 可用）', () => {
    const { context } = mountMpComponent(SFC)
    ctx = context
    context.wx.storage.setStorageSync('k', 5)
    expect(context.wx.storage.getStorageSync('k')).toBe(5)
  })
})
