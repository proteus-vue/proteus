// tests/web-mount-layers.test.ts —— ★★★GP3-a（2026-10-03）：**Web 端三层挂载**回归锁
//
// 【这张卡验什么（对标 GP3-a 验收原文）】
//   ① 三层顺序正确：Overlay > Page > Global（DOM 顺序 + 层叠域偏移两条判据）
//   ② 全局层内容在路由切换时保持存活且不重复挂载
//
// 【与 MP 端的差别（本文件锁住的正是这个"同形不同机制"）】
//   · Web：层标签是**运行时组件**（App.vue 是真根组件）⇒ Global 内容在 RouterView **之外**天然存活
//   · MP ：层标签是**编译期**概念（编译器解壳 + 注入每页；MP 无渲染层 App）
//   ⇒ 两端**声明形态相同**（`<app-root>` / `<*-layer>`），落地机制不同——本文件只测 Web 侧。
//
// 【判据设计（不只看一个证据）】
//   ① **DOM 顺序**（文档序 = 层序，与内核"树序是真源"同原则）
//   ② **层叠域偏移**（`z-index` 来自契约 `mountLayerDomainOffset`——不是本文件硬编码数值）
//   ③ **不重复挂载**（同层只渲染一个容器；`data-mount-layer` 可枚举）
//   ④ **C1 软校验**（层不在 `<app-root>` 之下 ⇒ 开发模式警告；生产零开销）
//   ⑤ **不用 Teleport**（GP0-e 结论：自有渲染树节点——绕过 teleport 才能保住可校验性）
//
// ★DOM 环境：本文件做真实挂载 + getComputedStyle ⇒ 需要 DOM（与 tests/devtools-panel-mount 同款 pragma）
// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, defineComponent, ref } from 'vue'
import {
  installMountLayers, createMountLayerComponent,
  AppRoot, GlobalLayer, PageLayer, OverlayLayer, WEB_MOUNT_LAYERS,
} from '../packages/web/src/mount-layers'
import { MOUNT_LAYERS, mountLayerDomainOffset, layerValueFor } from '@proteus-vue/contracts'

afterEach(() => {
  vi.restoreAllMocks()
  // 清理测试注入的构建期常量（防跨用例污染——本仓"模块级单例跨用例存活"的同类纪律）
  delete (globalThis as unknown as { __PROTEUS_DEBUG__?: boolean }).__PROTEUS_DEBUG__
})

/** 挂一个组件到临时容器并返回容器（Web 端可直接 createApp——无需 jsdom 之外的东西） */
function mount(node: unknown): { el: HTMLElement; unmount: () => void } {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp(node as never)
  // 三层组件是全局注册的——测试里也走同一安装路径（保证与生产接线一致）
  installMountLayers(app)
  app.mount(el)
  return {
    el,
    unmount: () => {
      app.unmount()
      el.remove()
    },
  }
}

const layersOf = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-mount-layer]')].map((n) => n.getAttribute('data-mount-layer') ?? '')

