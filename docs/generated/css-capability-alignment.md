# CSS 能力对齐清单（三端：Web / Skyline / App）

> ★自动生成（`node scripts/gen-css-capability-alignment.mjs`），勿手改。漂移门禁：`--check`。
> **三端模型**：Web（浏览器 CSS，超集）· Skyline（微信容器，唯一刚性外部约束）· **App（自研自绘 Rust 引擎，一套，面由我们定义、可扩展）**。
> 旧「五端」的 iOS/Android/鸿蒙 三列是**非自绘时代的原生组件映射**，在自绘模型下已失效 ⇒ 合并为 App。

## 端模型与证据来源

- **端**：web / skyline / app
- App = 自研自绘 Rust 引擎（一套，覆盖 iOS/Android/鸿蒙 三具体平台）——CSS 面由我们定义、可扩展；Skyline = 微信容器（唯一刚性外部约束）。旧「iOS/Android/鸿蒙」三列是**非自绘时代的原生组件映射**，在自绘模型下已失效 ⇒ 合并为一个 App。

| 列 | 采集方式 | 来源 | 采集日 |
|---|---|---|---|
| Web | Chromium CSS.supports（Playwright 151.0.7922.34） | 本机实测 | 2026-10-02 |
| Skyline | 官方《Skyline WXSS 样式支持与差异》解析 | https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/wxss.html · sha f7f4d7ebaef41608 | 2026-10-02 |
| App 现状 | 代码事实核对（编译器折叠面 + 引擎 LStyle + 宿主自绘） | `docs/generated/css-capability-sources/app-profile-features.json`（人工维护） | 2026-10-04 |

## App 端「现状」取值口径

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

> tier 是**加入该能力的成本档位**（人工按 Profile §3 标注，非实测毫秒）；supported 项的 tier = 它落地时所处档位；absent 候选的 tier = 若实现将归入的档位。

## 多端一致性审计（批 14 · 对齐 CSS 标准）

> ★批次 14（2026-10-04 · 多端一致性审计，用户「再看下我们已经实现的CSS哪些没有按照多端一致性实现的」）：对批 1–13 已实现的每个特性逐一对照 **CSS 标准（Web 为真值）**——★基准是 Web（浏览器真值），**不是「三端内部自洽」**（三端都是自研/原生绘制，容易互相看齐却集体偏离 Web）。已修：① line-height 顶对齐→**半行距居中**（批 13 修正）；② **命名色**（148 标准色）丢弃→归一（Web 生效）；③ **非 solid 边框线型**静默画成实线→**诊断跳过**；④ **text-align 语义级不可继承**→作为**继承**属性沿树传播；⑤ **box-sizing: content-box** 静默忽略→**诊断**；⑥ **枚举关键字大小写敏感**（`display: FLEX` 丢弃）→**大小写不敏感**（CSS 标准）。已确认对齐（无需改）：弹性轴默认（框架**显式声明** flex-direction 使其 3 端一致，绕过 Web(row)/Skyline(column) 默认分歧）、background 纯色、margin/padding/flex/background 简写展开。★批次 15（2026-10-04 · ★基准 = Web，用户「以后就按这个来，以 web 为基准对齐」）：继续按 **Web 真值** 审计已实现特性，本轮专修 **颜色归一**（此前只收 hex/rgb/rgba，其余 Web 合法形态**整条丢弃** ⇒ App 失样式）。补齐：① **4 位 hex #RGBA**（Web 合法，编译期展开为 8 位）；② **hsl()/hsla()**（设计系统常用，含 deg/rad/grad/turn 色相单位）；③ **现代空格 + /alpha 语法**（rgb(255 0 0) / hsl(0 100% 50% / 50%)）；④ **% 通道**（rgb(100%,0%,0%)）；⑤ **alpha 越界按 Web 语义 clamp 到 0..1**（旧实现 >1 ⇒ /255 把 rgba(...,2) 画成近乎透明，与 Web 不符）。未支持（如实诊断跳过）：currentColor（需运行时 color）· CSS4 新空间 lab()/lch()/oklab()/oklch()/color()/hwb()。★批次 26（2026-10-04 · 诊断质量）：**Web 默认值 / 无操作声明**显式识别（不诊断）——`transform:none` / `border:none|0` / `background:none` / `box-shadow:none` / `text-decoration:none` / `outline:none` / `background-image:none` / `display:block`（App 默认 flex-direction:column = block-like）。这些「无视觉变化 / = App 默认」的写法此前被报成「缺口」= **假阳性**（淹没真缺口）；现编译期**忽略且不诊断**。★实测：examples 真实构建的 CSS 声明级诊断**归零**（其余仅剩 :hover/@media 等结构性项）。★批次 27（2026-10-04 · 级联修正）：**重置声明的级联覆盖**——「`.b{border:none}` 覆盖 `.a{border:1px solid}`」此前**失效**（重置声明被直接 skip ⇒ 低优先级声明残留）。修：重置声明改为**记录默认值**（border:none→borderWidth:0 · background:none→透明 · box-shadow:none→null），使级联覆盖生效；`display:block`（= App 默认 block-like，无行为差异）⇒ 空记录不落键（避免 churn）；`transform:none`/`text-decoration:none` 等无 App 字段的 ⇒ 空记录。★批次 28（2026-10-04 · 继承关键字）：`inherit` 关键字支持（可继承属性 color/font-size/font-weight/line-height/text-align/text-overflow/letter-spacing + visibility）——`color:inherit` 等 = **显式取父 computed 值**（覆盖低优先级声明）；编译期记哨兵、由继承 walk 解析为父值；非可继承字段的 `inherit`（如 `width:inherit`）⇒ 忽略（不诊断）。★批次 29（2026-10-04 · 收口证据）：**showcase（120 路由 / 80+ 组件）App 构建的 CSS 诊断基本归零**（仅剩 v-model 写回等交互项 + 1 选择器）——CSS 声明级折叠面已成熟。另：`white-space: nowrap` = **no-op**（App 文本模型本就是**单行**，= App 默认）；`normal`/`pre`/`pre-wrap`/`pre-line` 需**多行/保留空白**支持（真缺口，诊断）。`overflow-x/y: visible` = 默认（no-op）；`hidden`/`auto` 分轴需独立支持（诊断）。★批次 30（2026-10-04 · 削减胶水）：**动态 :class 解析**——`:class=「{on:open}」`（对象/数组/字符串）此前**静默不生效**（编译器已发射 `paint.class` 绑定，运行期无解析）。现：编译期投影**自匹配纯类**规则（`.a`/`.a.b`）→ 订阅表 `classRules`；运行期解析活跃类名集 → 匹配 → 逐字段下发（**绘制字段**：颜色/字号/圆角/透明度…）；**关掉的类清字段**（对齐 Vue「类移除⇒样式移除」）。诚实边界：动态类设**布局字段**（width/height/margin…）**如实诊断**（VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED——当前绘制通道装不下布局字段）。用量：组件库 64 + examples 27 处。

