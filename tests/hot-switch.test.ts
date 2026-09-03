// tests/hot-switch.test.ts
// ★G-41 B5（proteus-host-integration-plan batches B5）：switchBackend 生产级 —— 热切换三策略
//   · rebuild   ：销毁重建（DevTools 开发期）——返回 null，调用方处置旧树
//   · rehydrate ：同一 IR 在新引擎重建（生产期路由切换）——返回新 root（保业务状态）
//   · hybrid    ：同页面多引擎（G-27 B6 createHybridRenderer 区域路由）——切到 hybrid 面
import { describe, it, expect } from 'vitest'
import {
  createNodeOpsDispatcher,
  createBackendSwitcher,
  createHeadlessBackend,
  createFlutterBackend,
  createHybridRenderer,
  toPlainTree,
  toWidgetTree,
} from '@proteus-vue/render-backend'
import type { IRNode } from '@proteus-vue/render-backend'

/** 业务 IR（page → grid → box×2（text/button）——与 B1/B2/B3 测试同构） */
function buildIR(dispatch: ReturnType<typeof createNodeOpsDispatcher>): IRNode {
  const grid = dispatch.toIRNode('p-grid', { minColWidth: 160 })
  const text = dispatch.toIRNode('p-text', { content: '商品 A' })
  const button = dispatch.toIRNode('p-button', { variant: 'primary' })
  return {
    ...dispatch.toIRNode('p-page', { title: 'Product' }),
    children: [{ ...grid, children: [{ ...dispatch.toIRNode('p-box', {}), children: [text] }, { ...dispatch.toIRNode('p-box', {}), children: [button] }] }],
  }
}

describe('G-41 B5 热切换三策略（switchBackend 生产级）', () => {
  it('rebuild：切后端返回 null（旧树丢，后续渲染走新后端）；trace 记录 strategy', () => {
    const dispatch = createNodeOpsDispatcher(createHeadlessBackend())
    const sw = createBackendSwitcher(dispatch)

    const root = sw.mount(buildIR(dispatch))
    expect(root).not.toBeNull()

    const whitespace = sw.switchBackend(createHeadlessBackend(), { strategy: 'rebuild' })
    expect(whitespace).toBeNull() // rebuild：旧树丢弃，调用方处置
    expect(sw.root).toBeNull()

    // trace 记录 strategy
    const switchCall = dispatch.trace.find((c) => c.op === 'switchBackend')
    expect(switchCall).toMatchObject({ op: 'switchBackend', strategy: 'rebuild' })
  })

  it('rehydrate：同一 IR 在新引擎重建（保业务状态）——返回新 root 且树语义等价', () => {
    const headless = createHeadlessBackend()
    const flutter = createFlutterBackend()
    const dispatch = createNodeOpsDispatcher(headless)
    const sw = createBackendSwitcher(dispatch)

    const rootA = sw.mount(buildIR(dispatch))
    const treeA = toPlainTree(rootA as never) as { children: Array<{ type: string }> }
    expect(treeA.children[0].type).toBe('grid') // headless 渲染

    // rehydrate 切到 Flutter——同一 IR 重建（保状态：currentIR 保持不变）
    const rootB = sw.switchBackend(flutter, { strategy: 'rehydrate' })
    expect(rootB).not.toBeNull()
    expect(dispatch.currentBackend).toBe(flutter)
    expect(sw.currentIR).not.toBeNull() // 活跃 IR 保留 = 状态载体

    const treeB = toWidgetTree(rootB as never) as { children: Array<{ widget: string }> }
    expect(treeB.children[0].widget).toBe('GridView') // 同一 IR 在 Flutter 重建
    const switchCall = dispatch.trace.find((c) => c.op === 'switchBackend')
    expect(switchCall).toMatchObject({ strategy: 'rehydrate' })
  })

  it('rehydrate 钩子：onBeforeSwitch / onAfterSwitch 按序触发', () => {
    const dispatch = createNodeOpsDispatcher(createHeadlessBackend())
    const sw = createBackendSwitcher(dispatch)
    sw.mount(buildIR(dispatch))

    const order: string[] = []
    const root2 = sw.switchBackend(createFlutterBackend(), {
      strategy: 'rehydrate',
      onBeforeSwitch: (from, to) => order.push(`before:${from.id}→${to.id}`),
      onAfterSwitch: (_from, to, root) => order.push(`after:${to.id}:${root ? 'root' : 'null'}`),
    })
    expect(root2).not.toBeNull()
    expect(order).toEqual(['before:headless→flutter', 'after:flutter:root'])
  })

  it('hybrid：切到 createHybridRenderer 区域路由面（同页面多引擎——G-27 B6 复用）', () => {
    const headless = createHeadlessBackend()
    const flutter = createFlutterBackend()
    const dispatch = createNodeOpsDispatcher(headless)
    const sw = createBackendSwitcher(dispatch)

    // 构造 hybrid 面：p-canvas（ui.canvas）走 Flutter，其余走 Headless
    const hybrid = createHybridRenderer({
      defaultBackend: headless,
      regions: [{ name: 'canvas', match: (n) => n.semantic === 'ui.canvas', backend: flutter }],
    })

    sw.switchBackend(hybrid, { strategy: 'hybrid' })
    const switchCall = dispatch.trace.find((c) => c.op === 'switchBackend')
    expect(switchCall).toMatchObject({ op: 'switchBackend', strategy: 'hybrid' })

    // 区域路由生效：canvas → Flutter widget 树，box → Headless 树
    const canvas = dispatch.nodeOps.createElement('p-canvas', { engine: 'skia' })
    expect(toWidgetTree(canvas as never)).toHaveProperty('widget')
    const box = dispatch.nodeOps.createElement('p-box')
    const boxTree = toPlainTree(box as never) as { type: string }
    expect(boxTree.type).toBe('box')
  })
})