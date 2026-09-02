// tests/render-backend.test.ts
// ★G-27（render-backend-1-plan M1.4 B1+B2）：ProteusRenderBackend SPI + conformance + 官方后端原型
//   B1 验收（05-batches §单测）：createElement 唯一句柄 / insert·remove 父子正确 / patchProp 属性变更 /
//   能力声明合法；conformance 能验证假后端接口完整性（M1 退出标准 3）
// @vitest-environment happy-dom（VueDomBackend DOM 断言）
import { describe, it, expect } from 'vitest'
import {
  createHeadlessBackend,
  createVueDomBackend,
  createNativeBackend,
  createMockNativeAdapter,
  createFlutterBackend,
  mapWidgetType,
  toWidgetTree,
  runBackendConformance,
  toPlainTree,
} from '@proteus-vue/render-backend'
import type { ProteusRenderBackend, NativeViewDescriptor, FlutterWidgetDescriptor } from '@proteus-vue/render-backend'

describe('G-27 runBackendConformance（B1 接口完整性自检）', () => {
  it('完整后端（Headless 参考实现）→ 全部 check 通过', () => {
    const result = runBackendConformance(createHeadlessBackend())
    expect(result.ok).toBe(true)
    const names = result.checks.map((c) => c.name)
    expect(names).toContain('method.createElement')
    expect(names).toContain('method.insert')
    expect(names).toContain('method.remove')
    expect(names).toContain('method.patchProp')
    expect(names).toContain('method.setText')
    expect(names).toContain('createElement.unique')
    expect(names).toContain('capabilities.layout')
    expect(result.checks.filter((c) => !c.pass)).toEqual([])
  })

  it('残缺后端（缺 insert + 非法 capabilities）→ fail 并指明缺失方法/非法枚举', () => {
    const broken: ProteusRenderBackend = {
      id: 'fake-broken',
      version: '0.0.1',
      capabilities: {
        layout: 'magic' as never, // 非法枚举
        glass: 'none',
        blur: 'none',
        animation: 'js',
        textureSharing: false,
        remoteRendering: false,
        ssr: false,
        input: ['touch', 'gesture' as never], // 非法输入类型
      },
      createElement: () => 'el-1', // 非唯一句柄（恒同引用）
      insert: undefined as never, // 缺必选方法
      remove: () => {},
      patchProp: () => {},
      setText: () => {},
    }
    const result = runBackendConformance(broken)
    expect(result.ok).toBe(false)
    const failNames = result.checks.filter((c) => !c.pass).map((c) => c.name)
    expect(failNames).toContain('method.insert')
    expect(failNames).toContain('createElement.unique')
    expect(failNames).toContain('capabilities.layout')
    expect(failNames).toContain('capabilities.input')
  })

  it('可选方法：存在时须为函数（非函数 → fail）', () => {
    const backend: ProteusRenderBackend = {
      ...createHeadlessBackend(),
      measure: 'not-a-function' as never,
    }
    const result = runBackendConformance(backend)
    expect(result.ok).toBe(false)
    expect(result.checks.filter((c) => !c.pass).map((c) => c.name)).toContain('optional.measure')
  })
})

describe('G-27 HeadlessBackend（B3 前置：内存节点树）', () => {
  it('createElement 唯一句柄 + insert 父子关系 + patchProp 属性变更 + setText', () => {
    const b = createHeadlessBackend()
    const root = b.createElement({ type: 'root', props: {}, children: [] }) as { id: number; children: unknown[] }
    const a = b.createElement({ type: 'view', props: {}, children: [] }) as { id: number; parent: unknown }
    const c = b.createElement({ type: 'text', props: {}, children: [] }) as { id: number }
    expect(root).not.toBe(a) // 唯一句柄
    b.insert(a, root)
    b.insert(c, a)
    expect((root.children as unknown[]).length).toBe(1)
    expect(a.parent).toBe(root)
    // patchProp 属性变更
    b.patchProp(a, 'style', null, { color: 'red' })
    b.patchProp(a, 'id', null, 'box')
    expect((a as { props: Record<string, unknown> }).props.id).toBe('box')
    // setText
    b.setText(c, 'hello')
    expect((c as { text: string }).text).toBe('hello')
    // remove
    b.remove(c)
    expect((a as { children: unknown[] }).children.length).toBe(0)
  })

  it('toPlainTree：序列化纯对象树（SSR/快照/Agent 断言载体）', () => {
    const b = createHeadlessBackend()
    const root = b.createElement({ type: 'page', props: { title: '首页' }, children: [] })
    const child = b.createElement({ type: 'text', props: {}, children: [] })
    b.insert(child, root)
    b.setText(child, 'hi')
    const tree = toPlainTree(root as { id: number; type: string; props: Record<string, unknown>; children: unknown[]; text: string })
    expect(tree.type).toBe('page')
    expect(tree.props).toEqual({ title: '首页' })
    expect((tree.children as Array<{ type: string; text: string }>)[0]).toMatchObject({ type: 'text', text: 'hi' })
  })

  it('通过 conformance（Headless 是参考实现）', () => {
    expect(runBackendConformance(createHeadlessBackend()).ok).toBe(true)
  })
})

