// packages/runtime/src/pinia/persistence/sharding.ts
// 状态分片 + 按需 hydrate（docs/proteus-pinia-plan M7.1）
// 千级 store 全量 hydrate → 冷启动卡顿；eager/lazy/keys 控制恢复节奏
//   · eager: true（默认）→ 插件创建即 hydrate
//   · lazy: true → 首次 store.$hydrate() 时恢复（$hydrated 状态供组件 loading）
//   · keys?: string[] → hydrate 只恢复指定字段（减少反序列化量）
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import { ref } from 'vue'
import type { PiniaPluginContext } from 'pinia'

export interface ShardingOptions {
  /** 启动即 hydrate（默认 true）；false 时惰性，首次 $hydrate() 触发 */
  eager?: boolean
  /** 惰性 hydrate（首次 $hydrate()）；与 eager=false 等价，语义更明确 */
  lazy?: boolean
  /** 只恢复指定字段（其余保持初始值） */
  keys?: string[]
}

export interface HydratedStore {
  /** 恢复状态（未完成时为 false，组件据此显示 loading）——Pinia store 上为解包布尔，响应性由闭包 ref 保证 */
  $hydrated: boolean
  /** 触发恢复（幂等：并发调用只执行一次；promise 缓存） */
  $hydrate(): Promise<void>
}

/** 是否惰性（eager 显式 false 或 lazy 显式 true） */
export function isLazy(opt: ShardingOptions | undefined): boolean {
  if (!opt) return false
  if (opt.lazy === true) return true
  if (opt.eager === false) return true
  return false
}

/**
 * 按 keys 挑字段（hydrate 侧限制：只恢复指定字段，其余保持初始值）
 */
export function pickKeys(state: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (k in state) out[k] = state[k]
  }
  return out
}

/**
 * 挂载分片能力到 store：$hydrated（Ref）+ $hydrate()（幂等）
 * @param doHydrate 实际恢复逻辑（返回恢复后的数据或 null）
 */
export function mountSharding(
  ctx: PiniaPluginContext,
  options: ShardingOptions | undefined,
  doHydrate: () => Promise<Record<string, unknown> | null>,
): void {
  if (!isLazy(options)) return // eager：由插件主流程直接 hydrate，无需挂载

  const store = ctx.store as PiniaPluginContext['store'] & HydratedStore
  const hydrated = ref(false)
  let pending: Promise<void> | null = null

  // 挂 ref 到 reactive store：读取时自动解包为布尔（组件 v-if="store.$hydrated" 直接用），
  // 响应性由闭包内的 ref 保证（$hydrate 完成后 hydrated.value = true 触发依赖）
  ;(store as { $hydrated: unknown }).$hydrated = hydrated
  store.$hydrate = () => {
    if (pending) return pending
    if (hydrated.value) return Promise.resolve()
    pending = doHydrate()
      .then((data) => {
        if (data) store.$patch(data as never)
        hydrated.value = true
      })
      .catch((err) => {
        console.warn('[proteus] 惰性 hydrate 失败（store 保持初始值）', err)
        hydrated.value = true // 失败也结束 loading（初始值兜底）
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}
