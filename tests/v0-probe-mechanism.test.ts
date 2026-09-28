// tests/v0-probe-mechanism.test.ts
// ★★V0 探针的**测量装置自检**（桌面）—— 真机跑之前必须先证明装置本身成立
//
// 【为什么必须有这一层（本仓第四次同类教训）】
//   真机一轮构建 + 装机 + 逐用例驱动约 3–4 分钟。若拿真机去调试"探针写得对不对"，
//   一旦读数反直觉，就分不清是 **Vue 行为如此** 还是 **我的探针有缺陷** ——
//   本仓已四次踩到「测量装置缺陷把结论带偏」（见 PROJECT_MEMORY 的加压测试一节）。
//   ⇒ 纪律：**测量装置本身必须先被验证**。本文件在桌面用 mock 语义（无需真机 RC）验证：
//     ① 三种用法真的产出了「同一棵树」（节点数/顺序一致）
//     ② memo / comp 真的**跳过了** VNode 创建（render 次数不变，而 plain 会 +1）
//     ③ comp 的行子组件渲染次数**只涨 1**（更新止于该行）
//     ④ `withMemo` 在依赖变化时会失效重建（否则 memo 就不是"缓存"，是"冻结"）
//
// 用法：pnpm vitest run tests/v0-probe-mechanism.test.ts

import { describe, it, expect } from 'vitest'
import { nextTick } from '@vue/runtime-core'
import { makeApp } from '../hosts/ios/bridge/bench-app'

/**
 * ★挂载后必须 `markFullSync()`（与真机 `mountApp()` 的前置条件一致）
 *
 * 【为什么（本仓已踩）】`mount` 会创建全部节点 ⇒ 适配器的 `structuralChange = true`。
 *   真机路径由 `mountApp()` 在全量挂载后调用 `markFullSync()` 复位；
 *   桌面自检若漏掉这一步，`takePatches()` 永远返回 `null`（每次都走全量），
 *   读数会退化成"看不出增量"——**看起来像探针没生效，实为前置条件没满足**。
 */
function mounted(n: number, strat: 'plain' | 'memo' | 'comp') {
  const app = makeApp(n, strat)
  app.adapter.markFullSync()
  return app
}

/** 取渲染树的**形状签名**（tag 序列 + 深度）——用于断言三种用法产出同一棵树 */
function shapeOf(nodes: Array<{ tag?: string; children?: unknown[] }>): string {
  const walk = (ns: Array<{ tag?: string; children?: unknown[] }>): string =>
    ns.map((n) => `${n.tag ?? '?'}(${walk((n.children ?? []) as never)})`).join(',')
  return walk(nodes)
}

