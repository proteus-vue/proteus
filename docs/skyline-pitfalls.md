# Skyline 适配踩坑总账（Pitfalls Ledger）

> **定位**：Proteus 在微信小程序 **Skyline（glass-easel）** 渲染引擎上踩过的**全部坑**的单一总账。
> 目的：**一次记录、全局复用**——新组件/新页面开发前先扫本表，避免重踩。
> **来源口径**：每条坑都标注**实测依据**（真机/模拟器对照实验、基础库 `app.asar` 提取、编译器注释、决策编号）。
> **关联**：`docs/compiler-platform-alignment.md`（官方 WXML 语义模型）· `docs/proteus-end-alignment-plan/04-batches.md`（SOP v2 的 T1-T15 陷阱索引）· `showcase/README.md`（演示工程跨端约束）

---

## 0. 速查表（症状 → 根因 → 处置）

| # | 症状（你看到的） | 根因 | 处置 |
|---|---|---|---|
| **S1** | 组件样式全部失效（连自己根节点都不匹配） | `.a.b` 复合类选择器不支持 | **单类选择器**（类名后缀 `-data-v-x`） |
| **S2** | 圆环/spinner 渲染成**方块** | `border-<side>-color` 单边异色 + `border-radius` | 用**统一色 border 环 + 随转子元素点**；编译器已告警 |
| **S3** | 圆角/自定义样式莫名丢失 | `[data-v-x]` 属性选择器不支持 | 同上（类名后缀替代属性选择器） |
| **S4** | 规则整条被丢弃或编译报错 | 通配符 `*` / 子选择器 `.x > *` 被拒 | 仅 MP 产物**规则级剔除**（Web 保留降级规则） |
| **S5** | 设计 token（`:root` 变量）全部失效 | Skyline 无 `:root`，根选择器是 `page` | 构建期把 `:root` 改写为 `page`（`app.wxss` 通道） |
| **S6** | `env(safe-area-inset-*)` 不生效 | 含 `env()` 的声明**整条被丢弃**（`max()` 包裹也无效） | 走**运行时读数**（`getWindowInfo`+`getMenuButtonBoundingClientRect`） |
| **S7** | 页面级 CSS 变量传不进组件 | 微信**组件样式隔离**（即使 `styleIsolation: apply-shared`） | 变量定在 **page 级**；类名走 `root-class` 通道 |
| **S8** | 按下态（hover）无反馈 | `hover-class` 由**平台**加到根节点，不经编译期 class 处理 | 定义在 **`<style global>`** + **单类选择器** |
| **S9** | 按下态叠加层被"吃掉" | `background` **简写**重置 `background-image`（global 在 scoped 前） | 改用 `box-shadow` 叠加 或 提升特异性/`!important` |
| **S10** | 组件**整体不渲染**、无任何报错 | PascalCase 标签 `<PSafe>` 或漏连字符 `<pgrid>` → `usingComponents` 未注册 | 标签**一律小写 kebab**（`<p-safe>`）；门禁 `component-tag-hygiene` |
| **S11** | 主题/变体类在 MP 端完全丢失（Web 正常） | 模板**动态拼接类名** `` `p-theme--${x}` `` → 编译器无法静态后缀 | `:class` 用**字面量键**（`'p-theme--brand': x==='brand'`） |
| **S12** | 整页黑屏 / IDE 卡死 | 模板内联箭头函数 `=>`、属性字面量含 `<`/`"` 破坏 WXML 解析 | 移到 computed/`data` |
| **S13** | 内容被状态栏/灵动岛遮挡 | 原生导航栏 `navigationStyle: custom` + 未避让 | `<p-safe area="top">`（内部走运行时读数，见 S6） |
| **S14** | 页面滚不动 | **Skyline 页面本身不滚动**，滚动必须 `scroll-view` | 编译器自动包 `<scroll-view scroll-y>`；`wx.pageScrollTo` 对容器无效 |
| **S15** | 原生 `<progress>` 不渲染 | Skyline 官方不支持原生 `<progress>` | 编译器降级为自定义 view 进度条 |
| **S16** | 容器查询恒定态（恒堆叠/恒 sm/不折叠） | 逻辑层**无 `ResizeObserver`** | 改 `SelectorQuery` 测量（`@proteus-vue/fluid` 的 MP 工厂） |
| **S17** | 点击拿不到坐标 | Skyline `tap` 的 `detail`/`touches`/`changedTouches` **全 undefined** | 用 `touchstart`（`touches[0]` 带 `pageX/pageY`） |
| **S18** | SVG 文字空白 | Skyline 解码 SVG 成功但**丢弃文字元素** | 文字移到 SVG 外 `<text>` 叠加（或轮廓化/WebView 渲染） |
| **S19** | SVG 动画不播放 | `<image>` 承载 SVG 时**静态光栅化** | 用 CSS/worklet 动画，或逐帧换 `src` |
| **S20** | `<svg>` 整体不渲染 | 微信无 `<svg>` 对等组件 | 编译期 lowering 为 `<image>` data-URI |
| **S21** | canvas 拿不到 `ctx`（`node()` 不回调） | Skyline canvas 通道限制（IDE 版本/自动化上下文） | 降级自写 path 解析器（`path-parser.ts`），不依赖 `createPath2D` |
| **S22** | 原生组件（camera/map/web-view）**吞触摸** | 原生组件层级高于同层渲染 | 原生组件区用 `<scroll-view>` 包裹 / 分区展示 |
| **S23** | 原生 `<switch disabled>` 看着和可用态**一样** | 原生 disabled **不做外观弱化** | 由**组件包装层**统一表达状态视觉（淡化+指示器） |
| **S24** | `type=checkbox` 是个**小方框**，和圆形开关完全不同 | 官方 switch 内用 `wx-checkbox-input` 渲染（平台历史包袱） | 登记「有意不沿用」，改用 `shape: round\|square`（都是开关） |
| **S25** | `calc()` 百分比在 `flex-basis` 不可靠（列宽算错） | Skyline 对 calc 百分比支持有限 | 用 **px 档**（运行时 `SelectorQuery` 实测宽 → setData） |
| **S26** | `v-for` + 内层 `v-if` 丢节点（只渲染出标题） | `<template wx:for>` 包裹丢节点 | 用**外层 `<view v-for>`** 包裹 |
| **S27** | 数据不更新 / 整块不渲染 | 模块常量 / store 未进 `data` | **经 `computed` 进 data**（`const x = computed(() => X)`） |
| **S28** | 组件内 `<Teleport>` / 悬浮层不渲染 | 缺 `componentFramework: glass-easel` 声明 | 组件 `json` 补该声明（`gen-routes` 已自动注入） |
| **S29** | 隐藏场景仍渲染 / 动画不停 | 无 `v-if` 时组件常驻 | `display:none`（实测生效，隐藏场景不渲染） + `:playing` 门控 |
| **S30** | 事件正常（数据变了）但 **UI 不变** | computed 派生值**只在 `ready()` 算一次**，无 observers | 编译器按依赖字段生成 **observers 重算**（`script/computed-observer`）；模板 class 尽量直读 props |
| **S31** | `flex: 1` 的文本把右侧内容**挤出屏幕** | Skyline 下 `flex:1` 的 text 会**扩张撑满整行** | 改 `justify-content: space-between` + `white-space: nowrap`（实测：`flex:1` 与 `flex:1+min-width:0` 均溢出） |
| **S32** | 原生 `<input type="date">` **完全失效** | Skyline 原生 input 无日期/时间选择能力 | 自绘选择器（触发字段 + 遮罩 + 面板 + 列选择） |
| **S33** | 数据莫名丢失、引用它的模板/computed 全失效 | `ref<T>(非空初值)` **带类型实参** → 初值不可静态求值 → data `undefined` | `ref(初值)` 不带泛型；★注意 `ref(x as T)` **同样**不可静态求值（用「整体替换」等无断言写法） |
| **S34** | 组件**完全点不中**（radio 全失效） | `props.value` 被 ref 的 `.value` 剥离规则误伤（→ `this.data.props`） | 编译器规则：`.value` 重写只对非 defineProps 变量生效（`script/computed-observer` 同批修复） |
| **S35** | 逻辑层数据已变、**视图不更新** | `refObj.value.field = v` 嵌套写只改 `this.data`、**不 setData** | 编译器补 `setData`（`script/ref-nested-write`）；或整体替换 `o.value = {...o.value, [k]: v}` |
| **S36** | 派生样式**残留旧值**（取消勾选仍紫色） | computed **链断裂**：`boxStyle` 依赖 computed `isChecked` 而非 prop，直接依赖扫描漏后继 | 编译器依赖提取改**传递闭包**（chain 上全部后继随根字段重算） |
| **S37** | 组件事件在页面收不到（群选无效） | emit 载荷**多包了一层 `detail`** → 页面 `e.detail.detail.value` 恒 undefined | emit **裸载荷**（框架约定：编译器 `triggerEvent(name, payload)` → 页面 `e.detail = payload`）；页面侧 `e?.detail ?? e` 跨端通吃 |
| **S38** | 模板表达式里的**函数调用**在 MP 无效（不止"不生效"，会**崩页事件链**） | WXML 表达式不支持函数调用；真机实测 `{{ list.join(', ') }}` / `{{ actLabel(act) }}` 抛 `TypeError: Cannot convert undefined or null to object at join`，中断 `handleChildrenCreation`/`bindingMapUpdate` → 该页渲染/事件整体失效（如 picker 确认后不更新） | 改为 **computed 派生数据**（`multiIdxText`）或方法内预计算；**禁止** `{{ a.b(...) }}` / `:style="f(x)"` / `:key="f(x)"`；编译器已加 `warnTemplateMethodCall` 告警 + 回归锁 |
| **S39** | 模拟器崩溃（页面白屏/启动失败） | `scroll-view` 上使用 `::before`/`::after` 伪元素 | 改**真实留白 `<view>` 元素** |
| **S40** | computed 体内 `obj.value` 被误改 | 编译器 ref 剥离规则把 `act.value` 改成 `this.data.value`（同 `props.value` 坑） | computed 体里属性取值用**方括号** `obj['value']`（或 `String(obj['value'])`） |
| **S46** | 样式变体**没生效**（如双按钮仍是超宽 184px） | 用**后代选择器**（`.parent--mod .child`）或复合类——**Skyline 编译器会剔除后代/复合选择器**（组件 scoped 下尤其） | 形态/尺寸变体一律用**单类**（`child--sm`）直接挂在元素上，不用后代/复合选择器；规则级剔除有编译期告警可查 |
| **S47** | 弹层**二次打开卡死 + 页面无法滚动** | `root-portal`（teleport）内容用 `v-if` **卸载/重挂**——glass-easel 下 portal 挂载异常，残留层锁死页面 | **portal 内容常驻**（不用 `v-if`）；可见性/动画用 `:class` + `visibility` + `phase`（leave 播完只切 phase，不卸载）；对齐 p-drawer |
| **S48** | Web 控制台 `Failed to resolve component: picker-view` | 组件模板**平台死分支**里的 MP 专用标签——Vue 把 `resolveComponent` **提升到 render 顶部**，死分支也解析 | `@vitejs/plugin-vue` 的 `compilerOptions.isCustomElement` 声明 MP 专用标签（`MP_ONLY_TAGS`）；框架级一次配置 |
| **S49** | 弹层**二次打开无反应 + 页面锁死**（改了多轮 v-if/teleport/动画都没用） | 顶层 **`let x = <非 null 值>`**（如 `let timer = 0`）被编译器**静默丢弃** → 方法体 `clearTimeout(timer)` **ReferenceError** 中断在 `setData({shown:false})` 前 → 全屏层永不隐藏，吞掉点击/滚动 | 需跨方法保留的变量一律 **`ref`**（`const timer = ref(0)`；抄 p-popup `timer.value`）；编译器已对「顶层 let 非 null 初始化」告警 |
| **S42** | 自定义组件弹层**不贴底/左右有间隙**（像浮动卡片） | 组件内用 **`position: fixed`**——**Skyline 不支持 fixed**（页面在 scroll-view 流内） | 弹层用 **`<teleport to="body">`**（编译器 → Skyline `<root-portal>`，子树脱离页面=类 fixed 顶层）；**常驻挂载 + class 驱动可见性/动画**（`<teleport>` 上的 `v-if` 编译会被丢弃）；正解可抄 p-drawer/p-modal |
| **S43** | 弹层**无弹出/关闭动画** | 用 `wx:if` 切换可见性（直接挂载/移除，无过渡） | **常驻 + class 驱动**：`transform: translateY(100%)→0` + `transition`（面板滑入滑出）、`opacity`（遮罩淡入淡出）；关闭态 `visibility:hidden` 延迟隐藏以保留退场动画 |
| **S44** | 改了 dist 但**真机/模拟器不变**（对着旧界面困惑） | 微信开发者工具**编译缓存**——`simulator_refresh`/`automation_navigate` 不足以重编译 | 改产物后执行 **`wechatide debug_clear_cache --action cleanCompileCache`** 再 `simulator_open_page`（清缓存前截图不可信） |
| **S45** | `picker-view` 选中项文字**被遮住/消失** | `indicator-style` 里加了 `background-color` 灰底——indicator 是**覆盖层**，会盖住选中项 | 保持 indicator **透明 + 仅上下细线**（或 `indicator-style` 不含背景色）；需要高亮时用 transform/文本色而非覆盖层底色 |
| **S41** | 真机 picker 问题先折腾模拟器自动化（效率坑） | 元素选择器/坐标 tap/touch 在 p-* 与离屏窗口下**全部无效**，耗时且无果 | ① 先 `get_simulator_console --command 'grep -n .'` 读**真机报错**；② 视觉问题直接看两端截图，不用自动化复现人眼一秒可辨之事 |