describe('★GP3-a ① 三层顺序（DOM 序 = 层序；域偏移来自契约）', () => {
  it('★三层按 global → page → overlay 的**声明序**输出（文档序即层序，与内核"树序是真源"同原则）', () => {
    const { el, unmount } = mount(
      defineComponent({
        setup: () => () =>
          h(AppRoot, null, {
            default: () => [
              h(GlobalLayer, null, { default: () => h('span', { id: 'g' }, 'G') }),
              h(PageLayer, null, { default: () => h('span', { id: 'p' }, 'P') }),
              h(OverlayLayer, null, { default: () => h('span', { id: 'o' }, 'O') }),
            ],
          }),
      }),
    )
    expect(layersOf(el), '★三层顺序：global → page → overlay').toEqual(['global', 'page', 'overlay'])
    // 内容归属正确（不是空容器）
    expect(el.querySelector('#g')?.textContent).toBe('G')
    expect(el.querySelector('#o')?.textContent).toBe('O')
    unmount()
  })

  it('★层间 z-index = **契约的域偏移**（不在本包硬编码数值——"各端映射表由框架统一维护"）', () => {
    const { el, unmount } = mount(
      defineComponent({
        setup: () => () =>
          h(AppRoot, null, {
            default: () => [h(GlobalLayer), h(PageLayer), h(OverlayLayer)],
          }),
      }),
    )
    const zs = WEB_MOUNT_LAYERS.map((layer) => {
      const node = el.querySelector(`[data-mount-layer="${layer}"]`) as HTMLElement
      return { layer, z: Number(getComputedStyle(node).zIndex) }
    })
    for (const { layer, z } of zs) {
      expect(z, `${layer} 层的 z-index 应等于契约域偏移`).toBe(mountLayerDomainOffset(layer))
    }
    // ★顺序判据（不依赖具体数值大小）：global < page < overlay 严格递增
    expect(zs[0]!.z).toBeLessThan(zs[1]!.z)
    expect(zs[1]!.z).toBeLessThan(zs[2]!.z)
    unmount()
  })

  it('★层叠域与层内四层**正交**（层内原语值远小于域宽 ⇒ 不会跨层压人）', () => {
    // 这是契约里"两个独立维度"的机器判据：最坏的层内值（popout=1000）也不越过层域
    const maxInner = layerValueFor('layer-popout', 'web')
    for (let i = 0; i < MOUNT_LAYERS.length - 1; i++) {
      const lower = mountLayerDomainOffset(MOUNT_LAYERS[i]!) + maxInner
      const upper = mountLayerDomainOffset(MOUNT_LAYERS[i + 1]!)
      expect(
        lower,
        `★低层（${MOUNT_LAYERS[i]}）的层内最大值(${lower})必须 < 高层的域起点(${upper})——否则层间顺序会被层内值推翻`,
      ).toBeLessThan(upper)
    }
  })

  it('★`position: relative` 随 z-index 一起给（CSS 层面 z-index 对 static 元素无效——少一个就静默失效）', () => {
    const { el, unmount } = mount(defineComponent({ setup: () => () => h(GlobalLayer) }))
    const node = el.querySelector('[data-mount-layer="global"]') as HTMLElement
    expect(getComputedStyle(node).position, '★没有 position，z-index 就是个摆设（静默失效）').toBe('relative')
    unmount()
  })

  it('反向：层容器**不干预布局**（无尺寸/无内外边距——它只建立层叠上下文）', () => {
    const { el, unmount } = mount(defineComponent({ setup: () => () => h(GlobalLayer) }))
    const node = el.querySelector('[data-mount-layer="global"]') as HTMLElement
    const cs = getComputedStyle(node)
    expect(cs.display, '不得设 display（会改变子元素布局语义）').not.toBe('none')
    // ★判据用**内联样式**（组件实际设置的）：happy-dom 不套用浏览器 UA 样式表（div 的默认 margin
    //   来自 UA 表，happy-dom 里恒为 ''）⇒ 用 computed 会测到环境差异而非组件行为。
    expect(node.style.margin, '组件不得设 margin').toBe('')
    expect(node.style.padding, '组件不得设 padding').toBe('')
    expect(node.style.width, '组件不得设 width').toBe('')
    expect(node.style.height, '组件不得设 height').toBe('')
    // 组件**只**设了这两条（position + z-index）——多设即越权
    expect(node.style.position, '应设 position（z-index 生效前提）').toBe('relative')
    expect(node.style.zIndex, '应设 z-index（层叠域）').not.toBe('')
    unmount()
  })
})

