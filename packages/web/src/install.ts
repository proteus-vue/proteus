// packages/web/src/install.ts
// ★installWebPlatform：注册框架内置组件（@proteus-vue/built-in-components）+ wx API 模拟（wx.*）
// 用法：main.ts: installWebPlatform(app)
// 组件层（proteus-*）与 wx API 模拟层分离后，本文件仅做聚合安装（依赖方向：web → built-in-components）
import type { App } from 'vue'
import { installBuiltInComponents } from '@proteus-vue/built-in-components'
import { installWxApi } from './wx'
import { installMountLayers } from './mount-layers'
import { installEnvVars } from './env-vars'

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
  // ★★★内置环境变量 · E 组设备标量（决策 #598）：--pf-hairline = 1/devicePixelRatio 注入 :root
  installEnvVars()
  // ★★★$nav 平台级导航全局（Web 侧 · 2026-10-08 · 决策 #616）：模板 `@tap="$nav('routeName')"`
  //   编译为 `n.$nav(...)`（setup ctx）⇒ 注册为 **globalProperty** 让任意组件解析到它；
  //   实现委托给路由登记到 `globalThis.$nav` 的函数（`createRouter` 时登记，路由记录为唯一事实源）。
  //   与 App（编译器编成 nav 动作）/ MP（编译器注入页方法 `this.$nav`）**三端同一写法**。
  ;(app.config.globalProperties as Record<string, unknown>).$nav = (target: string): void => {
    const g = globalThis as { $nav?: (t: string) => void }
    if (typeof g.$nav === 'function') g.$nav(target)
    else
      console.warn(
        `[proteus] $nav('${target}') 不可用：请先 createRouter(routes)（它在创建时登记 $nav 全局）。`,
      )
  }
  return app
}