describe('G-27 VueDomBackend（B2：DOM nodeOps——Vue 生态零成本复用验证）', () => {
  it('createElement → 真实 DOM 元素 + insert 挂载 + patchProp 属性/事件 + setText', () => {
    const b = createVueDomBackend(document)
    const root = b.createElement({ type: 'div', props: {}, children: [] }) as HTMLElement
    const btn = b.createElement({ type: 'button', props: {}, children: [] }) as HTMLElement
    b.insert(btn, root)
    expect(root.children.length).toBe(1)
    // patchProp 属性
    b.patchProp(btn, 'data-key', null, 'home')
    expect(btn.getAttribute('data-key')).toBe('home')
    // patchProp 事件（onClick → click）
    let hit = 0
    const handler = () => hit++
    b.patchProp(btn, 'onClick', null, handler)
    btn.click()
    expect(hit).toBe(1)
    // 移除事件（next 非函数）
    b.patchProp(btn, 'onClick', handler, null)
    btn.click()
    expect(hit).toBe(1)
    // setText
    b.setText(btn, '按钮')
    expect(btn.textContent).toBe('按钮')
    // remove
    b.remove(btn)
    expect(root.children.length).toBe(0)
  })

  it('patchProp style 对象 + insert anchor 定位', () => {
    const b = createVueDomBackend(document)
    const root = b.createElement({ type: 'div', props: {}, children: [] }) as HTMLElement
    const a = b.createElement({ type: 'span', props: {}, children: [] }) as HTMLElement
    const c = b.createElement({ type: 'span', props: {}, children: [] }) as HTMLElement
    b.insert(a, root)
    b.insert(c, root, a) // anchor=a → c 插到 a 前
    expect(root.children[0]).toBe(c)
    b.patchProp(a, 'style', null, { color: 'red', fontSize: '12px' })
    expect(a.style.color).toBe('red')
    expect(a.style.fontSize).toBe('12px')
  })

  it('通过 conformance', () => {
    expect(runBackendConformance(createVueDomBackend(document)).ok).toBe(true)
  })

  it('★G-31 B2：VueDom 消费 semantic——layout.grid → div.proteus-grid（Backend 映射 semantic 非 tag）', () => {
    const b = createVueDomBackend(document)
    const grid = b.createElement({ type: 'p-grid', semantic: 'layout.grid', props: {}, children: [] }) as HTMLElement
    expect(grid.tagName).toBe('DIV')
    expect(grid.getAttribute('class')).toBe('proteus-grid')
    const text = b.createElement({ type: 'p-text', semantic: 'ui.text', props: {}, children: [] }) as HTMLElement
    expect(text.tagName).toBe('SPAN')
    // 无 semantic → 按 type 原样（兼容层标签）
    const view = b.createElement({ type: 'view', props: {}, children: [] }) as HTMLElement
    expect(view.tagName).toBe('VIEW')
  })

  it('★G-31 B2 端到端：C-IR 树 → VueDom 渲染到 DOM（布局原语 Web 跑通——SPI 侧验证）', () => {
    const b = createVueDomBackend(document)
    const root = b.createElement({ type: 'p-box', semantic: 'layout.box', props: {}, children: [] }) as HTMLElement
    const grid = b.createElement({ type: 'p-grid', semantic: 'layout.grid', props: { minColWidth: 160 }, children: [] }) as HTMLElement
    const text = b.createElement({ type: 'p-text', semantic: 'ui.text', props: {}, children: [] }) as HTMLElement
    b.insert(grid, root)
    b.insert(text, grid)
    b.setText(text, '你好')
    b.patchProp(grid, 'style', null, { display: 'grid' })
    expect(root.children.length).toBe(1)
    expect((root.children[0] as HTMLElement).className).toBe('proteus-grid')
    expect((root.children[0] as HTMLElement).style.display).toBe('grid')
    expect(((root.children[0] as HTMLElement).children[0] as HTMLElement).textContent).toBe('你好')
  })

  it('无 document 环境且未注入 → 抛错（SSR 场景应改用 Headless）', () => {
    const orig = globalThis.document
    ;(globalThis as { document?: unknown }).document = undefined
    try {
      expect(() => createVueDomBackend()).toThrow(/无 document/)
    } finally {
      ;(globalThis as { document?: unknown }).document = orig
    }
  })
})

