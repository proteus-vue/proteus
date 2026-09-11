// src/components/runtime/container-measure.ts —— Skyline 线收口：组件层容器测量源
// 背景：fluid 的 createContainerQuery 依赖 ResizeObserver；小程序逻辑层无 RO → 容器查询恒初始态
//   （p-split 恒堆叠 / p-zone 恒 sm / p-toolbar 不折叠）——此前的「静默钉死」。
// 方案：MP 下改走 SelectorQuery（经 @proteus-vue/shared adapter L2 抽象，组件不碰 wx）；Web 返回 null（用默认 RO）。
// 选择器：MP 上 scoped 类被加后缀（p-split-data-v-xxx）无法静态选择 → 组件须在根节点加**运行时标记类**（不参与 scoped）。
import { adapter, detectRuntime } from '@proteus-vue/shared'
import { createMpSizeObserverFactory } from '@proteus-vue/fluid'
import type { SizeObserverFactory } from '@proteus-vue/fluid'

/** wx.onWindowResize 订阅（平台 API 收口在此，不进组件模板） */
function subscribeWindowResize(cb: () => void): () => void {
  const g = globalThis as {
    wx?: { onWindowResize?: (cb: () => void) => void; offWindowResize?: (cb: () => void) => void }
  }
  const wxApi = g.wx
  if (!wxApi || typeof wxApi.onWindowResize !== 'function') return () => {}
  wxApi.onWindowResize(cb)
  return () => {
    if (typeof wxApi.offWindowResize === 'function') wxApi.offWindowResize(cb)
  }
}

/**
 * 小程序容器测量工厂（D/C 类容器组件用）。
 * @param selector 根节点运行时标记类选择器（如 '.proteus-measure-split'——须为不参与 scoped 后缀的运行时类）
 * @param scope    组件实例（glass-easel 组件内查询用；缺省页面级查询）
 * @returns 工厂（MP）或 null（Web/无测量源——调用方用默认 ResizeObserver）
 */
export function mpContainerObserverFactory(selector: string, scope?: unknown): SizeObserverFactory | null {
  if (detectRuntime() !== 'mp') return null
  if (!adapter.measureRect) return null
  return createMpSizeObserverFactory({
    measure: async () => {
      const r = await adapter.measureRect?.(selector, scope)
      return r ? { width: r.width, height: r.height } : null
    },
    onResize: subscribeWindowResize,
  })
}

/** 是否处于小程序运行时（组件据此决定是否加运行时测量类） */
export function isMpRuntime(): boolean {
  return detectRuntime() === 'mp'
}

/** 测量类名生成（运行时标记类——不参与 scoped 后缀，供 SelectorQuery 命中） */
export function measureClass(name: string): string {
  return 'proteus-measure-' + name
}
