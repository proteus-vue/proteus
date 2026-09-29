# Proteus 兼容 uni-app 应用代码 —— 调研结论与落地方案

> 调研对象：能否让 Proteus 直接编译运行 uni-app 项目的应用代码
> 适用：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4）
> 结论：**能做，但必须严格界定"兼容到什么程度"**——不是 100% 兼容，而是覆盖目标项目集合的通用子集


> ⚠ **实施状态：规划态 · UC0 未启动（2026-09-28 核实）**
>
> 全仓 `uni_modules` / `pages.json` / `APP-PLUS` / `nvue` / `uniCloud` —— **零命中**（packages/scripts/hosts/spike/examples 全扫）。
> UC0~UC7 均未开工。本方案自身的出口条件（「未拿到扫描数据不得开始 UC1」）与现状一致。
>
> ⚠ **勿与已落地能力混淆**：`packages/compat-miniprogram` 是**微信小程序**（`wx.*`）兼容 + `migrate:mp` codemod，
> 与 uni-app **无关**；`__MP__`/`__WEB__` 宏是本仓自研条件编译，也非 uni 条件编译。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| **能不能做** | ✅ 能。uni-app 与 Proteus **架构同构**，且有三个天然助推器 |
| **做到什么程度** | 语法层 100%；核心组件与高频 API 高覆盖；**生态层（uni_modules / uniCloud / plus API）不兼容** |
| **最大障碍** | 不是技术，是**生态锁定**（插件市场、原生插件、uniCloud IDE 绑定） |
| **建议策略** | **先做兼容度扫描工具**，用真实项目量化覆盖率，再决定投入边界 |
| **意外收获** | 兼容后 uni-app 项目可获得 Proteus 自研渲染管线的性能收益——这是迁移的真实动机 |

---

## 1. 可行性：架构同构性分析

### 1.1 uni-app 的架构本质

uni-app 官方对自身组成与跨端原理的表述非常清晰，它由两部分配合完成：

> **编译器**：运行在开发环境，将开发者代码编译，输出物由各终端的 runtime 解析。
> **运行时（runtime）**：每个平台（Web / Android App / iOS App / 各家小程序）都有各自的 runtime。

其开发规范约定了五条（官方原文归纳）：

1. 页面文件遵循 **Vue 单文件组件（SFC）规范**
2. 组件标签靠近**小程序规范**
3. 接口能力（JS API）靠近小程序规范，但需将前缀 `wx`、`my` 等替换为 **`uni`**
4. 数据绑定及事件处理同 **Vue.js 规范**，同时补充了应用生命周期及页面生命周期
5. 如需兼容 app-nvue 平台，**建议使用 flex 布局**开发

### 1.2 映射到 Proteus 的既有架构

| uni-app 的层 | Proteus 的对应物 | 是否已有 |
|---|---|---|
| Vue SFC 输入 | Vue SFC 输入 | ✅ **完全一致** |
| 组件映射表（uni 组件 → 各端组件） | 语义 IR 的 `PNode.kind` + 各后端映射 | ✅ 已有机制，需补条目 |
| 条件编译（编译期剔除） | 编译期转换规则（69 条） | ✅ 已有机制，需补规则 |
| API 适配层（uni.request → wx.request / fetch / plus） | **需新建** | ❌ 需新建 |
| pages.json / manifest.json 配置 | `proteus.config.ts` | ⚠️ 需映射 |
| 应用/页面生命周期 | **需新建** | ❌ 需实现 |

**关键判断**：uni-app 的跨端能力 = **语法抽象 + 编译期映射 + 运行时适配**。这与 Proteus 的「语义 IR + 编译期收敛 + 多后端」是**同一个模型**。

所以这不是"从零做一个兼容层"，而是**给既有架构补一张映射表 + 一个 API 适配层**。

### 1.3 uni-app 各端产物与 Proteus 后端的对应

| uni-app 目标端 | uni-app 产物 | Proteus 现状 |
|---|---|---|
| 微信小程序 | `.wxml` / `.wxss` / `.js` / `.json` 四件套 | ✅ **已有 Skyline 后端** |
| H5 | 标准 Vue3 工程 | ✅ **已有 Web 后端**（零转换直跑） |
| App（vue 页面） | JS + WebView 渲染 | 🟡 App 端建设中（本方案 §6） |
| App（nvue） | Weex 原生渲染 | ❌ 建议不做（见 §4） |

