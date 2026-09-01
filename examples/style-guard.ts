// examples/style-guard.ts —— ★G-31 style-safety 共享守卫实例
// 单一实例保证：业务页面 guard.patch 的拦截记录 → main.ts 传入 devtools Inspector 的同一 guard.records()
// （页面自建 guard 的记录不会进 Vue DevTools Style Safety Inspector）
import { createStyleGuard } from '@proteus-vue/style-safety'

export const styleGuard = createStyleGuard({ mode: 'loose' })
