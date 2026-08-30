// scripts/gen-routes.ts —— 编译期路由表生成器 CLI（拆包步骤 7：逻辑来自 @proteus-vue/plugin-vite npm 包）
// 运行：tsx scripts/gen-routes.ts（dev:mp / build:mp 前置步骤）
// 输出：src/router/auto-routes.ts + dist/mp-weixin/{app.json,page.json,component.json}
import config from '../proteus.config'
import { runGenRoutes } from '@proteus-vue/plugin-vite'

runGenRoutes({ config })
