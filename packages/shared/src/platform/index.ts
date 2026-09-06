// src/platform/index.ts
// 平台适配器出口（P3-5）：按构建 mode 选择实现，业务代码只 import 这个实例
// ★拆包解耦（docs/packages.md 步骤 1）：删 proteus.config 依赖——mode 由 Vite --mode 静态替换
// ★#491 修复（小程序启动白屏）：examples 走 workspace 链接 dist（决策 #115）后，shared 的 esbuild
//   预打包产物里 import.meta.env?.MODE 是可选链形态，Vite 的 import.meta.env 替换只认
//   `import.meta.env.X` 精确形态（?. 不被替换）→ mp 运行时 isMP 恒 false → mp 包执行
//   createWebAdapter() → 读 location.pathname（mp 逻辑层无 location）→ 启动即崩
//   （TypeError: Cannot read properties of undefined (reading 'pathname')，模块求值阶段）。
//   修复：运行时探测兜底 + 编译期 mode 替换仍生效——双端任一消费路径（vite 源码 / dist 预打包）都正确。
//   ★window 前置守卫（同源教训 devtools M8）：@proteus-vue/web wx 模拟层会注册全局 wx，
//     window 存在必须判 web——wx 探测只在 window 缺席时生效。
import type { PlatformAdapter } from './adapter'
import { createMpAdapter } from './mp-adapter'
import { createWebAdapter } from './web-adapter'

// 运行时探测：小程序逻辑层无 window/DOM、有全局 wx；浏览器/SSR/测试环境 window 或 wx 不满足
// （typeof 守卫——mp 产物安全铁律：全局标识符不裸引用）
function detectMPRuntime(): boolean {
  // window 存在 → 必为 web（wx 模拟层注册的全局 wx 不得误判——devtools-panel M8 用户实测回归同源）
  if (typeof window !== 'undefined') return false
  try {
    // getSystemInfoSync 基础库 2.x 起稳定存在（3.x 标记废弃但仍可用）；getWindowInfo 为新一代 API——
    // 二者取或，覆盖基础库演进
    return (
      typeof wx !== 'undefined' &&
      (typeof wx.getSystemInfoSync === 'function' || typeof (wx as { getWindowInfo?: unknown }).getWindowInfo === 'function')
    )
  } catch (e) {
    return false
  }
}

// 编译期 mode：Vite 按 --mode 静态替换（web / mp-weixin）——源码消费时为字面量可摇树；
// dist 预打包消费时 vite 不转换 node_modules → 此值为 undefined → 由运行时探测兜底
const modeMP = ((import.meta as any).env?.MODE as string) === 'mp-weixin'

const isMP = modeMP || detectMPRuntime()

/** 全局唯一适配器实例 */
export const adapter: PlatformAdapter = isMP ? createMpAdapter() : createWebAdapter()