---

## 2. 三个"天然助推器"（这是可行性判断的核心）

### 助推器 ① 条件编译反而帮了我们

这是最反直觉、也最重要的一点。

uni-app 的条件编译是**用注释实现的、编译期生效**的：

```js
// js / uts：用 // 注释
// #ifdef APP-PLUS
plus.push.addEventListener(...)
// #endif

/* css：用 /* 注释 */
/* #ifdef MP-WEIXIN */
.wx-color { color: #fff000; }
/* #endif */

<!-- vue/nvue/uvue 模板：用 HTML 注释 -->
```

**推论**：uni-app 项目里**所有平台特有代码都被条件编译包着**。只要 Proteus **不声明** `APP-PLUS` / `MP-ALIPAY` 等平台标识，这些代码在编译期就自动消失了。

**真正需要兼容的只是"跨平台通用部分"**——即没有条件编译包裹的那部分代码。这大幅缩小了工作量。

而且这正好是 Proteus 的强项：编译期收敛本来就是既有架构的核心能力。

### 助推器 ② flex 优先，与 Proteus CSS Profile 高度重合

uni-app 官方建议「如需兼容 app-nvue 平台，建议使用 flex 布局开发」。而 Proteus CSS Profile 的主力也是 flex（L2 级，grid 待定）。

**两者在布局模型上重合度高**，样式兼容的难度比预期低。

主要增量是 **rpx 单位**（750rpx = 屏幕宽度）——这在编译期折叠为比例系数即可，与 Proteus「单位编译期折叠」的设计完全吻合。

### 助推器 ③ uni 组件规范 ≈ 小程序规范 ≈ Proteus Skyline 后端

uni-app 的组件规范是**参考小程序组件规范制定的**（官方明确说明）。而 Proteus **已有 Skyline 后端**。

所以：
```
uni 组件（view/text/image/scroll-view）
    → Proteus 语义 IR 的 PNode.kind（view/text/image/list/scroll-view）
    → Skyline 组件（view/text/image/scroll-view）
```
**近乎 1:1 映射**，不需要中间转换。这是 Skyline 端兼容能快速落地的原因。

---

## 3. 兼容度分级模型

| 层级 | 内容 | 目标覆盖率 | 难度 |
|---|---|---|---|
| **L1 语法层** | Vue SFC、模板语法、指令、事件绑定、响应式 | **100%** | 无（已支持） |
| **L2 组件层** | uni 内置组件 → IR kind | 核心组件高覆盖 | 中 |
| **L3 API 层** | `uni.xxx` 适配层 | 高频 API 高覆盖 | 中大 |
| **L4 配置层** | pages.json / manifest.json / easycom | 主要配置项 | 中 |
| **L5 生命周期层** | 应用生命周期 + 页面生命周期 | 全部 | 小 |
| **L6 生态层** | uni_modules / uniCloud / plus API | **0%（明确不做）** | 不可行 |

### 3.1 L2 组件层：分三档处理

| 档 | 组件 | 策略 |
|---|---|---|
| **A 档（自研映射）** | view、text、image、scroll-view、swiper、button、input、textarea、rich-text、icon、progress | 映射到 IR kind，走 Proteus 自研渲染 |
| **B 档（映射原生）** | map、video、camera、canvas、web-view、ad、live-player/live-pusher | 走「原生组件宿主」节点（`isNativeHost`），**低优先级** |
| **C 档（暂不支持）** | 平台专有组件（如微信 open-data） | 编译期报错 |

> ⚠️ B 档涉及 uni-app 的「混合渲染」语义：原生组件层级最高、`z-index` 无法覆盖、不能嵌入 `scroll-view`/`swiper`。Proteus 的「原生组件混用层」语义接近但不等价，**必须单列验证**。

### 3.2 L3 API 层：按频率推进，不要全量

uni-app 的 API 按官方文档分为：基础、网络、路由与页面跳转、数据缓存、位置、媒体、设备、worker、键盘、界面、上拉加载/下拉刷新、页面和窗体、文件、绘画、广告、第三方服务、uniCloud、平台扩展、其它——**数量在数百级**。

**不要试图全量实现**。策略：

