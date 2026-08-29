// examples/scripts/gen-routes.ts —— 路由表生成器 CLI（读 examples/proteus.config）
// 运行：tsx scripts/gen-routes.ts（dev:mp / build:mp 前置步骤）
// 输出：router/auto-routes.ts + dist/mp-weixin/{app.json,page.json,component.json}
import { fileURLToPath, URL } from 'node:url'
import config from '../proteus.config'
import { runGenRoutes } from '@proteus/plugin-vite'

// ★框架内置组件目录显式传入（组件库未拆包，决策 #115）：monorepo 根 src/components（本文件在 scripts/ 下，需 ../../）
runGenRoutes({ config, frameworkComponentsDir: fileURLToPath(new URL('../../src/components', import.meta.url)) })
