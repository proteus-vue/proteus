# 路由与转场

> Proteus 路由**编译期静态生成**：`scripts/gen-routes.ts` 扫描 `pagesDir` + `subPackages`，产出 `app.json` / `page.json` / `src/router/auto-routes.ts`（路由表 + 类型）。运行时**禁止动态注册页面/路由**（平台限制）。

## 路由声明（<route> 块）

每个页面 `.vue` 的 `<route>` 自定义块声明元信息：

```vue
<route>
{ "meta": { "title": "个人资料", "requiresAuth": true } }
</route>
```

支持的 `meta`：

| 字段 | 说明 |
|---|---|
| `title` | 页面标题（写入 `app.json` 或 `page.json`） |
| `isTab` | 是否为 tabBar 页面（**至少 2 个**，微信平台要求） |
| `requiresAuth` | 是否需登录（配合守卫使用） |
| 任意扩展 | 透传到路由记录，守卫中读取 |

目录结构推导命名路由：

```
examples/pages/
├── index.vue            → name: index        path: pages/index
├── user/index.vue       → name: user         path: pages/user/index
├── user/profile.vue     → name: user-profile path: pages/user/profile（parent: user）
└── subpackages/order/…  → name: order-pages-list  path: subpackages/order/pages/list（subPackage: order）
```

> ★**单一真相源（决策 #112）**：路由的一切声明只写页面 `<route>` 块——`meta`（title/isTab/requiresAuth/transition…）及可选 `path`/`name`/`parent`/`redirect`/`params`。`path`/`name` 缺省时由扫描按文件位置推导（零样板）；`auto-routes.ts` / `app.json` 是**生成物**（AUTO-GENERATED，勿手动编辑），meta 从 `<route>` 单向流向产物，**不存在第二处手写 meta**。

可选声明（推导的替代）：

```vue
<route>
{
  "path": "/user/profile",      // 显式 path（优先于文件推导）
  "name": "userProfile",        // 显式 name
  "parent": "user",             // 显式父子（覆盖 path 前缀推导）
  "redirect": "/user",         // 重定向（与 parent 互斥）
  "params": { "id": "string" } // 路由参数类型（类型提示全链路）
}
</route>
```

## Router API

```typescript
import { router } from '@proteus/router'

// 命名路由跳转（推荐）
router.push({ name: 'user-profile', params: { id: 1 } })
router.push({ name: 'user-profile', query: { from: 'list' } })

// 路径跳转（支持 query 字符串）
router.push({ path: 'pages/user/profile', params: { id: 1 } })

// 自定义转场（routeType 双端同 API）
router.push({ name: 'user-profile', routeType: 'halfScreen' })

// Tab 切换（switchTab，需 isTab）
router.push({ name: 'mine' })   // isTab 页面自动 switchTab
router.push({ name: 'mine', switchTab: true })

// 替换 / 重启
router.replace({ name: 'user-profile', params: { id: 2 } })
router.push({ name: 'index', reLaunch: true })

// 后退
router.back()
router.back(2)

// 当前栈深（MP 真实栈深；Web 恒为 1）
router.stackDepth
```

`NavigateOptions` 完整字段：

```typescript
interface NavigateOptions {
  name?: string          // 命名路由（优先）
  path?: string          // 页面路径
  params?: RouteParams   // 自动序列化为 query（encodeURIComponent）
  query?: RouteParams    // 与 params 合并
  routeType?: string     // Skyline 自定义转场类型
  replace?: boolean      // redirectTo
  reLaunch?: boolean     // reLaunch
  switchTab?: boolean    // switchTab（需 isTab）
}
```

### 路由守卫

```typescript
import { beforeEach, afterEach } from '@proteus/router/guards'

beforeEach((to, from) => {
  if (to.meta?.requiresAuth && !getToken()) {
    router.replace({ name: 'user' })
    return false          // 返回 false 取消导航
  }
})
afterEach((to, from) => {
  // 埋点等
})
```

### 模板内导航链接

```html
<!-- 静态链接 -->
<a href="/pages/user/profile">个人资料</a>
<a href="/pages/user/profile" route-type="halfScreen">半屏打开</a>

<!-- 动态链接 -->
<a :href="profileUrl">个人资料</a>

<!-- Vue Router 风格（可选） -->
<router-link to="/pages/showcase" route-type="scaleDown">转场演示</router-link>
```

编译为 `view` + `data-url` + `bindtap="proteusNavigateTo"`（handler 自动注入）。`<a @click>` 上有事件时不作为导航链接。

