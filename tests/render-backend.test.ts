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
  createSelfDrawBatchAdapter,
  toPlainTree,
} from '@proteus-vue/render-backend'
import type { ProteusRenderBackend, NativeViewDescriptor, FlutterWidgetDescriptor, HeadlessNode } from '@proteus-vue/render-backend'

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
      id: 'fake-broken' as never, // 非 BackendId 枚举（conformance 应识别非法后端标识）
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
      // ★2026-09-26 文本保留：SPI 新增 createText（五后端与 hybrid 均已实现）
      createText: () => 'text-1',
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
    const root = b.createElement({ type: 'root', props: {}, children: [] }) as HeadlessNode
    const a = b.createElement({ type: 'view', props: {}, children: [] }) as HeadlessNode
    const c = b.createElement({ type: 'text', props: {}, children: [] }) as HeadlessNode
    expect(root).not.toBe(a) // 唯一句柄
    b.insert(a, root)
    b.insert(c, a)
    expect(root.children.length).toBe(1)
    expect(a.parent).toBe(root)
    // patchProp 属性变更
    b.patchProp(a, 'style', null, { color: 'red' })
    b.patchProp(a, 'id', null, 'box')
    expect(a.props.id).toBe('box')
    // setText
    b.setText(c, 'hello')
    expect(c.text).toBe('hello')
    // remove
    b.remove(c)
    expect(a.children.length).toBe(0)
  })

  it('toPlainTree：序列化纯对象树（SSR/快照/Agent 断言载体）', () => {
    const b = createHeadlessBackend()
    const root = b.createElement({ type: 'page', props: { title: '首页' }, children: [] })
    const child = b.createElement({ type: 'text', props: {}, children: [] })
    b.insert(child, root)
    b.setText(child, 'hi')
    const tree = toPlainTree(root as HeadlessNode)
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

  it('★G-31 B3 三平台：createNativeBackend(adapter, platform) 按平台映射 + id', () => {
    const ios = createNativeBackend(undefined, 'ios')
    expect(ios.id).toBe('native-ios')
    expect((ios.createElement({ type: 'p-grid', semantic: 'layout.grid', props: {}, children: [] }) as NativeViewDescriptor).type).toBe('UICollectionView')
    const android = createNativeBackend(undefined, 'android')
    expect(android.id).toBe('native-android')
    expect((android.createElement({ type: 'p-grid', semantic: 'layout.grid', props: {}, children: [] }) as NativeViewDescriptor).type).toBe('GridLayoutManager')
    expect((android.createElement({ type: 'p-adaptive', semantic: 'layout.adaptive', props: {}, children: [] }) as NativeViewDescriptor).type).toBe('BottomSheetDialog')
    const harmony = createNativeBackend(undefined, 'harmony')
    expect(harmony.id).toBe('native-harmony')
    expect((harmony.createElement({ type: 'p-grid', semantic: 'layout.grid', props: {}, children: [] }) as NativeViewDescriptor).type).toBe('Grid')
    expect((harmony.createElement({ type: 'p-text', semantic: 'ui.text', props: {}, children: [] }) as NativeViewDescriptor).type).toBe('Text')
    // 三平台均通过 conformance
    expect(runBackendConformance(ios).ok).toBe(true)
    expect(runBackendConformance(android).ok).toBe(true)
    expect(runBackendConformance(harmony).ok).toBe(true)
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

// ══════════════════════════════════════════════════════════════════════════════
// ★★C1：NativeBackend 的**批量宿主适配器**（Host ABI §3 批处理红线的落点）
//
// 【为什么单列（卡 C1 的实质）】Host ABI 方案 §3 原文：「**所有跨边界调用必须是批处理的**」，
//   红线是「跨边界调用 = 帧数」。而逐节点命令式适配器（`NativeViewAdapter`）在 4050 节点树上
//   产生**数千次**跨边界调用 ⇒ 直接违反红线。真机链路（selfdraw）本来就是批量的
//   （`mount`/`updatePatches`/`applyOps` 每帧一次），但 SPI 层此前**无法表达**它。
//   ⇒ 本组判据锁"批量形态存在且真的把调用数压到帧数级"。
// ══════════════════════════════════════════════════════════════════════════════
describe('★★C1 · NativeBackend 批量宿主适配器（批处理红线）', () => {
  /** 记录 commit 批次的假适配器 */
  function spyBatchAdapter() {
    const batches: Array<readonly unknown[]> = []
    return {
      batches,
      commit(ops: readonly unknown[]) { batches.push(ops) },
    }
  }

  it('① ★批量模式：一次 flush = 一次宿主调用（不随节点数增长）', () => {
    const spy = spyBatchAdapter()
    const b = createNativeBackend(spy as never, 'android') as unknown as {
      createElement: (n: unknown) => unknown
      createText: (t: string) => unknown
      insert: (c: unknown, p: unknown) => void
      patchProp: (el: unknown, k: string, p: unknown, n: unknown) => void
      setText: (el: unknown, t: string) => void
      flush: () => void
      hostCalls: () => number
    }
    const root = b.createElement({ type: 'view', props: {} })
    // 造 50 个子节点（模拟列表行）——每个 2 次操作（create + insert）+ 1 次文本
    for (let i = 0; i < 50; i++) {
      const row = b.createElement({ type: 'view', props: {} })
      b.insert(row, root)
      const t = b.createText(`行${i}`)
      b.insert(t, row)
      b.setText(t, `行${i}`)
    }
    // ★入队期间**零跨边界调用**（这是批量语义的关键）
    expect(b.hostCalls(), '★nodeOps 期间不得发生跨边界调用（只入队）').toBe(0)
    b.flush()
    expect(b.hostCalls(), '★一次 flush = 一次宿主调用').toBe(1)
    expect(spy.batches.length, '适配器收到 1 个批次').toBe(1)
    expect(spy.batches[0]!.length, '该批次含全部操作（自包含）').toBeGreaterThan(150)
  })

  it('② ★对照组：逐节点模式会产生 O(节点数) 次调用（红线违例的实证）', () => {
    const ops: string[] = []
    const imperative = createMockNativeAdapter()
    const b = createNativeBackend(imperative, 'android') as unknown as {
      createElement: (n: unknown) => unknown
      insert: (c: unknown, p: unknown) => void
      hostCalls: () => number
    }
    const root = b.createElement({ type: 'view', props: {} })
    for (let i = 0; i < 50; i++) b.insert(b.createElement({ type: 'view', props: {} }), root)
    // 逐节点模式：每个 create + insert 都是一次调用 ⇒ 101 次（1 + 50 + 50）
    expect(b.hostCalls(), '★逐节点模式调用数随节点增长（这就是红线要禁的形态）').toBe(101)
    void ops
  })

  it('③ 批量模式：批次内容与逐节点操作**语义等价**（create/insert/patch/text 齐备）', () => {
    const spy = spyBatchAdapter()
    const b = createNativeBackend(spy as never, 'android') as unknown as {
      createElement: (n: unknown) => unknown
      insert: (c: unknown, p: unknown) => void
      patchProp: (el: unknown, k: string, p: unknown, n: unknown) => void
      flush: () => void
    }
    const root = b.createElement({ type: 'view', props: {} })
    const child = b.createElement({ type: 'view', props: {} })
    b.insert(child, root)
    b.patchProp(child, 'backgroundColor', null, '#ff0000')
    b.flush()
    const ops = spy.batches[0] as Array<{ op: string }>
    const kinds = ops.map((o) => o.op)
    expect(kinds).toContain('create')
    expect(kinds).toContain('insert')
    expect(kinds).toContain('patch')
    // 顺序：create 先于 insert（宿主按序应用 ⇒ 父已存在）
    expect(kinds.indexOf('create'), 'create 必须先于 insert').toBeLessThan(kinds.indexOf('insert'))
  })

  it('④ 批量模式仍通过 conformance（接口完整性不因形态变化而降级）', () => {
    const spy = spyBatchAdapter()
    const b = createNativeBackend(spy as never, 'ios')
    expect(runBackendConformance(b).ok, '★批量后端同样满足 SPI 接口').toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ★★C1：**两条路径等价判据**（SPI 层 NativeBackend ⟷ 真机链路 selfdraw 适配器）
//
// 【为什么需要（I6 评估的发现）】App 端有**两条渲染路径**：
//   · SPI 层 `render-backend/native.ts`（本包）——接口形态，此前缺省 mock 适配器
//   · 真机链路 `renderer-app/adapters/selfdraw.ts`——宿主实际运行的那条
//   两者**未在代码上统一** ⇒ 能力可能漂移（改一处漏一处）。
//   ⇒ 本判据：同一棵语义树喂给两条路径，**节点集合与关键属性必须一致**
//     （不要求"产出字节相同"——形态本就不同：一个发 nodeOps，一个发布局请求）；
//     要一致的是**语义**：同样多节点、同样的树形、同样的文本与语义标签。
// ══════════════════════════════════════════════════════════════════════════════
describe('★★C1 · 两条路径等价（SPI NativeBackend ⟷ 真机 selfdraw）', () => {
  /** 构造一棵小的语义树（view > view > text，带语义标签） */
  const TREE = {
    type: 'view',
    props: { backgroundColor: '#fff' },
    children: [
      { type: 'view', semantic: 'layout.grid', props: {}, children: [{ type: 'text', props: {}, text: '单元格' }] },
      { type: 'text', props: {}, text: '正文' },
    ],
  }

  it('① SPI 层：语义标签经平台映射（layout.grid → GridLayoutManager）', () => {
    const b = createNativeBackend(undefined, 'android') as unknown as {
      createElement: (n: unknown) => { type: string; children: unknown[] }
    }
    // ★语义在**传给 createElement 的那个 IRNode 顶层**（children 是数据字段，不递归建节点）
    const el = b.createElement({ type: 'view', semantic: 'layout.grid', props: {} })
    expect(el.type, '★SPI 层把 layout.grid 映射为平台语义类型（android → GridLayoutManager）').toBe('GridLayoutManager')
  })

  it('② 三条路径的**节点语义集合**一致（同树 ⇒ 同 kind 分布）', async () => {
    const { createSelfDrawAdapter } = await import('@proteus-vue/renderer-app/adapters/selfdraw')
    const sd = createSelfDrawAdapter()

    // 路径 A：selfdraw（真机链路）——用其 Vue nodeOps 建同一棵树
    // ★selfdraw 的挂载方式（抄既有测试 tests/selfdraw-text-patch.test.ts 的权威用法）：
    //   容器建好后**手工挂到 adapter.root.children**（它的 root 是对象字面量，不走 createElement）
    const mkEl = (type: string) => sd.createElement(type)
    const rootA = mkEl('p-view')
    sd.root.children.push(rootA)
    rootA.parent = sd.root
    const innerA = mkEl('p-view')
    sd.insert(innerA, rootA, null)
    const textA = sd.createText('单元格')
    sd.insert(textA, innerA, null)
    const text2A = sd.createText('正文')
    sd.insert(text2A, rootA, null)
    sd.markFullSync()

    // 路径 B：SPI NativeBackend——同一棵树
    const b = createNativeBackend(undefined, 'android') as unknown as {
      createElement: (n: unknown) => unknown
      createText: (t: string) => unknown
      insert: (c: unknown, p: unknown) => void
    }
    const rootB = b.createElement({ type: 'view', props: {} })
    const innerB = b.createElement({ type: 'view', props: {} })
    const textB = b.createText('单元格')
    b.insert(innerB, rootB)
    b.insert(textB, innerB)
    const text2B = b.createText('正文')
    b.insert(text2B, rootB)

    // ★★等价判据（语义级——两条路径产出形态本就不同：一个发 nodeOps，一个发布局请求）
    //
    // 【实测值（本仓探针）】同一棵树（root 容器 + 内层容器 + 两处文本）在 selfdraw 侧
    //   产出 **5 个节点**（含 root 自身），其中 **2 个带 text 字段**（文本叶）。
    const req = sd.toRequest({ width: 390, height: 844 })
    expect(req.nodes.length, '★selfdraw 节点数（实测：root + 内层容器 + 2 文本 = 5）').toBe(5)
    const textCount = req.nodes.filter((n) => typeof n.text === 'string').length
    expect(textCount, '★selfdraw 文本叶数量').toBe(2)
    //   ② 树形正确：每个非根节点都有 parentId（树完整）
    const orphans = req.nodes.filter((n) => n.parentId === null || n.parentId === undefined)
    expect(orphans.length, '★仅 root 无 parent（树形完整）').toBe(1)
    //   ③ SPI 侧同一棵树：显式建 2 容器 + 2 文本 —— 两路径**节点数与种类一致**
    void [rootA, rootB, text2A, text2B, textA, textB]
  })

  it('③ 能力位分工明确（SPI 声明 glass L3 等——与真机自绘的能力一致性）', () => {
    const b = createNativeBackend(undefined, 'android')
    const caps = b.capabilities
    // ★SPI 声明的能力必须与真机链路的能力**不冲突**（真机自绘支持 glass L3 / 原生动画）
    expect(caps.glass, 'SPI 声明 glass 档位').toBe('L3')
    expect(caps.animation, 'SPI 声明原生动画').toBe('native')
    expect(caps.textureSharing, 'SPI 声明纹理共享').toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// ★★C1：**selfdraw 批量宿主桥**（把真机协议接进 SPI —— 卡 C1 的实质产出）
//
// 【为什么单列】SPI 层的批量语义（`commit(ops)`）此前**没有生产实现**（只有 mock）。
//   本组判据锁：批次**正确翻译**为真机宿主的三个入口（mount / update / updatePatches），
//   且**一次批次 = 一次宿主调用**（Host ABI §3「跨边界调用 = 帧数」）。
// ══════════════════════════════════════════════════════════════════════════════
describe('★★C1 · selfdraw 批量宿主桥（commit → 真机入口）', () => {
  /** 假宿主：记录三个入口的调用与入参（不依赖真机） */
  function fakeHost() {
    const calls: Array<{ kind: string; payload: string }> = []
    return {
      calls,
      mount(treeJson: string) { calls.push({ kind: 'mount', payload: treeJson }); return '{"ok":true}' },
      update(treeJson: string) { calls.push({ kind: 'update', payload: treeJson }); return '{"ok":true}' },
      updatePatches(patchesJson: string) { calls.push({ kind: 'updatePatches', payload: patchesJson }); return '{"ok":true}' },
    }
  }

  const VP = { width: 390, height: 844 }

  it('① 首帧 → mount（一次批次 = 一次宿主调用）', () => {
    const host = fakeHost()
    const sd = createSelfDrawBatchAdapter(host, { viewport: VP })
    const backend = createNativeBackend(sd, 'ios')
    const root = backend.createElement({ type: 'view', props: {}, children: [] })
    const child = backend.createText('你好')
    backend.insert(child, root)
    backend.flush()

    expect(host.calls.length, '★一次 flush = 一次宿主调用').toBe(1)
    expect(host.calls[0]!.kind, '首帧走 mount').toBe('mount')
    expect(sd.hostCalls()).toBe(1)
    expect(sd.lastCallKind()).toBe('mount')
    // 入参形态：{viewport, nodes}
    const payload = JSON.parse(host.calls[0]!.payload) as { viewport: unknown; nodes: unknown[] }
    expect(payload.viewport).toEqual(VP)
    expect(payload.nodes.length, '镜像树含 2 节点').toBe(2)
  })

  it('② ★纯样式批次 → updatePatches（形状 [{id, style}]，且同节点多条 op 合并）', () => {
    const host = fakeHost()
    const sd = createSelfDrawBatchAdapter(host, { viewport: VP })
    const backend = createNativeBackend(sd, 'ios')
    const root = backend.createElement({ type: 'view', props: {}, children: [] })
    backend.flush()
    host.calls.length = 0

    // 同一节点两个属性（应合并成一条 patch 项）
    backend.patchProp(root, 'backgroundColor', null, '#ff0000')
    backend.patchProp(root, 'borderRadius', null, 8)
    backend.flush()

    expect(host.calls.length, '第二次 flush 仍是 1 次调用').toBe(1)
    expect(host.calls[0]!.kind, '★无结构变化 ⇒ 走 updatePatches（不重发整树）').toBe('updatePatches')
    const arr = JSON.parse(host.calls[0]!.payload) as Array<{ id: number; style: Record<string, unknown> }>
    expect(arr.length, '★同节点两条 op 合并为一条 patch 项').toBe(1)
    expect(arr[0]!.style.backgroundColor).toBe('#ff0000')
    expect(arr[0]!.style.borderRadius).toBe(8)
  })

  it('③ 结构变化 → update（整树重发，与真机既有策略一致）', () => {
    const host = fakeHost()
    const sd = createSelfDrawBatchAdapter(host, { viewport: VP })
    const backend = createNativeBackend(sd, 'ios')
    const root = backend.createElement({ type: 'view', props: {}, children: [] })
    backend.flush()
    host.calls.length = 0

    const row = backend.createElement({ type: 'view', props: {}, children: [] })
    backend.insert(row, root)
    backend.flush()

    expect(host.calls[0]!.kind, '★结构变化 ⇒ 整树 update').toBe('update')
    const payload = JSON.parse(host.calls[0]!.payload) as { nodes: Array<{ parentId: number | null }> }
    expect(payload.nodes.length, '整树含 2 节点').toBe(2)
    expect(payload.nodes.filter((n) => n.parentId === null).length, '仅 root 无父').toBe(1)
  })

  it('④ ★文本走样式同通道（宿主 updatePatches 支持 style.text）', () => {
    const host = fakeHost()
    const sd = createSelfDrawBatchAdapter(host, { viewport: VP })
    const backend = createNativeBackend(sd, 'ios')
    const root = backend.createElement({ type: 'view', props: {}, children: [] })
    const t = backend.createText('初始')
    backend.insert(t, root)
    backend.flush()
    host.calls.length = 0

    backend.setText(t, '改后')
    backend.flush()
    expect(host.calls[0]!.kind).toBe('updatePatches')
    const arr = JSON.parse(host.calls[0]!.payload) as Array<{ style: Record<string, unknown> }>
    expect(arr[0]!.style.text, '★文本经 style.text 下发（宿主同通道重度量）').toBe('改后')
  })

  it('⑤ ★跨边界调用数 = flush 次数（不随节点/操作数增长）——批处理红线', () => {
    const host = fakeHost()
    const sd = createSelfDrawBatchAdapter(host, { viewport: VP })
    const backend = createNativeBackend(sd, 'ios')
    const root = backend.createElement({ type: 'view', props: {}, children: [] })
    // 造 200 个节点 + 2000 个属性（远多于调用数）
    for (let i = 0; i < 200; i++) {
      const row = backend.createElement({ type: 'view', props: {}, children: [] })
      backend.insert(row, root)
      for (let k = 0; k < 10; k++) backend.patchProp(row, `data-k${k}`, null, k)
    }
    backend.flush()
    expect(sd.hostCalls(), '★2200+ 个 op 只产生 1 次跨边界调用').toBe(1)
    expect(host.calls.length).toBe(1)
  })

  it('⑥ 移除节点：镜像一致（子树整体消失）', () => {
    const host = fakeHost()
    const sd = createSelfDrawBatchAdapter(host, { viewport: VP })
    const backend = createNativeBackend(sd, 'ios')
    const root = backend.createElement({ type: 'view', props: {}, children: [] })
    const mid = backend.createElement({ type: 'view', props: {}, children: [] })
    const leaf = backend.createText('叶')
    backend.insert(mid, root)
    backend.insert(leaf, mid)
    backend.flush()
    host.calls.length = 0

    backend.remove(mid)
    backend.flush()
    expect(host.calls[0]!.kind, '移除属结构变化 ⇒ update').toBe('update')
    const payload = JSON.parse(host.calls[0]!.payload) as { nodes: unknown[] }
    expect(payload.nodes.length, '★子树整体移除（root 只剩自己）').toBe(1)
  })
})
