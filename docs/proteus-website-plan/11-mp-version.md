# 小程序版官网（Skyline）

## 目标

把官网内容**原样跑在微信小程序（Skyline）里**——实现"用 Proteus 构建的官网，一份内容双端（Web + Skyline）"，直接证明框架双端能力。

## 架构

```
apps/
  website/       Web 端（SPA + SSG）
  website-mp/    小程序端（Skyline）
shared/
  content/        Markdown 内容（双端共用）
  components/     p-* 组件（双端适配）
```

## 内容复用

- **Markdown 完全共用**（对齐 `02-docs-system.md`）
- 构建期把 `.md` → JSON → 小程序页面数据
- 小程序端无 DOM，用 Skyline 原生渲染 + glass-easel 组件

## 页面映射

| Web 路由 | 小程序页 |
|----------|---------|
| `/` | `pages/home/home` |
| `/docs/guide/[...slug]` | `pages/docs/detail`（参数传 slug） |
| `/playground` | `pages/playground/playground` |
| `/showcase` | `pages/showcase/showcase` |

**关键**：小程序页面数有限（建议 ≤ 30 个主入口），详情页用**参数化单页 + 数据切换**（不走大量独立 page）。

## 渲染适配

### p-* 组件 Skyline 化
- `p-text` → Skyline `<text>`
- `p-button` → Skyline `<button type="...">`
- `p-code-block` → `<scroll-view scroll-x>` + `<text>`（Skyline 无 `<pre>`）
- 复杂图表（Showcase）→ canvas 2d（Skyline 支持）

### 样式
- scoped CSS → WXSS（对齐 compiler-plan scoped 降级）
- 不支持选择器自动告警（构建期 `proteus audit mp`）
- rpx 适配（对齐 Skyline 布局约束）

## Playground 小程序版

- **受限**：小程序无法跑 WASM Compiler（包体积/权限）
- 方案：云端编译（Web Worker → 云函数），返回 IR + 产物
- 降级：展示预编译 preset，标注"完整交互见 Web 版"

## 能力探测（对齐 platform-plan）

- 小程序特有 API（`wx.shareAppMessage` / `wx.getSystemInfo`）走 capability
- Web 端无这些能力 → fallback UI
- `proteus audit capability`（platform-plan M8）检查双端一致性

## 分享（小程序核心场景）

- 首页/文档页/Showcase 支持转发给朋友 + 分享到朋友圈
- 分享卡片带标题 + 封面（动态生成 canvas 图）
- 从分享卡片进入 → 解析参数 → 跳对应文档页（对齐 lifecycle-plan deep link）

## 搜索
- 小程序端用本地 Fuse.js（语言包 + 索引按需加载）
- 对齐 `09-search-i18n.md`

## 性能（Skyline 约束）

- 长文档虚拟滚动（对齐 component-plan `p-list-view`）
- 图片懒加载 + KTX2 纹理压缩（如展示截图）
- 首屏 `disableScroll:true` + `scroll-view` 包内容（对齐 router-plan 全局滚动约束）

## 降级策略

| 能力 | 小程序 | Web |
|------|--------|-----|
| Playground | 云端编译 | WASM 本地 |
| 图表 | canvas 2d | SVG / canvas |
| 搜索 | 本地 Fuse | 本地 Fuse |

## 验收

- [ ] 全部文档页可在 Skyline 浏览（内容一致）
- [ ] Playground 至少 preset 可跑（云端或静态）
- [ ] 分享卡片正确跳转对应页
- [ ] 长列表 60fps（Skyline `recycleManager`）
- [ ] 包体积 < 主包 2MB + 按需分包

## 依赖

- `compiler-plan`（.md → WXML/WXSS）
- `component-plan`（p-* Skyline 适配）
- `platform-plan`（capability 探测）
- `lifecycle-plan`（deep link / onShow 恢复）
- `02/09/05`（内容复用 + 搜索 + Playground）
