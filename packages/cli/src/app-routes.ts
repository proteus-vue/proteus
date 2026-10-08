// packages/cli/src/app-routes.ts
// ★全端统一导航产物（auto-routes.ts）的路径解析 —— **唯一实现**。
//
// 【为什么需要它（用户实测：新工程 → 手机 跑不起来）】
//   `gen-routes` 按 `proteus.config.ts` 的 `router.routesOutput` 写产物（**缺省 `src/router/auto-routes.ts`**），
//   而 App 侧三条消费通路（`app-content` / `app-runtime-content` / `app-bundle`）此前**硬编码**
//   `<root>/router/auto-routes.ts` ⇒ 与配置器口径不一致：
//     · `css-conformance` / `superapp` / `examples` 恰好把 `routesOutput` 设为 `router/auto-routes.ts`
//       （**巧合对上**，所以主仓测试全绿、缺陷长期隐身）；
//     · **create-proteus 模板**用缺省 `src/router/auto-routes.ts` ⇒ 新工程
//       `proteus build --target android --package` 报「缺 router/auto-routes.ts（产物其实在 src/router/）」
//       —— 真实用户旅程当场失败。
//   ⇒ 三处统一走本解析器（honor 配置；缺配置/加载失败时回退 `router/auto-routes.ts`，兼容旧工程）。
import fs from 'node:fs'
import path from 'node:path'
import type { ProteusConfig } from '@proteus-vue/plugin-vite'

export interface ResolvedAppRoutes {
  /** auto-routes.ts 的绝对路径 */
  file: string
  /** 项目配置（若可读到；返回给调用方复用——避免同一函数内二次解析 `proteus.config.ts`） */
  config?: ProteusConfig
}

/**
 * 解析项目的 auto-routes.ts 绝对路径（honor `router.routesOutput`）。
 * @param root 项目根（含 `proteus.config.ts`）
 */
export async function resolveAppRoutes(root: string): Promise<ResolvedAppRoutes> {
  let config: ProteusConfig | undefined
  const cfgPath = path.join(root, 'proteus.config.ts')
  if (fs.existsSync(cfgPath)) {
    try {
      const { loadProteusConfig } = await import('./config-loader')
      config = (await loadProteusConfig(cfgPath)).config
    } catch {
      /* 无配置 / 加载失败 ⇒ 回退缺省路径（不阻断——保持既有"容忍"行为） */
    }
  }
  const routesOutput = config?.router?.routesOutput
  const file = routesOutput ? path.resolve(root, routesOutput) : path.join(root, 'router', 'auto-routes.ts')
  return { file, config }
}