## 超级应用能力清单（★优先口径：不按 demo 使用频次）

> ★优先口径（用户 2026-10-04 明示）：「我们的目标不仅仅是当前项目使用到的，我们的目标是**承载超级应用**」。⇒ 批次选择**不按 demo 使用频次**，而按「超级应用是否会用到」+ 三端可实现性。下表的 status 用 today 取值（supported/folded-only/engine-only/absent）。

| 超级应用能力 | 用途 | 现状 |
|---|---|---|
| 定位锚点（absolute + top/left/right/bottom + z 序） | 角标 / FAB / 关闭按钮 / 底部弹层 / 悬浮层 | supported（批 8 补 right/bottom；层序走层容器） |
| 卡片外观（background / border / border-radius / shadow / 内边距） | 列表项 / 卡片 / 面板 | supported（background/border/border-radius/padding ✅ 批 2/5；**box-shadow ✅ 批 10**；**aspect-ratio ✅ 批 24**——媒体卡/占位图，内核 taffy 原生） |
| 弹性流式布局（flex + wrap + gap + align/justify/content + 百分比） | 响应式排布 / 标签墙 / 宫格 | supported（批 6 flex-wrap · 批 11 align-content 已补） |
| 文本呈现（size / weight / align / color / line-height / 截断） | 标题 / 正文 / 单行截断 | font-size/weight/align/color ✅ · **line-height ✅ 批 13** · **text-overflow 单行截断 ✅ 批 16** · **letter-spacing 字距 ✅ 批 20**（诚实边界：仅单行截断 / px 字距） |
| 栅格 / 复杂排布（grid） | 仪表盘 / 复杂页面 | supported（批 12：引擎 Display::Grid + 显式轨迹 fr/px + repeat 展开；诚实边界：auto/minmax/gr、id-area 定位未支持） |
| 动效（transition / transform / keyframes） | 转场 / 反馈 / 加载 | 引擎 anim 通道 ✅（transition 走 <Transition>/宿主指令）；**transform 静态折叠面 ⏳** |
| 滚动容器（overflow + 滚动） | 长列表 / 弹层内容 | supported（overflow + 虚拟列表） |
| 层叠与主题（继承 / 变量令牌 / 特异性） | 主题化 / 组件库 | supported（批 1 继承/特异性/!important；**批 9 CSS 变量 var() 令牌编译期折叠**——从 globalStyle 解析，超级应用承载关键） |

## CSS 能力矩阵