1. 先建 **API 清单与优先级表**（按插件市场项目实际使用频率）
2. 首轮实现 **高频 Top N**（覆盖 80% 项目的最小集）
3. 未实现的 API **编译期明确报错**，禁止静默 undefined

**必须做的**：未实现 API 必须编译期报错 + 给出迁移建议。静默失败是兼容层最恶劣的失效模式。

### 3.3 L4 配置层映射

| uni-app 配置 | Proteus 对应 |
|---|---|
| `pages.json` → `pages[]` | `proteus.config.ts` 路由表（首页 = 数组第一项） |
| `pages[].style` | 页面级窗口样式 |
| `globalStyle` | 全局样式（优先级低于页面级） |
| `tabBar` | 需实现（含 iconPath / selectedIconPath） |
| `easycom` | 组件自动引入规则，`^uni-(.*)` → `@/components/uni-$1.vue` |
| `subPackages` / `preloadRule` | 分包（Skyline 端语义需核实） |
| `condition` | 开发期启动模式 |
| `manifest.json` → appid / 权限 / 隐私描述 | Proteus 应用配置 |

> 注意：uni-app x **不再支持** uni-app 的 `app-plus` 专用配置以及 tabbar 的 `midButton`。若对标 x 的行为，这两项可不实现。

### 3.4 L5 生命周期层

uni-app 在 Vue 规范之外补充了：
- **应用级**：`onLaunch` / `onShow` / `onHide`
- **页面级**：`onLoad` / `onShow` / `onReady` / `onHide` / `onUnload` / `onPullDownRefresh` / `onReachBottom` / `onPageScroll` 等

工作量不大，但**必须精确对齐调用时机**，否则业务行为会错。

---

## 4. 硬边界：明确不做的部分

| 项 | 为什么不兼容 | 处理 |
|---|---|---|
| **plus API（HTML5+）** | App 端原生能力全集，依赖 DCloud 的 5+ runtime | ✅ 大部分被 `#ifdef APP-PLUS` 包裹，Proteus 不声明该标识 → 编译期自动剔除。未被包裹的 → 编译期报错 |
| **uniCloud** | 与 DCloud 账号体系、服务空间强绑定；官方明确 **CLI 不支持**，运行/发行云函数只能用 HBuilderX 菜单 | ❌ 不兼容。编译期报错并说明 |
| **uni_modules 插件生态** | 插件可能含 UTS / Kotlin / Swift / ArkTS 原生代码，可混合 npm/gradle/cocoapods/ohpm | ❌ 不兼容第三方原生插件。纯 JS 的前端插件**可评估** |
| **ext API** | 不常用的 API 被剥离为 uni_modules 插件，需在插件 package.json 编写注册声明才能挂载到 `uni` 对象 | ❌ 同上 |
| **nvue 页面** | 基于 Weex 的原生渲染，与 vue 页面语义不同：不支持 `v-html` / `transition` / `float`；无 `document` / `window` / `localStorage`；Flexbox 是唯一布局模型且不支持 `flex-shrink` / `flex-basis` / `align-content` / `flex` 简写 | ❌ v1 不支持。编译期报错引导改写为 vue 页面 |
| **uni-push / 实人认证 / 支付等** | 依赖 DCloud 服务与资质 | ❌ 不兼容 |

### 4.1 关于 nvue 的一条重要提醒

nvue 有两种编译模式（weex 编译模式 / uni-app 编译模式，通过 `app-plus.nvueCompiler` 配置）。若在 manifest 中设 `"renderer": "native"`，App 端启用纯原生渲染，**pages.json 注册的 vue 页面将被忽略**。

**迁移时必须先检查 manifest.json 是否设置了 `renderer: native`**——这决定了项目到底是 vue 页面还是 nvue 页面为主，直接影响兼容策略。

---

## 5. 关键设计决策

### D1. 不做"运行时 shim"，做"编译期映射"

不要写一个运行时把 `uni.xxx` 转发到 Proteus API——那样每次调用都有额外开销，且与 Proteus「编译期优先」的主张冲突。

正确做法：**编译期把 uni API 调用识别出来，映射到 Proteus 的原生能力调用**，运行时零转发层。

### D2. 用「兼容度扫描工具」决定投入边界（最重要）

**在做任何兼容实现之前，先做扫描工具。**