---

## 1. CSS / 选择器层（最密集，S1-S9）

### 1.1 只支持**单类选择器**（S1/S3）

**实测**：`glass-easel` 不支持**复合类选择器 `.a.b`**——组件自己的 wxss 匹配自己的根节点都失效（p-button padding 消失）**且无警告**；**属性选择器 `[data-v-x]` 同样不支持**。

**处置**：`scoped` CSS 一律**类名后缀**（`.box` → `.box-data-v-x`，单一类选择器）。
→ 实现：`packages/compiler/src/style.ts` `suffixClassTokens()`
→ 连带结论：**主题变体也只能单类**（`.p-theme--brand`，不能 `.p-button.p-theme--brand`）。

### 1.2 单边异色 border 会让 border-radius 失效（S2）

**实测**（四组对照实验，2026-09-13）：`border-top-color`（单边异色）+ `border-radius` → **渲染成方块**；
统一色 border 正常；`background`/`conic-gradient` 正常。**与 transform 动画无关**（动画只是让方块可见地转起来）。

**处置**：spinner 用「**统一色 border 环 + 随转子元素点**」（`p-switch`/`p-loading`）。
→ 编译器已加告警：检测 `border-(top|right|bottom|left)-color`。

### 1.3 通配符 / 子选择器被拒（S4）

