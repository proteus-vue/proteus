// examples/scripts/gen-routes.ts —— 路由表生成器 CLI（读 examples/proteus.config）
// 运行：tsx scripts/gen-routes.ts（dev:mp / build:mp 前置步骤）
// 输出：router/auto-routes.ts + dist/mp-weixin/{app.json,page.json,component.json}
import config from '../proteus.config'
import { runGenRoutes } from '@proteus/plugin-vite'

runGenRoutes({ config })
