# @proteus-vue/components

Proteus **语义组件库**（`p-*`）——跨端语义组件的单一实现，双端同源码。

## 内容

| 目录 | 说明 |
|---|---|
| `p-*/index.vue` | **73 个语义组件**：表单（p-button/p-input/p-textarea/p-switch/p-slider/p-picker/p-checkbox/p-radio/p-form）、容器与外壳（p-view/p-text/p-image/p-scroll-view/p-page-container/p-nav-bar/p-modal/p-drawer/p-popup/…）、布局（p-grid/p-stack/p-split/p-zone/p-safe/p-fit/…）、手势（p-draggable/p-scrollable）、能力入口（p-scan-qr/p-pick-photo/p-location）、媒体（p-media/p-camera/p-map/p-canvas/p-svg/p-webview/p-ad）等 |
| `pg-glass/` | 液态玻璃组件（消费 `@proteus-vue/glass` 纯逻辑 SSOT） |
| `virtual-list/` | 虚拟长列表（框架内置，兼容别名 `p-list-view`） |
| `runtime/` | 组件层运行时（事件归一 / 能力探测 / 容器测量 / 虚拟窗口 / 可观测） |
| `contracts/` | 组件层契约与公共 props |
| `theme/` | 主题皮肤注册表（编译器主题通道消费） |
| `index.ts` | 聚合导出（Web 端 `import { PButton } from '@proteus-vue/components'`） |

## 用法

```bash
npm i @proteus-vue/components
```

```ts
// Web：注册组件（或按需 import）
import { PButton, PForm } from '@proteus-vue/components'
```

```
<!-- 小程序：标签直接写，框架编译器自动解析（产物 proteus/<tag>/index） -->
<p-button theme="brand">提交</p-button>
```

## ★源码包（不发 dist）

本包发布 **TypeScript + Vue SFC 源码**，不做预构建：

1. **小程序编译器需在磁盘上扫 `.vue` 源码**（`gen-routes` / `plugin-vite` 按 `<dir>/<tag>/index.vue` 定位组件）。
2. 与框架「**一份源码双端**」原则一致——Web 由消费方的 `@vitejs/plugin-vue` 编译，小程序由框架编译器编译，不引入第二套产物与漂移风险。

因此 `main` / `types` / `exports` 指向 `./index.ts`，包内标记 `publishSource: true` 供 `check-package-health` 按其校验。

## 相关

- 组件设计与端对齐标准：`docs/proteus-end-alignment-plan/`（SOP v2，参考实现 = p-button）
- Skyline 踩坑总账：`docs/skyline-pitfalls.md`
- 组件语义规划：`docs/proteus-component-plan/`
