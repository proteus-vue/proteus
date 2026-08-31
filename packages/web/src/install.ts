// packages/web/src/install.ts
// ★installWebPlatform：注册框架内置组件（@proteus-vue/built-in-components）+ wx API 模拟（wx.*）
// 用法：main.ts: installWebPlatform(app)
// 组件层（proteus-*）与 wx API 模拟层分离后，本文件仅做聚合安装（依赖方向：web → built-in-components）
import type { App } from 'vue'
import { installBuiltInComponents } from '@proteus-vue/built-in-components'
import { installWxApi } from './wx'

/** 注册框架内置组件（proteus-*）+ wx API 模拟（wx.* 全局注入） */
export function installWebPlatform(app: App): App {
  installBuiltInComponents(app)
  installWxApi()
  return app
}
