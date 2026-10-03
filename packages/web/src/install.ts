// packages/web/src/install.ts
// ★installWebPlatform：注册框架内置组件（@proteus-vue/built-in-components）+ wx API 模拟（wx.*）
// 用法：main.ts: installWebPlatform(app)
// 组件层（proteus-*）与 wx API 模拟层分离后，本文件仅做聚合安装（依赖方向：web → built-in-components）
import type { App } from 'vue'
import { installBuiltInComponents } from '@proteus-vue/built-in-components'
import { installWxApi } from './wx'
import { installMountLayers } from './mount-layers'

/**
 * 注册框架内置组件（proteus-*）+ wx API 模拟（wx.* 全局注入）+ ★三层挂载组件（GP3-a）。
 *
 * ★为什么三层挂载随平台安装一起注册（而不是让用户显式装）：它是**声明式结构能力**——
 *   App.vue 里写 `<global-layer>` 就该能用（与 `<view>` 需要 installWebPlatform 同理）；
 *   未使用的应用只是多 4 个全局组件注册（零运行时开销，无 DOM 产出）。
 */
export function installWebPlatform(app: App): App {
  installBuiltInComponents(app)
  installWxApi()
  installMountLayers(app)
  return app
}
