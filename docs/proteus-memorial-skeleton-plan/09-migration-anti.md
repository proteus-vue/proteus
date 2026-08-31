# 迁移指南与反例

## 1. 从手工方案迁移

### 1.1 Web：`html { filter }` → Proteus

**Before**（手写全局 CSS）：

```css
/* memorial.css，每年手动上线/下线 */
html { filter: grayscale(100%); -webkit-filter: grayscale(100%); }
```

**After**（一行配置，自动生效 + 热切换）：

```ts
// app.config.ts
export default defineProteus({
  memorial: { dates: ['04-04', '12-13'], remote: 'https://cdn.../memorial.json' },
})
```

→ 删除 `memorial.css`，`proteus doctor` 会提示 `memorial/no-hardcode-filter`。

### 1.2 Skyline/小程序：`page { filter }` → 根容器

**Before**（会导致 flex 失效）：

```css
page { filter: grayscale(100%); }   /* ❌ */
```

**After**（Compiler 自动处理，无需手写）：

```vue
<!-- 框架自动包裹，无需改动 -->
<p-view> ... </p-view>
```

若需手动兜底：`proteus-memorial-root` class（规则 CSS017 自动修复）。

### 1.3 iOS：`CAFilter` 私有 API → 覆盖层

**Before**（审核风险）：

```swift
let filter = NSClassFromString("CAFilter")!   // ❌ 私有
window.layer.filters = [filter]               // ❌ 私有
```

**After**（框架 JSI binding 提供）：

```swift
ProteusMemorial.apply(true)  // ✅ 内部用 compositingFilter 覆盖层
```

`proteus doctor` 静态扫描 `CAFilter` / `layer.filters` 字样，命中报错（RNT001）。

### 1.4 骨架：截图/base64 → IR

**Before**：

```js
// vite.config.ts
skeletonScreenPlugin({ routes, delay: 3000 }) // 启动 Chromium 截图 → base64
```

**After**：

```ts
// app.config.ts
export default defineProteus({
  skeleton: { routes: ['/', '/list'], mode: 'static' },
})
// 构建期自动生成 IR，无需 Chromium
```

## 2. 反例清单（明确禁止）

### 纪念日灰度

- ❌ **手写 `filter: grayscale` 散落在业务 CSS** → 无法统一开关、无法热切换 → 用 `app.config.ts`
- ❌ **Skyline 直挂 `page { filter }`** → flex 失效、布局错位 → 用根容器
- ❌ **iOS 用 `CAFilter` / `window.layer.filters`** → 私有 API、审核被拒 → 用覆盖层
- ❌ **灰度层阻断交互**（`pointer-events` 未设 none）→ 覆盖层必须穿透
- ❌ **常态构建常驻悼念代码** → 全年 1-3 天却常驻内存 → 按需注入 + 日期判定

### 骨架屏

- ❌ **截图转 base64 注入** → 产物大、不响应式、Chromium 依赖 → 用结构化 IR
- ❌ **骨架结构与真实布局脱节** → 列表变方块、闪屏 → 保留布局语义节点（SKL002）
- ❌ **骨架与真实节点 refKey 不对齐** → 过渡闪屏 → 自动对齐（SKL004）
- ❌ **手写骨架样式绕过 `<p-block>`** → 多端不一致 → 走语义原语

## 3. 灰度场景边界

**适用**：国家公祭日、全国哀悼日、重大灾害纪念日等**全站临时灰度**。

**不适用 / 需另做**：

- **账户冻结、功能受限**等局部置灰 → 用 `<p-view :class="frozen && 'p-gray'">` 局部语义 class，不走全局纪念日开关；
- **暗色模式** → 用主题 token（`p-dark`），非灰度；
- **无障碍高对比** → 用系统无障碍 API，非滤镜。

框架通过 `memorial.scope` 支持 `'all' | 'except-camera' | 'except-video'`，局部排除走组件级 `<p-gray exclude>`。

## 4. 兼容性声明

| 能力 | 最低版本 |
|------|---------|
| Web grayscale | Chrome 31+ / Safari 7+ / Firefox（SVG 兜底） |
| Skyline filter | 微信 8.0.49+（具体以 Skyline 文档为准） |
| iOS 覆盖层 | iOS 13+（`compositingFilter` 公开属性） |
| Android ColorMatrix | API 16+（硬件加速层） |
| 鸿蒙 grayscale | HarmonyOS NEXT（ArkUI） |

低版本降级：Web 走 SVG filter；App 端低于最低版本时**静默跳过**灰度（不影响功能，仅视觉），并在 DevTools 提示。

## 5. 评审 FAQ

**Q：为什么不用 CSS 变量 + 手动切换 class？**
A：手动方案无法保证五端同步、无法热切换、无法审计。Proteus 把"今天是纪念日"作为**单一语义事实**，五端统一消费。

**Q：骨架屏不用截图，怎么保证长得像？**
A：IR 推导**保留完整布局语义**（flex/grid/尺寸/列表项数），骨架结构与真实页面同构，视觉保真度高于截图（且响应式）。截图方案的"像"反而是响应式陷阱。

**Q：常态构建常驻灰度脚本会不会浪费？**
A：灰度注入脚本 < 1KB，且仅做日期判定 + class 切换，全年常驻成本可忽略；悼念代码本体（滤镜 binding）按需挂载。
