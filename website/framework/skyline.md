---
title: Skyline 与 WebView
order: 17
group: 运行期
---

# Skyline 与 WebView

小程序端 Skyline 是新一代原生渲染引擎（自绘，非 WebView）。Proteus 以 Skyline 优先：**Web 全功能 + 小程序 Skyline 优先，WebView 降级仅保证可运行**。

> **端范围**：本页描述 **mp-weixin** 端内的双渲染引擎。跨端视角：Web = vue-dom（DOM）、App = UIKit/Jetpack/ArkUI 原生、Flutter = Widget——同一语义模型、各端各自的原生引擎，对照见 [端与成熟度](/docs/framework/ends-matrix)。

## 工程里的 Skyline 字段（全部自动生成）

| 字段 | 位置 | 生成方 |
|---|---|---|
| `lazyCodeLoading: "requiredComponents"` | `app.json` | gen-routes（skyline 开关开启时写入） |
| `renderer: "skyline"` | 各页 `page.json`（页面级声明） | gen-routes writePageJsons |
| `rendererOptions.skyline.defaultDisplayBlock` | `app.json` | gen-routes（skylineLayout 可配） |
| `requiredComponents` | page.json | Skyline 渲染前提（微信平台校验）——gen-routes 自动声明 |

无需手配：skyline 开关在 `proteus.config.ts`，其余全部由 gen-routes 按页生成。

## Skyline 与 WebView 的结构差异

| 维度 | Skyline | WebView |
|---|---|---|
| 路由模型 | MPA（页面独立渲染） | 可近似 SPA 心智 |
| 嵌套页面 | 降级平铺 + `meta.__parent` 保留父链 | children 嵌套 |
| 转场 | `meta.transition` → `routeType`（自定义路由 + builder） | CSS 转场 |

Proteus 的 gen-routes 把这些差异吸收在**编译期**：同一份 `<route>` 声明，双端各自生成正确的结构。

## 诚实边界

- Skyline 能力建议用**真实 AppID + 真机**验证（基础库 ≥ 2.29.2）
- WebView 降级路径**仅保证可运行**，不承诺 Skyline 级体验
- `transition` 转场依赖 `wx.navigateTo({ routeType })` + 已注册 builder，page.json 无需声明

## 下一步

- [组件化与语义命名](/docs/framework/components-model)
