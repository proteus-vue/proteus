// tests/render-backend.test.ts
// ★G-27（render-backend-1-plan M1.4 B1+B2）：ProteusRenderBackend SPI + conformance + 官方后端原型
//   B1 验收（05-batches §单测）：createElement 唯一句柄 / insert·remove 父子正确 / patchProp 属性变更 /
//   能力声明合法；conformance 能验证假后端接口完整性（M1 退出标准 3）
// @vitest-environment happy-dom（VueDomBackend DOM 断言）
import { describe, it, expect } from 'vitest'
import {
  createHeadlessBackend,
  createVueDomBackend,
  runBackendConformance,
  toPlainTree,
} from '@proteus-vue/render-backend'
import type { ProteusRenderBackend } from '@proteus-vue/render-backend'

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
