---
title: Web 运行时
order: 12
group: 运行期
---

# Web 运行时

Web 端的运行时就是**标准 Vue 3 + 标准 Vite**——零转换、零抽象税：

- `src/main.ts` 是标准入口：`createApp` + 路由 + 平台安装（`installWebPlatform` / `installFluidLayout`）
- 渲染走 VueDom 后端（`createRenderer(nodeOps)`），`ref` 是真实 Vue 响应式
- Vue devtools / HMR / 按路由 code-split 全部原生可用
- 页面路由表由 gen-routes 生成（`src/router/auto-routes.ts`），vue-router 承载

## 渲染后端视角

Web 端的渲染后端是 **VueDom**：`RenderBackend` SPI 的 nodeOps 直接映射 DOM 操作——这也使它成为所有后端的语义基准（conformance 以它为对照）。

## 平台层

`@proteus-vue/web` 提供小程序语义的 Web 模拟层（12 组件 + wx API 15 项 + weui.io 对齐），供兼容层页面在 Web 端预览——这是 Web 运行时的可选扩展，不影响纯标准写法的工程。

## 与小程序运行时的对照

| | Web 运行时 | 小程序运行时 |
|---|---|---|
| 入口 | `main.ts`（createApp） | `main.mp.ts`（app 骨架自动生成） |
| 响应式 | Vue Proxy 原生 | ref → setData（16ms 批量） |
| 路由 | vue-router（history） | 页面栈（app.json pages） |
| 样式 | 标准 CSS | WXSS（px→rpx） |
| 调试 | Vue devtools + HMR | 微信开发者工具 + debug:mp 决策链 |

## 下一步

- [小程序运行时](/docs/framework/runtime-mp)