理由：兼容层的工作量是**开放式的**（数百个 API、数十个组件、大量配置项）。盲目投入会掉进无底洞。

工具职责：
```
输入：一个 uni-app 项目目录
输出：兼容性报告
  ├─ 语法层：通过 / 不通过
  ├─ 组件清单：A档 N 个 / B档 N 个 / C档 N 个（不支持）
  ├─ API 清单：已支持 N 个 / 未支持 N 个（列出调用位置）
  ├─ 条件编译分布：APP-PLUS / MP-WEIXIN / H5 各多少处
  ├─ plus API 依赖：N 处（其中被 #ifdef 包裹的可自动剔除）
  ├─ uniCloud 依赖：是 / 否
  ├─ nvue 页面占比
  └─ 预估迁移成本：人天
```

**用 3–5 个真实 uni-app 项目跑一遍，数据会直接告诉你该覆盖哪些 API。**

### D3. 平台标识策略

Proteus 需要定义自己的平台标识，并**明确不声明** uni-app 的标识：

| uni-app 标识 | Proteus 是否声明 | 后果 |
|---|---|---|
| `APP-PLUS` / `APP-PLUS-NVUE` / `APP-NVUE` | ❌ 不声明 | 相关代码块编译期剔除 |
| `MP-WEIXIN` | ⚠️ **可声明**（映射到 Proteus Skyline 端） | 复用已有代码 |
| `H5` / `WEB` | ⚠️ **可声明**（映射到 Proteus Web 端） | 复用已有代码 |
| 其他小程序平台 | ❌ 不声明 | 剔除 |
| `VUE3` | ✅ 声明（Proteus 基于 Vue 3.4） | 保留 VUE3 分支 |
| `VUE2` | ❌ 不声明 | 剔除 Vue2 分支 |
| `UNI-APP-X` | ❌ 不声明 | 剔除 uni-app x 专属分支 |

**这是助推器①的直接落地**：声明 `MP-WEIXIN` 和 `H5` 能白嫖大量已有代码，不声明 `APP-PLUS` 能自动剔除 plus 依赖。

### D4. 优先级：Skyline 端先于 App 端

理由见助推器③：uni 组件规范 ≈ 小程序规范，而 Proteus **已有 Skyline 后端**，是近乎 1:1 的映射。

App 端仍在建设（本方案 §6 依赖 App 自研渲染管线），应排在后面。

---

## 6. 落地里程碑

### UC0 · 兼容度扫描工具（≈1.5 人周）★ 必须先做

- [ ] 解析 uni-app 项目结构（pages.json / manifest.json / uni_modules）
- [ ] 扫描模板中的 uni 组件，按 A/B/C 档分类
- [ ] 扫描 `uni.xxx` / `plus.xxx` API 调用，输出清单与位置
- [ ] 统计条件编译分布与各平台标识
- [ ] 检测 uniCloud 依赖、nvue 页面、`renderer: native` 设置
- [ ] 输出兼容性报告 + 预估迁移成本

**出口**：用 3–5 个真实 uni-app 项目跑通，拿到覆盖率基线。**未拿到数据不得开始 UC1。**

### UC1 · 语法层与配置层（≈2 人周）

- [ ] 条件编译解析（三种注释语法：js `//`、css `/* */`、模板 `<!-- -->`）
- [ ] 平台标识声明策略（D3）落地
- [ ] `pages.json` → Proteus 路由配置映射
- [ ] `manifest.json` 主要配置项映射
- [ ] `easycom` 组件自动引入
- [ ] rpx 单位编译期折叠（750rpx = 屏幕宽度）

**出口**：能解析一个 uni-app 项目的配置并生成 Proteus 配置。

### UC2 · 组件层 A 档（≈3 人周）

- [ ] view / text / image / scroll-view / swiper / button / input / textarea / rich-text / icon / progress
- [ ] 映射到 IR kind + 属性/事件对齐
- [ ] Skyline 端优先验证

**出口**：A 档组件在 Skyline 端渲染正确。

### UC3 · 生命周期层（≈1 人周）

- [ ] 应用生命周期：onLaunch / onShow / onHide
- [ ] 页面生命周期：onLoad / onShow / onReady / onHide / onUnload / onPullDownRefresh / onReachBottom / onPageScroll
- [ ] 调用时机精确对齐（需 conformance 验证）

