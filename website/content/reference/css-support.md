---
title: CSS 多端支持参考
order: 43
group: 工程参考
generated: true
---

# CSS 多端支持参考

> 79 项 CSS 能力在 **Web / Skyline / App 三端**的支持现状与可扩展档位。
> ★自动生成（`scripts/gen-css-support.mjs`），SSOT = `docs/generated/css-capability-alignment.json`；漂移门禁 `--check`。

## 端模型

- **Web** —— 浏览器原生 CSSOM（真值基准）。
- **Skyline** —— 微信小程序容器（唯一刚性外部约束）。
- **App** —— 自研自绘 Rust 引擎（一套，覆盖 iOS / Android / 鸿蒙 三平台；CSS 面由我们定义、可扩展）。

## App 现状取值口径

| 取值 | 含义 |
|---|---|
| `supported` | 编译期折叠 + 引擎 + 宿主自绘**全通**（真上屏） |
| `folded-only` | 编译期**折叠透传**进内核树，但宿主**未真渲染**（如实标注，勿读成 supported） |
| `engine-only` | 引擎/宿主**已能绘制**，但编译期折叠面（parseStaticStyle）**尚未接**（= 「可扩展」的现成落点） |
| `absent` | 当前无（候选特性，见 tier/strategy） |

## App 可扩展档位（L0–L5 成本分级）

| 档位 | 含义 |
|---|---|
| L0 | 零运行时成本（编译期可完全折叠：选择器/层叠/继承/特异性/单位换算） |
| L1 | 低运行时成本（纯绘制/直接映射；如 backgroundColor / border-radius / opacity） |
| L2 | 中等成本（按需支持；flex/position/overflow/grid——需布局与包含块判定） |
| L3 | 高成本（默认关闭；z-index/fixed·sticky/3D/filter/shadow/will-change——关联合成层与内存） |
| L4 | 不自研（复用平台能力：字体/BiDi/emoji/复杂富文本） |
| L5 | 禁止（编译期报错：运行时动态选择器/无法折叠的层叠/运行时插样式表/超 Profile） |

## 能力矩阵

| 类别 | CSS | Web | Skyline | App 现状 | App 可扩展 | 策略 | 对齐 |
|---|---|---|---|---|---|---|---|
| 绘制 | `outline-offset` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 宿主绘制 | conditional |
| 绘制 | `outline（+ outline-width/-color/-style 长手）` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 宿主绘制 | conditional |
| 布局 | `width` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 布局 | `height` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 布局 | `min-width / max-width / min-height / max-height` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 布局 | `margin（+ 四边简写 + 1–4 值 shorthand）` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 布局 | `padding（+ 四边简写 + 1–4 值 shorthand）` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 布局 | `display: flex / none` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `flex-direction` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `justify-content` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `align-items / align-self` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `flex-grow / flex-shrink / flex-basis` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `gap（+ row-gap / column-gap）` | ◐ 部分 | ◐ 部分 | ✅ 支持 | L2 | 直映射 | conditional |
| 布局 | `position: static / relative / absolute` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `top / left` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `overflow: visible / hidden / scroll / auto` | ◐ 部分 | ◐ 部分 | ✅ 支持 | L2 | 直映射 | conditional |
| 取值 | `margin/padding 1–4 值简写 + background 纯色简写 + flex 简写` | — | — | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 单位 | `width/height 百分比` | — | — | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 绘制 | `background-color（+ background 纯色简写）` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 绘制 | `background-size` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L2 | 宿主几何 | conditional |
| 绘制 | `background-position` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L2 | 宿主几何 | conditional |
| 绘制 | `background-repeat` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L2 | 宿主几何 | conditional |
| 绘制 | `color` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 绘制 | `font-size` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 绘制 | `border-radius` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 绘制 | `opacity` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 特殊 | `box-sizing` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 直映射 | universal |
| 绘制 | `border（简写）/ border-color / border-width` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 绘制 | `border-top` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 绘制 | `border-right` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 绘制 | `border-bottom` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 绘制 | `border-left` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 动效 | `transform（2D：translate / scale / rotate）` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 动效 | `transform-origin` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 编译期折叠 | universal |
| 选择器 | `类选择器 .a / .a.b` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 选择器 | `元素/类型选择器 h3 / p.foo` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 选择器 | `后代 / 子组合 .a .b / .a > .b` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 选择器 | `静态结构伪类 :first-child / :last-child / :nth-child(An+B\|odd\|even) / :not(简单选择器)` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 选择器 | `状态伪类 :hover / :active / :focus / :checked` | — | — | ✗ 无 | L2 | 降级 | unsupported |
| 选择器 | `属性选择器 [data-x]` | — | — | ✗ 无 | L0 | 编译期折叠 | unsupported |
| 选择器 | `Vue 作用域穿透 :deep() / ::v-deep() / >>>` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 选择器 | `兄弟组合 + / ~` | — | — | ✗ 无 | L5 | 禁止 | unsupported |
| 选择器 | `通配 *` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 层叠 | `特异性 / 继承 / !important` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| @ 规则 | `@media（响应式 / 环境条件）` | — | — | ✅ 支持 | L2 | 独立通道 | conditional |
| @ 规则 | `@supports（特性检测）` | — | — | ✅ 支持 | L2 | 独立通道 | conditional |
| @ 规则 | `@keyframes（关键帧动画）` | — | — | ✅ 支持 | L1 | 编译期折叠 | conditional |
| @ 规则 | `animation（简写：name duration timing delay …）` | — | — | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 层叠 | `CSS 自定义属性（design tokens）var(--x)` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 单位 | `min() / max() / clamp()` | — | — | ✅ 支持 | L0 | 编译期折叠 | conditional |
| 单位 | `em / rem / vw / vh / calc / clamp` | — | — | ✗ 无 | L0 | 编译期折叠 | unsupported |
| 布局 | `display: grid + grid-template-columns/rows（显式轨迹）+ grid-column/row 线号放置` | ◐ 部分 | ◻ 未列 | ✅ 支持 | L2 | 直映射 | conditional |
| 布局 | `justify-self（网格项行内轴自对齐）` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 直映射 | conditional |
| 布局 | `place-items（+ justify-items 长手）` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 简写展开 | conditional |
| 文本 | `word-break（行内断词策略）` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L4 | 直映射 | universal |
| 布局 | `aspect-ratio` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 编译期折叠 | conditional |
| 布局 | `flex-wrap` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `align-content` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `right / bottom` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L2 | 直映射 | universal |
| 布局 | `inset（top/right/bottom/left 的 1–4 值缩写）` | — | — | ✅ 支持 | L2 | 编译期折叠 | conditional |
| 布局 | `order` | ✅ 支持 | ✅ 支持 | ✗ 无 | L2 | 直映射 | conditional |
| 层 | `z-index` | ✅ 支持 | ✅ 支持 | ✗ 无 | L3 | 语义组件 | conditional |
| 绘制 | `box-shadow` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L3 | 编译期折叠 | universal |
| 绘制 | `text-shadow` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L3 | 编译期折叠 | conditional |
| 绘制 | `filter / backdrop-filter` | ✅ 支持 | ✅ 支持 | ✗ 无 | L3 | 语义组件 | conditional |
| 文本 | `font-weight` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 文本 | `text-decoration` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 文本 | `text-align` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 文本 | `line-height` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 文本 | `text-overflow` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 文本 | `-webkit-line-clamp: <integer>` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L1 | 编译期折叠 | conditional |
| 文本 | `letter-spacing` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 文本 | `font-family` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L4 | 编译期折叠 | universal |
| 文本 | `white-space` | ✅ 支持 | ✅ 支持 | ✗ 无 | L4 | 降级 | conditional |
| 布局 | `pointer-events` | ◻ 未测 | ✅ 支持 | ✅ 支持 | L2 | 编译期折叠 | conditional |
| 绘制 | `visibility` | ✅ 支持 | ✅ 支持 | ✅ 支持 | L1 | 编译期折叠 | universal |
| 布局 | `grid-auto-flow` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 直映射 | conditional |
| 布局 | `grid-template-areas` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 直映射 | conditional |
| 布局 | `grid-area` | ◻ 未测 | ◻ 未列 | ✅ 支持 | L2 | 直映射 | conditional |

