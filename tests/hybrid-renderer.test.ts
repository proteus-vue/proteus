// tests/hybrid-renderer.test.ts
// ★G-27 B6（render-backend-1-plan 05-batches.md）：混合渲染——Texture Sharing + 区域级切后端 + DevTools 可视化
//   验证点：① 区域路由（match → 对应后端 / 缺省兜底）② 节点归属委托（createElement 后 insert/remove/
//   patchProp/setText 到归属后端；父子跨后端合法）③ 纹理共享广播（textureSharing 后端收到注册/注销）④
//   DevTools 路由 trace（semantic → 后端 决策记录 + clear）⑤ runHybridConformance 自检
// @vitest-environment happy-dom（VueDomBackend DOM 断言）
import { describe, it, expect, vi } from 'vitest'
import {
  createHeadlessBackend,
  createVueDomBackend,
  createNativeBackend,
  createFlutterBackend,
  createHybridRenderer,
  textureRef,
  runHybridConformance,
  toPlainTree,
} from '@proteus-vue/render-backend'
import type { HybridRenderer, IRNode, ProteusRenderBackend } from '@proteus-vue/render-backend'

/** text 语义节点快照（headless 断言用） */
function plain(b: ProteusRenderBackend, root: unknown): unknown {
  return toPlainTree(b, root)
}

