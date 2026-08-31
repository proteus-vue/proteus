// tests/renderer-app.test.ts
// ★app-plan B1：App 渲染器核心——Vue createRenderer + NativeAdapter mock 接线（渲染/更新/卸载/事件属性）
import { describe, it, expect } from 'vitest'
import { h, ref, nextTick } from 'vue'
import { createAppRenderer, createMockAdapter } from '@proteus-vue/renderer-app'
import type { NativeElementNode } from '@proteus-vue/renderer-app'

/** 取元素子节点中第一个文本内容（h('text', null, 'x') → text 元素 → 文本子节点） */
function firstText(el: NativeElementNode): string {
  const child = el.children[0] as NativeElementNode
  return (child.children[0] as { text?: string }).text ?? ''
}

describe('createAppRenderer 挂载（B1 核心）', () => {
  it('渲染组件 → mock 原生树结构正确（view/text 嵌套 + props 应用）', async () => {
    const adapter = createMockAdapter()
    const renderer = createAppRenderer(adapter)
    const app = renderer.createApp({
      render: () => h('view', { class: 'box' }, [h('text', null, 'hello')]),
    })
    app.mount(adapter.root)
    await nextTick()
    const view = adapter.root.children[0] as NativeElementNode
    expect(view.tag).toBe('view')
    expect(view.props.class).toBe('box')
    expect(view.children[0].__kind === 'element' && (view.children[0] as NativeElementNode).tag).toBe('text')
    expect(firstText(view)).toBe('hello')
    app.unmount()
  })

  it('响应式更新：ref 变更 → 文本正确 patch', async () => {
    const adapter = createMockAdapter()
    const renderer = createAppRenderer(adapter)
    const count = ref(0)
    const app = renderer.createApp({
      render: () => h('text', null, String(count.value)),
    })
    app.mount(adapter.root)
    await nextTick()
    expect(firstText(adapter.root)).toBe('0')
    count.value = 42
    await nextTick()
    expect(firstText(adapter.root)).toBe('42')
    app.unmount()
  })

  it('事件属性经 patchProp 记录（onClick → 原生手势桥契约）', async () => {
    const adapter = createMockAdapter()
    const renderer = createAppRenderer(adapter)
    const handler = () => {}
    const app = renderer.createApp({
      render: () => h('view', { onClick: handler }, 'x'),
    })
    app.mount(adapter.root)
    await nextTick()
    const view = adapter.root.children[0] as NativeElementNode
    expect(view.props.onClick).toBe(handler)
    expect(adapter.ops.some((o) => o === 'patchProp:onClick')).toBe(true)
    app.unmount()
  })

  it('卸载 → 节点 remove 调用（树清空）', async () => {
    const adapter = createMockAdapter()
    const renderer = createAppRenderer(adapter)
    const app = renderer.createApp({
      render: () => h('view', null, [h('text', null, 'a'), h('text', null, 'b')]),
    })
    app.mount(adapter.root)
    await nextTick()
    expect(adapter.root.children.length).toBeGreaterThan(0)
    app.unmount()
    await nextTick()
    expect(adapter.root.children.length).toBe(0)
    expect(adapter.ops.some((o) => o.startsWith('remove:'))).toBe(true)
  })

  it('v-if 条件渲染：节点文本随条件切换', async () => {
    const adapter = createMockAdapter()
    const renderer = createAppRenderer(adapter)
    const show = ref(true)
    const app = renderer.createApp({
      render: () => (show.value ? h('text', null, 'on') : h('text', null, 'off')),
    })
    app.mount(adapter.root)
    await nextTick()
    expect(firstText(adapter.root)).toBe('on')
    show.value = false
    await nextTick()
    expect(firstText(adapter.root)).toBe('off')
    app.unmount()
  })
})