## 逐项说明（按类别）

### 绘制

- **`outline-offset`** — ★★★outline 族项（2026-10-08）：轮廓与盒边的**偏移**（正=盒外 / 负=盒内；不影响布局）。Web 真值（真 Chromium）：`outline-offset: 2px` / `-2px` computed 即 px。App 宿主按偏移把环画在盒外/内（同 outline 通道）。
- **`outline（+ outline-width/-color/-style 长手）`** — ★★★outline 族项（2026-10-08 · css:next P0·3× · Basic User Interface）：**轮廓**（盒外/内偏移的环，**不占布局**，与 border 不同）。契约：新级别 OutlineWidth/OutlineOffset（+ outlineColor 复用 Color / outlineStyle 复用 BorderStyle）；编译器 APP_PAINT_FIELDS + 折叠（简写 `<width> <style> <color>` 序任意 + 长手 + offset 可负）；CSE 直通 outlineWidth/outlineColor/outlineStyle/outlineOffset；**宿主绘制**（host-only paint，同 border/box-shadow——**内核零改动**）；consistency 链。★诚实边界：① **Skyline 官方属性表（110 项）无 outline**（引擎锁死）；② 语料 3× 全在 `:focus-visible` 下（焦点环）——App **不支持状态伪类** ⇒ 语料到不了 App（**具名依赖**：焦点态需独立能力）；本项验**静态** outline。
- **`background-color（+ background 纯色简写）`** — 颜色编译期归一为 hex：hex / rgb() / rgba() / **命名色（148 个标准色，批 14）** / transparent；hsl/var ⇒ 诊断跳过。★`background` 纯色简写折进 backgroundColor；★批次 33：`linear-gradient` / `radial-gradient` 折进引擎 `fillGradient` 通道（`background`/`background-image` 均可）——免去手写 `fill-gradient='{json}'` 的胶水；`url()` 图片仍诊断（走原生组件）。★批 14 多端一致性审计修：命名色此前丢弃（Web 生效）⇒ 现查表归一（核心只认 hex）
- **`background-size`** — ★★★背景定位家族（2026-10-07 · css:next background-position · 静态单层）：**背景图层的图像盒尺寸**。契约：新级别 BackgroundSize（四同步）；CSE 直通 IR 字段 backgroundSize；编译器 APP_PAINT_FIELDS + 折叠分支（字符串原样下发）；宿主按 Web 几何（size %= 相对盒、px 直接）把渐变端点/平铺算到图像盒。★诚实边界：多值/关键字 cover/contain 暂诊断（本批不做）；动画/多层渐变留下一批。见 docs/css-background-family-plan.md
- **`background-position`** — ★★★背景定位家族（2026-10-07 · css:next）：**背景图像盒的偏移**。契约：新级别 BackgroundPosition（四同步）；CSE 直通 backgroundPosition；编译器 APP_PAINT_FIELDS + 折叠分支。★Web 真值（真 Chromium 实测）：关键字 left/top=0、right/bottom=100%、center=50%；px 直接；**% = X%×(盒宽−图宽)**（减图尺寸）。宿主解析该几何。见 docs/css-background-family-plan.md
- **`background-repeat`** — ★★★背景定位家族（2026-10-07）：**背景图像盒平铺**（repeat=以图像尺寸为砖平铺，相位=偏移；no-repeat=只画一次）。契约：新级别 BackgroundRepeat（四同步，值集 repeat/no-repeat——Space/Round 暂不做）；CSE 直通 backgroundRepeat；编译器 APP_PAINT_FIELDS + 折叠分支。见 docs/css-background-family-plan.md
- **`color`** — 颜色归一（hex/rgb/rgba/hsl/命名色/4 位 hex/transparent）；★批次 23：`color-mix(in srgb, A [pa%], B [pb%])` **常量折叠**（var() 已置换 ⇒ 两色已知 ⇒ sRGB 预乘 alpha 混合）——组件库 16 处令牌着色；非 srgb 色彩空间（oklab/lab…）诊断
- **`font-size`** — px/数字（不支持百分比/keyword）
- **`border-radius`** — px/数字（宿主圆角绘制）；★批次 18：**百分比**（`border-radius: 50%` = 内切圆/椭圆，头像/圆点刚需）折为 `borderRadiusPct`（0..1）⇒ 宿主按 `pct × min(w,h)` 算半径（正方盒 = 精确圆，Web 一致；非正方盒为统一圆角，Web 为椭圆——如实近似）。★批次 34：**逐角**（`12px 12px 0 0` 等——统一半径 + 部分角掩码 `borderRadiusCorners`，宿主 iOS maskedCorners / Android addRoundRect / 鸿蒙 CornerDirection）；**半径不一致**的逐角（`8px 4px`）诊断（不猜）
- **`opacity`** — 0–1
- **`border（简写）/ border-color / border-width`** — ★批次 5（2026-10-04）：`border: <width> <style> <color>` 简写解析为 borderWidth + borderColor（uniform **实线**）；**逐边**已支持（见 border-top/right/bottom/left 四条）· ★★★边框族收口批（2026-10-05）：**dashed/dotted 线型已支持**（简写 1–4 值 + 落逐边 Style；宿主按线型绘制）；double/groove 等仍诊断跳过（不静默画成实线）；var() 令牌色如实诊断。**三端宿主真画**：iOS CALayer.border* · Android borderPaint 描边（含圆角路径）· 鸿蒙 OH_ArkUI_RenderNodeUtils_SetBorderWidth/Color
- **`border-top`** — ★★★逐边 border 批（2026-10-05 · 用户「全端对齐不留缺陷」）：`border-top: <width> solid <color>` 简写 折为 borderTopWidth/Color（宿主**逐边绘制**）；`none` ⇒ 该边清零（重置语义）；★★★边框族收口批（2026-10-05）：**线型支持**——solid/dashed/dotted 落 border<Side>Style（宿主按线型绘制：Android 封角块+DashPathEffect / iOS CAShapeLayer lineDashPattern / 鸿蒙 ArkUI 原生；节距按 Chrome 实测真值 {3w,2w}/{w,w}）；double/groove 等仍诊断跳过。`border: <w> dashed <c>` 简写同步支持（1–4 值）。；不静默画成实线冒充）。Web/MP 端为该族**原生支持**（Skyline 官方 formats 表含 border-<side>-* 全部 12 项）。
- **`border-right`** — ★★★逐边 border 批（2026-10-05 · 用户「全端对齐不留缺陷」）：`border-right: <width> solid <color>` 简写 折为 borderRightWidth/Color（宿主**逐边绘制**）；`none` ⇒ 该边清零（重置语义）；★★★边框族收口批（2026-10-05）：**线型支持**——solid/dashed/dotted 落 border<Side>Style（宿主按线型绘制：Android 封角块+DashPathEffect / iOS CAShapeLayer lineDashPattern / 鸿蒙 ArkUI 原生；节距按 Chrome 实测真值 {3w,2w}/{w,w}）；double/groove 等仍诊断跳过。`border: <w> dashed <c>` 简写同步支持（1–4 值）。；不静默画成实线冒充）。Web/MP 端为该族**原生支持**（Skyline 官方 formats 表含 border-<side>-* 全部 12 项）。
- **`border-bottom`** — ★★★逐边 border 批（2026-10-05 · 用户「全端对齐不留缺陷」）：`border-bottom: <width> solid <color>` 简写 折为 borderBottomWidth/Color（宿主**逐边绘制**）；`none` ⇒ 该边清零（重置语义）；★★★边框族收口批（2026-10-05）：**线型支持**——solid/dashed/dotted 落 border<Side>Style（宿主按线型绘制：Android 封角块+DashPathEffect / iOS CAShapeLayer lineDashPattern / 鸿蒙 ArkUI 原生；节距按 Chrome 实测真值 {3w,2w}/{w,w}）；double/groove 等仍诊断跳过。`border: <w> dashed <c>` 简写同步支持（1–4 值）。；不静默画成实线冒充）。Web/MP 端为该族**原生支持**（Skyline 官方 formats 表含 border-<side>-* 全部 12 项）。
- **`border-left`** — ★★★逐边 border 批（2026-10-05 · 用户「全端对齐不留缺陷」）：`border-left: <width> solid <color>` 简写 折为 borderLeftWidth/Color（宿主**逐边绘制**）；`none` ⇒ 该边清零（重置语义）；★★★边框族收口批（2026-10-05）：**线型支持**——solid/dashed/dotted 落 border<Side>Style（宿主按线型绘制：Android 封角块+DashPathEffect / iOS CAShapeLayer lineDashPattern / 鸿蒙 ArkUI 原生；节距按 Chrome 实测真值 {3w,2w}/{w,w}）；double/groove 等仍诊断跳过。`border: <w> dashed <c>` 简写同步支持（1–4 值）。；不静默画成实线冒充）。Web/MP 端为该族**原生支持**（Skyline 官方 formats 表含 border-<side>-* 全部 12 项）。
- **`box-shadow`** — ★批次 10（2026-10-04）：单层解析为结构化 `boxShadow {dx,dy,blur,spread,color}`（多重取首个；inset 诊断跳过）。**三端绘制**：iOS `CALayer.shadow*`（原生；有阴影时不开 masksToBounds——圆角裁剪会裁掉阴影）· Android **分层圆角矩形近似**（硬件加速下 setShadowLayer 只支持文本）· 鸿蒙 `OH_ArkUI_RenderNodeUtils_SetShadow*`（原生；spread 无原生项）。★超级应用卡片抬升视觉刚需
- **`text-shadow`** — ★★★text-shadow 项（2026-10-08 · css:next P0·2× · CSS Text Decoration）：**文本阴影**（单层 dx dy [blur] color；无 spread）。契约：引擎字段 textShadow（同 boxShadow 先例）；编译器折叠（parseBoxShadow 复用）+ CSE 归一到**浏览器 computed 形态**（rgba(...) dxpx dypx blurpx）；**三端宿主文本绘制投影**：Android `TextPaint.setShadowLayer`（硬件加速下**只对文本生效**——正是文本阴影所需）· iOS `CATextLayer.shadow*` · 鸿蒙 `OH_Drawing_SetTextShadow + OH_Drawing_TextStyleAddShadow`（Typography 原生）。★语料 2×（glass-demo / p-formfactor 封面标题）。★诚实边界：多重阴影取首个；spread 无（CSS text-shadow 本无 spread）。
- **`filter / backdrop-filter`** — 离屏/额外缓冲；走 <p-glass> / <p-filter> 语义组件
- **`visibility`** — ★批次 25（2026-10-04 · ★基准 = Web）：`visible` / `hidden`。与 `display:none` 不同——`hidden` **仍占位**（保留布局），只是**不绘制**（宿主跳过绘制该节点）。CSS **可继承**（父 hidden ⇒ 子默认 hidden；子显式 **visible 可覆盖**）——编译期按树算 computed 值（每节点独立标记）。宿主：iOS `layer.isHidden`（子层随父隐藏）· Android Cmd 跳过（color/text/border 清零）· 鸿蒙指令不绘制。诚实边界：`collapse`（表格行折叠）未支持（诊断）

