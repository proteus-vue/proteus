// packages/web/src/mount-layers.ts
// ★★★GP3-a（2026-10-03）：**三层挂载（Web 端）**——《全局挂载点与App根组件方案》§3 的 Web 落地。
//
// 【与 MP 端的分工（同一模型的两种落地，别混）】
//   · **MP 端**：`<global-layer>` 等标签是**编译期**概念——编译器解壳 + 把 Global 内容**注入每个页面产物**
//     （GP2-a / GP3-b1；MP 无渲染层 App，只能每页注入）。
//   · **Web 端（本文件）**：标准 Vue + DOM ⇒ 标签是**运行时组件**——App.vue 是真正的根组件，
//     RouterView 嵌在 `<page-layer>` 里，Global 层内容**天然跨路由存活**（它在 RouterView 之外）。
//   ⇒ 两端**声明形态相同**（`<app-root>` / `<*-layer>`），落地机制不同（编译期注入 vs 运行时组件）。
//
// 【为什么不用原生 Teleport（GP0-e 结论：倾向自有渲染树节点）】
//   Teleport 把节点搬到 DOM 别处 ⇒ **绕过本框架的渲染树语义**（层级/可枚举性/conformance 都失去锚点），
//   且与 MP 端的"树序 = z-order"模型**不同构**（MP 端没有 teleport-to-body，只有 root-portal 逃逸层）。
//   ⇒ 三层用**自有节点 in-place 排列**：DOM 顺序即层序（与内核"树序是真源"同一原则），零 teleport。
//
// 【★层间 z-index 域偏移（与《页面层级规范》打通的地方）】
//   每个层容器 = **一个独立层叠上下文**（`position: relative` + `z-index: <域偏移>`）：
//   · 偏移来自契约 `mountLayerDomainOffset()`（global=0 / page=1_000_000 / overlay=2_000_000——**不自行算数**）
//   · 层内元素照常写 1/10/100/1000（WeUI 四层语义）⇒ 被限制在**本层域内**，不会跨层压人
//   ⇒ 这正是契约里"两个正交维度"的落地：层间靠容器域偏移，层内靠原语值。
//   ★诚实边界：本文件只保证**层间**顺序；层内原语（`layer="layer-navigation"` 等）的 z-index 产出
//     是**另一条线**（LY2，见《页面层级规范》§13.3）——当前校验通过但不产 z-index（实测：属性原样透传、
//     WXSS 无 z-index、全仓 `layerValueFor` 零消费者）⇒ 层内层级**今天尚不生效**，勿据此做遮挡假设。
//
// 【C1 的 Web 侧（运行时软校验）】契约 C1 = "挂载层只能声明在 App.vue"。MP 端是编译期 error（GP2-b）；
//   Web 端跑标准 Vue、无编译期检查 ⇒ 这里用 provide/inject 做**开发模式软校验**：
//   层组件不在 `<app-root>` 之下时给出警告（生产零开销——`__PROTEUS_DEBUG__` 常量折叠）。
import { defineComponent, h, inject, provide, type App, type Component } from 'vue'
import { MOUNT_LAYERS, mountLayerDomainOffset, type MountLayer } from '@proteus-vue/contracts'

/** App 根标记（供层组件判断"我是否在 App 壳内"——C1 软校验用） */
const APP_ROOT_KEY = 'proteus:app-root'

/**
 * 创建一层的容器组件（`global` / `page` / `overlay`）。
 *
 * 【为什么是容器而不是解壳（与 MP 端不同，这是刻意的）】MP 端解壳是因为**层内容要被搬到别的产物**；
 *   Web 端层内容就留在原地 ⇒ 容器**承担层叠域职责**（`z-index: 域偏移`）。
 *   容器不做任何布局干预（无尺寸/无内外边距），只建立层叠上下文 ⇒ 对页面布局零影响。
 */
export function createMountLayerComponent(layer: MountLayer): Component {
  return defineComponent({
    name: `Proteus${layer.charAt(0).toUpperCase()}${layer.slice(1)}Layer`,
    setup(_props, { slots }) {
      // ★C1 软校验（开发模式；生产由 `__PROTEUS_DEBUG__` 常量折叠为 false ⇒ 零开销）
      const inAppRoot = inject(APP_ROOT_KEY, false)
      if (!inAppRoot && typeof __PROTEUS_DEBUG__ !== 'undefined' && __PROTEUS_DEBUG__) {
        console.warn(
          `[proteus/mount-layers] <${layer}-layer> 不在 <app-root> 之下——按契约 C1，挂载层只能声明在 App.vue。` +
            `放在页面里它不会跨路由存活（与全局层语义矛盾），且 MP 端会编译期报错（两端行为不一致）`,
        )
      }
      return () =>
        h(
          'div',
          {
            // ★可枚举（对齐 C1 的"声明式、可枚举"）：DOM 上留下归属标记，测试/DevTools/conformance 可查
            'data-mount-layer': layer,
            class: `proteus-mount-layer proteus-mount-layer--${layer}`,
            style: {
              // `position: relative` 让 z-index 生效（且不改变布局——无偏移量）；两者共同建立层叠上下文
              position: 'relative',
              // ★域偏移**来自契约**（不是本文件硬编码数值——"各端映射表由框架统一维护"）
              zIndex: String(mountLayerDomainOffset(layer)),
            },
          },
          slots.default?.(),
        )
    },
  })
}

/**
 * `<app-root>`：App 壳的根（**不属任何层**——它是层的父）。
 *
 * 【行为：解壳（不产元素）】与 MP 编译器的处理一致（`<app-root>` 消解为内容本身）——
 *   保证两端 DOM 结构同构（Web 少一层包装 = 少一处两端差异）。
 *   ⇒ 它只做一件事：**provide 根标记**（供层组件做 C1 软校验）。
 */
export const AppRoot = defineComponent({
  name: 'ProteusAppRoot',
  setup(_props, { slots }) {
    provide(APP_ROOT_KEY, true)
    return () => slots.default?.()
  },
})

/** 三个层容器（导出供直接 import 用；通常经 `installMountLayers` 全局注册） */
export const GlobalLayer = createMountLayerComponent('global')
export const PageLayer = createMountLayerComponent('page')
export const OverlayLayer = createMountLayerComponent('overlay')

/**
 * 安装三层挂载组件（注册为全局组件——App.vue 模板里直接写 `<global-layer>` 等）。
 *
 * ★双名注册（Pascal + kebab）：与 `@proteus-vue/components` 的组件注册同款约定
 *   （模板两种写法都能解析；`global-components.d.ts` 的类型声明同源）。
 */
export function installMountLayers(app: App): App {
  app.component('AppRoot', AppRoot)
  app.component('app-root', AppRoot)
  app.component('GlobalLayer', GlobalLayer)
  app.component('global-layer', GlobalLayer)
  app.component('PageLayer', PageLayer)
  app.component('page-layer', PageLayer)
  app.component('OverlayLayer', OverlayLayer)
  app.component('overlay-layer', OverlayLayer)
  return app
}

/** 层名封闭集再导出（供测试/诊断断言，避免各处重列） */
export const WEB_MOUNT_LAYERS = MOUNT_LAYERS
