// packages/plugin-vite/src/cli.ts —— gen-routes CLI 入口（拆包步骤 5）
// 运行：tsx packages/plugin-vite/src/cli.ts（dev:mp / build:mp 前置步骤）
// 读项目根 proteus.config.ts → runGenRoutes（库逻辑在 gen-routes.ts，本文件仅组装）
import { runGenRoutes } from './gen-routes'

// 动态 import 需带 .ts 扩展名（Node ESM 解析 + tsx loader 拦截）；src/ → 项目根为三级
const { default: config } = await import('../proteus.config.ts')
runGenRoutes({ config })
