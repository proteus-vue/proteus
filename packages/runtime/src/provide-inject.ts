// packages/runtime/src/provide-inject.ts
// provide/inject 页面级注入桥（docs/vue-compat-advance Batch 3）
// 小程序组件树无 provide/inject 机制——全局注册表桥，统一挂在 getApp().__proteusProvides：
//   编译产物（script.ts，SFC 单文件产物无模块系统）在 onLoad/created 直接读写该注册表；
//   手写运行时路径（createPage/createComponent / 非 SFC 页面）用本模块 registerProvide/readInject —— 二者读写同一存储
// ★MVP：全局注册表（重名 key 后写覆盖）+ 值快照（非响应式联动——inject 侧读取时取当前值）；
//   页面级隔离（pageId）/ 响应式联动（ref 引用传递）为后续
// ⚠ MP 产物安全（决策 #32/#36）：全文件无 ?? / ?. / 对象展开 / 数组解构

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

/** 清空注册表（测试/重置用；MVP 全局注册表不随页面清理） */
export function clearProvides(): void {
  const reg = getRegistry()
  for (const k of Object.keys(reg)) delete reg[k]
}

/** 已注册的 key 数量（测试/诊断） */
export function provideCount(): number {
  return Object.keys(getRegistry()).length
}
