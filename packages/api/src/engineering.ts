// packages/api/src/engineering.ts
// ★G-32 B5（proteus-semantic-primitives-plus-plan §8）：工程原语 28——injectable 设计（api 包零运行时依赖 vue）
//   E1 useState / E2 useComputed / E3 useWatch / E6 useLifecycle / E7 useReady / E9 usePageParam
//   注入式：消费方注入 reactivity（vue reactive 工厂或自定义）——同 createReactiveStorage 零依赖先例（决策 #310）
//   MP 产物安全（决策 #32/#36）：无 ?. / ??；无数组解构

/** 注入式响应式（vue composables 语义面——useState/useComputed/useWatch 的底座） */
export interface Reactivity {
  /** ref：初始值 → { value }（useState） */
  ref<T>(initial: T): { value: T }
  /** computed：getter → 只读 { value }（useComputed） */
  computed<T>(getter: () => T): { value: T }
  /** watch：追踪 getter，变化回调 → 返回停止函数（useWatch） */
  watch<T>(getter: () => T, cb: (value: T, oldValue: T) => void): () => void
}

/** 生命周期事件（页面/组件） */
export type LifecycleEvent = 'load' | 'show' | 'hide' | 'unload'

/** 生命周期钩子句柄（useLifecycle / useReady） */
export interface LifecycleHandle {
  onLoad(cb: () => void): () => void
  onShow(cb: () => void): () => void
  onHide(cb: () => void): () => void
  onUnload(cb: () => void): () => void
}

/** 页面参数源（wx onLoad(options) / web URL query——代码侧注入） */
export type ParamSource = () => Record<string, string | undefined>

/** 工程原语注入项 */
export interface EngineeringOptions {
  reactivity: Reactivity
  /** 生命周期事件源（缺省 = 无事件流，仅暴露订阅 API；可对接 wx Page 钩子 / web 事件） */
  lifecycle?: Partial<Record<LifecycleEvent, (cb: () => void) => void>>
  /** 页面参数源（缺省 = 空对象——usePageParam 返回 undefined） */
  paramSource?: ParamSource
}

/** G-32 §8 ⑥ 工程原语语义面（E1-E9 首期） */
export interface Engineering {
  /** E1 useState：响应式状态（ref 语义） */
  useState<T>(initial: T): { value: T }
  /** E2 useComputed：派生状态（computed 语义） */
  useComputed<T>(getter: () => T): { value: T }
  /** E3 useWatch：副作用监听（watch 语义，返回停止函数） */
  useWatch<T>(getter: () => T, cb: (value: T, oldValue: T) => void): () => void
  /** E6 useLifecycle：生命周期订阅句柄 */
  useLifecycle(): LifecycleHandle
  /** E7 useReady：挂载就绪回调（onReady 语义——load 事件触发一次） */
  useReady(cb: () => void): () => void
  /** E9 usePageParam：页面参数（响应式读取；wx options / web query） */
  usePageParam<Key extends string>(key: Key): { value: string | undefined }
}

/**
 * ★createEngineering：工程原语统一实例（注入式——单测/多端可替换 reactivity/lifecycle/param 源）
 * 用法：const eng = createEngineering({ reactivity: { ref: vue.ref, computed: vue.computed, watch: vue.watch }, lifecycle: {...}, paramSource: () => opts })
 * 设计：工程原语是「语义面」——不绑死 Vue 具体版本/实现，业务代码只面向 useState/useComputed 语义
 */
export function createEngineering(options: EngineeringOptions): Engineering {
  const { reactivity } = options
  const lifecycleSrc: Partial<Record<LifecycleEvent, (cb: () => void) => void>> = options.lifecycle ?? {}
  let params: Record<string, string | undefined> = {}
  if (options.paramSource) params = options.paramSource()

  /** 通用订阅：源存在 → 注册并返回卸载；否则 → 返回 no-op（缺事件流时订阅仍安全） */
  function subscribe(event: LifecycleEvent, cb: () => void): () => void {
    const reg = lifecycleSrc[event]
    if (typeof reg !== 'function') return () => undefined
    reg(cb)
    return () => undefined
  }

  return {
    useState: (initial) => reactivity.ref(initial),
    useComputed: (getter) => reactivity.computed(getter),
    useWatch: (getter, cb) => reactivity.watch(getter, cb),
    useLifecycle: () => ({
      onLoad: (cb) => subscribe('load', cb),
      onShow: (cb) => subscribe('show', cb),
      onHide: (cb) => subscribe('hide', cb),
      onUnload: (cb) => subscribe('unload', cb),
    }),
    useReady: (cb) => subscribe('load', cb),
    usePageParam: (key) => {
      const param = reactivity.ref<string | undefined>(params[key])
      return param
    },
  }
}