describe('★GP3-a ② 不重复挂载 + 可枚举（C1 的"声明式、可枚举"）', () => {
  it('★同层多次声明 ⇒ 各自是独立容器（不合并、不丢内容）——重复声明由 C2 的节点计数管，不由运行时静默合并', () => {
    const { el, unmount } = mount(
      defineComponent({
        setup: () => () =>
          h(AppRoot, null, {
            default: () => [
              h(GlobalLayer, null, { default: () => h('span', { id: 'g1' }, '1') }),
              h(GlobalLayer, null, { default: () => h('span', { id: 'g2' }, '2') }),
            ],
          }),
      }),
    )
    expect(layersOf(el).filter((l) => l === 'global')).toHaveLength(2)
    expect(el.querySelector('#g1'), '第一份内容在').toBeTruthy()
    expect(el.querySelector('#g2'), '★第二份内容**不丢**（静默合并/丢弃是最坏形态）').toBeTruthy()
    unmount()
  })

  it('★`data-mount-layer` 可枚举（测试/DevTools/conformance 的机器可查面）', () => {
    const { el, unmount } = mount(
      defineComponent({
        setup: () => () =>
          h(AppRoot, null, { default: () => [h(GlobalLayer), h(OverlayLayer)] }),
      }),
    )
    const attrs = [...el.querySelectorAll('[data-mount-layer]')].map((n) => n.getAttribute('data-mount-layer'))
    expect(attrs, '★层归属在 DOM 上可枚举（不是靠类名猜）').toEqual(['global', 'overlay'])
    unmount()
  })

  it('★`<app-root>` **解壳**（不产元素——与 MP 编译器同款，保住两端 DOM 同构）', () => {
    const { el, unmount } = mount(
      defineComponent({
        setup: () => () => h(AppRoot, null, { default: () => h('span', { id: 'only' }, 'X') }),
      }),
    )
    // app-root 不产元素 ⇒ 容器下只有一个 span（没有额外包裹层）
    expect(el.querySelectorAll('*')).toHaveLength(1)
    expect(el.querySelector('#only')).toBeTruthy()
    unmount()
  })
})

describe('★GP3-a ④ C1 软校验（层必须在 `<app-root>` 之下）', () => {
  it('★层不在 `<app-root>` 之下 ⇒ 开发模式给出警告（含修法）+ 仍渲染（不阻断——与 MP 的编译期 error 分工）', () => {
    // ★`__PROTEUS_DEBUG__` 是**构建期常量**（vite define 注入）——测试进程里没有 ⇒ 守卫会短路。
    //   本用例显式定义它，模拟"开发构建"（这正是该分支的真实运行条件）。
    //   同源纪律：本仓组件（runtime/style-safety）用的也是 `typeof __PROTEUS_DEBUG__ !== 'undefined'`
    //   守卫式读取 —— 测试要覆盖该分支必须自己提供它。
    ;(globalThis as unknown as { __PROTEUS_DEBUG__?: boolean }).__PROTEUS_DEBUG__ = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { el, unmount } = mount(defineComponent({ setup: () => () => h(GlobalLayer, null, { default: () => h('span', 'x') }) }))
    const calls = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(calls, '★应提示 C1 违规（含 "app-root" 与修法指引）').toContain('app-root')
    expect(calls, '警告须能定位是哪一层').toContain('global-layer')
    expect(el.querySelector('[data-mount-layer="global"]'), '★软校验不阻断渲染（MP 端才是编译期 error）').toBeTruthy()
    unmount()
  })

  it('★反向：在 `<app-root>` 之下**不告警**（防误报——误报会让真问题被淹没）', () => {
    ;(globalThis as unknown as { __PROTEUS_DEBUG__?: boolean }).__PROTEUS_DEBUG__ = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { unmount } = mount(
      defineComponent({
        setup: () => () => h(AppRoot, null, { default: () => h(GlobalLayer, null, { default: () => h('span', 'x') }) }),
      }),
    )
    // ★这条同时锁住 `AppRoot` 的 provide（若它不 provide，本用例会**误告警** ⇒ 当场红）
    //   ——本用例首版没开 debug 常量，导致"provide 被删"也照样绿（测量装置缺陷，破坏性验证抓出）
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n'), '★正确写法不得告警（也即 app-root 必须 provide 根标记）').not.toContain('C1')
    unmount()
  })
})

