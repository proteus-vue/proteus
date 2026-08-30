// examples/src/shims/proteus-web.d.ts
// ★14-mp-first-semantics：全局 wx 类型（小程序语义 API——MP 端原生，Web 端 installWxApi 注入模拟层）
import type { WxApi } from '@proteus-vue/web'

declare global {
  const wx: WxApi
}

export {}