### UC4 · API 层高频集（≈4 人周，范围由 UC0 数据决定）

- [ ] 按 UC0 报告的频率表实现 Top N
- [ ] **未实现 API 编译期报错**（硬性要求）
- [ ] 典型分类优先：网络（request/uploadFile/downloadFile）、路由跳转、数据缓存、界面交互（showToast/showModal/showLoading）、设备信息、媒体

**出口**：UC0 选定的目标项目中，高频 API 覆盖率 ≥ 80%。

### UC5 · Web 端对齐与 conformance（≈2 人周）

- [ ] Web 端零转换直跑（复用既有后端）
- [ ] 以浏览器 `getComputedStyle` / `getBoundingClientRect` 为真值基准
- [ ] 与 Skyline 端 conformance 比对（≤ 0.5 dp）

### UC6 · App 端（依赖主方案 M2，可延后）

- [ ] 依赖《App 端高性能渲染落地方案》M2 通过
- [ ] A 档组件走 Proteus 自研渲染管线
- [ ] B 档组件（map/video/canvas 等）走原生组件宿主

### UC7 · B 档组件与收尾（≈3 人周，可延后）

- [ ] map / video / camera / canvas / web-view / ad
- [ ] 混合渲染语义验证（层级、嵌入限制）

---

## 7. 验收标准

| 指标 | 合格线 | 目标 |
|---|---|---|
| 目标项目语法层通过率 | 100% | 100% |
| A 档组件覆盖率 | 100% | 100% |
| 高频 API 覆盖率（按 UC0 定义） | ≥ 80% | ≥ 90% |
| 未实现 API | **编译期报错，零静默失败** | 同上 |
| plus API 未包裹残留 | 编译期报错 | 编译期报错 |
| conformance（Web vs Skyline） | ≤ 0.5 dp | ≤ 0.25 dp |
| 既有 Web / Skyline 后端测试 | 全绿 | 全绿 |
| Golden 门禁（Node/Rust 双端） | 通过 | 通过 |

---

## 8. 风险与坑位

| # | 风险 | 应对 |
|---|---|---|
| 1 | **盲目全量兼容，掉进无底洞** | UC0 扫描工具先行，用数据定边界 |
| 2 | **未实现 API 静默 undefined** | 编译期强制报错，这是最恶劣失效模式 |
| 3 | **nvue 与 vue 语义混淆** | v1 不支持 nvue，编译期报错引导改写 |
| 4 | **`renderer: native` 未检测** | UC0 必须检测此项，它决定项目主体类型 |
| 5 | **原生组件混合渲染语义不等价** | B 档单列验证，不假设与 Proteus 原生宿主等价 |
| 6 | **条件编译注释语法搞错（三种）** | js/css/模板三套，UC1 必须全覆盖测试 |
| 7 | **rpx 与 Proteus 单位体系冲突** | 编译期折叠，纳入 CSS Profile |
| 8 | **uni_modules 纯 JS 插件能否复用未验证** | 需单独 spike，不要默认可以 |
| 9 | **生命周期调用时机偏差** | 需 conformance 验证，不能凭文档推断 |
| 10 | **定位模糊：宣称"兼容 uni-app"但实际覆盖有限** | 对外必须给出覆盖率数据，不做模糊宣称 |

### 8.1 合规提醒（需法务确认）

uni-app 是 DCloud 的开源项目，其 API 规范属于**接口约定**。做接口兼容（类似兼容 POSIX / JDK 接口）业界常见，但：

- **不得复制其源码实现**，API 实现必须自研
- **不得使用 "uni-app" / DCloud 商标做宣传**
- 具体边界建议由法务确认

> 本条为风险提示，不构成法律意见。

---

## 9. 给实现 LLM 的执行指令

1. **UC0 扫描工具未完成、未拿到真实项目数据前，禁止开始 UC1。**
2. **未实现的 `uni.xxx` API 必须编译期报错**，禁止运行时静默失败或返回 undefined。
3. **不声明 `APP-PLUS` / `APP-NVUE` / `UNI-APP-X` / `VUE2` 等平台标识**，让相关代码块在编译期自动剔除。
4. **v1 不支持 nvue**，遇到 `.nvue` 文件编译期报错并给出改写指引。
5. **不实现 uniCloud / plus API / uni_modules 原生插件**，遇到即编译期报错说明原因。
6. **条件编译三种注释语法必须全部覆盖**（js `//`、css `/* */`、模板 `<!-- -->`）。
7. **不做运行时 API shim**，所有 uni API 调用在编译期映射。
8. **不得破坏既有 Web / Skyline 后端**，既有测试必须全绿。
9. **新增转换规则自带 AI 说明书**，与既有 111 条规则约定一致。
10. **每个阶段结束通过对应门禁**（Golden / conformance），再进入下一阶段。