describe('G-27 NativeBackend（B4：nodeOps → 原生视图）', () => {
  it('CRUD：descriptor 树 + mock adapter ops 日志（验证 nodeOps → UIView 接线）', () => {
    const adapter = createMockNativeAdapter()
    const b = createNativeBackend(adapter)
    const root = b.createElement({ type: 'view', props: {}, children: [] }) as NativeViewDescriptor
    const btn = b.createElement({ type: 'button', props: {}, children: [] }) as NativeViewDescriptor
    b.insert(btn, root)
    expect(root.children.length).toBe(1)
    expect(btn.parent).toBe(root)
    b.patchProp(btn, 'onClick', null, () => {})
    b.setText(btn, '确定')
    b.remove(btn)
    expect(root.children.length).toBe(0)
    // ops 日志断言宿主同步序列（update 值含函数 toString 不稳定 → 只匹配前缀）
    expect(adapter.ops.length).toBe(6)
    expect(adapter.ops[0]).toBe('create:view')
    expect(adapter.ops[1]).toBe('create:button')
    expect(adapter.ops[2]).toBe('insert:button')
    expect(adapter.ops[3]?.startsWith('update:onClick=')).toBe(true)
    expect(adapter.ops[4]).toBe('setText:确定')
    expect(adapter.ops[5]).toBe('remove:button')
  })

  it('自定义宿主 adapter（spy）：createView 返回宿主句柄 + 变更同步', () => {
    const handles: unknown[] = []
    const updates: string[] = []
    const adapter = {
      createView: (d: NativeViewDescriptor) => {
        handles.push(d.type)
        return { __host: d.type, id: d.id }
      },
      updateView: (_h: unknown, key: string) => updates.push(key),
      insertView: () => {},
      removeView: () => {},
      setViewText: () => {},
    }
    const b = createNativeBackend(adapter)
    const node = b.createElement({ type: 'view', props: {}, children: [] }) as NativeViewDescriptor
    expect(handles).toEqual(['view'])
    expect((node.handle as { __host: string }).__host).toBe('view')
    b.patchProp(node, 'backgroundColor', null, '#fff')
    expect(updates).toEqual(['backgroundColor'])
  })

  it('capabilities：原生系统级能力声明（glass L3 / animation native / textureSharing）+ conformance 通过', () => {
    const b = createNativeBackend()
    expect(b.capabilities).toMatchObject({ glass: 'L3', blur: 'true', animation: 'native', textureSharing: true, layout: 'native' })
    expect(runBackendConformance(b).ok).toBe(true)
  })

  it('insert anchor 定位（anchor 存在时插入其前）', () => {
    const b = createNativeBackend()
    const root = b.createElement({ type: 'view', props: {}, children: [] }) as NativeViewDescriptor
    const a = b.createElement({ type: 'text', props: {}, children: [] }) as NativeViewDescriptor
    const c = b.createElement({ type: 'text', props: {}, children: [] }) as NativeViewDescriptor
    b.insert(a, root)
    b.insert(c, root, a)
    expect(root.children[0]).toBe(c)
    expect(root.children[1]).toBe(a)
  })

  it('★G-31 B3：Native 消费 semantic——layout.grid → UICollectionView（UIKit 基准）', () => {
    const b = createNativeBackend()
    const grid = b.createElement({ type: 'p-grid', semantic: 'layout.grid', props: {}, children: [] }) as NativeViewDescriptor
    expect(grid.type).toBe('UICollectionView')
    const text = b.createElement({ type: 'p-text', semantic: 'ui.text', props: {}, children: [] }) as NativeViewDescriptor
    expect(text.type).toBe('UILabel')
    const btn = b.createElement({ type: 'p-button', semantic: 'ui.button', props: {}, children: [] }) as NativeViewDescriptor
    expect(btn.type).toBe('UIButton')
    // 无 semantic → 按 type 原样（兼容层标签）
    const view = b.createElement({ type: 'view', props: {}, children: [] }) as NativeViewDescriptor
    expect(view.type).toBe('view')
    // 未知 semantic → 回退 type
    const unknown = b.createElement({ type: 'p-x', semantic: 'unknown.sem', props: {}, children: [] }) as NativeViewDescriptor
    expect(unknown.type).toBe('p-x')
  })

  it('★G-31 B3 端到端：C-IR 树 → Native 渲染（grid>text 层级 + mock ops 含原生视图类型）', () => {
    const adapter = createMockNativeAdapter()
    const b = createNativeBackend(adapter)
    const root = b.createElement({ type: 'p-box', semantic: 'layout.box', props: {}, children: [] }) as NativeViewDescriptor
    const grid = b.createElement({ type: 'p-grid', semantic: 'layout.grid', props: { minColWidth: 160 }, children: [] }) as NativeViewDescriptor
    const label = b.createElement({ type: 'p-text', semantic: 'ui.text', props: {}, children: [] }) as NativeViewDescriptor
    b.insert(grid, root)
    b.insert(label, grid)
    b.setText(label, '你好')
    expect(root.children[0]).toBe(grid)
    expect((grid.children[0] as NativeViewDescriptor).type).toBe('UILabel')
    expect(adapter.ops[0]).toBe('create:UIView') // layout.box → UIView
    expect(adapter.ops[1]).toBe('create:UICollectionView')
    expect(adapter.ops[2]).toBe('create:UILabel')
  })
})