### 布局

- **`width`** — px/数字 → 长度；百分比 → widthRatio（比例字段，非长度）
- **`height`** — px/数字 → 长度；百分比 → heightRatio
- **`min-width / max-width / min-height / max-height`** — px/数字；★批次 19：**百分比**（`max-width:100%` 不溢出 / `min-height:100%` 撑满）折为 `*Pct`（0..1）⇒ 内核 taffy 按父内容盒解析（min 缺省 0 / max 缺省 auto 语义不变）
- **`margin（+ 四边简写 + 1–4 值 shorthand）`** — px/数字 → {top,right,bottom,left}；1–4 值简写按 CSS 标准展开（`margin: 8px 0`）；★批次 17：`auto`（`margin: 0 auto` 水平居中）折为逐边 `marginAuto` 标记 → 内核映射 taffy auto（此前静默丢弃 = Web 偏差）；Web 探针取 margin-top 代表
- **`padding（+ 四边简写 + 1–4 值 shorthand）`** — px/数字 → {top,right,bottom,left}；1–4 值简写按 CSS 标准展开（`padding: 8px 12px`）；Web 探针取 padding-top 代表。★文本节点内间距修复（2026-10-09 · 用户抓出「App 端 text 的 padding-left 被丢弃」）：盒子布局（内核 taffy）一直吃 padding，但**文本绘制**此前从**盒原点**起排 ⇒ text 节点的 padding 静默丢弃（与 Web 不符——Web 的文本 padding 内缩**行盒**、折行宽 = 内容盒宽）。三端宿主统一改为按**内容盒**绘制（Android ProteusHostView.drawCmds/drawTextMultiline、iOS lineBoxFrame/contentBox、鸿蒙 proteus_render 的 padL/T/R/B 内缩；JsRenderHost 同步）。
- **`display: flex / none`** — 引擎封闭集仅 flex/none（block/inline-block/inline-flex/grid ⇒ 诊断跳过）
- **`flex-direction`** — 封闭集 row/column/row-reverse/column-reverse
- **`justify-content`** — 引擎为**开放字符串**（未知值静默落默认，不崩）
- **`align-items / align-self`** — 开放字符串（未知值静默落默认）
- **`flex-grow / flex-shrink / flex-basis`** — flex-basis 为长度
- **`gap（+ row-gap / column-gap）`** — px/数字；★批次 31：**两值** `gap:<row> <col>` 与 **轴级** `row-gap`/`column-gap`（内核 `LStyle.row_gap/column_gap` → taffy `gap.height/width`）——真项目组件库 15 处两值 gap
- **`position: static / relative / absolute`** — 引擎封闭集；sticky/fixed ⇒ 诊断跳过
- **`top / left`** — 配合 absolute；引擎无 right/bottom（见候选）
- **`overflow: visible / hidden / scroll / auto`** — 引擎封闭集；auto 折叠为 taffy Scroll；★★★overflow-x 项（2026-10-06）：**单轴 overflow-x/y 已支持**（长手 + overflow 1–2 值简写；Web 归一回放：visible↔非visible ⇒ visible→auto；逐轴字段 overflowX/overflowY）+ 三端宿主**子内容裁剪**（Android 画布 clipRect / iOS masksToBounds / 鸿蒙 SetClip——内核 rects 下发有效裁剪矩形）
- **`display: grid + grid-template-columns/rows（显式轨迹）+ grid-column/row 线号放置`** — ★批次 12（2026-10-04）：引擎 `Display::Grid` + `LStyle.grid_template_columns/rows`（字符串轨迹）+ `NodeDto` + taffy grid_template_* 映射（parse_grid_tracks：fr/px/数字）；编译器 display:grid 入封闭集 + `grid-template-columns/rows` 解析（**显式轨迹**，`repeat(N,X)` 编译期展开）。★批次 41（2026-10-04）：`grid-column`/`grid-row` **线号放置**（`<n>` / `<start> / <end>`，线号可负——`1 / -1` 跨全宽）已支持（内核 taffy `Line<GridPlacement>`）。★★★grid 轨迹解析升级（2026-10-08）：① **minmax()** 支持（minmax(0, 1fr)——语料最高频；内核改用 taffy 官方 FromStr，裸 0→0px）；② 轨迹串接受 auto / % / min-content / max-content / fit-content + repeat(auto-fill|auto-fit, …)；③ 新增 **grid-auto-columns/rows**（隐式轨道尺寸，taffy GridTrackVec<TrackSizingFunction> 原生）。★**诚实边界**：命名线（[name]）/ span 文字未支持（诊断跳过）；Skyline 端实测退化为 block ⇒ 有条件可用
- **`justify-self（网格项行内轴自对齐）`** — ★★★justify-self 项（2026-10-06 · css:next P0·9× · CSS Box Alignment 3）：网格项**行内轴自对齐**。语料 9 处全在 grid 上下文（p-formfactor 仪表盘 justify-self: start/stretch）。契约：新级别 JustifySelf（四同步）；编译器 APP_LAYOUT_FIELDS + 封闭集（auto/normal/start/end/flex-start/flex-end/self-start/self-end/center/stretch）；内核 LStyle.justify_self → taffy Style.justify_self（grid 计算路径原生消费——flex 容器下 taffy 与 Web 同为「忽略」）；blob 枚举位图 E_JUSTIFY_SELF。★诚实边界：baseline/left/right 未列（taffy 的 grid baseline 按 start 近似=与 Web 不符 ⇒ 诊断跳过，不静默近似）；仅 grid 容器生效（taffy 原生语义=Web 语义：flex 下被忽略）；宿主零改动（纯内核布局）。★Skyline 官方属性表无 justify-self（该端无 Grid 容器）——主承载端为 App（自研内核）
- **`place-items（+ justify-items 长手）`** — ★★★place-items/justify-items 项（2026-10-08 · css:next P0·1× · CSS Box Alignment 3）：**网格容器内所有子项的「行内轴」对齐**（`place-items: <align-items> <justify-items>` 简写；单值⇒两轴同）。语料 1 处（p-formfactor hero 媒体 `place-items: center end`）。契约：新级别 JustifyItems（四同步，值集 = JustifySelf 去 auto）；编译器 place-items 简写展开为 alignItems + justifyItems（+ justify-items 长手）；内核 LStyle.justify_items → taffy Style.justify_items（grid 容器原生——flex 下 taffy 与 Web 同为「忽略」）。★诚实边界：baseline 按 start 近似（同 justify-self ⇒ 未列封闭集，诊断跳过）；仅 grid 容器生效；宿主零改动（纯内核布局）。★Skyline 官方属性表无 grid 族——主承载端为 App（自研内核）
- **`aspect-ratio`** — ★批次 24（2026-10-04 · ★基准 = Web）：宽高比（媒体卡/占位图）。`<n>`（1.5）/`<w>/<h>`（16/9，含空格）→ 比值；`auto` = 默认不发射。内核 `LStyle.aspect_ratio` → taffy `aspect_ratio`（原生；定一轴派生另一轴）
- **`flex-wrap`** — ★批次 6（2026-10-04）：引擎新增 `FlexWrap`（Rust `LStyle.flex_wrap` + `NodeDto` + taffy `flex_wrap` 映射，闭合集 nowrap/wrap/wrap-reverse）；编译器入 APP_LAYOUT_FIELDS + APP_ENUM_VALUES + Android LAYOUT_KEYS 白名单。引擎行为测试 tests/flex_wrap.rs（wrap 换行/nowrap 不换行）
- **`align-content`** — ★批次 11（2026-10-04）：引擎 `LStyle.align_content`（open string，与 justify/align-items 同模式）+ `NodeDto` + taffy `align_content` 映射（parse_align_content：center/flex-start/…/space-evenly → AlignContent）；编译器入 APP_LAYOUT_FIELDS + Android LAYOUT_KEYS。多行弹性容器的**行间**对齐（标签墙/宫格）。引擎行为测试 tests/align_content.rs（center 行组居中）
- **`right / bottom`** — ★批次 8（2026-10-04）：引擎 `LStyle.right/bottom` + `NodeDto` + taffy inset 映射（absolute/relative 的右/下边缘锚定）；编译器入 APP_LAYOUT_FIELDS + style-object + Android LEN_SCALARS/LAYOUT_KEYS。★**超级应用刚需**：角标 / FAB / 关闭按钮 / 底部弹层锚点。引擎行为测试 tests/inset_right_bottom.rs（right=10/bottom=5 ⇒ 落父右下角）
- **`inset（top/right/bottom/left 的 1–4 值缩写）`** — ★批次 38（对齐 Web · 削减胶水）：编译期展开为 top/right/bottom/left（引擎四边已支持）；真项目 15 处（路由层/浮层/scrim 的 position:absolute; inset:0）。auto 边 = 默认偏移（该边不设）。
- **`order`** — 引擎无字段
- **`pointer-events`** — ★批次 32（2026-10-04 · ★基准 = Web）：`none` / `auto`。`none` ⇒ 该节点**不参与命中测试**（事件穿透到其下——浮层/遮罩刚需），但**仍占位**（有几何）。CSS **可继承**（父 none ⇒ 子默认 none、子 auto 可覆盖）——编译期按树算 computed 值。内核 `hit_path` 逐节点跳过 `pointer_events==false`（绘制/层不动——node 仍绘制）。只有内核 hitTest 消费（三端同一命中实现）。
- **`grid-auto-flow`** — ★★★grid-auto-flow 项（2026-10-08 · css:next P0·3× · CSS Grid）：类 grid 容器的**自动放置方向/密度**。契约：新级别 GridAutoFlow（四同步）；值集 = 四端可表达子集（row / column / dense / column dense；Web `row dense` 归一为 `dense`）；编译器 APP_LAYOUT_FIELDS + 封闭集 + 折叠分支；CSE 直通 IR 字段 gridAutoFlow；内核 LStyle.grid_auto_flow → taffy `Style.grid_auto_flow`（GridAutoFlow 原生，仅 grid 容器消费——item 上被忽略，与 Web 同）；consistency 链（applier/snapshot/probes/coverage）。★诚实边界：Skyline 官方属性表无 grid 族（该端无 Grid 容器，grid→嵌套 flex degrade）——主承载端为 App（自研内核）。
- **`grid-template-areas`** — ★★★grid-template-areas 项（2026-10-08 · css:next P0·2× · CSS Grid）：grid 容器的**命名区域模板**（配合子项 grid-area: <name> 放置）。契约四同步（该能力无独立语义级别——走引擎字段，同 gridTemplateColumns 先例）；编译器 APP_LAYOUT_FIELDS + 折叠分支（CSS 多引号串归一为**浏览器 computed 形态**，与 parity 真值对齐）；CSE 直通 IR 字段 gridTemplateAreas + gridArea（grid-area: <name> 即命名区引用；线号形态 1 / 2 / 3 / 4 拆 grid-row/grid-column）；内核 LStyle.grid_template_areas 走 taffy GridTemplateAreas（区域名解析成 名-start / 名-end 命名线）+ grid_area 走 GridPlacement::NamedLine（NamedLineResolver 解析区域跨行/跨列）；consistency 链（applier/snapshot/probes/coverage）。★诚实边界：Skyline 官方属性表无 grid 族（该端无 Grid 容器，grid→嵌套 flex degrade）——主承载端为 App（自研内核）；空单元（点号）/ 命名线 / span 未支持（诊断）。
- **`grid-area`** — ★★★grid-area 项（2026-10-08 · css:next P0·2× · CSS Grid）：子项的**网格放置**（命名区引用 / 线号）。命名形态 grid-area: <name> 折为 gridArea（内核走命名线放置）；线号形态 grid-area: 1 / 2 / 3 / 4 拆为 grid-row + grid-column。契约四同步（引擎字段，同 gridColumn 先例）；编译器折叠 + CSE（gridArea 直通）。★诚实边界：span / auto 命名线混合形态未支持（诊断）。

