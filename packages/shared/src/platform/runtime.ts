// packages/shared/src/platform/runtime.ts
// ★Skyline 线收口（2026-09-11）：运行时 / 渲染器判定 SSOT —— 全框架唯一判定点。
//   背景：此前多处各自 `typeof wx !== 'undefined'` 猜测，造成三类真问题：
//   ① Skyline vs WebView 从不区分（getDeviceInfo 恒 isSkyline:true；组件能力表无法分流）
//   ② Web 污染：@proteus-vue/web 的 wx 模拟层注册全局 wx 后，无 window 守卫的探测误选小程序分支
//   ③ 各包判定口径漂移（api / capabilities / 组件 runtime / router 各写一份）
//   本模块给出权威实现，消费方 import 本模块，禁止再写裸 typeof wx 判定。
//
// ★MP 产物安全铁律：全局标识符一律 typeof 守卫，不裸引用（无 window / 无 wx 的环境不崩）。

/** 运行时类别：web=浏览器/SSR/Node；mp=小程序（Skyline 或 WebView 渲染器） */
export type ProteusRuntime = 'web' | 'mp'

/** 小程序渲染器：skyline=微信自研渲染引擎；webview=传统 WebView 渲染 */
export type MpRenderer = 'skyline' | 'webview'

// 构建期宏（vite/define 注入 src/mp 入口；非 mp 产物无此全局——typeof 守卫安全）
declare const __PROTEUS_SKYLINE__: boolean

/**
 * 是否小程序运行时。
 * ★window 前置守卫：window 存在 → 必为 web（@proteus-vue/web 的 wx 模拟层注册全局 wx，
 *   不得误判；devtools-panel M8 用户实测回归同源）。此守卫是本 SSOT 与旧实现的核心差异。
 */
export function detectRuntime(): ProteusRuntime {
  if (typeof window !== 'undefined') return 'web'
  try {
    const g = globalThis as {
      wx?: { getSystemInfoSync?: unknown; getWindowInfo?: unknown }
    }
    const w = g.wx
    if (
      typeof w !== 'undefined' &&
      w &&
      (typeof w.getSystemInfoSync === 'function' || typeof w.getWindowInfo === 'function')
    ) {
      return 'mp'
    }
  } catch {
    /* 探测失败一律按 web（fail-safe：不误认小程序） */
  }
  return 'web'
}

/** 便捷：是否小程序运行时 */
export function isMiniProgram(): boolean {
  return detectRuntime() === 'mp'
}

/**
 * 小程序渲染器判定（Skyline vs WebView）。
 * 双通道：① 构建期宏 __PROTEUS_SKYLINE__（vite define = config.skyline，最可靠）
 *         ② 运行时 wx.getSystemInfoSync().renderer === 'skyline'（未注入宏的消费路径兜底）
 * 非小程序运行时 → 返回 'webview'（调用方应先判 detectRuntime）——不抛错，fail-safe。
 */
export function detectMpRenderer(): MpRenderer {
  if (typeof __PROTEUS_SKYLINE__ !== 'undefined' && __PROTEUS_SKYLINE__) return 'skyline'
  try {
    const g = globalThis as { wx?: { getSystemInfoSync?: () => { renderer?: string } } }
    const w = g.wx
    if (w && typeof w.getSystemInfoSync === 'function') {
      return w.getSystemInfoSync().renderer === 'skyline' ? 'skyline' : 'webview'
    }
  } catch {
    /* getSystemInfoSync 异常（低版本/权限）→ 按 webview（保守：不启用 Skyline 专有能力） */
  }
  return 'webview'
}

/** 是否 Skyline 渲染环境（小程序 + renderer=skyline） */
export function isSkylineRuntime(): boolean {
  return detectRuntime() === 'mp' && detectMpRenderer() === 'skyline'
}