---

## 附：关键事实依据

- uni-app 由「编译器 + 运行时」两部分配合实现跨端：编译器运行在开发环境，输出物由各终端 runtime 解析；每个平台各有 runtime
- uni-app 开发规范：页面文件遵循 Vue SFC 规范；组件标签靠近小程序规范；接口能力靠近小程序规范但前缀换为 `uni`；数据绑定及事件处理同 Vue.js 规范并补充应用/页面生命周期；如需兼容 app-nvue 建议使用 flex 布局
- 条件编译用注释实现、编译期生效，非目标平台代码直接剔除不进产物；js/uts 用 `//`，css 用 `/* */`，vue/nvue/uvue 模板用 `<!-- -->`
- 平台标识符：APP-PLUS、APP-PLUS-NVUE / APP-NVUE、APP-ANDROID、APP-IOS、APP-HARMONY、H5 / WEB、MP-WEIXIN、MP-ALIPAY、MP-BAIDU、MP-TOUTIAO、MP-LARK、MP-QQ、MP-KUAISHOU、MP-JD、MP-360、MP-XHS、MP、QUICKAPP-*、VUE2 / VUE3、VUE3-VAPOR、UNI-APP-X、uniVersion
- pages.json 决定首页、页面路径、窗口样式、原生导航栏、原生 tabbar；**所有页面均需在 pages.json 注册**，否则不会被打包；pages 数组第一项为入口页
- uni-app x 不再支持 uni-app 的 app-plus 专用配置以及 tabbar 的 midButton
- easycom：`^uni-(.*)` → `@/components/uni-$1.vue`，支持 autoscan；rpx 以 750 为屏幕宽度基准，配套 rpxCalcMaxDeviceWidth / rpxCalcBaseDeviceWidth / rpxCalcIncludeWidth
- uni 组件分类：视图容器（view / scroll-view / swiper / match-media / movable-area / movable-view）、基础内容（text / rich-text / icon / progress）、表单（button / checkbox / form / input / editor / label / picker / picker-view / radio / slider / switch / textarea）、导航（navigator）、媒体（audio / camera / image / video / live-player / live-pusher）、地图（map）、画布（canvas）、web-view、广告（ad / ad-draw）、页面属性配置（custom-tab-bar / navigation-bar / page-meta）、uniCloud（unicloud-db）、扩展组件（uni-ui）
- 混合渲染语义：原生组件层级最高，z-index 无法覆盖；无法嵌入 scroll-view / swiper / picker-view / movable-view；原生组件清单含 map / video / camera / canvas / input / textarea / live-player / live-pusher / cover-view / cover-image / ad
- nvue 基于 Weex 改进的原生渲染，与 vue 页面差异：不支持 v-html / transition / float；无 document / window / localStorage；Flexbox 为默认唯一布局模型，不支持 flex-shrink / flex-basis / align-content / flex 简写；Android 仅支持 overflow:hidden。分 weex 编译模式与 uni-app 编译模式（`app-plus.nvueCompiler`）
- manifest 中 `"app-plus": { "renderer": "native" }` 启用纯原生渲染，此时 pages.json 注册的 vue 页面将被忽略
- uni_modules 可同时放置 npm / gradle / cocoapods / ohpm 库；不常用的 API 被剥离为 uni_modules 插件但仍使用 `uni.` 前缀；ext API 需在插件 package.json 编写注册声明才能挂载到 `uni` 对象
- uniCloud 必须通过 HBuilderX 创建并关联服务空间，**CLI 不支持**；运行与发行云函数只能用 HBuilderX 菜单
- plus API 在 disagreeMode 下受合规限制（设备信息、蓝牙、相机、通讯录、指纹、相册、定位、iBeacon、io、地图、oauth、支付、runtime、语音、统计、视频等）