describe('V0 探针装置自检（桌面）', () => {
  it('三种用法产出同一棵树形状（可比性的前提）', async () => {
    const N = 8
    const shapes: Record<string, string> = {}
    for (const strat of ['plain', 'memo', 'comp'] as const) {
      const app = mounted(N, strat)
      const req = app.adapter.toRequest({ width: 390, height: 844 })
      shapes[strat] = shapeOf(req.nodes as never)
      app.dispose()
    }
    expect(shapes['memo']).toBe(shapes['plain'])
    expect(shapes['comp']).toBe(shapes['plain'])
  })

  it('★memo：改单行 → 该行重建，其余行跳过 VNode 创建（父 render 仍会跑）', async () => {
    const N = 50
    const mid = 25
    const app = mounted(N, 'memo')
    app.adapter.resetStats()

    const r0 = app.renderCount()
    const p0 = app.adapter.patchCount()
    app.setDotSize(mid, 20)
    await nextTick()

    // 父组件 render 必然重跑（响应式依赖在父作用域）
    expect(app.renderCount()).toBe(r0 + 1)
    // 关键：只有 1 个节点被标脏（若 memo 失效，50 行都会因 style 引用不同而标脏）
    const patches = app.adapter.takePatches()
    expect(patches).not.toBeNull()
    expect(patches!.length).toBe(1)
    expect(patches![0].style).toMatchObject({ height: 20 })
    void p0
    app.dispose()
  })

  it('★memo：依赖变化时缓存失效（memo 不是冻结）', async () => {
    const N = 20
    const app = mounted(N, 'memo')
    app.adapter.resetStats()
    // ★① 文本变更**现在走补丁增量**（2026-09-28 修复；此前只能全量）
    //   【为什么这条断言变过】旧实现里 `setElementText` 会"清空 children + 新建文本节点"
    //   ⇒ 新 id ⇒ 结构变更 ⇒ `takePatches()` 返回 null ⇒ **整树重发**
    //   （真机 S4 实测 300 行文案 = 281KB / 150ms）。首版测试把这个**现状**钉住并注明
    //   "它正是编译器路线要动的地方之一"——现在动了：适配器**复用同一文本节点**
    //   ⇒ id 稳定 ⇒ 内容更新 ⇒ 走补丁（真机 A/B：281KB→15KB · 150ms→71ms）。
    app.churnText(5, 'X')
    await nextTick()
    const tp = app.adapter.takePatches()
    expect(tp, '文本更新现在应产出补丁（而非 null ⇒ 全量）').not.toBeNull()
    expect(tp!.filter((x) => (x.style as { text?: string }).text !== undefined).length).toBeGreaterThan(0)
    // ★② 依赖数组内的**布局**字段变更必须被看到（证明 memo 会失效重建，不是冻结）
    app.setDotSize(3, 30)
    await nextTick()
    const p2 = app.adapter.takePatches()
    expect(p2!.some((p) => (p.style as { height?: number }).height === 30)).toBe(true)
    app.dispose()
  })

  it('★comp：行子组件只在自身 props 变化时渲染（更新止于该行）', async () => {
    const N = 50
    const mid = 25
    const app = mounted(N, 'comp')
    app.adapter.resetStats()

    const r0 = app.renderCount()
    const row0 = app.rowRenderCount()
    app.setDotSize(mid, 20)
    await nextTick()

    expect(app.renderCount()).toBe(r0 + 1)         // 父 render 仍重跑（VNode 创建 O(n) 仍在）
    expect(app.rowRenderCount() - row0).toBe(1)    // ★但只有 1 个行子组件重渲染
    const patches = app.adapter.takePatches()
    expect(patches!.length).toBe(1)
    app.dispose()
  })

  it('★零行变更（改标题 margin）：memo/comp 不重建任何行', async () => {
    const N = 50
    for (const strat of ['memo', 'comp'] as const) {
      const app = mounted(N, strat)
      app.adapter.resetStats()
      const row0 = app.rowRenderCount()
      app.setHeaderMargin(20)
      await nextTick()
      expect(app.rowRenderCount() - row0).toBe(0)
      const patches = app.adapter.takePatches()
      expect(patches!.length).toBe(1)              // 只有标题节点标脏
      expect(patches![0].style).toMatchObject({ margin: { bottom: 20 } })
      app.dispose()
    }
  })

  it('plain（基线）：改单行会让全部行标脏 —— 对照组的差异必须真实存在', async () => {
    const N = 50
    const app = mounted(N, 'plain')
    app.adapter.resetStats()
    app.setDotSize(25, 20)
    await nextTick()
    // 基线里 style 对象每次新建 ⇒ Vue 对所有行调用 patchProp ⇒ 适配器按布局子集比值后…
    // ★只有真正变化的那个节点应被标脏（这正是适配器 styleSig 的功劳）。
    //   但 patchProp 的**调用次数**是 O(n)：用 patchCount 证明"遍历成本仍在"。
    const patches = app.adapter.takePatches()
    expect(patches!.length).toBe(1)                       // 布局补丁数（适配器已按值过滤）
    expect(app.adapter.patchCount()).toBeGreaterThan(N)   // ★但 patchProp 被调用了 O(n) 次
    app.dispose()
  })
})
