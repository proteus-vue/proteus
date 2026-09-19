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

/**
 * ★全局唯一键（2026-09-19 修「外部用户必踩」的包副本分裂）：
 *   `adapter` 是**有状态单例**（Web 端内部维护页面栈 + onPageLoad listeners）。
 *   当依赖树里出现**两份 @proteus-vue/shared**（npm 嵌套去重常见：顶层一份，某依赖再带一份），
 *   模块会被求值两次 → **两个独立实例** → 一方 `onPageLoad` 注册、另一方 `navigateTo` emit
 *   → **URL 变了但视图永不更新**，且**没有任何报错**（外部实战报告实测：极难定位）。
 *   修法：实例挂到 `globalThis`（跨副本共享——同 `runtime/probe.ts` 的注册表做法），
 *   同一 JS 上下文内所有副本复用同一实例。
 *
 *   ★键按**平台判定结果**区分（`__PROTEUS_ADAPTER_MP__` / `__PROTEUS_ADAPTER_WEB__`）：
 *   平台判定取决策于全局环境（window/wx）。若用单一键，测试场景（stub 全局后重载模块）与
 *   「同一上下文先后出现两种判定」都会错误复用先前实例——既有 `platform-adapter.test.ts`
 *   正是这样验证判定的（`vi.resetModules()` + stub + 重新 import），单一键会让判定被冻结。
 *   按判定分键后：同平台跨副本仍共享（修复目标），判定变化则各自实例（语义正确）。
 */
const ADAPTER_GLOBAL_KEY_WEB = '__PROTEUS_ADAPTER_WEB__'
const ADAPTER_GLOBAL_KEY_MP = '__PROTEUS_ADAPTER_MP__'

type AdapterGlobal = typeof globalThis & {
  [ADAPTER_GLOBAL_KEY_WEB]?: PlatformAdapter
  [ADAPTER_GLOBAL_KEY_MP]?: PlatformAdapter
}

function resolveAdapter(): PlatformAdapter {
  const g = globalThis as AdapterGlobal
  const key = isMP ? ADAPTER_GLOBAL_KEY_MP : ADAPTER_GLOBAL_KEY_WEB
  const existing = g[key]
  if (existing) return existing
  const created: PlatformAdapter = isMP ? createMpAdapter() : createWebAdapter()
  g[key] = created
  return created
}

/** 全局唯一适配器实例（★跨包副本共享：同平台下同一 JS 上下文内始终同一实例，见上方键注释） */
export const adapter: PlatformAdapter = resolveAdapter()
