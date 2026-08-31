# @proteus-vue/router

Proteus 路由（router-plan M1/M2 + B11）——`createRouter` 工厂 + 守卫 + Skyline 转场 + `<route>` 扫描/校验/树构建。只依赖 `@proteus-vue/shared` 接口，**禁止直连 `wx`**（执行规则 4）。

## 导出

| API | 说明 |
|-----|------|
| `createRouter(routes, options?)` | **路由工厂**：注入路由表（应用侧由 `gen-routes` 生成的 auto-routes 提供）+ 可选 `auth` 检查器——不再全局单例 |
| `router.beforeEach(guard)` / `router.afterEach(guard)` | 实例级守卫注册（M6 三端一致；`requiresAuth` 自动守卫见 B11） |
| `navigateTo` / `navigateBack` / `redirectTo` / `switchTab` / `reLaunch` 等 | 导航方法（MP 走 `adapter`，Web 走 history） |
| `WEB_TRANSITION_MAP` / `MP_ROUTE_TYPE_MAP` / `webTransitionName` / `mpRouteType` / `isTransition` | **Skyline 转场映射**：业务声明式转场 → 双端实际转场类型（`transform-transition`） |
| `isSkyline` / `navigateWithCustomRoute` | Skyline 自定义路由（`wx.router`）探测与导航 |
| `generateWebRoutes` / `generateMpConfig` / `mergeAppJson` / `flattenNodes` / `toPageConfig` | 路由表 → Web routes / 小程序 `app.json` 配置 codegen |
| `StackSemantic` / `StylePlatform` | 导航栈语义（`stack-diff` 补丁 / 样式平台对齐） |
| `computeRoutePatch` / `applyRoutePatch` | 页面栈 diff 计算与应用（转场/返回一致性） |
| `parseDeepLinkUrl` / `matchPattern` / `isDeepLinkAllowed` / `resolveDeepLink` / `buildColdStartStack` | **深链（B11 超级应用）**：冷启动路由栈构建 + 白名单校验 |

## 子路径

| 子路径 | 说明 |
|--------|------|
| `@proteus-vue/router/types` | 路由类型（`RouteRecord` / `RouteParams` / `NavigateOptions`） |
| `@proteus-vue/router/scan` | `<route>` 块扫描（SFC / router 目录） |
| `@proteus-vue/router/tree` | 路由树构建 |
| `@proteus-vue/router/rules` | 路由规则校验 |
| `@proteus-vue/router/schema` | 路由 schema |
| `@proteus-vue/router/merge` | 路由配置合并 |
| `@proteus-vue/router/codegen` | 路由表 codegen（Web routes / app.json） |
| `@proteus-vue/router/navigation` / `stack-diff` / `deep-link` | 导航栈语义 / 栈 diff / 深链 |
| `@proteus-vue/router/transforms/transform-transition` | Skyline 转场映射 |

## 使用

```ts
import { createRouter } from '@proteus-vue/router'
import routes from './router/auto-routes' // gen-routes 生成

const router = createRouter(routes, {
  auth: () => Boolean(getToken()), // requiresAuth 自动守卫（B11）
})

router.beforeEach((to, from) => {
  if (to.meta?.needLogin && !isLogin()) return false // 拦截
})

await router.navigateTo('/pages/cart', { transition: 'slide' }) // 双端转场一致
```

## 设计要点

- **工厂化（拆包步骤 4）**：路由表由调用方注入，无全局单例——可测试、可多实例（微前端/子应用）
- **禁止直连 wx**：平台差异收敛在 `@proteus-vue/shared` adapter，路由层零平台分支
