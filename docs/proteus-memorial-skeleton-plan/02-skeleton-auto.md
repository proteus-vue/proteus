# 骨架屏自动生成方案

- **所属层**：基建层（Compiler + CLI 产出，Runtime 消费）
- **执行位**：G-26（依赖 Compiler IR 稳定，与 Performance AOT 可共享 SFC 静态分析）
- **关联 plan**：`proteus-compiler-plan`（IR + transform）、`proteus-css-compat`（骨架样式走 ✅ 直映射）、`proteus-performance-plan`（首屏 AOT/IFR 协同）、`proteus-app-renderer-plan`（原生端骨架 View）
- **核心定位**：**开发者不改业务代码、不手写骨架 CSS，由 Compiler 静态分析 SFC + 路由表，自动产出三端（Web / Skyline / App）的骨架屏结构与样式，并与 IFR 静态首帧、AOT 预编译共用同一份 IR。**

---

## 1. 问题定义

骨架屏用于首屏与路由切换的加载占位，业界现有方案的问题：

- **Puppeteer 截图方案**（page-skeleton-webpack-plugin / vite-plugin-skeleton-screen）：构建期启动无头 Chromium，逐路由截图→转 base64→注入 HTML。优点"全自动"，缺点：**依赖重（Chromium 下载）、TTI 不稳定、对需要登录/接口数据的页面失效、产物是图片不利于响应式**；
- **手动写骨架组件**：灵活但**重复劳动、UI 一改要同步改两份**，维护成本高；
- **纯构建期代码生成**（vite-plugin-auto-skeleton）：通过占位符 `__SKELETON_CONTENT__` + transform 钩子注入生成代码，更轻量但需要约定占位符。

> **Proteus 的方案**：不走"截图转图片"，而是**基于 SFC 静态分析 + Compiler IR 推导骨架结构**，产出的也是结构化 IR → 三端各自渲染成真实占位节点。响应式天然、无 Chromium 依赖、与 AOT/IFR 同源。

---

## 2. 设计原则（遵循 Architecture #10）

1. **单一事实源**：骨架结构由 SFC + 路由表**唯一推导**，不存在手写骨架与业务 UI 两份真相；
2. **结构化产出，非图片**：输出 IR 节点树 + 骨架样式，五端渲染为真实占位 View，响应式自适应；
3. **编译期生成，运行期零推理**：骨架在构建期算定，运行时只做"显示/隐藏"切换，不占首屏 JS；
4. **与 IFR/AOT 协同**：骨架 IR 复用 AOT 预编译产物，IFR 静态首帧**直接就是**骨架屏，天然衔接；
5. **可覆盖**：自动生成的骨架允许在 `app.config.ts` 或 `<p-skeleton override>` 里手动精修（圆角、配色、动画）。

---

## 3. 核心机制：SFC 静态分析 → 骨架 IR

### 3.1 推导规则（按节点类型映射）

| SFC 节点 | 骨架占位 | 尺寸来源 |
|---------|---------|---------|
| `<img>` / `<p-image>` | 灰色矩形块 | `width/height` 静态值或 `aspect-ratio` |
| 文本节点 / `<p-text>` | 若干细条 `.skeleton-text` | 字符数 × 字号估算行数 |
| `<p-button>` / `<button>` | 圆角矩形 | 组件默认尺寸 |
| `<p-flex>` / 容器 | 保留布局结构（flex/grid 骨架） | 布局语义原样保留 |
| 列表 `v-for` | 按 `:key` 重复 N 条骨架项（N 取自 `recycle-view` 预估） | 容器高度 / 项高 |
| `<pg-glass>` | 普通占位块（骨架态无玻璃效果） | — |

**关键**：布局语义（`p-flex` / `p-stack` / `p-grid`）原样保留 → **骨架屏的布局结构与真实页面一致**，不会出现"真页面是列表、骨架是方块"的错位感。

### 3.2 IR 产出

```typescript
// Compiler 生成的骨架 IR（与 AOT IR 同源）
interface SkeletonIRNode {
  type: 'block' | 'text' | 'circle' | 'image'
  style: { width?: SizeSpec; height?: SizeSpec; radius?: number; lines?: number }
  children?: SkeletonIRNode[]
  // 与真实节点的映射关系（用于 IFR 接管时 key 对齐）
  refKey: string
}
```

