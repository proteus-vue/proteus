// tests/web-adapter-query.test.ts
// @vitest-environment jsdom
// ★Web adapter 路由参数保留（2026-09-19 修外部实战报告第 4 条）：
//   外部项目实测「写作页恒显示第 0 章」——根因是 Web 端**两条路都拿不到参数**：
//     · `pageLifecycle.onLoad` 在 Web 是 no-op（回调不执行）
//     · RouterView 此前不把 query 传给页面（`<component :is>` 无 v-bind）
//     且 adapter 的当前页对象**丢弃** query（只传给 listeners）
//   修复：① adapter 当前页保留 query（对齐 MP `Page.options` 语义）
//        ② RouterView 把 query `v-bind` 给页面（页面 defineProps 即收到）
//   本文件锁第 ① 条；第 ② 条由 E2E（examples 页面）覆盖。
//   ★用 jsdom 环境：adapter 构造时会读 location/history 并注册 window/document 事件——
//     手写 mock 需逐个补齐（实测漏一个即 ReferenceError），jsdom 提供真实实现更可靠。
import { describe, it, expect } from 'vitest'
import { createWebAdapter } from '../packages/shared/src/platform/web-adapter'

/** 每次新建 adapter（闭包内 current 为实例状态，隔离测试） */
function newAdapter(): ReturnType<typeof createWebAdapter> {
  return createWebAdapter()
}

describe('★Web adapter：当前页保留路由参数（对齐 MP Page.options 语义）', () => {
  it('导航带 query → getCurrentPages()[0].query 可读（此前被丢弃）', async () => {
    const adapter = newAdapter()
    const seen: Array<{ route: string; query: Record<string, string> }> = []
    adapter.onPageLoad?.((route, query) => {
      seen.push({ route, query })
    })
    // 模拟一次带参导航
    await adapter.navigateTo?.({ url: '/pages/editor?id=41&tab=outline' })

    // ① listener 收到 query（既有行为，防回归）
    const last = seen[seen.length - 1]
    expect(last, '应有 onPageLoad 回调触发').toBeTruthy()
    expect(last!.query, 'listener 应收到解析后的 query').toMatchObject({ id: '41', tab: 'outline' })

    // ② ★当前页对象也保留 query（本次修复点——此前 current 只存 route）
    const cur = adapter.getCurrentPages()[0]
    expect(cur?.query, '★当前页应保留 query（否则页内 getCurrentPages()[0].query 读不到参数）').toMatchObject({
      id: '41',
      tab: 'outline',
    })
  })

  it('无 query 的导航 → query 为空对象（不残留上一次参数）', async () => {
    const adapter = newAdapter()
    adapter.onPageLoad?.(() => undefined)
    await adapter.navigateTo?.({ url: '/pages/a?id=1' })
    expect(adapter.getCurrentPages()[0]?.query).toMatchObject({ id: '1' })
    await adapter.navigateTo?.({ url: '/pages/b' })
    expect(adapter.getCurrentPages()[0]?.query, '★换页后不得残留上一页参数').toEqual({})
  })

  it('query 值经 decodeURIComponent 解析（中文/特殊字符）', async () => {
    const adapter = newAdapter()
    adapter.onPageLoad?.(() => undefined)
    await adapter.navigateTo?.({ url: '/pages/editor?title=' + encodeURIComponent('第 41 章') })
    expect(adapter.getCurrentPages()[0]?.query?.title).toBe('第 41 章')
  })
})
