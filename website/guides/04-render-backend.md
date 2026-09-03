---
title: 渲染后端
order: 4
---

# 渲染后端（G-27：可插拔渲染底座）

## 一个 App，多种引擎

Proteus 不自研渲染引擎，而是构建渲染后端无关的上层模型。通过统一 SPI `ProteusRenderBackend`，官方后端可插拔：

| 后端 | 实现路径 | 适用 |
|------|---------|------|
| VueDom | `createRenderer(nodeOps)` 零成本复用 | Web / H5 |
| Native | nodeOps → UIKit / Jetpack / ArkUI | 体验优先页面 |
| Flutter | Flutter Embedder C ABI | 品牌动效 / 一致性 |
| Skia | Canvas / WebGL 自绘 | 高频绘制 |
| Headless | 无设备渲染 | SSR / 测试 / AI Agent 回归 |

**同一个 App 按页面选引擎**：商品详情 → Native、品牌动效 → Flutter、数据大屏 → Skia、H5 落地页 → Vue DOM——业务代码完全一样。

## 热切换与混合渲染

```ts
// nodeOps Dispatcher：切换后端 = 一次赋值
setCurrentBackend(flutterBackend)
```

- **热切换**：运行时换引擎，页面无需重建（host-conformance H-05 强制验证）
- **混合渲染**：同屏区域级切后端 + 纹理共享（Texture Sharing），DevTools 显示路由 trace

## conformance 门禁

每个后端必须通过同一套 conformance（42 项，C-01~C-10）：

- 同一棵 IR → 各后端产出**同 shape** 的渲染结果（RND002）
- `capabilities` 必须诚实声明，未声明 = 不支持
- 降级必须可见（开发期警告 + 生产期日志），不得静默

Flutter 锁死 Skia、RN 锁死原生——只有"上层模型 + 可插拔后端"这条路线能做到渲染引擎自由。