### 取值

- **`margin/padding 1–4 值简写 + background 纯色简写 + flex 简写`** — ★批次 2/7（2026-10-04）：a) `margin: 8px 0` / `padding: 8px 12px` 按 CSS 标准展开为 {top,right,bottom,left}（auto 的边忽略）；b) `background: #fff`/`rgba(...)` 归一折进 backgroundColor；c) `flex: <g> [<s> [<b>]]` / `none` / `auto` 展开到 flexGrow/flexShrink/flexBasis（CSS 语义：省略 shrink=1、省略 basis=0）。取证：真项目这些简写高频。渐变/图片简写诊断跳过

### 单位

- **`width/height 百分比`** — → widthRatio/heightRatio（比例字段）
- **`min() / max() / clamp()`** — ★数学函数项（2026-10-08 · css:next P0）：`min()/max()/clamp()` **px-only 常量化**——全参数为编译期绝对长度（`px`/数字/`calc()`/嵌套数学）⇒ 折为单 px（`clamp(MIN,VAL,MAX) = max(MIN, min(VAL, MAX))`）。★与既有 `calc()` 折叠**同阶段、同能力**（都在编译期常量求值）；含 `百分比/vw/vh/unitless` 参数 ⇒ 编译期无上下文不可求 ⇒ **诊断（不静默丢）**——浏览器在 used-value 阶段按容器/视口求解（App/MP 的相对长度模型为运行时 ratio，无编译期容器上下文）。★两路径一致（CSE `foldMathPx` + App 折叠面 `numOf/parseLineHeight` 共用 px-only 口径），否则 App/Web 分叉。★实测修复假阴性：此前 CSE 把合法 `clamp()/min()/max()` 判 `CSE_VALUE_INVALID` 静默丢弃（语料真用：p-formfactor 网格轨道 / Home.vue 流体尺寸——但其参数含 %/vw ⇒ 属上述编译期不可求面，如实登记）。诚实边界：含相对单位的数学函数在 App/Skyline 端**不折**（诊断）；Web 由浏览器 used-value 求解 ⇒ 该类形态跨端不可比（本项验收页只用可绝对化参数）。
- **`em / rem / vw / vh / calc / clamp`** — 收 px/数字/rpx（宽高另支持 %）。★批次 21：`rpx`（小程序 750 设计单位，1rpx = 0.5px，与 rpxRatio:2 互为逆）折为 px——真项目 125 处。★★`vw`/`vh`（2026-10-08 · 决策 #595 · Stage 2）：编译期折为内置视口变量 `--pf-vw`/`--pf-vh`（`19vw` → `env:--pf-vw*0.19`，宿主采集**真实视口逻辑尺寸**；`min-height:100vh` → `env:--pf-vh`）——此前 App **整条丢弃** `vw`/`vh`（页面不铺满/宽度丢失）；现与 Web 同语义。其余相对单位（em/rem）编译期无上下文 ⇒ 诊断跳过（`var()` 见 css-vars 行；`clamp()/min()/max()` 见 math-functions 行——已支持）。★批次 22 + calc 收口（2026-10-08）：`calc()` **完整算术常量折叠**——`+ - * /` 与括号、`env(safe-area-inset-*)` fallback（`var()` 已在解析前置换 ⇒ `calc(var(--u) * 1.15)` 也折）；**CSE 与 App 折叠面共享唯一实现 `calc-fold.ts`（同口径）**——此前 CSE 仅支持单层同单位加减（`calc(8px * 0.6)` 等在 CSE 被丢、App 却折得出 ⇒ 两路径分叉）。含 `%`/相对单位的 calc（`calc(100% - 20px)`）仍诊断（无上下文）。组件库 64 处 `calc(var(--x) * N)` 依赖它