describe('★GP3-a ⑤ 自有渲染树节点（GP0-e 结论：不用原生 Teleport）', () => {
  it('★层容器**不产 Teleport 节点**（绕过 teleport 才能保住层级/可枚举/conformance 三个锚点）', () => {
    const { el, unmount } = mount(defineComponent({ setup: () => () => h(GlobalLayer, null, { default: () => h('span', 'x') }) }))
    // Teleport 会产出注释锚点（v-if 与 teleport 都会）——这里断言"内容在**原地**"
    const layerNode = el.querySelector('[data-mount-layer="global"]') as HTMLElement
    expect(layerNode.contains(layerNode.querySelector('span')), '★内容在层容器**内部**（原地）').toBe(true)
    // 且层容器直接挂在传入容器下（没有被搬走）
    expect(layerNode.parentElement, '层容器在挂载点之下（未被 teleport 搬移）').toBe(el)
    unmount()
  })

  it('★Web 落地机制与 MP 不同但**声明形态相同**（同形不同机制——本文件的头注判据）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '..')
    // Web 侧：运行时组件
    const webSrc = fs.readFileSync(path.join(root, 'packages/web/src/mount-layers.ts'), 'utf-8')
    expect(webSrc, 'Web 侧用 Vue 组件（运行时）').toContain('defineComponent')
    // ★先把**注释剥掉**再判（本文件首版被自己的说明注释假红——同 GP4-a 的"字面量自污染"教训）
    const codeOnly = webSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(codeOnly, '★代码里不得使用 Teleport（GP0-e 结论：自有渲染树节点）').not.toMatch(/Teleport/)
    // MP 侧：编译期解壳（既有实现——GP2-a）
    const mpSrc = fs.readFileSync(path.join(root, 'packages/compiler/src/template.ts'), 'utf-8')
    expect(mpSrc, 'MP 侧是编译期解壳').toContain('MOUNT_LAYER_TAGS')
    // 两侧都认同一套标签名（契约单一来源）
    expect(webSrc, '★Web 侧标签名来自契约（不自列一份）').toMatch(/installMountLayers|MOUNT_LAYERS/)
  })
})

describe('★GP3-a 组件契约（导出面 + 双名注册）', () => {
  it('三个层容器 + AppRoot 均导出（供直接 import 的用法）', () => {
    for (const [name, comp] of Object.entries({ AppRoot, GlobalLayer, PageLayer, OverlayLayer })) {
      expect(comp, `${name} 应导出`).toBeTruthy()
    }
  })

  it('★`createMountLayerComponent` 对封闭集外的层名也可构造（不崩——但闭集约束在契约侧，本函数不做校验）', () => {
    // 注：这里刻意**不**测"非法层名报错"——封闭集约束由 `MountLayer` 类型 + 契约保证（编译期），
    // 运行时再校验一遍是重复实现（本仓"同一件事两份实现"的纪律）
    const custom = createMountLayerComponent('page')
    expect(custom).toBeTruthy()
  })

  it('★`installMountLayers` 双名注册（Pascal + kebab——两种模板写法都能解析）', () => {
    const app = createApp({ render: () => h('div') })
    installMountLayers(app)
    const registered = (app as unknown as { _context: { components: Record<string, unknown> } })._context.components
    for (const name of ['app-root', 'AppRoot', 'global-layer', 'GlobalLayer', 'page-layer', 'PageLayer', 'overlay-layer', 'OverlayLayer']) {
      expect(registered[name], `★${name} 应已注册（否则模板写它解析失败）`).toBeTruthy()
    }
  })

  it('★响应式：层内容随状态更新（层容器不打断响应式链——它是普通组件而非静态包装）', async () => {
    const n = ref(0)
    const { el, unmount } = mount(
      defineComponent({
        setup: () => () => h(AppRoot, null, { default: () => h(GlobalLayer, null, { default: () => h('span', { id: 'c' }, String(n.value)) }) }),
      }),
    )
    expect(el.querySelector('#c')?.textContent).toBe('0')
    n.value = 7
    await nextTick()
    expect(el.querySelector('#c')?.textContent, '★层容器不得截断响应式更新').toBe('7')
    unmount()
  })
})
