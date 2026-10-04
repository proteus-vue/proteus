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

## 超级应用能力清单（★优先口径：不按 demo 使用频次）

> ★优先口径（用户 2026-10-04 明示）：「我们的目标不仅仅是当前项目使用到的，我们的目标是**承载超级应用**」。⇒ 批次选择**不按 demo 使用频次**，而按「超级应用是否会用到」+ 三端可实现性。下表的 status 用 today 取值（supported/folded-only/engine-only/absent）。

| 超级应用能力 | 用途 | 现状 |
|---|---|---|
| 定位锚点（absolute + top/left/right/bottom + z 序） | 角标 / FAB / 关闭按钮 / 底部弹层 / 悬浮层 | supported（批 8 补 right/bottom；层序走层容器） |
| 卡片外观（background / border / border-radius / shadow / 内边距） | 列表项 / 卡片 / 面板 | supported（background/border/border-radius/padding ✅ 批 2/5；**box-shadow ✅ 批 10**——iOS/鸿蒙原生、Android 分层近似） |
| 弹性流式布局（flex + wrap + gap + align/justify/content + 百分比） | 响应式排布 / 标签墙 / 宫格 | supported（批 6 flex-wrap · 批 11 align-content 已补） |
| 文本呈现（size / weight / align / color / line-height / 截断） | 标题 / 正文 / 单行截断 | font-size/weight/align/color ✅ · **line-height ✅ 批 13**；**text-overflow 截断 ⏳** |
| 栅格 / 复杂排布（grid） | 仪表盘 / 复杂页面 | supported（批 12：引擎 Display::Grid + 显式轨迹 fr/px + repeat 展开；诚实边界：auto/minmax/gr、id-area 定位未支持） |
| 动效（transition / transform / keyframes） | 转场 / 反馈 / 加载 | 引擎 anim 通道 ✅（transition 走 <Transition>/宿主指令）；**transform 静态折叠面 ⏳** |
| 滚动容器（overflow + 滚动） | 长列表 / 弹层内容 | supported（overflow + 虚拟列表） |
| 层叠与主题（继承 / 变量令牌 / 特异性） | 主题化 / 组件库 | supported（批 1 继承/特异性/!important；**批 9 CSS 变量 var() 令牌编译期折叠**——从 globalStyle 解析，超级应用承载关键） |

## CSS 能力矩阵

