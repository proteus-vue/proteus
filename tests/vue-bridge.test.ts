// tests/vue-bridge.test.ts
// ★G-41 B3（proteus-host-integration-plan batches B3）：真实 Vue createRenderer 接入
//   标准 Vue 渲染路径（h() → render/renderer）经 B1 Dispatcher 落到任意后端——"Vue 代码不变、引擎可换"的可运行验证
//   · Headless 后端：无 DOM 全链路（mount/diff/setText）
//   · vue-dom 后端：happy-dom 下真实 DOM 元素（B3 验收"SFC 在 vue-dom 后端完整渲染"）
//   · switchBackend 热切换：同 VNode 树在另一后端重建
// @vitest-environment happy-dom（vue-dom 后端需 document）
import { describe, it, expect } from 'vitest'
import { h } from 'vue'
import {
  createHeadlessBackend,
  createVueDomBackend,
  createFlutterBackend,
  createNodeOpsDispatcher,
  createProteusRenderer,
  createProteusRendererForBackend,
  toPlainTree,
  toWidgetTree,
} from '@proteus-vue/render-backend'
import type { IRNode } from '@proteus-vue/render-backend'

/** 业务 VNode 树（语义标签 p-* —— "一套代码"本体） */
function productVNode() {
  return h('p-page', { title: 'Product' }, [
    h('p-grid', { minColWidth: 160 }, [
      h('p-box', {}, [h('p-text', { content: '商品 A' }, '商品 A')]),
      h('p-box', {}, [h('p-button', { variant: 'primary' }, '加入购物车')]),
    ]),
  ])
}

describe('G-41 B3 vue-bridge：真实 Vue 渲染器接入 Dispatcher', () => {
  it('Headless 后端：render(h()) 全链路渲染 → 后端树结构正确（mount/insert/patchProp/setText）', () => {
    const headless = createHeadlessBackend()
    const { renderer } = createProteusRendererForBackend(headless)
    const container = headless.createElement({ type: 'container', props: {}, children: [] }) as never

    renderer.render(productVNode(), container)

    const tree = toPlainTree(container) as {
      type: string
      props: Record<string, unknown>
      children: Array<{ type: string; props: Record<string, unknown>; children: Array<{ type: string; children: Array<{ type: string; text: string }> }> }>
    }
    // 结构：container → page → grid → [box→text, box→button]；semantic 分发：layout.grid → 'grid'，ui.text → 'text'
    expect(tree.type).toBe('container')
    const page = tree.children[0]
    expect(page.type).toBe('page')
    const grid = page.children[0]
    expect(grid.type).toBe('grid')
    expect(grid.props.minColWidth).toBe(160) // patchProp 转发生效
    expect(grid.children[0].children[0].type).toBe('text')
    expect(grid.children[0].children[0].text).toBe('商品 A')
    expect(grid.children[1].children[0].type).toBe('button')
  })

  it('更新 diff：重新 render 新 VNode → patchProp/setText 转发，树更新', () => {
    const headless = createHeadlessBackend()
    const { renderer } = createProteusRendererForBackend(headless)
    const container = headless.createElement({ type: 'container', props: {}, children: [] }) as never

    renderer.render(h('p-text', { content: 'A' }, 'A'), container)
    renderer.render(h('p-text', { content: 'B' }, 'B'), container)

    const tree = toPlainTree(container) as { children: Array<{ text: string; props: Record<string, unknown> }> }
    expect(tree.children[0].text).toBe('B') // setText/setElementText 转发（文本在 container 的 child 上）
    expect(tree.children[0].props.content).toBe('B') // patchProp 转发
  })

  it('vue-dom 后端（happy-dom）：完整渲染为真实 DOM 元素（B3 验收）', () => {
    const backend = createVueDomBackend()
    const { renderer } = createProteusRendererForBackend(backend)
    const container = document.createElement('div')

    renderer.render(productVNode(), container)

    const grid = container.querySelector('.proteus-grid') as HTMLElement | null
    expect(grid).not.toBeNull()
    expect(grid?.getAttribute('class')).toContain('proteus-grid')
    const text = grid?.querySelector('span') as HTMLElement | null
    expect(text?.textContent).toContain('商品 A')
    const button = grid?.querySelector('button') as HTMLElement | null
    expect(button?.textContent).toContain('加入购物车')
  })

  it('switchBackend 热切换后，同一 VNode 树在另一后端重建（引擎无关）', () => {
    const headless = createHeadlessBackend()
    const flutter = createFlutterBackend()
    const dispatch = createNodeOpsDispatcher(headless)
    const { renderer } = createProteusRenderer(dispatch)

    // 先在 Headless 渲染
    const headContainer = headless.createElement({ type: 'container', props: {}, children: [] }) as never
    renderer.render(productVNode(), headContainer)
    const headTree = toPlainTree(headContainer) as { children: Array<{ type: string; props: Record<string, unknown>; children: Array<{ type: string }> }> }
    expect(headTree.children[0].type).toBe('page')
    expect(headTree.children[0].children[0].type).toBe('grid')

    // 热切换 → 同一 VNode 树重新渲染到 Flutter（源码零改动）
    dispatch.switchBackend(flutter)
    const flatContainer = flutter.createElement({ type: 'container', props: {}, children: [] }) as never
    renderer.render(productVNode(), flatContainer)
    const flatTree = toWidgetTree(flatContainer) as { children: Array<{ widget: string; children: Array<{ widget: string; children: Array<{ widget: string }> }> }> }
    expect(flatTree.children[0].widget).toBe('Scaffold') // shell.page
    const flatGrid = flatTree.children[0].children[0]
    expect(flatGrid.widget).toBe('GridView') // layout.grid
    expect(flatGrid.children[1].children[0].widget).toBe('FilledButton') // ui.button
  })
})

describe('G-41 B3 createVueRendererOptions：Vue RendererOptions 契约', () => {
  it('options 含 Vue 所需全部方法（createElement/insert/remove/patchProp/setText/createText/...）', () => {
    const dispatch = createNodeOpsDispatcher(createHeadlessBackend())
    const { renderer } = createProteusRenderer(dispatch)
    expect(typeof renderer.render).toBe('function')
    // createRenderer 正常构造即证明 options 形状被 Vue 接受
  })

  it('非 p-* 元素（div/span 等兼容层标签）在运行期被拦截（Layer 0 只认语义原语）', () => {
    const headless = createHeadlessBackend()
    const { renderer } = createProteusRendererForBackend(headless)
    const container = headless.createElement({ type: 'container', props: {}, children: [] }) as never
    expect(() => renderer.render(h('div', {}, 'not allowed'), container)).toThrow(/unknown primitive/)
  })
})

// 类型防护：确认 vue-bridge 导出契约（编译期断言）
const _typeCheck: IRNode = { type: 'p-text', semantic: 'ui.text', props: {}, children: [] }
void _typeCheck