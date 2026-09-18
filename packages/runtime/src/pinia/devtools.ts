// packages/runtime/src/pinia/devtools.ts
// DevTools / 状态追踪（docs/proteus-pinia-plan M5）
// Web：Pinia 官方 DevTools 由 createPinia 原生接入（window.__PINIA_DEVTOOLS__），无需额外代码；
// 本模块提供跨端等价可观测性：动作/变更 trace + 状态快照导出（小程序/App 无浏览器 DevTools）
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开
import type { PiniaPluginContext } from 'pinia'

let traceEnabled = false
export function enablePiniaTrace(): void {
  traceEnabled = true
}

/** 关闭 trace（测试/运行时切换；对齐 enableStorageTrace 语义） */
export function disablePiniaTrace(): void {
  traceEnabled = false
}

/** trace 状态（供工厂 debug 判断） */
export function isPiniaTraceEnabled(): boolean {
  return traceEnabled
}

/**
 * 创建 DevTools 兼容插件（debug 构建挂载）：
 * - $onAction → [pinia] <id> action:<name>（参数）
 * - $subscribe → [pinia] <id> <mutationType>:<key>
 * 非 Web 端替代 Vue DevTools 的最小可观测层
 */
export function createDevtoolsPlugin() {
  return function devtoolsPlugin(ctx: PiniaPluginContext): void {
    const store = ctx.store

    store.$onAction(({ name, args }) => {
      if (!traceEnabled) return
      console.log(`[pinia] ${store.$id} action:${name}`, args)
    })

    store.$subscribe((mutation, _state) => {
      if (!traceEnabled) return
      const key = 'key' in mutation ? String((mutation as { key?: string }).key) : ''
      console.log(`[pinia] ${store.$id} ${mutation.type}:${key}`)
    })
  }
}

/** 状态快照导出：全局注册 __PROTEUS_STORES__()（微信开发者工具 Console 可调，对齐 Vue DevTools Import State） */
export function registerStoreSnapshot(pinia: {
  state: { value: Record<string, unknown> }
}): void {
  const g = globalThis as { __PROTEUS_STORES__?: () => string }
  g.__PROTEUS_STORES__ = () => JSON.stringify(pinia.state.value, null, 2)
}
