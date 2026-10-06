# App 端 CSS 支持面对照矩阵（生成物 · 勿手改）

> 生成：`pnpm check:app-css-surface --update` ｜ 门禁：`pnpm check:app-css-surface` ｜ 日期：2026-10-06
>
> **这是什么**：App（Vapor/selfdraw）端**编译期样式折叠面** vs CSS 矩阵（G-21）/ 运行时 Validator 的对照。
> App 端**无 CSS 引擎**——样式在**编译期**由 `parseStaticStyle` 折叠为引擎字段（值仅 px/数字；宽高另支持百分比→比例）。
> 选择器 / 层叠 / 伪类 / 媒体查询 / grid / box-shadow 等**均不在 App 端**（与 Web/MP 的根本差异）。

## 1. App 端折叠字段（全量）

| 字段 | 类别 | CSS 矩阵级别 | style-safety | App 采集方式 |
|---|---|---|---|---|
| `width` | 布局 | Length | ✅ 白名单 | px/数字；百分比 → `widthRatio` |
| `height` | 布局 | Length | ✅ 白名单 | px/数字；百分比 → `heightRatio` |
| `minWidth` | 布局 | Length | ✅ 白名单 | px/数字 |
| `maxWidth` | 布局 | Length | ✅ 白名单 | px/数字 |
| `minHeight` | 布局 | Length | ✅ 白名单 | px/数字 |
| `maxHeight` | 布局 | Length | ✅ 白名单 | px/数字 |
| `margin` | 布局 | Length | ✅ 白名单 | px/数字 → `{top,right,bottom,left}` |
| `padding` | 布局 | Length | ✅ 白名单 | px/数字 → `{top,right,bottom,left}` |
| `flexDirection` | 布局 | — | ⚠ 无 | px/数字 |
| `flexWrap` | 布局 | — | ⚠ 无 | px/数字 |
| `justifyContent` | 布局 | FlexJustify | ◐ 矩阵已声明 | px/数字 |
| `alignItems` | 布局 | FlexAlign | ◐ 矩阵已声明 | px/数字 |
| `alignContent` | 布局 | — | ⚠ 无 | px/数字 |
| `alignSelf` | 布局 | FlexAlign | ◐ 矩阵已声明 | px/数字 |
| `flexGrow` | 布局 | FlexNumber | ◐ 矩阵已声明 | px/数字 |
| `flexShrink` | 布局 | FlexNumber | ◐ 矩阵已声明 | px/数字 |
| `flexBasis` | 布局 | — | ⚠ 无 | px/数字 |
| `gap` | 布局 | — | ✅ 白名单 | px/数字 |
| `rowGap` | 布局 | — | ⚠ 无 | px/数字 |
| `columnGap` | 布局 | — | ⚠ 无 | px/数字 |
| `display` | 布局 | FORBIDDEN | ❌ 禁止 | px/数字 |
| `position` | 布局 | — | ❌ 禁止 | px/数字 |
| `top` | 布局 | — | ✅ 白名单 | px/数字 |
| `left` | 布局 | — | ✅ 白名单 | px/数字 |
| `right` | 布局 | — | ✅ 白名单 | px/数字 |
| `bottom` | 布局 | — | ✅ 白名单 | px/数字 |
| `overflow` | 布局 | — | ❌ 禁止 | px/数字 |
| `overflowX` | 布局 | Overflow | ◐ 矩阵已声明 | px/数字 |
| `overflowY` | 布局 | Overflow | ◐ 矩阵已声明 | px/数字 |
| `gridTemplateColumns` | 布局 | — | ⚠ 无 | px/数字 |
| `gridTemplateRows` | 布局 | — | ⚠ 无 | px/数字 |
| `gridColumn` | 布局 | — | ⚠ 无 | px/数字 |
| `gridRow` | 布局 | — | ⚠ 无 | px/数字 |
| `aspectRatio` | 布局 | — | ⚠ 无 | px/数字 |
| `pointerEvents` | 布局 | — | ⚠ 无 | px/数字 |
| `justifySelf` | 布局 | JustifySelf | ◐ 矩阵已声明 | px/数字 |
| `whiteSpace` | 布局 | TextWrap | ◐ 矩阵已声明 | px/数字 |
| `backgroundColor` | 绘制 | Color | ✅ 白名单 | 颜色字符串 |
| `color` | 绘制 | Color | ✅ 白名单 | 颜色字符串 |
| `fontSize` | 绘制 | — | ✅ 白名单 | px/数字 |
| `fontWeight` | 绘制 | Integer | ✅ 白名单 | px/数字 |
| `fontFamily` | 绘制 | — | ⚠ 无 | px/数字 |
| `textAlign` | 绘制 | TextAlign | ◐ 矩阵已声明 | px/数字 |
| `lineHeight` | 绘制 | — | ✅ 白名单 | px/数字 |
| `textOverflow` | 绘制 | — | ⚠ 无 | px/数字 |
| `letterSpacing` | 绘制 | — | ✅ 白名单 | px/数字 |
| `textDecoration` | 绘制 | — | ⚠ 无 | px/数字 |
| `visibility` | 绘制 | — | ⚠ 无 | px/数字 |
| `borderRadius` | 绘制 | Length | ✅ 白名单 | px/数字 |
| `borderColor` | 绘制 | Color | ✅ 白名单 | 颜色字符串 |
| `borderWidth` | 绘制 | Length | ◐ 矩阵已声明 | px/数字 |
| `borderTopWidth` | 绘制 | Length | ◐ 矩阵已声明 | px/数字 |
| `borderRightWidth` | 绘制 | Length | ◐ 矩阵已声明 | px/数字 |
| `borderBottomWidth` | 绘制 | Length | ◐ 矩阵已声明 | px/数字 |
| `borderLeftWidth` | 绘制 | Length | ◐ 矩阵已声明 | px/数字 |
| `borderTopColor` | 绘制 | Color | ◐ 矩阵已声明 | px/数字 |
| `borderRightColor` | 绘制 | Color | ◐ 矩阵已声明 | px/数字 |
| `borderBottomColor` | 绘制 | Color | ◐ 矩阵已声明 | px/数字 |
| `borderLeftColor` | 绘制 | Color | ◐ 矩阵已声明 | px/数字 |
| `borderTopStyle` | 绘制 | BorderStyle | ◐ 矩阵已声明 | px/数字 |
| `borderRightStyle` | 绘制 | BorderStyle | ◐ 矩阵已声明 | px/数字 |
| `borderBottomStyle` | 绘制 | BorderStyle | ◐ 矩阵已声明 | px/数字 |
| `borderLeftStyle` | 绘制 | BorderStyle | ◐ 矩阵已声明 | px/数字 |
| `opacity` | 绘制 | Opacity | ✅ 白名单 | px/数字 |
| `boxShadow` | 绘制 | — | ❌ 禁止 | px/数字 |
| `transform` | 绘制 | Transform | ✅ 白名单 | px/数字 |
| `widthRatio` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `heightRatio` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `marginAuto` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `borderRadiusCorners` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `borderRadiusPct` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `transformOrigin` | 派生（比例） | TransformOrigin | ◐ 矩阵已声明 | 宽高百分比 → 比例字段 |
| `minWidthPct` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `maxWidthPct` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `minHeightPct` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `maxHeightPct` | 派生（比例） | — | ⚠ 无 | 宽高百分比 → 比例字段 |
| `boxSizing` | 特殊（忠实记录） | — | ⚠ 无 | 透传（内核恒 border-box） |

