# 超级应用承载 · CSS 能力扩展方案（v1）

> 类型：plan（CSS 能力扩展族清单 + 分批）
> 触发：用户 2026-10-08「现在的 CSS 能力不足以支撑超级应用，文本样式/文本排版太简单，**按超级应用真正需要的刚需落地新的一批 CSS 能力**，我感觉需要很多新的族了」。
> 关联：`docs/Proteus_CSS_Profile规格.md` · `docs/generated/css-capability-alignment.md`（能力对齐清单）· `docs/generated/css-feature-inventory.json`（MDN Web 全量清单）· `css-conformance/PLAYBOOK.md`（逐项全端对齐流程）· `docs/css-background-family-plan.md`（族方案先例）
> 状态：**提案（待裁定优先级/范围）**

---

## 0. 结论先行

现有实现覆盖 **12 个功能族**（layout / paint / text / cascade / selector / at-rule / unit / motion / value / special / layer / scroll），
但按**超级应用（微信/支付宝级）承载场景**核对，**还缺 5 个整族**——其中 2 项是**当前被静默错处理**的真缺陷：

| # | 新族 | 超级应用刚需场景 | 缺口性质 |
|---|---|---|---|
| **F1** | 定位与层叠增强 | 吸顶列表头 / 固定底栏 / 悬浮按钮 / 角标层序 | `position:sticky` 缺；**`position:fixed` 被静默改写成 `absolute`（真 bug）**；`z-index` 数值被静默丢（真 bug） |
| **F2** | 视觉特效（filter 族） | 毛玻璃导航栏 / 磨砂卡片 / 图片调色（亮度/饱和度） | `filter` / `backdrop-filter` 整族缺（**Skyline 官方已支持**，Proteus 丢弃） |
| **F3** | 排版增强 | 价格/编号等宽对齐 / 斜体 / 大小写 / 彩色下划线 / 首行缩进 | `font-style` / `font` 简写 / `text-transform` / `font-variant-numeric` / `text-decoration-color` / `text-indent` / `word-spacing` / `overflow-wrap` 全缺 |
| **F4** | 交互态与伪元素 | 按压反馈 / 焦点环 / 禁用态 / 角标与装饰（`::before/::after`） | 状态伪类（`:hover/:active/:focus/:checked/:focus-visible/:disabled`）与 `::before/::after/::placeholder` 全缺（**富交互超级应用核心**） |
| **F5** | 滚动容器增强 | 首页 banner / 宫格分页吸附 / 弹层阻断滚动链 / 平滑滚动 | `scroll-snap-type` / `scroll-snap-align` / `overscroll-behavior` / `scroll-behavior` 全缺（现登记 excluded） |

**取证口径（三方对齐，非感觉）**：① **superapp 真实语料**（`superapp/App.vue` 用 `position:fixed`+`inset`+`transform`+`transition`+`box-shadow`）；② **Skyline 官方属性表**（`docs/generated/css-capability-sources/skyline-wxss-official.json`，109 项：`position` 支持 `relative/absolute/**fixed**`、`filter`/`backdrop-filter` 均支持）；③ **真 Chromium**（Web 基准）。

---

## 1. 现状（对齐清单口径）

**已实现（12 族）**：layout（flex/grid/position static·relative·absolute/box model/gap/aspect-ratio）· paint（background/border/border-radius/box-shadow/text-shadow/outline/渐变/背景定位族）· text（font-size/weight/family/align/color/line-height/letter-spacing/text-overflow/text-decoration/white-space/word-break/line-clamp/vertical-align）· cascade（继承/特异性/!important/var()）· selector（类/标签/后代/结构伪类/`*`/`:deep()`）· at-rule（@media/@supports/@keyframes/animation 简写）· unit（px/rpx/%/vw/vh/calc/min-max-clamp）· motion（transform/transform-origin/keyframes）· special/layer/scroll（overflow/pointer-events）· 环境变量（`--pf-*`）。

**gap 明细（本方案要补的项，逐项带现状）**：

| 属性 | 现状（编译器实测） | Skyline 官方 | Web |
|---|---|---|---|
| `position: fixed` | **静默 → absolute**（真 bug） | ✅ 支持 | ✅ |
| `position: sticky` | 诊断跳过 | ❌ 不在表 | ✅ |
| `z-index: <n>` | **静默丢**（真 bug） | ✅ 支持 | ✅ |
| `filter` | 诊断跳过 | ✅ 支持 | ✅ |
| `backdrop-filter` | 诊断跳过 | ✅ 支持 | ✅ |
| `font-style` | 诊断跳过 | ✅ 支持 | ✅ |
| `font`（简写） | 诊断跳过 | ✅ 支持 | ✅ |
| `text-transform` | 诊断跳过 | ❌ | ✅ |
| `font-variant-numeric` | 诊断跳过 | ❌ | ✅ |
| `text-decoration-color` | 诊断跳过 | ✅（text-decoration） | ✅ |
| `text-indent` / `word-spacing` | 诊断跳过 | ❌ | ✅ |
| `overflow-wrap` / `word-wrap` | 诊断跳过 | ❌ | ✅ |
| `:hover/:active/:focus/:checked/:focus-visible/:disabled` | `:active` 已支持（折 `press*`）；余诊断跳过 | ❌（触屏无 hover） | ✅ |
| `::before/::after` + `content` | **✅ 已支持**（编译期物化装饰子节点 · Android 宿主先跑通 · 决策 #791） | ❌（触屏无 hover 伪元素） | ✅ |
| `::placeholder` | 诊断跳过 | ❌ | ✅ |
| `scroll-snap-type/-align` | excluded | ❌ | ✅ |
| `overscroll-behavior` / `scroll-behavior` | excluded | ❌ | ✅ |

