// packages/runtime/src/pinia/scope.ts
// store 生命周期与 dispose（docs/proteus-pinia-plan M7.5）
// 页面级 store 在 MPA 小程序里不主动销毁 → 内存只涨不跌；scope: 'page' 的 store 在页面 onUnload 时批量 $dispose
//   · scope: 'app'（默认）：跟随 App 生命周期，手动 pinia 实例释放
//   · scope: 'page'：注册到页面注册表，disposePageStores(pageId) 批量销毁（页面 onUnload 调用）
//   · $dispose()（Pinia 官方）：清空 state、解绑订阅（本模块只负责"批量编排"）
// ⚠ MP 产物安全：全文件无 ?? / ?. / 对象展开 / 数组解构
import type { Store } from 'pinia'

/** 页面级 store 注册表：pageId → store 集合 */
const pageRegistry = new Map<string, Set<Store>>()

/**
 * 注册页面级 store（persisted({scope:'page'}) 时由持久化插件调用）
 * @returns 注销函数（store $dispose 后自动清理）
 */
export function registerPageStore(pageId: string, store: Store): () => void {
  let set = pageRegistry.get(pageId)
  if (!set) {
    set = new Set()
    pageRegistry.set(pageId, set)
  }
  set.add(store)
  return () => {
    const s = pageRegistry.get(pageId)
    if (s) s.delete(store)
  }
}

/**
 * 销毁某页面全部 page-scoped store（页面 onUnload 时调用）
 * 页面栈多实例（A→B→A）用 pageId 区分：只清当前页
 */
export function disposePageStores(pageId: string): void {
  const set = pageRegistry.get(pageId)
  if (!set) return
  for (const s of Array.from(set)) {
    try {
      s.$dispose()
    } catch (err) {
      console.warn('[proteus] 页面 store dispose 失败', pageId, err)
    }
  }
  pageRegistry.delete(pageId)
}

/** 页面注册 store 数量（测试/诊断） */
export function pageStoreCount(pageId: string): number {
  return pageRegistry.get(pageId)?.size ?? 0
}