| 类别 | CSS | Web | Skyline | App 现状 | App 可扩展 | 策略 | 对齐 | 说明 |
|---|---|---|---|---|---|---|---|---|
| layout | `width` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → 长度；百分比 → widthRatio（比例字段，非长度） |
| layout | `height` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → 长度；百分比 → heightRatio |
| layout | `min-width / max-width / min-height / max-height` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字；★批次 19：**百分比**（`max-width:100%` 不溢出 / `min-height:100%` 撑满）折为 `*Pct`（0..1）⇒ 内核 taffy 按父内容盒解析（min 缺省 0 / max 缺省 auto 语义不变） |
| layout | `margin（+ 四边简写 + 1–4 值 shorthand）` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → {top,right,bottom,left}；1–4 值简写按 CSS 标准展开（`margin: 8px 0`）；★批次 17：`auto`（`margin: 0 auto` 水平居中）折为逐边 `marginAuto` 标记 → 内核映射 taffy auto（此前静默丢弃 = Web 偏差）；Web 探针取 margin-top 代表 |
| layout | `padding（+ 四边简写 + 1–4 值 shorthand）` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → {top,right,bottom,left}；1–4 值简写按 CSS 标准展开（`padding: 8px 12px`）；Web 探针取 padding-top 代表 |
| layout | `display: flex / none` | supported | supported | supported | L2 | 直映射 | universal | 引擎封闭集仅 flex/none（block/inline-block/inline-flex/grid ⇒ 诊断跳过） |
| layout | `flex-direction` | supported | supported | supported | L2 | 直映射 | universal | 封闭集 row/column/row-reverse/column-reverse |
| layout | `justify-content` | supported | supported | supported | L2 | 直映射 | universal | 引擎为**开放字符串**（未知值静默落默认，不崩） |
| layout | `align-items / align-self` | supported | supported | supported | L2 | 直映射 | universal | 开放字符串（未知值静默落默认） |
| layout | `flex-grow / flex-shrink / flex-basis` | supported | supported | supported | L2 | 直映射 | universal | flex-basis 为长度 |
| layout | `gap（+ row-gap / column-gap）` | partial | partial | supported | L2 | 直映射 | conditional | px/数字；★批次 31：**两值** `gap:<row> <col>` 与 **轴级** `row-gap`/`column-gap`（内核 `LStyle.row_gap/column_gap` → taffy `gap.height/width`）——真项目组件库 15 处两值 gap |
| layout | `position: static / relative / absolute` | supported | supported | supported | L2 | 直映射 | universal | 引擎封闭集；sticky/fixed ⇒ 诊断跳过 |
| layout | `top / left` | supported | supported | supported | L2 | 直映射 | universal | 配合 absolute；引擎无 right/bottom（见候选） |
| layout | `overflow: visible / hidden / scroll / auto` | supported | supported | supported | L2 | 直映射 | universal | 引擎封闭集；auto 折叠为 taffy Scroll |
| value | `margin/padding 1–4 值简写 + background 纯色简写 + flex 简写` | — | — | supported | L1 | 编译期折叠 | conditional | ★批次 2/7（2026-10-04）：a) `margin: 8px 0` / `padding: 8px 12px` 按 CSS 标准展开为 {top,right,bottom,left}（auto 的边忽略）；b) `background: #fff`/`rgba(...)` 归一折进 backgroundColor；c) `flex: <g> [<s> [<b>]]` / `none` / `auto` 展开到 flexGrow/flexShrink/flexBasis（CSS 语义：省略 shrink=1、省略 basis=0）。取证：真项目这些简写高频。渐变/图片简写诊断跳过 |
| unit | `width/height 百分比` | — | — | supported | L1 | 编译期折叠 | conditional | → widthRatio/heightRatio（比例字段） |
| paint | `background-color（+ background 纯色简写）` | supported | supported | supported | L1 | 编译期折叠 | universal | 颜色编译期归一为 hex：hex / rgb() / rgba() / **命名色（148 个标准色，批 14）** / transparent；hsl/var ⇒ 诊断跳过。★`background` 纯色简写折进 backgroundColor；★批次 33：`linear-gradient` / `radial-gradient` 折进引擎 `fillGradient` 通道（`background`/`background-image` 均可）——免去手写 `fill-gradient='{json}'` 的胶水；`url()` 图片仍诊断（走原生组件）。★批 14 多端一致性审计修：命名色此前丢弃（Web 生效）⇒ 现查表归一（核心只认 hex） |
| paint | `color` | supported | supported | supported | L1 | 编译期折叠 | universal | 颜色归一（hex/rgb/rgba/hsl/命名色/4 位 hex/transparent）；★批次 23：`color-mix(in srgb, A [pa%], B [pb%])` **常量折叠**（var() 已置换 ⇒ 两色已知 ⇒ sRGB 预乘 alpha 混合）——组件库 16 处令牌着色；非 srgb 色彩空间（oklab/lab…）诊断 |
| paint | `font-size` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字（不支持百分比/keyword） |
| paint | `border-radius` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字（宿主圆角绘制）；★批次 18：**百分比**（`border-radius: 50%` = 内切圆/椭圆，头像/圆点刚需）折为 `borderRadiusPct`（0..1）⇒ 宿主按 `pct × min(w,h)` 算半径（正方盒 = 精确圆，Web 一致；非正方盒为统一圆角，Web 为椭圆——如实近似）。★批次 34：**逐角**（`12px 12px 0 0` 等——统一半径 + 部分角掩码 `borderRadiusCorners`，宿主 iOS maskedCorners / Android addRoundRect / 鸿蒙 CornerDirection）；**半径不一致**的逐角（`8px 4px`）诊断（不猜） |
| paint | `opacity` | supported | supported | supported | L1 | 编译期折叠 | universal | 0–1 |
| special | `box-sizing` | supported | supported | supported | L1 | 直映射 | universal | 两内核恒 border-box ⇒ 只作忠实记录、无副作用 |
| paint | `border（简写）/ border-color / border-width` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 5（2026-10-04）：`border: <width> <style> <color>` 简写解析为 borderWidth + borderColor（uniform **实线**）；**逐边**/非 solid 线型（dashed/dotted…）诊断跳过（★批 14 审计修：非 solid 此前**静默画成实线**=与 Web 偏差 ⇒ 现诊断跳过）；var() 令牌色如实诊断。**三端宿主真画**：iOS CALayer.border* · Android borderPaint 描边（含圆角路径）· 鸿蒙 OH_ArkUI_RenderNodeUtils_SetBorderWidth/Color |
| motion | `transform（2D：translate / scale / rotate）` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 39（2026-10-04 · 对齐 Web · 削减胶水）：静态 transform 编译期折成数值集（txPx/tyPx + txPct/tyPct 盒比例 + 等比 scale + rotate）⇒ 三端宿主逐节点变换通道应用（复用动画表：静态为基态、动画覆盖之）。支持 2D 子集；3D/skew/matrix/非等比缩放 ⇒ 诊断跳过（如实） |
| motion | `transform-origin` | supported | supported | engine-only | L2 | 编译期折叠 | conditional | 引擎有 transform_origin_x/y（paint-only），编译面未接 |
| selector | `类选择器 .a / .a.b` | — | — | supported | L0 | 编译期折叠 | conditional | C1：<style> 类规则编译期匹配合并（按源序；无特异性权重） |
| selector | `元素/类型选择器 h3 / p.foo` | — | — | supported | L0 | 编译期折叠 | conditional | C1：按节点原始 tag 匹配（含祖先链） |
| selector | `后代 / 子组合 .a .b / .a > .b` | — | — | supported | L0 | 编译期折叠 | conditional | C1：祖先类链匹配 |
| selector | `静态结构伪类 :first-child / :last-child / :nth-child(An+B|odd|even) / :not(简单选择器)` | — | — | supported | L0 | 编译期折叠 | conditional | ★批次 37（对齐 Web）：元素兄弟序在编译期树遍历里已知 ⇒ 结构伪类**编译期算一次**（:first-child/:last-child/:nth-child + :not 单段简单选择器）；节点无祖先 CSS 引擎。 |
| selector | `状态伪类 :hover / :active / :focus / :checked` | — | — | absent | L2 | 降级 | unsupported | ★批次 37：需**运行时状态通道**（App 自绘手势层无 hover 概念）；状态切换改用动态 :class 或语义组件。 |
| selector | `属性选择器 [data-x]` | — | — | absent | L0 | 编译期折叠 | unsupported | 编译期可判（属性在模板里静态可枚举） |
| selector | `Vue 作用域穿透 :deep() / ::v-deep() / >>>` | — | — | supported | L0 | 编译期折叠 | conditional | ★批次 37：编译期展开为普通后代选择器（本仓无 scope 后缀之外的作用域处理）；`>>>` 等价 `:deep()`。 |
| selector | `兄弟组合 + / ~` | — | — | absent | L5 | 禁止 | unsupported | 语义弱、跨端难统一（Skyline 亦不支持）——建议改写为类选择器。 |
| selector | `通配 *` | — | — | supported | L0 | 编译期折叠 | conditional | ★批次 37（对齐 Web）：`*` 单段匹配任意元素（特异性 0）；`.box > *` 这类"所有直接子"常见于设计与重置样式。 |
| cascade | `特异性 / 继承 / !important` | — | — | supported | L0 | 编译期折叠 | conditional | ★批次 1（2026-10-04）：规则按 (!important, 特异性 (id,class,tag), 源序) 层叠；color/fontSize 沿树继承（CSS 可继承子集；编译期一次性算进 computed style，运行时零匹配） |
| at-rule | `@media（响应式）` | — | — | absent | L3 | 降级 | unsupported | 编译期无法唯一确定断点；跨端建议走 flex/比例布局 + 框架流体能力 |
| at-rule | `@keyframes（动画）` | — | — | absent | L3 | 降级 | unsupported | 块整体剔除（旧实现误当元素选择器）；动画走引擎动画桥（animStart/animTick） |
| cascade | `CSS 自定义属性（design tokens）var(--x)` | — | — | supported | L0 | 编译期折叠 | conditional | ★批次 9（2026-10-04）：从项目 `globalStyle`（如 styles/tokens.css，与 Web/MP 同一份）解析 `--name: value`，SFC 内 `var(--x)` **编译期替换为字面值**（递归展开引用令牌；支持 fallback；未知令牌诊断）。★**超级应用承载关键**：组件库/主题化全靠设计令牌（真项目 242 处 var()）。诚实边界：只折**字面值**令牌；calc()/env() 动态令牌值不折 |
| unit | `em / rem / vw / vh / calc / clamp` | — | — | absent | L0 | 编译期折叠 | unsupported | 收 px/数字/rpx（宽高另支持 %）。★批次 21：`rpx`（小程序 750 设计单位，1rpx = 0.5px，与 rpxRatio:2 互为逆）折为 px——真项目 125 处。其余相对单位（em/rem/vw/vh/clamp）编译期无法在无上下文时求值 ⇒ 诊断跳过（`var()` 令牌见 css-vars 行——已支持）。★批次 22：`calc()` **常量折叠**已支持——`calc(8px * 0.6)` → 4.8（`var()` 已在解析前置换 ⇒ `calc(var(--u) * 1.15)` 也折）；含 `%`/相对单位的 calc（`calc(100% - 20px)`）仍诊断（无上下文）。组件库 64 处 `calc(var(--x) * N)` 依赖它 |
| layout | `display: grid + grid-template-columns/rows（显式轨迹）` | partial | not-listed | supported | L2 | 直映射 | conditional | ★批次 12（2026-10-04）：引擎 `Display::Grid` + `LStyle.grid_template_columns/rows`（字符串轨迹）+ `NodeDto` + taffy grid_template_* 映射（parse_grid_tracks：fr/px/数字）；编译器 display:grid 入封闭集 + `grid-template-columns/rows` 解析（**显式轨迹**，`repeat(N,X)` 编译期展开）。★**诚实边界**：仅显式轨迹（fr/px/数字）——auto/minmax/fit-content/命名线/隐式行（grid-auto-*）/grid-area 定位**未支持**，诊断跳过；Skyline 端实测退化为 block ⇒ 有条件可用 |
| layout | `aspect-ratio` | not-measured | not-listed | supported | L2 | 编译期折叠 | conditional | ★批次 24（2026-10-04 · ★基准 = Web）：宽高比（媒体卡/占位图）。`<n>`（1.5）/`<w>/<h>`（16/9，含空格）→ 比值；`auto` = 默认不发射。内核 `LStyle.aspect_ratio` → taffy `aspect_ratio`（原生；定一轴派生另一轴） |
| layout | `flex-wrap` | supported | supported | supported | L2 | 直映射 | universal | ★批次 6（2026-10-04）：引擎新增 `FlexWrap`（Rust `LStyle.flex_wrap` + `NodeDto` + taffy `flex_wrap` 映射，闭合集 nowrap/wrap/wrap-reverse）；编译器入 APP_LAYOUT_FIELDS + APP_ENUM_VALUES + Android LAYOUT_KEYS 白名单。引擎行为测试 tests/flex_wrap.rs（wrap 换行/nowrap 不换行） |
| layout | `align-content` | supported | supported | supported | L2 | 直映射 | universal | ★批次 11（2026-10-04）：引擎 `LStyle.align_content`（open string，与 justify/align-items 同模式）+ `NodeDto` + taffy `align_content` 映射（parse_align_content：center/flex-start/…/space-evenly → AlignContent）；编译器入 APP_LAYOUT_FIELDS + Android LAYOUT_KEYS。多行弹性容器的**行间**对齐（标签墙/宫格）。引擎行为测试 tests/align_content.rs（center 行组居中） |
| layout | `right / bottom` | supported | supported | supported | L2 | 直映射 | universal | ★批次 8（2026-10-04）：引擎 `LStyle.right/bottom` + `NodeDto` + taffy inset 映射（absolute/relative 的右/下边缘锚定）；编译器入 APP_LAYOUT_FIELDS + style-object + Android LEN_SCALARS/LAYOUT_KEYS。★**超级应用刚需**：角标 / FAB / 关闭按钮 / 底部弹层锚点。引擎行为测试 tests/inset_right_bottom.rs（right=10/bottom=5 ⇒ 落父右下角） |
| layout | `inset（top/right/bottom/left 的 1–4 值缩写）` | — | — | supported | L2 | 编译期折叠 | conditional | ★批次 38（对齐 Web · 削减胶水）：编译期展开为 top/right/bottom/left（引擎四边已支持）；真项目 15 处（路由层/浮层/scrim 的 position:absolute; inset:0）。auto 边 = 默认偏移（该边不设）。 |
| layout | `order` | supported | supported | absent | L2 | 直映射 | conditional | 引擎无字段 |
| layer | `z-index` | supported | supported | absent | L3 | 语义组件 | conditional | 本仓已定案**语义化**（layer="content\|navigation\|mask\|popout"，见 contracts/layers.ts）——数值禁止（跨端无意义 + 推高合成层内存） |
| paint | `box-shadow` | supported | supported | supported | L3 | 编译期折叠 | universal | ★批次 10（2026-10-04）：单层解析为结构化 `boxShadow {dx,dy,blur,spread,color}`（多重取首个；inset 诊断跳过）。**三端绘制**：iOS `CALayer.shadow*`（原生；有阴影时不开 masksToBounds——圆角裁剪会裁掉阴影）· Android **分层圆角矩形近似**（硬件加速下 setShadowLayer 只支持文本）· 鸿蒙 `OH_ArkUI_RenderNodeUtils_SetShadow*`（原生；spread 无原生项）。★超级应用卡片抬升视觉刚需 |
| paint | `filter / backdrop-filter` | supported | supported | absent | L3 | 语义组件 | conditional | 离屏/额外缓冲；走 <p-glass> / <p-filter> 语义组件 |
| text | `font-weight` | not-measured | supported | supported | L1 | 编译期折叠 | conditional | ★批次 3（2026-10-04）：`normal`→400 / `bold`→700 / 100–900 数值归一；作为**文本可继承**字段沿树继承。三端宿主：iOS 已读 `fontWeight`（≥600 bold 判据）、Android 新接线（Cmd.fontWeight + 绘制/度量同源 typeface）、鸿蒙新接线（OH_Drawing_SetTextStyleFontWeight） |
| text | `text-decoration` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 35（2026-10-04 · ★基准 = Web）：`underline` / `line-through`（`none` = 默认不发射）；CSS **可继承**（沿树传播）。三端宿主：iOS `NSAttributedString.underlineStyle/strikethroughStyle` · Android `Paint.setUnderlineText/setStrikeThruText` · 鸿蒙 `OH_Drawing_SetTextStyleDecoration`。诚实边界：`overline`/颜色/线型未支持（诊断） |
| text | `text-align` | not-measured | supported | supported | L1 | 编译期折叠 | conditional | ★批次 4（2026-10-04）：封闭集 left/center/right（justify/st 等诊断跳过）。宿主：iOS CATextLayer.alignmentMode · Android Paint.Align（绘制 x 按对齐换算）· 鸿蒙 OH_Drawing_SetTypographyTextAlign。真项目 28 处（22 center） |
| text | `line-height` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 13（2026-10-04，含真机修正确标准）：无单位倍数 / 百分比（→倍数）/ 绝对 px 归一为 token；作为**文本可继承**字段沿树继承。三端宿主实现 **CSS 语义**（非仅行盒高）：行盒变高、字形内容区在行盒内**垂直居中**（半行距）——与 Web/Skyline 真 CSS 一致：iOS measureText 行盒高 + 文本层**可视 frame 居中收缩**（层中心不变 ⇒ 不影响锚点动画）· Android buildMeasures 行盒高 + drawCmds 基线 `盒心 − (ascent+descent)/2` · 鸿蒙 measureTextTypoPx 行盒高 + TypographyPaint `offsetY = (盒高−字形高)/2`。★真机实测 CATextLayer 是顶对齐（故必须显式居中收缩才对齐 Web）。诚实边界：letter-spacing 未支持 |
| text | `text-overflow` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 16（2026-10-04 · ★基准 = Web）：CSS 默认 clip（截断不省略）；ellipsis ⇒ 自绘文本**单行**行尾以 … 截断（超级应用列表项/标签截断刚需）。封闭集 clip/ellipsis（大小写不敏感；其余诊断跳过）；作为**文本可继承**字段沿树继承。三端宿主：iOS CATextLayer.truncationMode（ellipsis ⇒ .end；其余 ⇒ .none——★此前**恒 .end** 是 Web 偏差）· Android TextUtils.ellipsize(TruncateAt.END)（挂载/更新时算好 = 绘制零开销）· 鸿蒙 OH_Drawing_SetTypographyTextEllipsis（maxLines=1 + 尾部 modal + Layout 按盒宽）。诚实边界：仅**单行**（本仓文本无自动换行）；多行 -webkit-line-clamp、fade（渐隐）未支持 |
| text | `letter-spacing` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 20（2026-10-04 · ★基准 = Web）：字距（超级应用排版）；Web 默认 normal（=0，不发射）；`<n>px`/`<n>` → 数值 + 作为**文本可继承**沿树继承（相对单位 em/rem 未支持 ⇒ 诊断）。三端宿主：iOS `NSAttributedString` kern（`textLayerString` helper；度量/绘制同源）· Android `Paint.setLetterSpacing`（em：px/字号；度量+绘制）· 鸿蒙 `OH_Drawing_SetTextStyleLetterSpacing`（物理 px） |
| text | `font-family` | supported | supported | supported | L4 | 编译期折叠 | universal | ★批次 36（2026-10-04 · ★基准 = Web）：候选清单 → **字体角色**（system/serif/monospace/rounded/condensed；与 renderer-app 的 normalizeFontFamily 同一映射）；未识别具体族名透传 custom:<名>。CSS **可继承**。宿主：iOS ProteusTextAdapter.font(family:)（角色→UIFont）· Android typefaceOf(role)（角色→Typeface）· 鸿蒙 SetTextStyleFontFamilies（**best-effort**：鸿蒙字体集有限，仅 monospace/serif 映射、其余回落默认——如实边界）。★字体名大小写敏感、自定义族需宿主注册（见 CUSTOM_FONT_PREFIX） |
| text | `white-space` | supported | supported | absent | L4 | 降级 | conditional | 白空格（多行/保留空白）走平台文本引擎（不自研）——App 仅支持 `nowrap`（= App 单行默认，no-op）；`normal`/`pre`/`pre-wrap`/`pre-line` 未支持（诊断）。★文本维已含 fontSize/color/fontWeight/textAlign/line-height/text-overflow/letter-spacing/**text-decoration**（批 35） |
| layout | `pointer-events` | not-measured | supported | supported | L2 | 编译期折叠 | conditional | ★批次 32（2026-10-04 · ★基准 = Web）：`none` / `auto`。`none` ⇒ 该节点**不参与命中测试**（事件穿透到其下——浮层/遮罩刚需），但**仍占位**（有几何）。CSS **可继承**（父 none ⇒ 子默认 none、子 auto 可覆盖）——编译期按树算 computed 值。内核 `hit_path` 逐节点跳过 `pointer_events==false`（绘制/层不动——node 仍绘制）。只有内核 hitTest 消费（三端同一命中实现）。 |
| paint | `visibility` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 25（2026-10-04 · ★基准 = Web）：`visible` / `hidden`。与 `display:none` 不同——`hidden` **仍占位**（保留布局），只是**不绘制**（宿主跳过绘制该节点）。CSS **可继承**（父 hidden ⇒ 子默认 hidden；子显式 **visible 可覆盖**）——编译期按树算 computed 值（每节点独立标记）。宿主：iOS `layer.isHidden`（子层随父隐藏）· Android Cmd 跳过（color/text/border 清零）· 鸿蒙指令不绘制。诚实边界：`collapse`（表格行折叠）未支持（诊断） |

> 表中**带编译器字段**的行（对应 `packages/compiler/src/vapor/template.ts` 的 LAYOUT/PAINT_FIELDS）是
> 「编译器属性」口径（M1 一致性覆盖率的分母来源）；其余行是选择器 / @rule / 引擎通道等**非属性字段**能力。

### 「仅部分端支持」差集（conditional —— 归 L3「有条件可用」/ 需 opt-in）

| CSS | Web | Skyline | App | 受限原因 |
|---|---|---|---|---|
| `gap（+ row-gap / column-gap）` | partial | partial | supported | px/数字；★批次 31：**两值** `gap:<row> <col>` 与 **轴级** `row-gap`/`column-gap`（内核 `LStyle.row_gap/c |
| `margin/padding 1–4 值简写 + background 纯色简写 + flex 简写` | — | — | supported | ★批次 2/7（2026-10-04）：a) `margin: 8px 0` / `padding: 8px 12px` 按 CSS 标准展开为 {top,right,bottom |
| `width/height 百分比` | — | — | supported | → widthRatio/heightRatio（比例字段） |
| `transform-origin` | supported | supported | engine-only | 引擎有 transform_origin_x/y（paint-only），编译面未接 |
| `类选择器 .a / .a.b` | — | — | supported | C1：<style> 类规则编译期匹配合并（按源序；无特异性权重） |
| `元素/类型选择器 h3 / p.foo` | — | — | supported | C1：按节点原始 tag 匹配（含祖先链） |
| `后代 / 子组合 .a .b / .a > .b` | — | — | supported | C1：祖先类链匹配 |
| `静态结构伪类 :first-child / :last-child / :nth-child(An+B|odd|even) / :not(简单选择器)` | — | — | supported | ★批次 37（对齐 Web）：元素兄弟序在编译期树遍历里已知 ⇒ 结构伪类**编译期算一次**（:first-child/:last-child/:nth-child + :not |
| `Vue 作用域穿透 :deep() / ::v-deep() / >>>` | — | — | supported | ★批次 37：编译期展开为普通后代选择器（本仓无 scope 后缀之外的作用域处理）；`>>>` 等价 `:deep()`。 |
| `通配 *` | — | — | supported | ★批次 37（对齐 Web）：`*` 单段匹配任意元素（特异性 0）；`.box > *` 这类"所有直接子"常见于设计与重置样式。 |
| `特异性 / 继承 / !important` | — | — | supported | ★批次 1（2026-10-04）：规则按 (!important, 特异性 (id,class,tag), 源序) 层叠；color/fontSize 沿树继承（CSS 可继承子 |
| `CSS 自定义属性（design tokens）var(--x)` | — | — | supported | ★批次 9（2026-10-04）：从项目 `globalStyle`（如 styles/tokens.css，与 Web/MP 同一份）解析 `--name: value`，SF |
| `display: grid + grid-template-columns/rows（显式轨迹）` | partial | not-listed | supported | ★批次 12（2026-10-04）：引擎 `Display::Grid` + `LStyle.grid_template_columns/rows`（字符串轨迹）+ `NodeD |
| `aspect-ratio` | not-measured | not-listed | supported | ★批次 24（2026-10-04 · ★基准 = Web）：宽高比（媒体卡/占位图）。`<n>`（1.5）/`<w>/<h>`（16/9，含空格）→ 比值；`auto` = 默认 |
| `inset（top/right/bottom/left 的 1–4 值缩写）` | — | — | supported | ★批次 38（对齐 Web · 削减胶水）：编译期展开为 top/right/bottom/left（引擎四边已支持）；真项目 15 处（路由层/浮层/scrim 的 positi |
| `order` | supported | supported | absent | 引擎无字段 |
| `z-index` | supported | supported | absent | 本仓已定案**语义化**（layer="content\|navigation\|mask\|popout"，见 contracts/layers.ts）——数值禁止（跨端无意义  |
| `filter / backdrop-filter` | supported | supported | absent | 离屏/额外缓冲；走 <p-glass> / <p-filter> 语义组件 |
| `font-weight` | not-measured | supported | supported | ★批次 3（2026-10-04）：`normal`→400 / `bold`→700 / 100–900 数值归一；作为**文本可继承**字段沿树继承。三端宿主：iOS 已读 ` |
| `text-align` | not-measured | supported | supported | ★批次 4（2026-10-04）：封闭集 left/center/right（justify/st 等诊断跳过）。宿主：iOS CATextLayer.alignmentMode |
| `white-space` | supported | supported | absent | 白空格（多行/保留空白）走平台文本引擎（不自研）——App 仅支持 `nowrap`（= App 单行默认，no-op）；`normal`/`pre`/`pre-wrap`/`pr |
| `pointer-events` | not-measured | supported | supported | ★批次 32（2026-10-04 · ★基准 = Web）：`none` / `auto`。`none` ⇒ 该节点**不参与命中测试**（事件穿透到其下——浮层/遮罩刚需），但 |

## 官方 Skyline 对齐开关

| 开关 | 平台/基础库最低版本 |
|---|---|
| 开启默认Block布局 | Android 8.0.34 · iOS 8.0.36 · 开发者工具 Nightly Build (1.06.2304262) · 基础库 2.31.1 |
| 开启默认 ContentBox 盒模型 | Android 8.0.42 · iOS 8.0.42 · 开发者工具 Nightly Build (1.06.2310092) · 基础库 3.1.0 |
| 开启 tag 选择器全局匹配 | Android 8.0.51 · iOS 8.0.51 · 开发者工具 Nightly Build (1.06.2409032) · 基础库 3.6.0 |
| 开启 scroll-view 自动撑开 | Android 8.0.54 · iOS 8.0.54 · 基础库 3.7.2 |
| 开启 keyframe 样式全局共享 | Android 8.0.57 · iOS 8.0.57 · 基础库 3.8.0 |

## 结构性事实（端能力差异）

| 事实 | 判定 | 证据 |
|---|---|---|
| skylineComputedStyle | unsupported | spike/vc0-skyline-geom 实测：fields({computedStyle}) 在 Skyline 下返回 {}（静默丢弃）；WebView 同装置可用 |
| skylineSelectorIdClass | supported | VC0 实测：#id ✓ / .class ✓ |
| skylineSelectorAttrTag | unsupported | VC0 实测：属性选择器 [data-*] 与 tag 选择器恒返 null（官方选择器表亦标 ×） |
| skylineInlineStyleOnly | note | 装置事实：小程序不能 JS 写节点内联样式——样式变更须经 setData/绑定 |
| skylineDefaults | differ | 官方表：display 默认 flex、flex-direction 默认 column、box-sizing 默认 border-box（可经配置改 block/content-box）；与 Web/App 均不同 |
| webviewRenderingContrast | note | WebView 渲染模式对照实测 37 条（源：spike/vc0-skyline-geom/results/computed-webview.txt）——WebView 是 Skyline 的渲染模式对照，非独立端，不再单列 |
| appSelfDrawnEngine | note | App = 自研自绘 Rust 引擎（一套覆盖 iOS/Android/鸿蒙）；CSS 面由项目定义、可扩展（见 app-profile-features.json 的 tier/strategy） |

## 引擎扩展通道（非 CSS 属性——独立于上表）

| 编译器字段 | 声明属性 | 说明 |
|---|---|---|
| `fill-gradient` | `fill-gradient` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射 |
| `fill-gradient-to` | `fill-gradient-to` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射 |
| `clip-path` | `clip-path` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射 |
| `glow` | `glow` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射 |
| `mask` | `mask` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射 |
| `svg-path` | `svg-path` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射 |
| `svg-path-to` | `svg-path-to` | 引擎扩展通道（JSON 属性载体，非 CSS 属性）——App 宿主真源探针已验证（A/B 批次 probeChannels）；Web/小程序端由编译器映射 |

> 判定口径：Web=`CSS.supports` 实测；Skyline=官方表**收录**（未收录≠确认不支持，需实测补证）；
> App 现状=代码事实（compile 折叠面 ∩ 引擎 ∩ 宿主）；App 可扩展=tier（人工按 Profile §3，非实测毫秒）。
> 属性清单与编译器单一事实源交叉校验：`packages/compiler/src/vapor/template.ts` 的 LAYOUT_FIELDS / PAINT_FIELDS / PAINT_DECL_ATTRS。