---

## 2. 五大族 · 逐项落地设计

> **通用判据（每项都走 `css-conformance/PLAYBOOK.md` 七步）**：① 契约（IR 值类型 + 四同步）② 编译器两路径（App 折叠 + CSE）③ 内核/宿主实现 ④ 四端真机 ⑤ 探针 + 独立子代理终评。**Web 为基准**；端侧缺口就地补齐（铁律：不得以"别批次未落地"跳过端）。

### F1 · 定位与层叠增强（P0）

| 项 | Web 真值 | App（内核/宿主）落地 | MP 落地 |
|---|---|---|---|
| `position: fixed` | 相对**视口**固定，脱离文档流 | 内核 `Position::Fixed` + taffy absolute-like，但**锚定视口原点**（不受页根滚动影响）——页根滚动时不动 | Skyline 原生支持 `fixed` ⇒ 透传 WXSS |
| `position: sticky` | 滚动到阈值后吸附（top/bottom/left/right） | 内核布局静态算（= relative），**吸附在宿主滚动层实现**（滚动时按阈值钳制该层 frame）；阈值=`top/left/…` | ❌ 引擎锁死（Skyline 无 sticky）⇒ 具名豁免（App/Web 承载） |
| `z-index: <n>` | 数值层序（同层叠上下文内） | 内核已有语义 `layer`（content/navigation/mask/popout）——新增**数值→语义层**映射（区间映射 + 越界诊断），或改由宿主层容器按 z 排序 | Skyline 原生支持 ⇒ 透传 |

**诚实边界**：sticky 在 MP 引擎锁死（穷尽官方表确认）⇒ 该端具名豁免；App 用宿主滚动层实现吸附（非内核布局）。

### F2 · 视觉特效 filter 族（P0）

| 项 | 支持函数（v1 子集） | App 落地 |
|---|---|---|
| `filter` | `blur(<len>)` / `brightness(<n\|%>)` / `contrast` / `saturate` / `grayscale` / `sepia` / `hue-rotate` / `drop-shadow` | iOS `CIFilter`/`CALayer.filters`（或 core image 层）· Android `RenderEffect`(API31+)/`Paint` 位图滤镜 · 鸿蒙 `OH_ArkUI_RenderNodeUtils` 特效·（模糊已有 glass 通道可复用） |
| `backdrop-filter` | 同上（背景层滤镜） | 毛玻璃：iOS `UIVisualEffectView`/`CABackdropLayer` · Android `RenderEffect` blur（+ 背景取样）· 鸿蒙 blur 特效 |

**诚实边界**：非 blur 的复杂滤镜（多函数叠加 / 颜色矩阵）先做**单函数**；`drop-shadow` 归 box-shadow 同源。`mix-blend-mode` 另议（合成层）。

### F3 · 排版增强（P0，**用户点名的"太简单"主体**）

| 项 | IR 字段 | App 落地 |
|---|---|---|
| `font-style: italic` | `fontStyle`（继承） | 宿主选斜体字形（iOS `UIFont italic` / Android `Typeface.ITALIC` / 鸿蒙 fontStyle） |
| `font`（简写） | 展开到 fontSize/fontFamily/fontWeight/fontStyle/lineHeight | 编译期简写展开（同 margin shorthand 先例） |
| `text-transform` | `textTransform`（继承） | **编译期对静态文本变换**（uppercase/lowercase/capitalize）——自绘端文本是字符串常量，编译期可变换；动态文本走宿主 |
| `font-variant-numeric: tabular-nums` | `fontVariantNumeric`（继承） | 等宽数字（价格/KPI 列对齐刚需）：iOS `kNumberSpacing` feature / Android `Paint` feature / 鸿蒙 fontFeature |
| `text-decoration-color` / `-thickness` / `-style` | `textDecorationColor` 等 | 复用 text-decoration 通道（宿主已有 underline/strike 绘制） |
| `text-indent` | `textIndent`（长度） | 首行缩进（正文/富文本）：宿主文本引擎首行偏移 |
| `word-spacing` | `wordSpacing`（长度，继承） | 词间距：宿主文本引擎 |
| `overflow-wrap: break-word/anywhere` + `word-wrap` | 归一到 `wordBreak` 家族 | 长 URL/串折行（与现有 word-break 同通道） |

