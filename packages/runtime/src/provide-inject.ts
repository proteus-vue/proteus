// packages/runtime/src/provide-inject.ts
// provide/inject 页面级注入桥（docs/vue-compat-advance Batch 3/4/6）
// 小程序组件树无 provide/inject 机制——注册表桥，统一挂在 getApp().__proteusProvides：
//   编译产物（script.ts，SFC 单文件产物无模块系统）在 onLoad/created 直接读写该注册表；
//   手写运行时路径（createPage/createComponent / 非 SFC 页面）用本模块 registerProvide/readInject —— 二者读写同一存储
// ★Batch 6 页面级隔离：注册表按 pageId 命名空间隔离（页面 A 的 provide 不污染页面 B）：
//   __proteusProvides = {
//     [pageId]: { "user": <value>, "__subs": { "user": [ { k, fn } ] } },  // 页面命名空间
//     "__seq": n                                                          // pageId 生成计数器（保留键）
//   }
//   pageId 来源：编译产物 onLoad 经 nextPageId() 生成并挂页面实例 __proteusPageId；
//   组件 created/attached 经 getCurrentPages() 栈顶读取所属页面 id；无则回退 'global'（手写路径）
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / ?. / 对象展开 / 数组解构

/** 保留键（业务 key 避让） */
const SUBS_KEY = '__subs'
const SEQ_KEY = '__seq'
const GLOBAL_PAGE = 'global'

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

/** 当前页面 id：getCurrentPages 栈顶页面的 __proteusPageId（编译注入）→ 无则 'global' */
function currentPageId(): string {
  const wxGlobal = (globalThis as { wx?: { getCurrentPages?: () => Array<Record<string, unknown>> } }).wx
  const getPages = wxGlobal && wxGlobal.getCurrentPages
  const pages = typeof getPages === 'function' ? getPages() : []
  if (pages.length > 0) {
    const pid = pages[pages.length - 1].__proteusPageId
    if (typeof pid === 'string' && pid) return pid
  }
  return GLOBAL_PAGE
}

/** 页面命名空间注册表（惰性创建；pageId 缺省从当前页推导） */
function pageRegistry(pageId?: string): Record<string, unknown> {
  const reg = getRegistry()
  const pid = pageId ?? currentPageId()
  const page = (reg[pid] as Record<string, unknown> | undefined) ?? {}
  if (reg[pid] === undefined) reg[pid] = page
  return page
}

/** 生成下一个页面 id（__seq 递增；编译产物 onLoad 调用，存页面实例 __proteusPageId） */
export function nextPageId(): string {
  const reg = getRegistry()
  const seq = (reg[SEQ_KEY] as number | undefined) ?? 0
  reg[SEQ_KEY] = seq + 1
  return `p${seq + 1}`
}

/** 注册提供者（页面 onLoad / 组件 created 调用；pageId 缺省当前页命名空间） */
export function registerProvide(key: string, value: unknown, pageId?: string): void {
  pageRegistry(pageId)[key] = value
}

/** 读取注入值（onLoad/attached 调用；pageId 缺省当前页命名空间；未注册返回 undefined） */
export function readInject(key: string, pageId?: string): unknown {
  return pageRegistry(pageId)[key]
}

/**
 * ★Batch 4：订阅 key 的值变化（提供侧 ref 写入 → 编译产物调 notifyProvide / 本函数通知）
 * 返回取消函数（幂等）
 */
export function subscribeProvide(key: string, cb: () => void, pageId?: string): () => void {
  const page = pageRegistry(pageId)
  const subs = (page[SUBS_KEY] as Record<string, unknown> | undefined) ?? {}
  if (page[SUBS_KEY] === undefined) page[SUBS_KEY] = subs
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

/** ★Batch 4：通知 key 的订阅者（编译产物 proteusSyncProvide 内部调用；只读不创建命名空间） */
export function notifyProvide(key: string, pageId?: string): void {
  const reg = getRegistry()
  const page = reg[pageId ?? currentPageId()] as Record<string, unknown> | undefined
  if (!page) return
  const subs = page[SUBS_KEY] as Record<string, Array<{ k: string; fn: () => void }>> | undefined
  if (!subs) return
  const list = subs[key]
  if (!list) return
  for (let i = 0; i < list.length; i++) list[i].fn()
}

/** ★Batch 6：清理页面命名空间（页面 onUnload 调用；编译产物也可直接 delete 注册表键） */
export function destroyPage(pageId: string): void {
  delete getRegistry()[pageId]
}

/** 清空注册表（测试/重置用） */
export function clearProvides(): void {
  const reg = getRegistry()
  for (const k of Object.keys(reg)) delete reg[k]
}

/** 已注册的 key 数量（测试/诊断；遍历全部页面命名空间，不含保留键） */
export function provideCount(): number {
  const reg = getRegistry()
  let n = 0
  for (const k of Object.keys(reg)) {
    if (k === SEQ_KEY) continue
    const page = reg[k] as Record<string, unknown>
    for (const pk of Object.keys(page)) {
      if (pk !== SUBS_KEY) n++
    }
  }
  return n
}
