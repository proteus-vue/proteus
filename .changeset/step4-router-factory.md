---
'@proteus-vue/router': minor
---

拆包步骤 4：router 工厂化 + 路由规划 M1/M2 落地

- `createRouter(routes)` 工厂（删全局单例），guards 同工厂化（routeMap 由 push 注入）
- `RouteParamsByName` 改空基接口 + 应用侧 auto-routes `declare module` 模块扩充注入（vue-router 同款模式，push 泛型/PageOnLoad 零回归）
- 新增 M1 `schema.ts`（RouteValidationError 含 loc + 手写校验）/ `scan.ts`（@vue/compiler-sfc 解析 + 行号定位）
- 新增 M2 `tree.ts`（嵌套树：path 前缀推导 + parent 显式优先 + 环检测 + 稳定排序）/ `merge.ts`（meta 深合并限深 3）
- auto-routes 随应用存放（gen-routes `routesOutput` 指向应用侧），RouterView 改相对导入
