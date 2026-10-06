// shims/nav.d.ts —— 框架模板约定：`$nav('目标')` 导航一等动作（B1）
//
// 模板里 `@tap="$nav('detail')"` 编译成 Vapor 的 nav 动作；Web/MP 原生执行、App 经统一运行期执行。
// ★必须是**模块增强**（顶层 import ⇒ 本文件是模块 ⇒ 才能 apply 到真实 `vue` 模块）——
//   在无 import/export 的 ambient 文件里写 `declare module 'vue'` 会**遮蔽**真实类型
//   （实测：`vue` 的 computed/ref 立即报 “no exported member”）。
import 'vue'

declare module 'vue' {
  interface ComponentCustomProperties {
    $nav: (target: string) => void
  }
}