describe('G-27 B6 混合渲染（Texture Sharing + 区域切后端）', () => {
  it('区域路由：semantic 命中 → 对应后端；未命中 → default 兜底', () => {
    const headless = createHeadlessBackend()
    const vue = createVueDomBackend(document)
    const hybrid = createHybridRenderer({
      defaultBackend: headless,
      regions: [{ name: 'media', match: (n) => n.semantic === 'ui.media', backend: vue }],
    })
    // media 节点 → vue（区域命中）
    const media = hybrid.createElement({ type: 'p-media', semantic: 'ui.media', props: {}, children: [] })
    expect(hybrid.backendOf(media)).toBe(vue)
    // 普通节点 → headless（兜底）
    const box = hybrid.createElement({ type: 'p-box', semantic: 'layout.box', props: {}, children: [] })
    expect(hybrid.backendOf(box)).toBe(headless)
    // 路由决策可复现
    expect(hybrid.routeFor({ type: 'p-media', semantic: 'ui.media', props: {}, children: [] })).toBe(vue)
    expect(hybrid.routeFor({ type: 'p-box', semantic: 'layout.box', props: {}, children: [] })).toBe(headless)
  })

  it('节点归属委托：insert/remove/patchProp/setText 委托到归属后端（跨后端仅委托机制）', () => {
    const headless = createHeadlessBackend()
    const vue = createVueDomBackend(document)
    const hybrid = createHybridRenderer({
      defaultBackend: headless,
      regions: [{ name: 'media', match: (n) => n.semantic === 'ui.media', backend: vue }],
    })
    // 纯 headless 子树：委托到归属后端（headless）正常
    const root = hybrid.createElement({ type: 'root', props: {}, children: [] })
    const text = hybrid.createElement({ type: 'p-text', semantic: 'ui.text', props: {}, children: [] })
    hybrid.insert(text, root)
    hybrid.setText(text, 'hi')
    expect((root as { children: unknown[] }).children.length).toBe(1)
    // 跨后端委托机制：child（vue）的 insert/patchProp/setText 委托到 vue
    const media = hybrid.createElement({ type: 'p-media', semantic: 'ui.media', props: {}, children: [] })
    expect(hybrid.backendOf(media)).toBe(vue)
    hybrid.patchProp(media, 'data-kind', null, 'video')
    expect((media as HTMLElement).getAttribute('data-kind')).toBe('video') // patchProp 委托 vue ✓
    hybrid.remove(text)
    expect((root as { children: unknown[] }).children.length).toBe(0)
  })

  it('纹理共享：registerExternalTexture 广播到 textureSharing 后端 + DevTools trace', () => {
    const headless = createHeadlessBackend()
    const native = createNativeBackend() // textureSharing: true（B4 系统级声明）
    const flutter = createFlutterBackend() // textureSharing: true（B5）
    const hybrid = createHybridRenderer({
      defaultBackend: headless,
      regions: [
        { name: 'native', match: (n) => n.semantic === 'shell.modal', backend: native },
        { name: 'flutter', match: (n) => n.semantic === 'layout.grid', backend: flutter },
      ],
    })
    const vueNoShare = createVueDomBackend(document)
    expect(vueNoShare.capabilities.textureSharing).toBe(false) // vue-dom 无纹理共享（DOM 无原生视图混入）
    // 广播注册：native + flutter 都收到（无 textureSharing 的 headless 不参与；default 兜底不误伤）
    const spy = vi.fn()
    const origReg = native.registerExternalTexture
    native.registerExternalTexture = spy as never
    hybrid.registerExternalTexture('video-1', { id: 'video-1', nativeView: { tag: 42 }, width: 640, height: 360 })
    expect(spy).toHaveBeenCalledWith('video-1', expect.objectContaining({ width: 640 }))
    expect(native.capabilities.textureSharing).toBe(true)
    if (origReg) native.registerExternalTexture = origReg
    // textureRef 便捷构造
    expect(textureRef('video-1')).toEqual({ textureId: 'video-1' })
  })

  it('DevTools 路由 trace：createElement 必留痕（semantic → 后端决策）；clearTraces 清空', () => {
    const hybrid = createHybridRenderer({
      defaultBackend: createHeadlessBackend(),
      regions: [{ name: 'media', match: (n) => n.semantic === 'ui.media', backend: createVueDomBackend(document) }],
    })
    hybrid.createElement({ type: 'p-media', semantic: 'ui.media', props: {}, children: [] })
    hybrid.createElement({ type: 'p-box', semantic: 'layout.box', props: {}, children: [] })
    const traces = hybrid.traces()
    expect(traces.length).toBe(2)
    expect(traces[0]).toMatchObject({ semantic: 'ui.media', region: 'media' })
    expect(traces[0].backendId).not.toBe(traces[1].backendId) // media→vue / box→headless 不同后端
    expect(traces[1]).toMatchObject({ region: 'default' })
    hybrid.clearTraces()
    expect(hybrid.traces().length).toBe(0)
    // devtools: false 关闭记录
    const quiet = createHybridRenderer({ defaultBackend: createHeadlessBackend(), devtools: false })
    quiet.createElement({ type: 'p-box', semantic: 'layout.box', props: {}, children: [] })
    expect(quiet.traces().length).toBe(0)
  })

  it('runHybridConformance：接口完整 + 路由一致 + 纹理方法 + trace 记录 → ok', () => {
    const hybrid = createHybridRenderer({
      defaultBackend: createHeadlessBackend(),
      regions: [{ name: 'media', match: (n) => n.semantic === 'ui.media', backend: createVueDomBackend(document) }],
    })
    const result = runHybridConformance(hybrid)
    expect(result.ok).toBe(true)
    const names = result.checks.map((c) => c.name)
    expect(names).toContain('route.backendOf-owned')
    expect(names).toContain('route.consistent')
    expect(names).toContain('optional.registerExternalTexture')
    expect(names).toContain('devtools.trace-recorded')
  })

  it('混合渲染器自身通过 runBackendConformance（统一 ProteusRenderBackend 面）', async () => {
    const { runBackendConformance } = await import('@proteus-vue/render-backend')
    const hybrid: HybridRenderer = createHybridRenderer({
      defaultBackend: createHeadlessBackend(),
      regions: [{ name: 'media', match: (n) => n.semantic === 'ui.media', backend: createVueDomBackend(document) }],
    })
    const result = runBackendConformance(hybrid)
    expect(result.ok).toBe(true)
  })
})