## 2. 门禁判据（分层对照 · 棘轮）

> **★分层前提（勿误读）**：`FORBIDDEN` / runtime 白名单是**语义层**（开发者可写的收敛模型：`:style` 绑定 + 动态 patch）；
> 本页的 App 折叠字段是**引擎字段层**（Layer-3：静态 CSS 折叠 + 框架 `p-*` 语义组件产出的目标字段）。两层职责不同，
> 交集**不构成缺陷**；但**未登记的新交集** = "开发者能在 App 写一个语义层禁止的属性" = 收敛模型逃生口 ⇒ 棘轮判红。

- **① CSS 矩阵级别声明**（信息）：App 引擎接受面未在 CSS 矩阵声明的字段：`flexDirection` `flexWrap` `alignContent` `flexBasis` `gap` `rowGap` `columnGap` `position` `top` `left` `right` `bottom` `overflow` `gridTemplateColumns` `gridTemplateRows` `gridColumn` `gridRow` `aspectRatio` `pointerEvents` `fontSize` `fontFamily` `lineHeight` `textOverflow` `letterSpacing` `textDecoration` `visibility` `boxShadow`（矩阵是**语义子集**，引擎面更宽属正常）
- **② 已登记的分层差异**（棘轮硬判据）：App 接受面 ∩ FORBIDDEN = `display` `position` `overflow` `boxShadow`
  - 已登记（引擎字段层需要）：`display` `position` `overflow` `boxShadow`
  - **未登记（新增即红）**：∅ ✅
- **③ runtime 白名单**（信息）：不在 runtime 白名单且矩阵未声明：`flexDirection` `flexWrap` `alignContent` `flexBasis` `rowGap` `columnGap` `position` `overflow` `gridTemplateColumns` `gridTemplateRows` `gridColumn` `gridRow` `aspectRatio` `pointerEvents` `fontFamily` `textOverflow` `textDecoration` `visibility` `boxShadow`（同步属分层差异）

## 3. 与 Web/MP 的差异（诚实边界）

| 能力 | Web/MP | App |
|---|---|---|
| 选择器 / 层叠 / 伪类 / 媒体查询 | ✅ CSS 引擎 | ❌ 无（编译期折叠） |
| 长度单位（em/rem/vw/vh/calc/clamp） | ✅ | ❌ 仅 px/数字（宽高另支持 %） |
| grid | ✅/降级 | ❌（`grid` 定案未实现，见《CSS Profile 规格》§9） |
| box-shadow / filter / backdrop-filter | ✅/🔶 | ❌ |
| flex 子集（direction/justify/align/grow/shrink/basis/gap） | ✅ | ✅ |
| 尺寸/margin/padding/position/overflow | ✅ | ✅（`overflow` 见判据 ② 的级别不一致） |
| 绘制（bg/color/border/borderRadius/fontSize/opacity） | ✅ | ✅ |

