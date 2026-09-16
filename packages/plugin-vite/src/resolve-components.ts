// packages/plugin-vite/src/resolve-components.ts —— ★语义组件库包根解析（2026-09-14 拆包）
//
// 背景：`@proteus-vue/components`（p-* 语义组件库）此前未拆包——组件源码在仓库根 `src/components/`，
//   靠 vite/tsconfig alias + `frameworkComponentsDir` 配置项定位（决策 #115）。拆包后它成为真正的
//   workspace/npm 包，**源码随包发布**（.vue 源文件在包内），故改为从**项目 node_modules 解析包根**。
//
// 为什么必须从 projectRoot 解析：vite config 会被 bundle 到 `os.tmpdir`，`import.meta.url` 基准失效；
//   且 pnpm 严格链接下 plugin 自身位置解析不到应用声明的框架包（同 resolveSharedModule 的踩坑）。
//
// 独立小模块（而非并入 plugin.ts）：gen-routes.ts 与 plugin.ts 都要用，且 **plugin.ts 已 import gen-routes**
//   ——若把解析器放进 plugin.ts 再由 gen-routes import，会形成循环依赖。本模块零内部依赖，可被两者安全引用。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/** 语义组件库包名 */
export const COMPONENTS_PKG = '@proteus-vue/components'

/**
 * 解析 `@proteus-vue/components` 的**包根**绝对路径（含 .vue 源码的目录）。
 * 解析顺序：① projectRoot/node_modules 真实解析（createRequire）→ ② 回退 projectRoot/node_modules/<pkg>（软链）
 * → ③ 兜底返回路径本身（调用方负责 existsSync 判断 + 告警）。
 */
export function resolveComponentsRoot(projectRoot: string): string {
  try {
    const pkgRequire = createRequire(path.join(projectRoot, 'package.json'))
    // 用 package.json 解析拿包根（不依赖 main 指向，源码包的 main 是 ./index.ts）
    const pkgJson = pkgRequire.resolve(`${COMPONENTS_PKG}/package.json`)
    return path.dirname(pkgJson)
  } catch {
    // 包未安装 / 解析失败 → 回退软链路径（调用方 existsSync 判定并告警）
    return path.join(projectRoot, 'node_modules', COMPONENTS_PKG)
  }
}

/** 判断组件库是否可解析（供 plugin 在无 p-* 场景下静默跳过） */
export function componentsRootExists(projectRoot: string): boolean {
  return fs.existsSync(resolveComponentsRoot(projectRoot))
}