**实测**：Skyline WXSS 编译器**拒绝通配符 `*`**（含 `.x-fallback > *`、`:deep(*)` 编译后的 `.x *`）。
**处置**：仅 MP 产物**规则级剔除**（Web 保留——真浏览器可用）。`style.ts` step 3.5。

### 1.4 `:root` 不存在（S5）

**处置**：构建期 `:root` → `page`（`rewriteRootToPage`）；设计 token 走 `app.wxss`（`globalStyle`）通道。

### 1.5 `env()` 整条声明被丢弃（S6）

**实测**：`env(safe-area-inset-top)` **不可用**，含它的声明**整条丢弃**，`max(env(...), 50px)` 兜底也无效
（p-safe 曾因此**完全无效**）。官方文档未记载。
**处置**：MP 端走**运行时读数**（`getWindowInfo().statusBarHeight` + `getMenuButtonBoundingClientRect().bottom`）。

### 1.6 组件样式隔离（S7）

**实测**：微信自定义组件**页面 wxss 无法可靠作用于组件内部**——即使 `styleIsolation: apply-shared`。
**处置**：
- 类名 → `root-class` 通道（编译期把 class 传进组件，组件根节点绑 `{{rootClass}}`）
- **换肤/主题变量** → 定在 **page 级**（跨组件设 CSS 变量**不继承**）
- **共享组件的根节点/容器用原生 `<view>`/`<text>`**（`<p-view class="card">` 的类名进组件内部 → 父 wxss 够不到 → 卡片边框/圆角/阴影全失效）

