// packages/runtime/src/provide-inject.ts
// provide/inject 页面级注入桥（docs/vue-compat-advance Batch 3 + Batch 4 响应式联动）
// 小程序组件树无 provide/inject 机制——全局注册表桥，统一挂在 getApp().__proteusProvides：
//   编译产物（script.ts，SFC 单文件产物无模块系统）在 onLoad/created 直接读写该注册表；
//   手写运行时路径（createPage/createComponent / 非 SFC 页面）用本模块 registerProvide/readInject —— 二者读写同一存储
// 数据结构（编译产物与本模块共用）：
//   __proteusProvides = {
//     "user": <value>,                     // 值（Batch 3：快照 / Batch 4：ref 写入同步）
//     "__subs": { "user": [ { k, fn } ] }  // ★Batch 4：订阅集合（键 "__subs" 避开业务 key）
//   }
// ★MVP：全局注册表（重名 key 后写覆盖）+ 页面级隔离（pageId）/ 值响应式联动由编译期通知驱动
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / ?. / 对象展开 / 数组解构

/** 注册表保留键（业务 key 避让） */
const SUBS_KEY = '__subs'

/** 获取全局注册表（惰性创建；非小程序环境回退 globalThis，测试可用） */
function getRegistry(): Record<string, unknown> {
  const globalFn = (globalThis as { getApp?: () => Record<string, unknown> }).getApp
  const app = typeof globalFn === 'function' ? globalFn() : undefined
  const host = (app ?? globalThis) as Record<string, unknown>
  const reg = host.__proteusProvides as Record<string, unknown> | undefined
  const next = reg === undefined ? {} : reg
  if (reg === undefined) host.__proteusProvides = next
  return next
}

/** 注册提供者（页面 onLoad / 组件 created 调用；与编译产物写同一注册表） */
export function registerProvide(key: string, value: unknown): void {
  getRegistry()[key] = value
}

/** 读取注入值（onLoad/attached 调用；未注册返回 undefined） */
export function readInject(key: string): unknown {
  return getRegistry()[key]
}

/**
 * ★Batch 4：订阅 key 的值变化（提供侧 ref 写入 → 编译产物调 notifyProvide / 本函数通知）
 * 返回取消函数（幂等）
 */
export function subscribeProvide(key: string, cb: () => void): () => void {
  const reg = getRegistry()
  const subs = (reg[SUBS_KEY] as Record<string, unknown> | undefined) ?? {}
  if (reg[SUBS_KEY] === undefined) reg[SUBS_KEY] = subs
  const list = (subs[key] as Array<{ k: string; fn: () => void }> | undefined) ?? []
  if (subs[key] === undefined) subs[key] = list
  const entry = { k: key, fn: cb }
  list.push(entry)
  let cancelled = false
  return () => {
    if (cancelled) return
    cancelled = true
    const idx = list.indexOf(entry)
    if (idx >= 0) list.splice(idx, 1)
  }
}

/** ★Batch 4：通知 key 的订阅者（编译产物 proteusSyncProvide 内部调用） */
export function notifyProvide(key: string): void {
  const reg = getRegistry()
  const subs = reg[SUBS_KEY] as Record<string, Array<{ k: string; fn: () => void }>> | undefined
  if (!subs) return
  const list = subs[key]
  if (!list) return
  for (let i = 0; i < list.length; i++) list[i].fn()
}

/** 清空注册表（测试/重置用；MVP 全局注册表不随页面清理） */
export function clearProvides(): void {
  const reg = getRegistry()
  for (const k of Object.keys(reg)) delete reg[k]
}

/** 已注册的 key 数量（测试/诊断；不含 __subs 保留键） */
export function provideCount(): number {
  return Object.keys(getRegistry()).filter((k) => k !== SUBS_KEY).length
}
