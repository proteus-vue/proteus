---
title: 端与成熟度
order: 6
group: 总览
---

# 端与成熟度

> 本页由端注册表（`website/src/ends.ts`，原则 W-7 SSOT）驱动。**接入新端 = 注册表加一行 + 状态推进**——文档端矩阵不允许手写第二份端清单。

## 端注册表

| 端 | 渲染引擎 | 逻辑层运行时 | 持久化 | 状态工厂 | 状态 |
|---|---|---|---|---|---|
| Web SPA | vue-dom | Vue 3（同线程） | localStorage | `createWebPinia()` | ✅ 已落地 |
| 微信小程序 | skyline（WebView 降级） | 独立 JS 运行时 | wx storage（防抖） | `createMpPinia()` | ✅ 已落地 |
| Headless（SSR/测试） | headless | Node | memory | `createSsrPinia()` | ✅ 已落地（工具档） |
| iOS 原生 | native-ios（UIKit） | JSI 载体（G-40） | NativeKVAdapter（待接入） | `createAppPinia()` | 🟡 原型映射 |
| Android 原生 | native-android（Jetpack） | JSI 载体（G-40） | NativeKVAdapter（待接入） | `createAppPinia()` | 🟡 原型映射 |
| 鸿蒙 | native-harmony（ArkUI） | JSI 载体（G-40） | 待定 | `createAppPinia()` | 🟡 原型映射 |
| Flutter 混合 | flutter | 同一 JS 逻辑层 | 待定 | `createAppPinia()` | 🟡 widget 级映射 |
| 快应用 | 快应用引擎（待定） | 待定 | 待定 | 待定 | ⬜ 未开始 |

> 状态四档沿用全库纪律：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库 · ⬜ 未开始——**端特有断言必须带状态**（W-4 证明先于宣称）。

## 引擎全集（RenderBackend SPI 注册）

`vue-dom` · `flutter` · `native-ios` · `native-android` · `native-harmony` · `skyline` · `skia` · `canvas2d` · `headless`——语义到引擎的映射 SSOT 是 `SEMANTIC_BACKEND_MAP`（component-ir），文档端矩阵与代码共享同一注册表。

## 新端接入流程（W-7 §4）

1. **⬜→📋** 注册表加行 + 相关 plan 链接
2. **📋→🟡** 受影响端矩阵表扩列（生命周期/产物对照/能力降级）
3. **🟡→✅** 端页新增（`runtime-{end}.md`）+ 快速开始旅程扩列（仅当端可跑通）

## 下一步

- [可插拔架构](/docs/framework/22-architecture)：SPI 全景
- [一致性验证](/docs/framework/29-conformance)：跨端语义门禁
