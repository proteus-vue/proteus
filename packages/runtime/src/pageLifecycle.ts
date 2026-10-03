// src/runtime/pageLifecycle.ts
// 生命周期体系（P5-3 → 2026-10-04 完整化）：**从框架导入**的页面生命周期注册 API。
//
// 【为什么（用户指令）】「生命周期函数需要在页面写同名函数，比如 onShow，这个体验太差了，
//   应该从我们框架导入使用才对，我们框架需要一套完整的体系开放给开发者使用」。
//   ⇒ 统一形态：`import { onShow, onHide, … } from '@proteus-vue/runtime'` + 回调注册
//     （对齐 Vue 组合式 onMounted 的直觉；不再要求开发者记忆"写同名顶层函数"）。**两端同源一份代码**：
//     · **MP**：编译器提取回调体 → 生成同名 Page 钩子（零每页引入；回调调用在产物中被编译吸收）；
//     · **Web**：本模块按语义降级（onShow→onMounted / onHide→onUnmounted / onResize→window resize…），
//       无对等实现的钩子在**调用时显式警告一次**（反黑盒，不静默）。
// - onReady/onUnload：MP 运行时渲染路径的钩子注册（既有语义）；Web 端为 no-op 兼容
// - createPage：Vue setup 结果（data/methods）→ Page 构造器配置
// - createComponent：同上，组件场景（lifetimes.attached/detached）
import { setDataBridge } from './setDataBridge'
import { adapter } from '@proteus-vue/shared'
import { onMounted, onUnmounted } from 'vue'

/** Vue onMounted → 小程序 onReady（页面级） */
export function onReady(hook: () => void): void {
  ;(getCurrentPage() as any)?.__onReadyHooks?.push(hook)
}

/**
 * 页面 onLoad 回调注册（类型提示全链路步骤 3）：
 * MP 端由编译产物处理（extractLifecycles 把顶层 onLoad(cb) 提取进 Page().onLoad 并注入路由参数）；
 * Web 端为 no-op 兼容（回调不执行，参数在 RouterView/路由层处理，MVP 不注入）——避免源码 onLoad 在 Web 端报错。
 * 参数类型由调用方声明（如 onLoad((options: PageOnLoad<'user-profile'>) => ...)），此处宽松兼容
 */
export function onLoad(_hook: (options?: any) => void): void {
  // Web 端 no-op
}

/** Vue onUnmounted → 小程序 onUnload（页面级） */
export function onUnload(hook: () => void): void {
  ;(getCurrentPage() as any)?.__onUnloadHooks?.push(hook)
}

/**
 * ★★★2026-10-04（生命周期体系）：**页面级 Web 降级注册**——在 Vue setup 里注册挂载/卸载回调。
 * MP 端这些调用被编译器提取（回调体 → Page 钩子），运行时函数**不会被调用**；此处仅 Web 语义。
 * 非组件上下文（无活跃 Vue 实例）时安全忽略（MP 运行时渲染路径不适用 Vue 钩子）。
 */
function registerWebHook(hook: () => void, kind: 'mount' | 'unmount'): void {
  try {
    if (kind === 'mount') onMounted(hook)
    else onUnmounted(hook)
  } catch {
    // 无活跃实例：忽略（MP 运行时路径 / 组件外调用）
  }
}

/** ★★2026-10-04：无 Web 对等的页面钩子——**调用即显式警告一次**（不静默吞掉开发者意图） */
const warnedNoWebEquiv = new Set<string>()
function warnNoWebEquiv(name: string): void {
  if (warnedNoWebEquiv.has(name)) return
  warnedNoWebEquiv.add(name)
  console.warn(
    `[proteus] ${name}() 在 Web 端暂无对等实现（MP 端由编译产物接管，两端语义不同）——该注册已忽略；` +
      '如需 Web 端对应能力：滚动类用容器事件 / 触底用 IntersectionObserver / 下拉用自定义手势，或等待后续批次。',
  )
}

/**
 * 页面显示（MP Page.onShow；Web ≈ onMounted——无 keep-alive 的路由下每次进页都重新挂载）。
 * `import { onShow } from '@proteus-vue/runtime'`；写一次两端生效。
 */
export function onShow(hook: () => void): void {
  registerWebHook(hook, 'mount')
}

/** 页面隐藏（MP Page.onHide；Web ≈ onUnmounted——离开路由即卸载） */
export function onHide(hook: () => void): void {
  registerWebHook(hook, 'unmount')
}

/** 页面尺寸变化（MP Page.onResize，载荷 {size:{windowWidth,windowHeight}}；Web = window resize 同载荷） */
export function onResize(hook: (e: { size: { windowWidth: number; windowHeight: number } }) => void): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    warnNoWebEquiv('onResize')
    return
  }
  const handler = (): void => {
    hook({ size: { windowWidth: window.innerWidth, windowHeight: window.innerHeight } })
  }
  try {
    onMounted(() => {
      window.addEventListener('resize', handler)
    })
    onUnmounted(() => {
      window.removeEventListener('resize', handler)
    })
  } catch {
    warnNoWebEquiv('onResize')
  }
}

/**
 * 页面生命周期（其余成员）：MP 端由编译器提取生成同名 Page 钩子；
 * **Web 端暂无对等**——调用时警告一次（见 warnNoWebEquiv；诚实边界，不静默）。
 */
export function onRouteDone(_hook: () => void): void { warnNoWebEquiv('onRouteDone') }
export function onTabItemTap(_hook: (e: { index: number; pagePath: string }) => void): void { warnNoWebEquiv('onTabItemTap') }
export function onReachBottom(_hook: () => void): void { warnNoWebEquiv('onReachBottom') }
export function onPageScroll(_hook: (e: { scrollTop: number }) => void): void { warnNoWebEquiv('onPageScroll') }
export function onPullDownRefresh(_hook: () => void): void { warnNoWebEquiv('onPullDownRefresh') }
/** 转发（MP：声明才显示菜单入口；Web 端走浏览器原生 share 或自研按钮——此处 no-op + 警告） */
export function onShareAppMessage(_hook: () => unknown): void { warnNoWebEquiv('onShareAppMessage') }
export function onShareTimeline(_hook: () => unknown): void { warnNoWebEquiv('onShareTimeline') }
export function onAddToFavorites(_hook: () => unknown): void { warnNoWebEquiv('onAddToFavorites') }
export function onSaveExitState(_hook: () => unknown): void { warnNoWebEquiv('onSaveExitState') }

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
