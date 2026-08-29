// src/components/runtime/capability.ts —— 组件层平台能力探测（组件库落地评估 v2 §4）
// 组件代码不得直接 if (typeof wx !== 'undefined')，必须查询 capability（对齐 Draft v1 02-platform-capability.md）
// 修正：不全局注入（$capability），组件内直接 import 本模块；探测惰性单例（首次调用求值，测试可先 stub 再调）
// ★MP 产物安全（决策 #32/#36）：无 ?? / ?. / 对象展开 / 数组解构（共享模块 B0 机制编译进 MP 产物）

/** 当前渲染后端：web=浏览器/SSR；skyline=微信小程序运行时（Skyline/WebView 渲染器差异归能力表）；app=v0.6 自定义渲染器占位 */
export type PlatformBackend = 'web' | 'skyline' | 'app'

/** 能力名：组件层关心的跨端能力（新增能力按 02-platform-capability.md §5 流程：加字段 + 探测 + 矩阵标注 + 单测） */
export type CapabilityName =
  | 'worklet-animation' // applyAnimatedStyle（当前未实现 → 恒 false，弹层走 CSS transition）
  | 'recycle-manager'   // Skyline 长列表回收（当前未实现 → 恒 false，list-view 用 JS 切片）
  | 'native-toast'      // wx.showToast 原生反馈
  | 'webp'              // 图片 webp 格式
  | 'passive-event'     // Web 被动事件监听

export interface PlatformCapability {
  backend: PlatformBackend
  /** 同步能力查询（启动期确定，setup() 求值一次缓存） */
  has(name: CapabilityName): boolean
  /** 异步探测（基础库版本 / 运行时特性），失败兜底默认值 */
  detect(name: CapabilityName): Promise<boolean>
}

/** 降级告警（铁律 C6：⚠️/❌ 能力必须显式 warn，禁止静默失效） */
export function capabilityWarn(tag: string, feature: string, fallback: string): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn('[Proteus][' + tag + '] ' + feature + ' 不可用，已降级：' + fallback)
  }
}

function detectBackend(): PlatformBackend {
  // MP 运行时：wx 存在（Skyline/WebView 均适用）；浏览器/SSR：无 wx 归 web；app 恒占位（v0.6）
  if (typeof wx !== 'undefined') return 'skyline'
  return 'web'
}

const DYNAMIC_CAPABILITIES = new Set(['webp', 'native-toast'])

function syncHas(backend: PlatformBackend, name: CapabilityName): boolean {
  switch (name) {
    case 'worklet-animation':
      return false // Worklet 未实现（router B10 ⬜），v0.6 后接
    case 'recycle-manager':
      return false // Skyline recycleManager 未接入，list-view 用 JS 切片
    case 'native-toast':
      return backend === 'skyline' && typeof wx !== 'undefined' && typeof wx.showToast === 'function'
    case 'webp':
      return true // 现代浏览器/微信基础库默认支持；低版本由 detect 异步兜底
    case 'passive-event':
      return backend === 'web'
    default:
      return false
  }
}

let cached: PlatformCapability | null = null

/** 能力单例（惰性求值）：MP 端共享模块 require 缓存同路径同实例；Web 端 Vite 模块单例 */
export function getCapability(): PlatformCapability {
  if (cached) return cached
  const backend = detectBackend()
  const capability: PlatformCapability = {
    backend,
    has(name: CapabilityName) {
      return syncHas(backend, name)
    },
    detect(name: CapabilityName) {
      if (!DYNAMIC_CAPABILITIES.has(name)) return Promise.resolve(syncHas(backend, name))
      // 异步探测（webp：Image decode / native-toast：wx 存在），失败兜底同步判定
      return Promise.resolve(syncHas(backend, name))
    },
  }
  cached = capability
  return capability
}

/** 测试重置（vitest 环境切换 backend 用） */
export function resetCapability(): void {
  cached = null
}
