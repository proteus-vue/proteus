// src/runtime/pageLifecycle.ts
// Vue 生命周期 → 小程序 Page()/Component() 映射（P5-3）
// - onReady/onUnload：Vue setup 中注册钩子（运行时渲染路径用）
// - createPage：Vue setup 结果（data/methods）→ Page 构造器配置
// - createComponent：同上，组件场景（lifetimes.attached/detached）
import { setDataBridge } from './setDataBridge'
import { adapter } from '../platform'

/** Vue onMounted → 小程序 onReady（页面级） */
export function onReady(hook: () => void): void {
  ;(getCurrentPage() as any)?.__onReadyHooks?.push(hook)
}

/** Vue onUnmounted → 小程序 onUnload（页面级） */
export function onUnload(hook: () => void): void {
  ;(getCurrentPage() as any)?.__onUnloadHooks?.push(hook)
}

/** 获取当前页面实例 */
function getCurrentPage(): any {
  const stack = adapter.getCurrentPages()
  return stack.length > 0 ? stack[stack.length - 1] : null
}

/** 路由参数自动 decode 并注入 data（与编译产物默认 onLoad 行为一致）
 * 仅对结构化值（{ / [ 开头）做 JSON.parse；普通标量保持字符串（P3 契约：options.id === '1'） */
function decodeParams(options: Record<string, string>): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(options || {})) {
    const s = decodeURIComponent(v)
    try {
      params[k] = s.startsWith('{') || s.startsWith('[') ? JSON.parse(s) : s
    } catch {
      params[k] = s
    }
  }
  return params
}

/**
 * 生成小程序 Page 构造器配置（运行时渲染路径）
 * 编译产物路径（P4）直接生成 Page({...})，二者行为对齐
 */
export function createPage(vueSetupResult: {
  data: Record<string, unknown>
  methods: Record<string, Function>
}): PageOptions {
  const { data, methods } = vueSetupResult
  return {
    data() {
      return data
    },
    onLoad(options: Record<string, string>) {
      ;(this as any).setData(decodeParams(options))
    },
    onReady() {
      ;(this as any).__onReadyHooks?.forEach((h: () => void) => h())
    },
    onUnload() {
      setDataBridge.flushSync() // 卸载前刷完脏数据
      ;(this as any).__onUnloadHooks?.forEach((h: () => void) => h())
    },
    __onReadyHooks: [] as Array<() => void>,
    __onUnloadHooks: [] as Array<() => void>,
    ...methods,
  }
}

/**
 * 生成小程序 Component 构造器配置（运行时渲染路径，组件场景）
 * defineProps → properties；methods 中可调用 this.triggerEvent 触发事件
 */
export function createComponent(vueSetupResult: {
  properties: Record<string, unknown>
  data: Record<string, unknown>
  methods: Record<string, Function>
}): ComponentOptions {
  const { properties, data, methods } = vueSetupResult
  return {
    properties,
    data,
    methods,
    lifetimes: {
      // Vue onMounted → 组件 attached（组件挂载）
      attached() {
        ;(this as any).__onReadyHooks?.forEach((h: () => void) => h())
      },
      detached() {
        setDataBridge.flushSync()
        ;(this as any).__onUnloadHooks?.forEach((h: () => void) => h())
      },
    },
    __onReadyHooks: [] as Array<() => void>,
    __onUnloadHooks: [] as Array<() => void>,
  }
}