### 1.7 `hover-class` 只能靠 global + 单类（S8）

**实测**：`hover-class` 的类名由**平台**在按下时加到根节点，**不经** Vue 编译期 `:class` → **无 scopeId 后缀**。
**处置**：定义在 `<style global>`（scoped 版永远匹配不上）+ 单类选择器。

### 1.8 `background` 简写重置 `background-image`（S9）

**实测**：编译器把 `<style global>` 输出在 scoped **之前**；基类 scoped 规则若用 `background:` **简写**，
会把它之后的 `background-image` 重置为 `none`（按下叠加层被静默吃掉）。
**处置**：叠加层改用 `box-shadow`（不受 background 简写影响）或 `!important` 与顺序解耦。

---

## 2. 组件与隔离层（S10/S22-S24/S28）

### 2.1 标签写法决定"是否注册"（S10）

**实测**：`<PSafe>`（PascalCase）→ 编译器 `kebabCase` 旧实现产出 `psafe`（**连续大写不插连字符**）
→ `gen-routes` 按 `psafe` 找不到组件目录 `p-safe` → `usingComponents` **未注册** → **组件静默不渲染**；
且旧正则只匹配小写开头 → **连告警都没有**。
**处置**：标签**一律小写 kebab**；`kebabCase` 已修 Vue 标准（`/\B([A-Z])/`）；门禁 `tests/component-tag-hygiene.test.ts`。

