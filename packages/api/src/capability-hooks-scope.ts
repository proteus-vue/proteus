// packages/api/src/capability-hooks-scope.ts
// ★★★能力 Hook 的**订阅作用域**（决策 #1071）—— 2026-10-19
//
// 【它解决什么】`useAppLifecycle().onShow(cb)` / `usePageLifecycle().onXxx(cb)` 返回"取消函数"，
//   而生命周期总线是**全局单例**：没人保存这个取消函数时，页面卸载后回调仍留在总线里。
//   实测：100 个页面实例 ⇒ 200 个悬挂订阅，且随访问页数**单调增长**（页面越多越糟）。
//
// 【做法】给 hooks 实例配一个"回收袋"：
//   · `wrap(handle)` 把句柄上所有"返回取消函数"的方法包一层，返回的取消函数自动登记；
//   · `dispose()` 一次性解除全部（幂等）。
//   ★保留原句柄的属性描述符（含 `get phase()` 这类 getter），只替换函数成员 ⇒ 可见语义零变化。
//
// 【为什么按"返回值是不是函数"判定】生命周期句柄的取消函数形态就是 **`() => void`**（wx/Vue 同族约定）；
//   句柄上的其它方法（`onShow` 自身、`getLaunchOptions` 等）返回值不是函数或不该登记 ⇒ 自然不会误收。
//
// 【诚实边界】只覆盖"经本 hooks 实例拿到的订阅"；业务直接 `bus.on(...)` 的订阅仍由业务自己管理
//   （总线仍返回取消函数，语义不变）。

/** 一次 wrap 之后的回收袋。 */
export interface SubscriptionScope {
  /** 包装一个生命周期句柄：其 `onXxx()` 返回的取消函数自动登记进本作用域。 */
  wrap<T extends object>(handle: T): T
  /** 直接登记一个取消函数（句柄之外的订阅用）。 */
  add(off: () => void): void
  /** 解除本作用域登记的全部订阅（幂等）。 */
  dispose(): void
  /** 当前登记数量（诊断/判据用）。 */
  size(): number
}

/** 创建一个回收袋。 */
export function createSubscriptionScope(): SubscriptionScope {
  const subs = new Set<() => void>()
  return {
    wrap<T extends object>(handle: T): T {
      const out: Record<string, unknown> = {}
      for (const key of Reflect.ownKeys(handle)) {
        const desc = Object.getOwnPropertyDescriptor(handle, key)
        if (!desc) continue
        // getter/setter 与普通值：原样搬运（不改语义）
        if (desc.get || desc.set || typeof desc.value !== 'function') {
          Object.defineProperty(out, key, desc)
          continue
        }
        const fn = desc.value as (...a: unknown[]) => unknown
        Object.defineProperty(out, key, {
          ...desc,
          value: function (this: unknown, ...args: unknown[]): unknown {
            const ret = fn.apply(handle, args)
            if (typeof ret === 'function') subs.add(ret as () => void)
            return ret
          },
        })
      }
      return out as T
    },
    add(off: () => void): void {
      subs.add(off)
    },
    dispose(): void {
      for (const off of [...subs]) {
        try {
          off()
        } catch {
          /* 单个取消失败不影响其余（与总线 fire 的同款防御） */
        }
      }
      subs.clear()
    },
    size(): number {
      return subs.size
    },
  }
}

/**
 * 把能力实例的 `dispose()` 接到宿主生命周期（**注入式，零 vue 依赖**）。
 *
 * 【为什么注入式】`@proteus-vue/api` 不依赖 Vue（MP/App 引擎里也要能跑）；由调用方传入
 *   `onScopeDispose`（Vue setup）或 `onUnmounted` 即可。与 `useMCP({ onDispose })` 同款约定。
 *
 * @param register 宿主的作用域销毁注册函数（Vue: `onScopeDispose` / `onUnmounted`）
 * @param cap 要绑定回收的能力实例（`createCapabilityHooks()` 的返回值）
 * @returns 手动解绑函数（幂等；也用于提前解绑）
 */
export function installCapabilityDisposeHook(
  register: (fn: () => void) => void,
  cap: { dispose(): void },
): () => void {
  let done = false
  const run = (): void => {
    if (done) return
    done = true
    cap.dispose()
  }
  try {
    register(run)
  } catch {
    // 宿主不在活跃作用域（如在 setup 之外调用）⇒ 交给调用方用手动解绑，不静默
  }
  return run
}