### 特殊

- **`box-sizing`** — 两内核恒 border-box ⇒ 只作忠实记录、无副作用

### 动效

- **`transform（2D：translate / scale / rotate）`** — ★批次 39（2026-10-04 · 对齐 Web · 削减胶水）：静态 transform 编译期折成数值集（txPx/tyPx + txPct/tyPct 盒比例 + 等比 scale + rotate）⇒ 三端宿主逐节点变换通道应用（复用动画表：静态为基态、动画覆盖之）。支持 2D 子集；3D/skew/matrix/非等比缩放 ⇒ 诊断跳过（如实）
- **`transform-origin`** — ★批次 40（2026-10-04 · 补齐批 39）：编译期折成盒分数 {x,y}（关键字 left/center/right/top/bottom 1–2 值 / 百分比 / 0）⇒ 三端宿主变换锚点（Android injectTransformOrigin · iOS 建层快照 + applyTransform · 鸿蒙 SetPivot 规范化坐标）。非零 px 需盒尺寸 ⇒ 诊断跳过；默认中心不发射

### 选择器

- **`类选择器 .a / .a.b`** — C1：<style> 类规则编译期匹配合并（按源序；无特异性权重）
- **`元素/类型选择器 h3 / p.foo`** — C1：按节点原始 tag 匹配（含祖先链）
- **`后代 / 子组合 .a .b / .a > .b`** — C1：祖先类链匹配
- **`静态结构伪类 :first-child / :last-child / :nth-child(An+B|odd|even) / :not(简单选择器)`** — ★批次 37（对齐 Web）：元素兄弟序在编译期树遍历里已知 ⇒ 结构伪类**编译期算一次**（:first-child/:last-child/:nth-child + :not 单段简单选择器）；节点无祖先 CSS 引擎。
- **`状态伪类 :hover / :active / :focus / :checked`** — ★批次 37：需**运行时状态通道**（App 自绘手势层无 hover 概念）；状态切换改用动态 :class 或语义组件。
- **`属性选择器 [data-x]`** — 编译期可判（属性在模板里静态可枚举）
- **`Vue 作用域穿透 :deep() / ::v-deep() / >>>`** — ★批次 37：编译期展开为普通后代选择器（本仓无 scope 后缀之外的作用域处理）；`>>>` 等价 `:deep()`。
- **`兄弟组合 + / ~`** — 语义弱、跨端难统一（Skyline 亦不支持）——建议改写为类选择器。
- **`通配 *`** — ★批次 37（对齐 Web）：`*` 单段匹配任意元素（特异性 0）；`.box > *` 这类"所有直接子"常见于设计与重置样式。