### 2.2 原生组件吞触摸（S22）

**实测**：`camera`/`map`/`web-view` 等**原生组件**层级高于同层渲染 → 吞掉触摸事件（`p-svg-canvas` 先例）。
**处置**：原生组件区用 `<scroll-view>` 包裹或**分区展示**。

### 2.3 原生 switch 的状态/形态限制（S23/S24）

- `disabled` **不做外观弱化**（与可用态一模一样）→ 包装层显式补齐状态视觉。
- `type=checkbox` 是**独立的小方框**（基础库内部 `wx-checkbox-input`）→ 平台历史包袱；
  Proteus 登记「有意不沿用」，改 `shape: round|square`。
- **方角做不到**（wxss 改不了原生组件内部圆角）→ 该组件**自绘**。

### 2.4 组件内需要 `componentFramework` 声明（S28）

**实测**：组件内用 `<root-portal>`（官方悬浮层）**无 `componentFramework: glass-easel` 声明则不渲染**。
**处置**：`gen-routes` 对组件 json 自动注入（与页面 `json` 同）。

---

## 3. 模板 / 编译层（S11/S12/S26/S27）

| 坑 | 说明 | 处置 |
|---|---|---|
| 动态拼接类名（S11） | `` `p-theme--${x}` `` 编译器无法静态后缀 → MP 变体类丢失 | `:class` 字面量键 |
| 内联箭头函数（S12） | `:options="list.map(b => ({…}))"` 的 `=>` 破坏 WXML（`unmatched parenthesis` → 整页黑屏） | 移到 `computed` |
| 属性字面量含 `<`/`"`（S12） | `:code="'<p-button>'"` 破坏 WXML 解析（IDE 卡死） | 存 `data` 后 `:code="codes.x"` |
| `<template v-for>` 丢节点（S26） | 嵌套 `v-for` + 内层 `v-if/v-else` 用 `<template wx:for>` 包裹会丢节点 | 外层用 `<view v-for>` 包裹 |
| 模块常量/store 未进 data（S27） | 绑到模块标识符（非 data）→ MP 运行时 undefined、整块不渲染 | 经 `computed` 进 data |
| PascalCase 标签（S10） | 见 §2.1 | kebab |

---

## 4. 能力 / 运行时层（S13-S21/S25/S29）

| 坑 | 实测 | 处置 |
|---|---|---|
| 页面不滚动（S14） | Skyline 页面本身不滚动 | 自动包 `<scroll-view scroll-y>`；`wx.pageScrollTo` 对 scroll-view 容器**无效** |
| 原生 `<progress>` 不渲染（S15） | 官方不支持 | 编译器降级自定义 view 进度条（`16-progress-skyline-degrade`） |
| 无 `ResizeObserver`（S16） | 逻辑层无 RO → 容器查询恒定态 | `SelectorQuery` 测量（`fluid` MP 工厂） |
| `tap` 无坐标（S17） | `detail`/`touches`/`changedTouches` 全 undefined | `touchstart`（`touches[0].pageX/pageY`） |
| SVG 文字被丢弃（S18） | 解码成功但丢文字元素（**官方文档未记载**） | SVG 外 `<text>` 叠加 / 轮廓化 `<path>` / WebView 渲染 |
| SVG 动画不播放（S19） | `<image>` 承载 SVG → 静态光栅化 | CSS/worklet 动画 或 逐帧换 `src` |
| `<svg>` 无对等（S20） | 微信无 `<svg>` | 编译期 lowering → `<image>` data-URI |
| canvas `node()` 不回调（S21） | `boundingClientRect` 正常但取不到 ctx | 自写 path 解析（不依赖 `createPath2D`） |
| `calc()` 百分比不可靠（S25） | `flex-basis` 百分比算错（320 宽算出 3 列并排） | **px 档**（SelectorQuery 实测宽 → setData） |
| 隐藏场景仍渲染（S29） | — | `display:none`（实测生效）+ `:playing` 门控 |