产物落在 `dist/.proteus/skeleton/{route}.ir.json`，运行时按 route 读取。

---

## 4. 三端渲染

| 端 | 骨架渲染方式 | 说明 |
|----|-----------|------|
| **Web** | 构建期把骨架 IR 序列化为内联 HTML + CSS，注入 `<head>` 的 `#app` 之前 | IFR 静态首帧即骨架，Vue mount 后接管 |
| **Skyline** | IR → WXML 静态节点，首屏直接渲染 | 与 Skyline 静态首屏机制协同 |
| **App** | AOT 预编译 IR → 原生占位 View（UIView/ArkUI/Android View），JSI mount | **无需等待 Vue 启动即可显示骨架** ← 与 Lynx/IFR 同档 |

骨架样式（`.skeleton-block { background: linear-gradient(...) }` shimmer 动画）走 ✅ 直映射，五端共用同一套 CSS 变量（`--skeleton-bg` / `--skeleton-shine`），由 CSS 兼容矩阵收敛。

---

## 5. 触发与显示策略

```ts
// app.config.ts
export default defineProteus({
  skeleton: {
    // 自动生成范围：基于路由表
    routes: ['/', '/list', '/detail'], // 留空 = 自动扫描 Vue Router
    // 生成策略
    mode: 'static', // 'static' 构建期 | 'hybrid' 构建+运行时
    // 外观
    appearance: { color: '#eee', animation: 'shimmer', radius: 8 },
    // 数据依赖页面的 fixture（构建期渲染用）
    fixtures: { '/detail': { id: 1 } },
  },
})
```

运行时：
```vue
<!-- 框架自动包裹，业务只管 isLoading -->
<p-skeleton :for="route">
  <PageContent v-if="!isLoading" />
</p-skeleton>
```

- **首屏**：IFR 直接出骨架（Web/Skyline/App 三端一致）；
- **路由切换**：`<p-skeleton>` 在 `useFetch` pending 期间显示自动骨架，数据到后按 `refKey` 对齐做**节点复用式过渡**，避免闪屏。

---

## 6. 与 AOT / IFR 的协同（核心差异化）

```
SFC + 路由表
    ↓ Compiler 静态分析（一次）
┌────────────┬────────────┐
│ 真实 UI IR │ 骨架 IR    │  ← 同源产出
└────────────┴────────────┘
    ↓                ↓
  AOT 预编译      IFR 静态首帧
  JSI/原生 mount   骨架占位 View
    ↓                ↓
  真实 View 接管   骨架淡出（refKey 对齐）
```

**价值**：骨架不是"额外生成一份图片"，而是**同一份 IR 的两个视图**——真实 UI 与骨架屏结构天然一致，UI 改动骨架自动同步。

---

## 7. 反例与边界

- ❌ 禁止把骨架截图当 base64 注入（产物大、不响应式、依赖 Chromium）→ `--no-puppeteer-screenshot` 默认开启；
- ❌ 禁止骨架结构与真实布局脱节（必须保留布局语义节点）；
- ✅ 允许 `<p-skeleton override>` 手动精修个别复杂区块。

---

## 8. 对标

| 方案 | 自动生成 | 三端 | 响应式 | 与首屏协同 | Chromium 依赖 |
|------|---------|------|-------|----------|-------------|
| Puppeteer 截图 | ✅ | ❌(仅 Web) | ❌ | ⚠️ | ✅ 重 |
| 手写组件 | ❌ | ✅ | ✅ | 手动 | ❌ |
| **Proteus** | ✅ | ✅ | ✅ | ✅ AOT+IFR 同源 | ❌ 零依赖 |

---

## 9. 分批（详见 `11-batches.md`）

- **M1**：Web 端骨架 IR + 内联注入（纯 Compiler + 静态分析，零依赖，最先验证）
- **M2**：Skyline 骨架 IR → WXML
- **M3**：App 端骨架 IR → 原生占位 View（复用 AOT 管线）
- **M4**：`<p-skeleton>` 运行时 + refKey 对齐过渡 + fixtures
- **M5**：与 IFR 静态首帧合并验证 + 真机矩阵