### 层叠

- **`特异性 / 继承 / !important`** — ★批次 1（2026-10-04）：规则按 (!important, 特异性 (id,class,tag), 源序) 层叠；color/fontSize 沿树继承（CSS 可继承子集；编译期一次性算进 computed style，运行时零匹配）
- **`CSS 自定义属性（design tokens）var(--x)`** — ★批次 9（2026-10-04）：从项目 `globalStyle`（如 styles/tokens.css，与 Web/MP 同一份）解析 `--name: value`，SFC 内 `var(--x)` **编译期替换为字面值**（递归展开引用令牌；支持 fallback；未知令牌诊断）。★**超级应用承载关键**：组件库/主题化全靠设计令牌（真项目 242 处 var()）。诚实边界：只折**字面值**令牌；calc()/env() 动态令牌值不折

### @ 规则

- **`@media（响应式 / 环境条件）`** — ★条件 at-rule 通道（2026-10-08）：@media 是**跨端控制结构**，其语义由 **@proteus-vue/fluid 独立通道**交付（非编译器折叠面）——视口/容器断点 → createContainerQuery/resolveBreakpoint/createAdaptiveController（以**容器**为基准，车机/多窗口）；prefers-reduced-motion → shouldReduceMotion/createDeviceEnv；orientation/display-mode(折叠) → readDisplayMode；hover/pointer → probePointer。★具名边界（决策 #279 FLD001 / W-6）：手写 @media 在 App 端**无对等**（自绘引擎无 CSS 条件块）⇒ 框架规定响应式走 fluid 容器查询（禁止手写 @media），Web/MP 由各自 CSS 引擎原生处理。原 note：编译期无法唯一确定断点（无容器/视口上下文）。
- **`@supports（特性检测）`** — ★条件 at-rule 通道（2026-10-08）：@supports 的语义由 **@proteus-vue/fluid 的 detectFluidCapabilities**（probe 式运行时能力检测：clamp/grid/containerQuery/flexGap/aspectRatio）+ formSupports 交付（运行时能力分支）；App 端无 CSS 引擎 ⇒ @supports 条件块跳过（具名边界）；Web/MP 由各自 CSS 引擎原生处理。
- **`@keyframes（关键帧动画）`** — ★批次 42（2026-10-04 · 动效 · 对齐 Web）：@keyframes 停靠点（from/to/%）解析 → 逐通道 keyframe 规格（opacity + px 位移/等比缩放/旋转）→ 内核 anim_start（Keyframes 模式）；挂载后由宿主启动。@keyframes 块不再被误当选择器
- **`animation（简写：name duration timing delay …）`** — ★批次 42（对齐 Web）：animation 简写 → 命中同文件 @keyframes → 逐通道 keyframe 动画（内核 anim_start）；单次播放、终态保持（iters/delay/direction/fill 暂忽略，诊断）。可动画通道限 opacity / px 位移 / 等比缩放 / 旋转