describe('G-27 FlutterBackend（B5 spike：Proteus 语义 → Flutter widget 树）', () => {
  it('语义标签 → Flutter widget 映射（语义收敛的运行时对应）', () => {
    expect(mapWidgetType('view')).toBe('Container')
    expect(mapWidgetType('text')).toBe('Text')
    expect(mapWidgetType('button')).toBe('FilledButton')
    expect(mapWidgetType('scroll-view')).toBe('SingleChildScrollView')
    expect(mapWidgetType('p-grid')).toBe('Wrap')
    expect(mapWidgetType('unknown-custom')).toBe('unknown-custom') // 未映射透传
  })

  it('IR 树 → widget 树：端到端语义收敛路径（spike 可行性验证）', () => {
    const b = createFlutterBackend()
    const root = b.createElement({ type: 'view', props: {}, children: [] }) as FlutterWidgetDescriptor
    const text = b.createElement({ type: 'text', props: { fontSize: 16 }, children: [] }) as FlutterWidgetDescriptor
    const btn = b.createElement({ type: 'button', props: {}, children: [] }) as FlutterWidgetDescriptor
    b.insert(text, root)
    b.insert(btn, root)
    b.setText(text, '你好')
    b.patchProp(btn, 'onPressed', null, () => {})
    const tree = toWidgetTree(root)
    expect(tree.widget).toBe('Container')
    expect((tree.children as Array<{ widget: string; text: string; props: Record<string, unknown> }>)[0]).toMatchObject({
      widget: 'Text',
      text: '你好',
      props: { fontSize: 16 },
    })
    expect((tree.children as Array<{ widget: string }>)[1].widget).toBe('FilledButton')
  })

  it('CRUD + capabilities（layout yoga——Flutter 自带布局）+ conformance 通过', () => {
    const b = createFlutterBackend()
    expect(b.capabilities).toMatchObject({ layout: 'yoga', glass: 'L3', blur: 'true', animation: 'native', textureSharing: true })
    const root = b.createElement({ type: 'view', props: {}, children: [] }) as FlutterWidgetDescriptor
    const child = b.createElement({ type: 'text', props: {}, children: [] }) as FlutterWidgetDescriptor
    b.insert(child, root)
    b.remove(child)
    expect(root.children.length).toBe(0)
    expect(runBackendConformance(b).ok).toBe(true)
  })
})
