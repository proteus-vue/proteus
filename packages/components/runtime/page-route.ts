// packages/components/runtime/page-route.ts —— 当前页 route 的唯一实现
//
// ★2026-11-12（外部 F-36，blocker）：
//   组件里三处（p-auth-gate / p-loading-host / p-toast-host）直接写全局 `getCurrentPages?.()`，
//   那是**小程序运行时全局**——在 .vue 源码里既没有类型声明，也没有 Web 实现：
//     · 消费者 `vue-tsc --noEmit` 报 TS2304: Cannot find name 'getCurrentPages'
//       → 而 `proteus build` 在 vite build 之前先跑 vue-tsc ⇒ **整条构建链中断**
//     · Web 端该全局不存在 ⇒ 恒走 catch/空值分支
//
//   而框架**早就有**平台无关抽象 `adapter.getCurrentPages()`（shared/platform/adapter.ts:29，
//   MP 走 `wx` 页面栈投影、Web 返回长度 1 的当前页）——又是「能力与接线分离」：
//   抽象写好了，消费方却绕过它直连平台 API。本项目对这类写法的门禁是 `check:no-platform-api`。
//
//   故三处 `routeOf()` 收敛到本文件一处实现：组件只依赖本函数，不再触碰平台全局。

import { adapter } from '@proteus-vue/shared'

/**
 * 当前页 route（栈顶）。
 * @param fallback 无页面栈时的返回值（各组件原有语义不同：auth-gate/toast-host 用 `'unknown'`，
 *                 loading-host 用 `''`——保持调用方原样，避免改变既有过滤/清理判据）
 */
export function currentPageRoute (fallback = ''): string {
  try {
    const pages = adapter.getCurrentPages() ?? []
    if (!pages.length) return fallback
    const top = pages[pages.length - 1]
    return top?.route ?? fallback
  } catch {
    // 适配器缺失 / 平台异常：保持调用方原语义（不抛，组件继续工作）
    return fallback
  }
}