## 自定义路由转场（routeType）

`routeType` 是**双端同 API、各平台原生实现**：

| routeType | 小程序（Skyline `wx.router`） | Web（Vue `<Transition>`） |
|---|---|---|
| `halfScreen` | 半屏弹层（顶部留距 + 圆角 + 遮罩可点击关闭） | `halfscreen`：新页上滑半屏，旧页保持原位（barrier 0.4） |
| `slideUp` | 底部上滑全页 | `slide-up`：新页推入 + 旧页上移淡出 |
| `scaleDown` | 前页下沉缩放 + 新页滑入（层叠） | `scale`：旧页下沉缩放 + 新页覆盖（barrier 0.8） |
| `wx://bottom-sheet` | 微信官方半屏预设 | 降级为 `halfscreen` 等价转场 |
| 无（默认） | 微信默认导航 | `fade` 淡入淡出（out-in） |
| 返回 | 微信默认返回 | 反向转场（`-back`：B 滑出、A 恢复） |
| `replace` / `reLaunch` / tab | 平台默认 | `replace`（缩小淡出）/ `reset`（淡入）/ `tab`（淡入淡出） |

### 小程序端（Skyline）

- 内置预设（`halfScreen` / `slideUp` / `scaleDown`）源码在 `src/router/presets/`，由 `proteus.config.ts` 的 `customRoute.builders` 声明，构建时**内联进 `app.js`** 并注册——开发者无需手写注册代码。
- **手写覆盖预设**：`examples/main.mp.ts` 中同名 `wx.router.addRouteBuilder('halfScreen', fn)` 即可覆盖（插件检测同名后跳过自动注册，开发者优先）。
- **极简模式（★默认）**：`main.mp.ts` 只需写自定义 builder，`App()` / `onLaunch` 调试日志 / 错误捕获 / 预设注册由框架自动生成（插件检测入口不含 `App(` 时拼装 `src/runtime/appSkeleton.ts` 骨架）。
- **自定义新 builder**：`main.mp.ts` 中编写具名函数 + `addRouteBuilder`（约束：同文件静态可分析，不得 import 其它模块）。
- 预设实现遵循微信 `RouteBuilder` 契约（`opaque` / `barrierColor` / `handlePrimaryAnimation` worklet…），类型见 `src/shims/mp.d.ts`。

### Web 端（Vue Transition）

- 无 Skyline 对等机制：`routeType` 在 Web 由 `isSkyline()=false` 优雅忽略，但**导航行为一致**；视觉转场由 `examples/router/RouterView.vue` 用 Vue `<Transition>` 层叠实现（`.page` 绝对定位重叠 + `.route-barrier` 遮罩纯 CSS z-index 方案 + 反向转场按 `history.state.proteusIndex` 栈深判断）。
- 支持 `prefers-reduced-motion`（无障碍：关闭全部转场）。

## 平台硬边界

| 边界 | 说明 |
|---|---|
| 自定义路由**不能从 tabBar 页发起** | 半屏/转场从 tab 页发起点不生效（`applyAnimatedStyle can not find corresponding nodes`），必须从非 tab 页发起（★真机确诊） |
| `tabBar.list` ≥ 2 项 | 微信平台校验；`gen-routes` 不足时告警并忽略 tabBar |
| Skyline 依赖 | `app.json` 需 `lazyCodeLoading: "requiredComponents"`（gen-routes 按 `skyline` 开关自动补齐）；页面级 `page.json` 声明 `"renderer": "skyline"` + `componentFramework: "glass-easel"` |
| 页面栈 ≤ 10 层 | `stackDepth ≥ 9` 时自动降级 `redirectTo`（仅 MP 约束，Web 不受限） |
| `switchTab` 传参被忽略 | 平台行为 |
| 自定义路由转场仅连续 Skyline 页面间生效 | 基础库 ≥ 2.29.2 |
| 运行时禁止动态注册页面/路由 | 编译期静态声明（`app.json` pages 数组） |

## 常见问题

**Q：为什么半屏跳转从首页（tab 页）点没效果？**
tabBar 页面是自定义路由的禁地（见硬边界表）。示例演示链接已移入非 tab 页（如"用户中心"）。

**Q：`pages/pages/...` 页面找不到？**
微信 `navigateTo` 相对路径会拼接成 `pages/pages/...`。导航 url 必须保留前导 `/`（编译器已保证，勿手动 `replace(/^[/]/)`）。
