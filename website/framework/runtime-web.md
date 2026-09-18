---
title: Web 运行时
order: 12
group: 运行期
---

# Web 运行时

Web 端的运行时就是**标准 Vue 3 + 标准 Vite**——零转换、零抽象税：

- `src/main.ts` 是标准入口：`createApp` + 路由 + 平台安装（`installWebPlatform` / `installFluidLayout`）
- `ref` 是真实 Vue 响应式——没有 setData 桥、没有批量窗口
- Vue devtools / HMR / 按路由 code-split 全部原生可用
- 页面路由表由 gen-routes 生成（`src/router/auto-routes.ts`），vue-router 承载

## 平台安装（installWebPlatform）

`@proteus-vue/web` 的 `installWebPlatform(app)` 做两件事（组件层与 wx API 模拟层分离，此处聚合）：

| 安装项 | 内容 |
|---|---|
| `installBuiltInComponents(app)` | 注册框架内置组件（proteus-*） |
| `installWxApi()` | 全局注入 **wx API Web 模拟**（`WxApi` 接口全量） |

## wx API Web 模拟层（WxApi 接口）

存量小程序代码（`wx.*` 调用）在 Web 端预览的兼容面——以 PlatformAdapter 路由 + 浏览器能力对齐小程序语义：

| 分类 | 覆盖 | 实现 |
|---|---|---|
| 路由（full） | `navigateTo` / `redirectTo` / `reLaunch` / `switchTab` / `navigateBack` / `getCurrentPages` / `pageScrollTo` | 代理 PlatformAdapter——Web 端 history 驱动 RouterView 转场；`pageScrollTo` → `window.scrollTo` |
| 存储（full） | `setStorageSync` / `getStorageSync` / `removeStorageSync` / `clearStorageSync` | localStorage + JSON 序列化（对齐小程序语义） |
| 系统信息（full） | `getSystemInfoSync` / `getDeviceInfo` | 浏览器信息 |
| 交互（full） | `showToast` / `hideToast` / `showLoading` / `hideLoading` / `showModal` / `showActionSheet` | 自定义 DOM UI 对齐微信表现；`showModal` 支持 WeUI 三种对话框（双按钮/单按钮/可输入），返回对齐小程序 `{ confirm, cancel, errMsg }` |
| 网络（partial） | `request` | fetch 封装 |
| 业务能力 | `requestPayment` 等 | 无 Web 对等——触发自定义钩子 `proteusWebPay` 或警告降级 |

## 渲染后端视角

Web 端的渲染后端是 **VueDom**（`RenderBackend` SPI）：nodeOps 直接映射 DOM 操作，事件归一化（`onXxx` prop → `addEventListener`）；注入 `documentLike`（测试传 fake/happy-dom，运行时用全局 document）——这也使它成为所有后端的语义基准（conformance 以它为对照）。

## 与小程序运行时的对照

| | Web 运行时 | 小程序运行时 |
|---|---|---|
| 入口 | `main.ts`（createApp） | `main.mp.ts`（app 骨架自动生成） |
| 响应式 | Vue Proxy 原生 | ref → setData（16ms 批量 + 深层 diff） |
| 路由 | vue-router（history） | 页面栈（app.json pages） |
| 样式 | 标准 CSS | WXSS（px→rpx + scoped 类名后缀） |
| 事件 | 原生事件对象 | `eventField` 归一（detail/target 双取） |
| 调试 | Vue devtools + HMR | 微信开发者工具 + debug:mp 决策链 |

## 下一步

- [小程序运行时](/docs/framework/runtime-mp)
- [逻辑层与视图层](/docs/framework/logic-view)