---

## 4.1 响应式与派生值（S30/S33）

### 4.1.1 computed 派生值不会自动重算（S30）

**实测**：小程序**无响应式系统**——编译产物把 computed 求值放在 `ready()`（**仅一次**）。
props/data 变化后，读派生值的模板绑定（如 `:class="{ on: isChecked }"`）**永不更新**。
真机症状：**事件正常（数据已变）但 UI 不变**（p-checkbox 勾选后框不变色）。
**处置**：编译器按 computed 的**依赖字段**生成 Component observers 重算（`script/computed-observer`）；
依赖提取用「字段引用扫描」（覆盖 `this.data.f` / `f.value` / `props.f`）。
→ 顺带建议：模板 class **尽量直读 props**（如 `modelValue ? 'on' : ''`）可少一层派生依赖。

### 4.1.2 `ref<T>(非空初值)` 丢数据（S33）

**实测**：`ref<Record<string, boolean>>({ apple: true })` → 编译器无法静态求值 → data `picked: undefined`
→ 引用它的群选/渲染**整块失效**（Web 正常，仅真机暴露）。
**处置**：`ref({ apple: true })`（不带泛型，类型用 `as` 断言）；编译器已加**醒目告警**（提示去掉类型实参）。
· 今日连续踩三次（p-checkbox `picked` / p-picker `draft` / 演示页 `picked`），已收敛为告警。

## 5. 已落成的防护（防复发机制）

| 防护 | 位置 | 覆盖 |
|---|---|---|
| Skyline 不支持属性告警 | `compiler/src/style.ts` step 3 | `float` / `position: fixed` / `border-*-color` |
| Skyline 不支持选择器剔除 | `compiler/src/style.ts` step 3.5 | 通配符 `*` / 子选择器 |
| 标签写法卫生门禁 | `tests/component-tag-hygiene.test.ts` | PascalCase / 缺连字符 |
| kebabCase 回归锁 | `tests/mp-transform.test.ts` | `PSafe→p-safe` 等 7 组 |
| 页面渲染门禁（可见性） | `tests/e2e-showcase-render.test.ts`（`assertPageRendered`） | 元素塌陷/不可见/整体消失 |
| 组件属性覆盖棘轮 | `scripts/audit-component-attrs.mjs --min` | 属性覆盖只增不减 |
| 端对齐 SOP 陷阱索引 | `docs/proteus-end-alignment-plan/04-batches.md` T1-T15 | 开发流程约束 |

---

## 6. 诚实边界（未解决/未验证）

1. **canvas `node()` 通道**：可能是 IDE 版本（非 Nightly）或自动化上下文限制，**未定论**（模拟器 `boundingClientRect` 正常但取不到 ctx）。
2. **SVG 内部元素事件命中**：官方不支持，Proteus 用**包围盒近似**（非精确）。
3. **`v-for` 场景的 SVG**：保持编译期警告，不完全支持。
4. **组件嵌套容器测量**：受 glass-easel 隔离限制（**页面级为已验证路径**）。
5. **worklet**：编译器已验证 `worklet:xxx` 属性透传；但「编译期提取到自建 UI runtime」**不做**（UI 线程由官方引擎管理）。
6. **`renderer: webview` 白屏兜底**：作为 Skyline 不支持的逃生通道（页面级，放弃 Skyline 特性）。
7. **自动化通道限制**：模拟器 `selectAllComponents` 在**分包页失效**、元素选择器在部分 nightly 失效 → 验证要走**产物断言 + 运行时 evaluate**。

---

## 7. 新增坑的登记方式（贡献约定）

1. 先做**对照实验**（唯一变量）确认根因——**初判常是错的**（例：圆角失效初判"transform 动画"，实为"单边异色 border"）。
2. 补进本表：编号（S 序）+ 症状 + 根因 + 处置 + **实测依据**。
3. 若能机器检测 → **落编译器告警/门禁**（不只改当前组件）；若不能 → 至少加回归锁。
4. 同步 `docs/proteus-end-alignment-plan/04-batches.md` 的陷阱索引（T 序）。
5. 记录进 `PROJECT_MEMORY.md`（含实验过程，供后续复现）。