**诚实边界**：`text-transform` 编译期变换对**动态绑定文本**不适用（走宿主最佳努力）；`word-spacing` 对 CJK 语义弱（主承载西文/混排）。

### F4 · 交互态与伪元素（P1，富交互核心）

| 项 | 落地设计 |
|---|---|
| 状态伪类 `:hover/:active/:focus/:focus-visible/:checked/:disabled` | **已有运行时动态类通道**（B2 的 `:class` 静态枚举 + O(1) 位图）⇒ 把伪类**降级**为运行时状态位（`pressed`/`focused`/`disabled`），编译期产出「状态 → 样式」表；App 自绘手势层给 pressed/focused，MP 由天生态提供 |
| `::before/::after` + `content` | ★**已落地**（决策 #791 · 2026-10-10）：编译期**物化伪元素节点**（合成装饰子节点，`:active` 触发动画 `:active::after{animation}`）；Android 宿主先跑通，iOS/鸿蒙待补 |
| `::placeholder` | 输入组件（`p-input`）通道内交付（非通用伪元素） |

**诚实边界**：`::before/::after` 物化是**结构性**能力（改树）但**已完成**（决策 #791：合成装饰子节点，非改原树）；`:active` 已支持（折 `press*` + 按下触发动画）；其余状态伪类（`:hover/:focus/:checked`）仍待做。触屏无 `:hover`（App 端 `:hover` 语义 = 无效，须具名）。

### F5 · 滚动容器增强（P1/P2）

| 项 | 落地设计 |
|---|---|
| `scroll-snap-type` / `scroll-snap-align` | 滚动吸附（banner 分页/宫格翻页）：内核滚动层按 `snap-align` 建吸附点，滚动结束钳到最近点（iOS `UIScrollView` paging / Android `SnapHelper` / 鸿蒙 scroll）；Skyline 引擎锁死（不在官方表）⇒ MP 具名豁免 |
| `overscroll-behavior: contain/none` | 阻断滚动链（弹层内滚不带动底层）：宿主滚动容器到边界不外传 |
| `scroll-behavior: smooth` | 平滑滚动：宿主滚动动画（`setContentOffset(animated:)` 等） |

**诚实边界**：scroll-snap 在 Skyline 引擎锁死；`scroll-behavior` 仅对程序化滚动有意义。

---

## 3. 分批与建议顺序

| 批 | 族 | 理由 | 预计工作量 |
|---|---|---|---|
| **批 A（P0）** | **F1 定位**（fixed/sticky/z-index） | **含 2 个静默 bug**（fixed→absolute、z-index 丢）+ superapp 语料已在用 ⇒ 优先级最高 | 中（内核 position 枚举 + 宿主滚动层吸附） |
| **批 B（P0）** | **F3 排版**（font-style/font 简写/text-transform/tabular-nums/decoration-color/text-indent/word-spacing/overflow-wrap） | 用户点名"文本太简单"的主体；多为**宿主/编译期**改动（内核零改），性价比高 | 中（逐项，走 PLAYBOOK） |
| **批 C（P0）** | **F2 特效**（filter/backdrop-filter） | 毛玻璃是超级应用 UI 标志；Skyline 官方已支持 | **高**（三端 GPU 滤镜/合成层，各端 API 差异大） |
| **批 D（P1）** | **F4 状态伪类**（:hover/:active/:focus/:checked/:disabled） | 富交互核心；**复用现有动态类位图**（零树改动） | 中 |
| **批 E（P1/P2）** | **F5 滚动增强**（snap/overscroll/smooth） | 首页 banner/宫格/弹层 | 中高（宿主滚动层） |
| ★已落地（#791） | `::before/::after` + `content` | **结构性**（改模板树），单列 | 高 |

**建议**：先做 **批 A（定位）**——它是真缺陷（静默错处理）+ 语料在用 + 成本可控；再做 **批 B（排版）**收用户点名的"文本太简单"。

---

## 4. 诚实边界（v1 不做，具名）

- `mix-blend-mode` / `isolation` / `background-blend-mode`（合成层，成本高）
- `writing-mode` / `direction` / `unicode-bidi`（竖排/BiDi——复用平台，L4）
- `columns` / `column-count`（多列，三端成本极高）
- `::before/::after` 已落地（决策 #791）——不属本「不做」清单
- `object-fit`（走组件通道，非 CSS 属性）
- `scroll-snap` / sticky 的 **MP 端**（Skyline 引擎锁死，具名豁免）

---

## 5. 待裁定

1. 范围：五族全做，还是先做 P0 三族（F1/F2/F3）？
2. 起步批次：建议 **批 A（定位：fixed/sticky/z-index）** —— 同意否？
3. `z-index` 策略：**数值→语义层映射**（保持 layer 语义纪律），还是**开放数值**（宿主按 z 排序，破语义约束）？（建议前者：数值区间映射，越界诊断）
