// packages/test-core/src/mount-mp.ts
// ★test-framework M3：mountMpComponent——SFC → 编译（真实 transform）→ 逻辑层实例 + WXML
// 03-component-integration.md：小程序用例只校验「逻辑 + WXML」，不真实渲染（不跑真机，L4 下沉）
import { compileVueSfc } from '@proteus-vue/compiler'
import type { CompileOptions } from '@proteus-vue/compiler'
import { createMockContext } from './context'
import type { MockContext } from './context'

export interface MpComponentInstance {
  /** 组件 data 快照 */
  data: Record<string, unknown>
  /** setData：合并更新 + 追踪（断言更新序列） */
  setData: ReturnType<typeof createTrackedSetData>
  /** 暴露组件方法（methods/事件处理） */
  [key: string]: unknown
}

export interface MountMpComponentResult {
  /** 逻辑层实例（data + setData 追踪 + 方法） */
  instance: MpComponentInstance
  /** 编译产物 WXML（结构断言，对齐 Component plan 映射表） */
  wxml: string
  /** 编译产物 JS（原始） */
  js: string
  /** mock 上下文（wx 断言 + 构造器捕获） */
  context: MockContext
  /** 构造器注册的原始配置（data/methods/lifetimes 断言） */
  config: unknown
}

/** setData：合并更新 + 追踪（断言更新序列）——★真实语义：同步合并进 data（统一状态断言 stateOf 依赖） */
function createTrackedSetData(target: Record<string, unknown>) {
  const calls: Array<Record<string, unknown>> = []
  const setData = (patch: Record<string, unknown>): void => {
    calls.push(patch)
    Object.assign(target, patch)
  }
  return Object.assign(setData, { calls })
}

/**
 * 挂载小程序组件/页面：compileVueSfc 编译 SFC → 执行逻辑层 JS（Page/Component 构造器捕获）→ 实例化
 * 返回 { instance, wxml, js, context, config }——逻辑 + WXML 双断言（03 铁律）
 */
export function mountMpComponent(sfcSource: string, options: CompileOptions = {}): MountMpComponentResult {
  const context = createMockContext()
  const { wxml, js } = compileVueSfc(sfcSource, { isComponent: true, ...options })

  // 执行逻辑层（js 是 Page({...}) / Component({...}) 全局调用；注入全局捕获）
  const executor = new Function(
    'Page',
    'Component',
    'App',
    'wx',
    'getApp',
    'getCurrentPages',
    `"use strict";\n${js}`,
  )
  executor(
    (config: unknown) => {
      context.registrations.page = config
    },
    (config: unknown) => {
      context.registrations.component = config
    },
    (config: unknown) => {
      context.registrations.app = config
    },
    context.wx,
    context.getApp,
    context.getCurrentPages,
  )

  const config = context.registrations.component ?? context.registrations.page ?? {}
  const raw = config as {
    data?: Record<string, unknown>
    [key: string]: unknown
  }
  const data: Record<string, unknown> = { ...(raw.data ?? {}) }
  const instance: MpComponentInstance = {
    data,
    setData: createTrackedSetData(data),
  }
  // 方法暴露：页面模式顶层函数 + 组件模式 methods（微信组件方法必须在 methods: {}——编译器强制）
  // ★methods 后绑定覆盖（组件模式以 methods 为准，防顶层同名残留）
  const exposeMethod = (name: string, fn: (...args: unknown[]) => unknown): void => {
    if (name === 'data' || name === 'setData') return
    instance[name] = fn.bind(instance)
  }
  for (const key of Object.keys(raw)) {
    if (typeof raw[key] === 'function') exposeMethod(key, raw[key] as (...args: unknown[]) => unknown)
  }
  const rawMethods = (raw.methods ?? {}) as Record<string, unknown>
  for (const key of Object.keys(rawMethods)) {
    if (typeof rawMethods[key] === 'function') exposeMethod(key, rawMethods[key] as (...args: unknown[]) => unknown)
  }

  return { instance, wxml, js, context, config }
}
