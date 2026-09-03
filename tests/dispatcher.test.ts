// tests/dispatcher.test.ts
// ★G-41 B1（proteus-host-integration-plan batches B1 验收）：ProteusNodeOpsDispatcher（方案 B 全局转发层）
//   · toIRNode：p-* 标签 → C-IR（G-32 原语表数据源；未知标签 throw——G-41.2 禁止静默）
//   · nodeOps 转发：createElement/insert/patchProp/setText 全部转发到 currentBackend
//   · H-03-04 双引擎一致：同一份 IR 在 Headless 与 Flutter 两个引擎下渲染——
//       ① 各自的引擎树类型正确（grid→Grid 类映射）
//       ② nodeOps 调用日志（trace）逐条一致 → 机器证据「渲染驱动与引擎无关」
//   · switchBackend 热切换：切换后新节点走新引擎，旧节点保留
import { describe, it, expect } from 'vitest'
import {
  createNodeOpsDispatcher,
  createHeadlessBackend,
  createFlutterBackend,
  renderIRTree,
  semanticSequence,
  DispatcherError,
  toPlainTree,
  toWidgetTree,
} from '@proteus-vue/render-backend'
import type { IRNode } from '@proteus-vue/render-backend'

/** 构造一棵真实业务页面 IR（page → grid → box×2（text/button）——对齐 128 原语语义） */
function buildPageIR(): IRNode {
  return {
    type: 'p-page',
    semantic: 'shell.page',
    props: { title: 'Product' },
    children: [
      {
        type: 'p-grid',
        semantic: 'layout.grid',
        props: { minColWidth: 160 },
        children: [
          { type: 'p-box', semantic: 'layout.box', props: {}, children: [{ type: 'p-text', semantic: 'ui.text', props: { content: '商品 A' }, children: [] }] },
          { type: 'p-box', semantic: 'layout.box', props: {}, children: [{ type: 'p-button', semantic: 'ui.button', props: { variant: 'primary' }, children: [] }] },
        ],
      },
    ],
  }
}

describe('G-41 toIRNode（标签 → C-IR，G-32 原语表驱动）', () => {
  it('p-grid → semantic layout.grid（后端按 semantic 分发——G-37.1 对齐）', () => {
    const d = createNodeOpsDispatcher(createHeadlessBackend())
    const ir = d.toIRNode('p-grid', { minColWidth: 160 })
    expect(ir.semantic).toBe('layout.grid')
    expect(ir.type).toBe('p-grid')
    expect(ir.props).toEqual({ minColWidth: 160 })
  })

  it('未知 p-* 标签 → DispatcherError（运行期兜底，编译期就该拦下）', () => {
    const d = createNodeOpsDispatcher(createHeadlessBackend())
    expect(() => d.toIRNode('p-unknown-thing', {})).toThrow(DispatcherError)
  })

  it('非 p-* 标签（view/text 兼容层）→ DispatcherError（Layer 0 只认语义原语）', () => {
    const d = createNodeOpsDispatcher(createHeadlessBackend())
    expect(() => d.toIRNode('view', {})).toThrow(DispatcherError)
  })
})

describe('G-41 nodeOps 转发（全部落到 currentBackend）', () => {
  it('createElement + insert → Headless 树出现语义节点', () => {
    const headless = createHeadlessBackend()
    const d = createNodeOpsDispatcher(headless)
    const grid = d.nodeOps.createElement('p-grid', { minColWidth: 160 })
    const text = d.nodeOps.createElement('p-text', { content: '商品 A' })
    d.nodeOps.insert(text, grid)
    d.nodeOps.setText(text, '商品 A')
    const root = d.nodeOps.createElement('p-page', { title: 'Product' })
    d.nodeOps.insert(grid, root)

    const tree = toPlainTree(root as never)
    // headless 语义映射：shell.page → page、layout.grid → grid、ui.text → text
    expect((tree as { type: string }).type).toBe('page')
    const gridNode = (tree as { children: Array<{ type: string; children: Array<{ type: string; text: string }> }> }).children[0]
    expect(gridNode.type).toBe('grid')
    expect(gridNode.children[0].type).toBe('text')
    expect(gridNode.children[0].text).toBe('商品 A')
  })

  it('patchProp 转发并生效', () => {
    const headless = createHeadlessBackend()
    const d = createNodeOpsDispatcher(headless)
    const el = d.nodeOps.createElement('p-image', { src: 'a.png' })
    d.nodeOps.patchProp(el, 'src', 'a.png', 'b.png')
    const tree = toPlainTree(el as never)
    expect((tree as { props: Record<string, unknown> }).props.src).toBe('b.png')
  })
})

