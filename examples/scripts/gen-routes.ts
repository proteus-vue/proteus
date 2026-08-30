// examples/scripts/gen-routes.ts —— 路由表生成器 CLI（读 examples/proteus.config）
// 运行：tsx scripts/gen-routes.ts（dev:mp / build:mp 前置步骤）
// 输出：router/auto-routes.ts + dist/mp-weixin/{app.json,page.json,component.json}
// ★module-plan B5：扫描模块契约（proteus-module.config.ts）→ 分包依赖（dependencies）/ preloadRule 生成
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import config from '../proteus.config'
import { runGenRoutes } from '@proteus-vue/plugin-vite'
import { scanModuleConfigs } from '@proteus-vue/module'

// ★框架内置组件目录显式传入（组件库未拆包，决策 #115）：monorepo 根 src/components（本文件在 scripts/ 下，需 ../../）
async function main(): Promise<void> {
  const frameworkComponentsDir = fileURLToPath(new URL('../../src/components', import.meta.url))
  // ★B5：模块契约扫描（async）→ 分包依赖/preloadRule
  const scan = await scanModuleConfigs(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
  const moduleConfigs = scan.modules
    .filter((m) => m.ok && m.name)
    .map((m) => ({ name: m.name!, chunk: m.chunk, dependencies: m.dependencies, preload: m.preload }))
  if (moduleConfigs.length) console.log(`[gen-routes] 模块契约 ${moduleConfigs.length} 个（分包依赖/preloadRule 生成，module-plan B5）`)
  runGenRoutes({ config, frameworkComponentsDir, moduleConfigs })
}

main().catch((err: Error) => {
  console.error(`[gen-routes] ${err.message}`)
  process.exit(1)
})