### 文本

- **`word-break（行内断词策略）`** — ★★★word-break 项（2026-10-06 · css:next P0·7× · CSS Text · 继承属性）：行内断词策略。值集 = 四端可表达子集（normal / break-all / break-word；keep-all/auto-phrase 诊断跳过）。语料 7 处（长串/代码块 break-all · p-rich-text break-word）。契约：新级别 WordBreak（四同步）；CSE 继承集（word-break 是继承属性）+ 展开映射；编译器 APP_LAYOUT_FIELDS + APP_INHERITABLE_FIELDS（补 white-space 同族）+ 折叠分支（透传宿主文本引擎，内核忽略该键）；consistency 链条（applier/snapshot/probes/coverage）。★承载端：Android StaticLayout setBreakStrategy / iOS CATextLayer lineBreakMode(byCharWrapping) / 鸿蒙 OH_Drawing_SetTypographyTextWordBreakType / MP wxss（官方表支持 normal/break-all）。★normal 断词对齐（2026-10-09）：App 三端（自绘）对「无断点长串且溢出盒宽」显式判为**单行溢出**（= Web normal「不折长词」）——Android `isUnbreakableToken`+单行绘制 / iOS `effectiveWrap`+跳过 CoreText / 鸿蒙 `WORD_BREAK_TYPE_NORMAL`；**MP/Skyline 引擎锁定**（恒软换行，具名豁免）。★诚实边界：keep-all（CJK 专用，Skyline 无、内核无对应）/ auto-phrase（实验）未支持（诊断跳过）；break-word 归一波 overflow-wrap 语义（主流实现等价）
- **`font-weight`** — ★批次 3（2026-10-04）：`normal`→400 / `bold`→700 / 100–900 数值归一；作为**文本可继承**字段沿树继承。三端宿主：iOS 已读 `fontWeight`（≥600 bold 判据）、Android 新接线（Cmd.fontWeight + 绘制/度量同源 typeface）、鸿蒙新接线（OH_Drawing_SetTextStyleFontWeight）
- **`text-decoration`** — ★批次 35（2026-10-04 · ★基准 = Web）：`underline` / `line-through`（`none` = 默认不发射）；CSS **可继承**（沿树传播）。三端宿主：iOS `NSAttributedString.underlineStyle/strikethroughStyle` · Android `Paint.setUnderlineText/setStrikeThruText` · 鸿蒙 `OH_Drawing_SetTextStyleDecoration`。诚实边界：`overline`/颜色/线型未支持（诊断）
- **`text-align`** — ★批次 4（2026-10-04）：封闭集 left/center/right（justify/st 等诊断跳过）。宿主：iOS CATextLayer.alignmentMode · Android Paint.Align（绘制 x 按对齐换算）· 鸿蒙 OH_Drawing_SetTypographyTextAlign。真项目 28 处（22 center）
- **`line-height`** — ★批次 13（2026-10-04，含真机修正确标准）：无单位倍数 / 百分比（→倍数）/ 绝对 px 归一为 token；作为**文本可继承**字段沿树继承。三端宿主实现 **CSS 语义**（非仅行盒高）：行盒变高、字形内容区在行盒内**垂直居中**（半行距）——与 Web/Skyline 真 CSS 一致：iOS measureText 行盒高 + 文本层**可视 frame 居中收缩**（层中心不变 ⇒ 不影响锚点动画）· Android buildMeasures 行盒高 + drawCmds 基线 `盒心 − (ascent+descent)/2` · 鸿蒙 measureTextTypoPx 行盒高 + TypographyPaint `offsetY = (盒高−字形高)/2`。★真机实测 CATextLayer 是顶对齐（故必须显式居中收缩才对齐 Web）。诚实边界：letter-spacing 未支持
- **`text-overflow`** — ★批次 16（2026-10-04 · ★基准 = Web）：CSS 默认 clip（截断不省略）；ellipsis ⇒ 自绘文本**单行**行尾以 … 截断（超级应用列表项/标签截断刚需）。封闭集 clip/ellipsis（大小写不敏感；其余诊断跳过）；作为**文本可继承**字段沿树继承。三端宿主：iOS CATextLayer.truncationMode（ellipsis ⇒ .end；其余 ⇒ .none——★此前**恒 .end** 是 Web 偏差）· Android TextUtils.ellipsize(TruncateAt.END)（挂载/更新时算好 = 绘制零开销）· 鸿蒙 OH_Drawing_SetTypographyTextEllipsis（maxLines=1 + 尾部 modal + Layout 按盒宽）。诚实边界：仅**单行**（本仓文本无自动换行）；多行截断见 `-webkit-line-clamp` 项（已支持）、fade（渐隐）未支持
- **`-webkit-line-clamp: <integer>`** — ★line-clamp 项（2026-10-08 · ★基准 = Web）：**多行截断**——文本折行超过 N 行 ⇒ 只保留前 N 行、末行尾以 … 结尾（WebKit 三件套 `display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:<n>` 的事实标准）。Web 真值（真 Chromium 实测）：盒高恒 = N × lineHeight、末行尾加 …，**与 overflow 声明无关**（computed display 变 flow-root）。编译期：`display: -webkit-box/-webkit-inline-box/box` 静默容忍（无 App 对等、不落 display 字段）、`-webkit-box-orient` 静默丢弃、`-webkit-line-clamp:<正整数>` → lineClamp（0/负 = 无截断，诊断跳过）。作为**文本可继承**？否（line-clamp 非继承属性）。三端宿主（均**测量封顶 = 绘制同源**——否则盒高与墨迹打架）：iOS 适配器 CTFramesetter 预截断（CATextLayer 无 numberOfLines ⇒ 自建截断串）+ measureTextWrapped(maxLines) 封顶 · Android StaticLayout.setMaxLines+setEllipsize(END)（测量/绘制两处同款）· 鸿蒙 OH_Drawing_SetTypographyTextMaxLines + EllipsisModal(TAIL)（测量用 min(自然行数, clamp) 封顶）。诚实边界：① 仅**尾部省略号**（WebKit 事实标准；fade 渐隐未支持）；仅当文本确需折行（white-space 非 nowrap/pre）时生效（与 Web `display:-webkit-box` 的块级折行语义一致）。② **Skyline（本页真机渲染器）引擎锁死边界**：官方属性表未收录 `-webkit-line-clamp`、且不收 `display:-webkit-box`（只认 none/flex/block）⇒ 真机实测**不截断**；该端无 CSS 多行截断等价属性（如需按端条件渲染或组件化，另立项）。主承载端 = Web（浏览器原生）+ App（自研内核）。
- **`letter-spacing`** — ★批次 20（2026-10-04 · ★基准 = Web）：字距（超级应用排版）；Web 默认 normal（=0，不发射）；`<n>px`/`<n>` → 数值 + 作为**文本可继承**沿树继承（相对单位 em/rem 未支持 ⇒ 诊断）。三端宿主：iOS `NSAttributedString` kern（`textLayerString` helper；度量/绘制同源）· Android `Paint.setLetterSpacing`（em：px/字号；度量+绘制）· 鸿蒙 `OH_Drawing_SetTextStyleLetterSpacing`（物理 px）
- **`font-family`** — ★批次 36（2026-10-04 · ★基准 = Web）：候选清单 → **字体角色**（system/serif/monospace/rounded/condensed；与 renderer-app 的 normalizeFontFamily 同一映射）；未识别具体族名透传 custom:<名>。CSS **可继承**。宿主：iOS ProteusTextAdapter.font(family:)（角色→UIFont）· Android typefaceOf(role)（角色→Typeface）· 鸿蒙 SetTextStyleFontFamilies（**best-effort**：鸿蒙字体集有限，仅 monospace/serif 映射、其余回落默认——如实边界）。★字体名大小写敏感、自定义族需宿主注册（见 CUSTOM_FONT_PREFIX）
- **`white-space`** — 白空格（多行/保留空白）走平台文本引擎（不自研）——App 仅支持 `nowrap`（= App 单行默认，no-op）；`normal`/`pre`/`pre-wrap`/`pre-line` 未支持（诊断）。★文本维已含 fontSize/color/fontWeight/textAlign/line-height/text-overflow/letter-spacing/**text-decoration**（批 35）

### 层

- **`z-index`** — 本仓已定案**语义化**（layer="content|navigation|mask|popout"，见 contracts/layers.ts）——数值禁止（跨端无意义 + 推高合成层内存）

> 复现：能力验收项目（`css-conformance`）逐页对照本表；语义边界以各端实测为准。

<!-- generated by scripts/gen-css-support.mjs · SSOT：docs/generated/css-capability-alignment.json -->