describe('G-41 H-03-04 双引擎一致（同一 IR，两引擎渲染，机器证据）', () => {
  it('Headless 与 Flutter 各自正确渲染（类型映射各自正确）', () => {
    const head = createHeadlessBackend()
    const flat = createFlutterBackend()
    const ir = buildPageIR()

    const headRoot = renderIRTree(head, ir)
    const flatRoot = renderIRTree(flat, ir)

    const headTree = toPlainTree(headRoot as never)
    const flatTree = toWidgetTree(flatRoot as never)

    // Headless 类型序列（semantic → headless 映射）
    expect((headTree as { type: string }).type).toBe('page')
    const hGrid = (headTree as { children: Array<{ type: string; children: Array<{ type: string; children: Array<{ type: string }> }> }> }).children[0]
    expect(hGrid.type).toBe('grid')
    expect(hGrid.children[0].children[0].type).toBe('text')
    expect(hGrid.children[1].children[0].type).toBe('button')

    // Flutter widget 序列（semantic → flutter 映射）
    expect((flatTree as { widget: string }).widget).toBe('Scaffold')
    const fGrid = (flatTree as { children: Array<{ widget: string; children: Array<{ widget: string; children: Array<{ widget: string }> }> }> }).children[0]
    expect(fGrid.widget).toBe('GridView')
    expect(fGrid.children[0].children[0].widget).toBe('Text')
    expect(fGrid.children[1].children[0].widget).toBe('FilledButton')
  })

  it('语义序列一致（引擎无关输入指纹：两引擎消费同一 IR，semantic 序列必相同）', () => {
    const head = createHeadlessBackend()
    const flat = createFlutterBackend()
    const ir = buildPageIR()

    const headTree = toPlainTree(renderIRTree(head, ir) as never) as { type: string; children: never[] }
    const flatTree = toWidgetTree(renderIRTree(flat, ir) as never) as { widget: string; children: never[] }

    // IR 输入指纹（引擎无关）
    expect(semanticSequence(ir)).toEqual(['shell.page', 'layout.grid', 'layout.box', 'ui.text', 'layout.box', 'ui.button'])

    // 归一化为「引擎无关结构骨架」：type/widget → 占位（结构不变），children 递归
    const shape = (t: unknown): unknown => {
      const node = t as { children: unknown[] }
      return { children: (node.children ?? []).map(shape) }
    }
    expect(shape(headTree)).toEqual(shape(flatTree))
  })

  it('nodeOps 调用日志逐条一致（★机器证据：渲染驱动与引擎无关）', () => {
    const headDispatcher = createNodeOpsDispatcher(createHeadlessBackend())
    const flatDispatcher = createNodeOpsDispatcher(createFlutterBackend())
    const ir = buildPageIR()

    renderIRTreeWithNodeOps(headDispatcher, ir)
    renderIRTreeWithNodeOps(flatDispatcher, ir)

    expect(headDispatcher.trace).toEqual(flatDispatcher.trace)
    // 关键：trace 里有完整的 createElement 序列（含 semantic），证明引擎切换不改变建树驱动
    const createOps = headDispatcher.trace.filter((c) => c.op === 'createElement').map((c) => (c as { semantic: string }).semantic)
    expect(createOps).toEqual(['shell.page', 'layout.grid', 'layout.box', 'ui.text', 'layout.box', 'ui.button'])
  })
})

/** 用 Dispatcher 的 nodeOps 平铺渲染一棵 IR 树（H-03 trace 采集方式——与 Vue createRenderer 消费方式一致） */
function renderIRTreeWithNodeOps(
  d: ReturnType<typeof createNodeOpsDispatcher>,
  ir: IRNode,
  insertInto?: (child: unknown, parent: unknown) => void,
): unknown {
  const handle = d.nodeOps.createElement(ir.type, ir.props)
  for (const child of ir.children) {
    const c = renderIRTreeWithNodeOps(d, child)
    if (insertInto) insertInto(c, handle)
    else d.nodeOps.insert(c as never, handle as never)
  }
  return handle
}

describe('G-41 switchBackend（方案 B 热切换 = 一次赋值）', () => {
  it('切换后新节点走新引擎，旧节点保留', () => {
    const headless = createHeadlessBackend()
    const flutter = createFlutterBackend()
    const d = createNodeOpsDispatcher(headless)

    const page = renderIRTreeWithNodeOps(d, buildPageIR())
    const headTree = toPlainTree(page as never)

    d.switchBackend(flutter)
    const box = d.nodeOps.createElement('p-box', {})
    const text = d.nodeOps.createElement('p-text', { content: '切换后' })
    d.nodeOps.insert(text, box)

    // 旧节点保留在 Headless（未受影响）
    expect((headTree as { type: string }).type).toBe('page')
    // 新节点落在 Flutter（widget 类型）
    const flatTree = toWidgetTree(box as never)
    expect((flatTree as { widget: string }).widget).toBe('Container')

    // 历史与 trace 记录切换
    expect(d.switchHistory.length).toBe(1)
    expect(d.switchHistory[0].id).toBe('headless')
    const switchCall = d.trace.find((c) => c.op === 'switchBackend')
    expect(switchCall).toMatchObject({ op: 'switchBackend', from: 'headless', to: 'flutter' })
  })

  it('clearTrace 后日志重置（H-03 逐条对比前置）', () => {
    const d = createNodeOpsDispatcher(createHeadlessBackend())
    d.nodeOps.createElement('p-box', {})
    expect(d.trace.length).toBeGreaterThan(0)
    d.clearTrace()
    expect(d.trace.length).toBe(0)
  })
})