| 类别 | CSS | Web | Skyline | App 现状 | App 可扩展 | 策略 | 对齐 | 说明 |
|---|---|---|---|---|---|---|---|---|
| layout | `width` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → 长度；百分比 → widthRatio（比例字段，非长度） |
| layout | `height` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → 长度；百分比 → heightRatio |
| layout | `min-width / max-width / min-height / max-height` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 |
| layout | `margin（+ 四边简写 + 1–4 值 shorthand）` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → {top,right,bottom,left}；1–4 值简写按 CSS 标准展开（`margin: 8px 0`；auto 的边忽略）；Web 探针取 margin-top 代表 |
| layout | `padding（+ 四边简写 + 1–4 值 shorthand）` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字 → {top,right,bottom,left}；1–4 值简写按 CSS 标准展开（`padding: 8px 12px`）；Web 探针取 padding-top 代表 |
| layout | `display: flex / none` | supported | supported | supported | L2 | 直映射 | universal | 引擎封闭集仅 flex/none（block/inline-block/inline-flex/grid ⇒ 诊断跳过） |
| layout | `flex-direction` | supported | supported | supported | L2 | 直映射 | universal | 封闭集 row/column/row-reverse/column-reverse |
| layout | `justify-content` | supported | supported | supported | L2 | 直映射 | universal | 引擎为**开放字符串**（未知值静默落默认，不崩） |
| layout | `align-items / align-self` | supported | supported | supported | L2 | 直映射 | universal | 开放字符串（未知值静默落默认） |
| layout | `flex-grow / flex-shrink / flex-basis` | supported | supported | supported | L2 | 直映射 | universal | flex-basis 为长度 |
| layout | `gap` | supported | supported | supported | L2 | 直映射 | universal | px/数字（无 row-gap/column-gap 分开形态） |
| layout | `position: static / relative / absolute` | supported | supported | supported | L2 | 直映射 | universal | 引擎封闭集；sticky/fixed ⇒ 诊断跳过 |
| layout | `top / left` | supported | supported | supported | L2 | 直映射 | universal | 配合 absolute；引擎无 right/bottom（见候选） |
| layout | `overflow: visible / hidden / scroll / auto` | supported | supported | supported | L2 | 直映射 | universal | 引擎封闭集；auto 折叠为 taffy Scroll |
| value | `margin/padding 1–4 值简写 + background 纯色简写 + flex 简写` | — | — | supported | L1 | 编译期折叠 | conditional | ★批次 2/7（2026-10-04）：a) `margin: 8px 0` / `padding: 8px 12px` 按 CSS 标准展开为 {top,right,bottom,left}（auto 的边忽略）；b) `background: #fff`/`rgba(...)` 归一折进 backgroundColor；c) `flex: <g> [<s> [<b>]]` / `none` / `auto` 展开到 flexGrow/flexShrink/flexBasis（CSS 语义：省略 shrink=1、省略 basis=0）。取证：真项目这些简写高频。渐变/图片简写诊断跳过 |
| unit | `width/height 百分比` | — | — | supported | L1 | 编译期折叠 | conditional | → widthRatio/heightRatio（比例字段） |
| paint | `background-color（+ background 纯色简写）` | supported | supported | supported | L1 | 编译期折叠 | universal | 颜色编译期归一为 hex（rgb/rgba/transparent → hex；命名色/hsl/var ⇒ 诊断跳过）；★`background` 纯色简写折进 backgroundColor（渐变/图片诊断跳过，走引擎 fill-gradient 通道） |
| paint | `color` | supported | supported | supported | L1 | 编译期折叠 | universal | 同上颜色归一 |
| paint | `font-size` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字（不支持百分比/keyword） |
| paint | `border-radius` | supported | supported | supported | L1 | 编译期折叠 | universal | px/数字（宿主圆角绘制） |
| paint | `opacity` | supported | supported | supported | L1 | 编译期折叠 | universal | 0–1 |
| special | `box-sizing` | supported | supported | supported | L1 | 直映射 | universal | 两内核恒 border-box ⇒ 只作忠实记录、无副作用 |
| paint | `border（简写）/ border-color / border-width` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 5（2026-10-04）：`border: <width> <style> <color>` 简写解析为 borderWidth + borderColor（uniform 实线；逐边/styled 诊断跳过；var() 令牌色如实诊断）；**三端宿主真画**：iOS CALayer.border* · Android borderPaint 描边（含圆角路径）· 鸿蒙 OH_ArkUI_RenderNodeUtils_SetBorderWidth/Color。此前为 folded-only（折叠透传但宿主不画）——本批补齐绘制 |
| motion | `transform（translate/scale/rotate/skew/perspective）` | supported | supported | engine-only | L1 | 编译期折叠 | conditional | ★引擎/宿主已支持（LStyle 的绘制通道 paint-only + 宿主动画桥），但编译期折叠面（parseStaticStyle）**未接 transform** ⇒ 「可扩展」现成落点：加进 APP_PAINT_FIELDS 即可 |
| motion | `transform-origin` | supported | supported | engine-only | L2 | 编译期折叠 | conditional | 引擎有 transform_origin_x/y（paint-only），编译面未接 |
| selector | `类选择器 .a / .a.b` | — | — | supported | L0 | 编译期折叠 | conditional | C1：<style> 类规则编译期匹配合并（按源序；无特异性权重） |
| selector | `元素/类型选择器 h3 / p.foo` | — | — | supported | L0 | 编译期折叠 | conditional | C1：按节点原始 tag 匹配（含祖先链） |
| selector | `后代 / 子组合 .a .b / .a > .b` | — | — | supported | L0 | 编译期折叠 | conditional | C1：祖先类链匹配 |
| selector | `伪类 :hover / :active / :first-child / :nth-child` | — | — | absent | L0 | 编译期折叠 | unsupported | 静态部分可编译期折叠（Profile L0）；动态交互态需运行时状态通道（成本更高） |
| selector | `属性选择器 [data-x]` | — | — | absent | L0 | 编译期折叠 | unsupported | 编译期可判（属性在模板里静态可枚举） |
| selector | `兄弟组合 +~ / 通配 *` | — | — | absent | L5 | 禁止 | unsupported | 语义弱、跨端难统一（Skyline 亦不支持）——建议改写为类选择器 |
| cascade | `特异性 / 继承 / !important` | — | — | supported | L0 | 编译期折叠 | conditional | ★批次 1（2026-10-04）：规则按 (!important, 特异性 (id,class,tag), 源序) 层叠；color/fontSize 沿树继承（CSS 可继承子集；编译期一次性算进 computed style，运行时零匹配） |
| at-rule | `@media（响应式）` | — | — | absent | L3 | 降级 | unsupported | 编译期无法唯一确定断点；跨端建议走 flex/比例布局 + 框架流体能力 |
| at-rule | `@keyframes（动画）` | — | — | absent | L3 | 降级 | unsupported | 块整体剔除（旧实现误当元素选择器）；动画走引擎动画桥（animStart/animTick） |
| cascade | `CSS 自定义属性（design tokens）var(--x)` | — | — | supported | L0 | 编译期折叠 | conditional | ★批次 9（2026-10-04）：从项目 `globalStyle`（如 styles/tokens.css，与 Web/MP 同一份）解析 `--name: value`，SFC 内 `var(--x)` **编译期替换为字面值**（递归展开引用令牌；支持 fallback；未知令牌诊断）。★**超级应用承载关键**：组件库/主题化全靠设计令牌（真项目 242 处 var()）。诚实边界：只折**字面值**令牌；calc()/env() 动态令牌值不折 |
| unit | `em / rem / vw / vh / calc / clamp` | — | — | absent | L0 | 编译期折叠 | unsupported | 仅收 px/数字（宽高另支持 %）；其余单位编译期无法在无上下文时求值 ⇒ 诊断跳过（`var()` 令牌见 css-vars 行——已支持） |
| layout | `display: grid + grid-template-columns/rows（显式轨迹）` | partial | not-listed | supported | L2 | 直映射 | conditional | ★批次 12（2026-10-04）：引擎 `Display::Grid` + `LStyle.grid_template_columns/rows`（字符串轨迹）+ `NodeDto` + taffy grid_template_* 映射（parse_grid_tracks：fr/px/数字）；编译器 display:grid 入封闭集 + `grid-template-columns/rows` 解析（**显式轨迹**，`repeat(N,X)` 编译期展开）。★**诚实边界**：仅显式轨迹（fr/px/数字）——auto/minmax/fit-content/命名线/隐式行（grid-auto-*）/grid-area 定位**未支持**，诊断跳过；Skyline 端实测退化为 block ⇒ 有条件可用 |
| layout | `flex-wrap` | supported | supported | supported | L2 | 直映射 | universal | ★批次 6（2026-10-04）：引擎新增 `FlexWrap`（Rust `LStyle.flex_wrap` + `NodeDto` + taffy `flex_wrap` 映射，闭合集 nowrap/wrap/wrap-reverse）；编译器入 APP_LAYOUT_FIELDS + APP_ENUM_VALUES + Android LAYOUT_KEYS 白名单。引擎行为测试 tests/flex_wrap.rs（wrap 换行/nowrap 不换行） |
| layout | `align-content` | supported | supported | supported | L2 | 直映射 | universal | ★批次 11（2026-10-04）：引擎 `LStyle.align_content`（open string，与 justify/align-items 同模式）+ `NodeDto` + taffy `align_content` 映射（parse_align_content：center/flex-start/…/space-evenly → AlignContent）；编译器入 APP_LAYOUT_FIELDS + Android LAYOUT_KEYS。多行弹性容器的**行间**对齐（标签墙/宫格）。引擎行为测试 tests/align_content.rs（center 行组居中） |
| layout | `right / bottom` | supported | supported | supported | L2 | 直映射 | universal | ★批次 8（2026-10-04）：引擎 `LStyle.right/bottom` + `NodeDto` + taffy inset 映射（absolute/relative 的右/下边缘锚定）；编译器入 APP_LAYOUT_FIELDS + style-object + Android LEN_SCALARS/LAYOUT_KEYS。★**超级应用刚需**：角标 / FAB / 关闭按钮 / 底部弹层锚点。引擎行为测试 tests/inset_right_bottom.rs（right=10/bottom=5 ⇒ 落父右下角） |
| layout | `order` | supported | supported | absent | L2 | 直映射 | conditional | 引擎无字段 |
| layer | `z-index` | supported | supported | absent | L3 | 语义组件 | conditional | 本仓已定案**语义化**（layer="content\|navigation\|mask\|popout"，见 contracts/layers.ts）——数值禁止（跨端无意义 + 推高合成层内存） |
| paint | `box-shadow` | supported | supported | supported | L3 | 编译期折叠 | universal | ★批次 10（2026-10-04）：单层解析为结构化 `boxShadow {dx,dy,blur,spread,color}`（多重取首个；inset 诊断跳过）。**三端绘制**：iOS `CALayer.shadow*`（原生；有阴影时不开 masksToBounds——圆角裁剪会裁掉阴影）· Android **分层圆角矩形近似**（硬件加速下 setShadowLayer 只支持文本）· 鸿蒙 `OH_ArkUI_RenderNodeUtils_SetShadow*`（原生；spread 无原生项）。★超级应用卡片抬升视觉刚需 |
| paint | `filter / backdrop-filter` | supported | supported | absent | L3 | 语义组件 | conditional | 离屏/额外缓冲；走 <p-glass> / <p-filter> 语义组件 |
| text | `font-weight` | not-measured | supported | supported | L1 | 编译期折叠 | conditional | ★批次 3（2026-10-04）：`normal`→400 / `bold`→700 / 100–900 数值归一；作为**文本可继承**字段沿树继承。三端宿主：iOS 已读 `fontWeight`（≥600 bold 判据）、Android 新接线（Cmd.fontWeight + 绘制/度量同源 typeface）、鸿蒙新接线（OH_Drawing_SetTextStyleFontWeight） |
| text | `text-align` | not-measured | supported | supported | L1 | 编译期折叠 | conditional | ★批次 4（2026-10-04）：封闭集 left/center/right（justify/st 等诊断跳过）。宿主：iOS CATextLayer.alignmentMode · Android Paint.Align（绘制 x 按对齐换算）· 鸿蒙 OH_Drawing_SetTypographyTextAlign。真项目 28 处（22 center） |
| text | `line-height` | supported | supported | supported | L1 | 编译期折叠 | universal | ★批次 13（2026-10-04，含真机修正确标准）：无单位倍数 / 百分比（→倍数）/ 绝对 px 归一为 token；作为**文本可继承**字段沿树继承。三端宿主实现 **CSS 语义**（非仅行盒高）：行盒变高、字形内容区在行盒内**垂直居中**（半行距）——与 Web/Skyline 真 CSS 一致：iOS measureText 行盒高 + 文本层**可视 frame 居中收缩**（层中心不变 ⇒ 不影响锚点动画）· Android buildMeasures 行盒高 + drawCmds 基线 `盒心 − (ascent+descent)/2` · 鸿蒙 measureTextTypoPx 行盒高 + TypographyPaint `offsetY = (盒高−字形高)/2`。★真机实测 CATextLayer 是顶对齐（故必须显式居中收缩才对齐 Web）。诚实边界：letter-spacing 未支持 |
| text | `letter-spacing / white-space` | supported | supported | absent | L4 | 降级 | conditional | 字距/白空格走平台文本引擎（不自研）；当前 App 折叠面文本维 = fontSize/color/fontWeight/textAlign/line-height——letter-spacing/white-space 未支持 |
| paint | `visibility` | supported | supported | absent | L1 | 直映射 | conditional | 引擎无 visibility 字段（可用 display:none 或 opacity 近似） |

