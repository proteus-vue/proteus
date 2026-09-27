// hosts/ios/bridge/entry.ts —— iOS 宿主 JS 入口（★iOS 竖切 M1：真实 JavaScriptCore → UIKit 链路）
//
// 这条链路要证明的事（「一套语义多引擎」在真机上的第一段）：
//   标准 Vue render 函数 → Vue VNode → @proteus-vue/render-backend 的 Dispatcher
//   → createNativeBackend(adapter,'ios')（语义 → UIKit 类型映射 SEMANTIC_NATIVE_MAPS.ios）
//   → adapter（本文件）→ globalThis.proteusNative（Swift 经 JSExport 注入）
//   → 真实 UIView 树
//
// ★约束（对齐 docs/proteus-app-renderer-plan/02-native-binding.md 铁律 A-02）：
//   视图操作全部**同步**——本入口没有任何 await；JSC 的 JSExport 方法即时返回句柄。
//
// ★诚实边界（M1 竖切骨架，不是完整渲染器）：
//   ① 属性映射只做「看得见的少数」：背景色 / 字号 / 文字色 / 圆角 / 尺寸 / 文本；
//      布局交给 UIKit 缺省（本步不实现 flex/grid 求解——M3+）；
//   ② 不接手势/动画/Glass（M5/M6）；
//   ③ 产物是**单文件 IIFE bundle**（JSC 无模块加载器）——构建见 build.mjs。
import { h } from '@vue/runtime-core'
import { createNativeBackend, createProteusRendererForBackend } from '@proteus-vue/render-backend'
import type { NativeViewAdapter, NativeViewDescriptor } from '@proteus-vue/render-backend'

/** Swift 侧经 JSExport 注入的原生桥（见 ProteusBridge.swift） */
interface ProteusNative {
  createView(type: string, propsJson: string): number
  updateView(handle: number, key: string, valueJson: string): void
  insertView(child: number, parent: number, anchor: number): void
  removeView(handle: number): void
  setViewText(handle: number, text: string): void
  /** 链路完成回调（Swift 侧据此落盘快照，避免轮询等待） */
  ready(summaryJson: string): void
}

declare const proteusNative: ProteusNative

const json = (v: unknown): string => {
  try {
    return JSON.stringify(v ?? null) ?? 'null'
  } catch {
    return 'null'
  }
}

/**
 * NativeViewAdapter 的**宿主实现**：把 render-backend 的适配器契约转发给原生。
 * createView 由 native backend 在 createElement 时调用，传入的是**已映射的 UIKit 类型名**
 * （如 UIView / UILabel——来自 SEMANTIC_NATIVE_MAPS.ios）。
 */
const adapter: NativeViewAdapter = {
  createView(descriptor: NativeViewDescriptor): unknown {
    return proteusNative.createView(descriptor.type, json(descriptor.props))
  },
  updateView(handle: unknown, key: string, _prev: unknown, next: unknown): void {
    proteusNative.updateView(handle as number, key, json(next))
  },
  insertView(child: unknown, parent: unknown, anchor?: unknown): void {
    proteusNative.insertView(child as number, parent as number, (anchor as number) ?? -1)
  },
  removeView(child: unknown): void {
    proteusNative.removeView(child as number)
  },
  setViewText(handle: unknown, text: string): void {
    proteusNative.setViewText(handle as number, text)
  },
}

/** 业务代码（标准 Vue render 函数——零原生 API、零平台判断） */
const App = {
  name: 'VerticalSliceApp',
  render() {
    // ★最外层用 p-stack（→ UIStackView）承担纵向排布：M1 **不实现 flex/grid 求解**，
    //   布局交给 UIKit；用 stack 是「诚实地只用已映射的布局能力」，而非假装支持 CSS 布局。
    return h('p-stack', { style: { backgroundColor: '#101020', width: '100%', height: '100%' } }, [
      h('p-text', { style: { fontSize: '28px', color: '#ffffff' } }, 'Proteus · iOS 竖切'),
      h('p-text', { style: { fontSize: '15px', color: '#9aa3b2' } }, 'Vue → Dispatcher → NativeBackend → UIKit'),
      h('p-stack', { style: { marginTop: '18px' } }, [
        h('p-view', { style: { backgroundColor: '#6f4ae8', height: '56px', borderRadius: '12px' } }, [
          h('p-text', { style: { fontSize: '16px', color: '#ffffff' } }, '主操作按钮'),
        ]),
        h('p-view', { style: { backgroundColor: '#1b1b21', height: '56px', borderRadius: '12px', marginTop: '10px' } }, [
          h('p-text', { style: { fontSize: '16px', color: '#c9b8ff' } }, '次操作'),
        ]),
      ]),
    ])
  },
}

/** 入口（JSC 顶层直接执行——全同步） */
function main(): void {
  const backend = createNativeBackend(adapter, 'ios')
  const { renderer, dispatch } = createProteusRendererForBackend(backend)

  // 容器：根节点由后端创建（UIKit 侧是 root view 的子视图）
  const root = dispatch.nodeOps.createElement('p-view', { style: { width: '100%', height: '100%' } })
  renderer.createApp(App).mount(root)

  proteusNative.ready(
    json({
      ok: true,
      backendId: (backend as unknown as { id?: string }).id ?? '?',
      traceCount: dispatch.trace.length,
      appName: App.name,
    }),
  )
}

main()