> 表中**带编译器字段**的行（对应 `packages/compiler/src/vapor/template.ts` 的 LAYOUT/PAINT_FIELDS）是
> 「编译器属性」口径（M1 一致性覆盖率的分母来源）；其余行是选择器 / @rule / 引擎通道等**非属性字段**能力。

### 「仅部分端支持」差集（conditional —— 归 L3「有条件可用」/ 需 opt-in）

| CSS | Web | Skyline | App | 受限原因 |
|---|---|---|---|---|
| `margin/padding 1–4 值简写 + background 纯色简写 + flex 简写` | — | — | supported | ★批次 2/7（2026-10-04）：a) `margin: 8px 0` / `padding: 8px 12px` 按 CSS 标准展开为 {top,right,bottom |
| `width/height 百分比` | — | — | supported | → widthRatio/heightRatio（比例字段） |
| `transform（translate/scale/rotate/skew/perspective）` | supported | supported | engine-only | ★引擎/宿主已支持（LStyle 的绘制通道 paint-only + 宿主动画桥），但编译期折叠面（parseStaticStyle）**未接 transform** ⇒ 「可扩 |
| `transform-origin` | supported | supported | engine-only | 引擎有 transform_origin_x/y（paint-only），编译面未接 |
| `类选择器 .a / .a.b` | — | — | supported | C1：<style> 类规则编译期匹配合并（按源序；无特异性权重） |
| `元素/类型选择器 h3 / p.foo` | — | — | supported | C1：按节点原始 tag 匹配（含祖先链） |
| `后代 / 子组合 .a .b / .a > .b` | — | — | supported | C1：祖先类链匹配 |
| `特异性 / 继承 / !important` | — | — | supported | ★批次 1（2026-10-04）：规则按 (!important, 特异性 (id,class,tag), 源序) 层叠；color/fontSize 沿树继承（CSS 可继承子 |
| `CSS 自定义属性（design tokens）var(--x)` | — | — | supported | ★批次 9（2026-10-04）：从项目 `globalStyle`（如 styles/tokens.css，与 Web/MP 同一份）解析 `--name: value`，SF |
| `display: grid + grid-template-columns/rows（显式轨迹）` | partial | not-listed | supported | ★批次 12（2026-10-04）：引擎 `Display::Grid` + `LStyle.grid_template_columns/rows`（字符串轨迹）+ `NodeD |
| `order` | supported | supported | absent | 引擎无字段 |
| `z-index` | supported | supported | absent | 本仓已定案**语义化**（layer="content\|navigation\|mask\|popout"，见 contracts/layers.ts）——数值禁止（跨端无意义  |
| `filter / backdrop-filter` | supported | supported | absent | 离屏/额外缓冲；走 <p-glass> / <p-filter> 语义组件 |
| `font-weight` | not-measured | supported | supported | ★批次 3（2026-10-04）：`normal`→400 / `bold`→700 / 100–900 数值归一；作为**文本可继承**字段沿树继承。三端宿主：iOS 已读 ` |
| `text-align` | not-measured | supported | supported | ★批次 4（2026-10-04）：封闭集 left/center/right（justify/st 等诊断跳过）。宿主：iOS CATextLayer.alignmentMode |
| `letter-spacing / white-space` | supported | supported | absent | 字距/白空格走平台文本引擎（不自研）；当前 App 折叠面文本维 = fontSize/color/fontWeight/textAlign/line-height——letter |
| `visibility` | supported | supported | absent | 引擎无 visibility 字段（可用 display:none 或 opacity 近似） |

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
