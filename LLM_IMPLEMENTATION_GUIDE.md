# Proteus（普罗透斯）：Vue 跨端编译框架（小程序 Skyline + Web）LLM 落地执行指南

> 本文档面向 LLM（大语言模型）辅助开发场景，将自研跨端框架拆解为可独立交付的代码模块。LLM 按"阶段 → 任务 → 文件"三级结构逐个生成，每个任务产出 1-3 个文件，任务间通过明确定义的接口契约衔接，避免一次性生成大量代码导致逻辑混乱。
>
> **v2.1 变更**：框架正式定名 **Proteus（普罗透斯）**——名字来源与设计意图见下节"框架命名"，配置文件统一更名 `proteus.config.ts`。<br>
> **v2.0 变更**：新增"痛点对照"与设计原则（§0）、平台适配层（P1-6 / P3-5）、Web 端零转换策略、分包支持（P2）、setData 路径合并优化（P5-1）、renderer 降级为可选扩展（P5-2）、调试与测试阶段（P6）。详见文末变更记录。

---

## 框架命名：Proteus（普罗透斯）

> 本节是项目的"命名宪章"：记录框架名字的来源与设计意图。文档、包名、CLI、目录中的命名一律以此为准。

### 名字来源（古希腊神话）

**普罗透斯（Proteus）** 是古希腊神话中的海神，波塞冬的牧人，被称作"海中老人"。他的两个核心神格：

1. **千变万化**：《奥德赛》中，墨涅拉俄斯在法罗斯岛擒住他求问归途，他在怀中化作狮子、蛇、野猪、流水与大树……最终只得恢复原形作答。英语中 **protean**（千变万化的）一词正源于他的名字。
2. **知晓万物**：普罗透斯通晓过去、现在与未来，能预知命运。

### 设计意图：神格 ↔ 框架优势映射

框架的差异化优势（见 §0.2 / §0.3）与普罗透斯的神格一一对应：

| 普罗透斯的神格 | 框架的差异化优势 | 对应模块 |
|---|---|---|
| **变形**：同一存在变换出多种形态 | **编译转换**：一份标准 Vue SFC → Web 形态 + 小程序形态，形态可变、本质不变 | §P4 编译转换 |
| **先知**：预知未来 | **编译期为主**：一切转换在 build-time 完成，运行期零虚拟 DOM（vs Taro 3 的运行时模拟） | §0.3 原则 3 |
| **本质恒定**：变形成任何形态，本体仍是普罗透斯 | **标准写法**：业务代码始终是标准 Vue + 标准 HTML，平台差异由编译器吸收（vs uni-app 的非标准 DSL） | §0.3 原则 1 |
| **通晓万物**：知过去、现在、未来 | **双端一致**：一套代码在 Web 与小程序两端行为一致 | §P3 adapter |

### 与其他候选的取舍

| 候选 | 被否理由 |
|---|---|
| Janus（雅努斯，双面神） | "双端"是所有跨端框架的共性卖点，不构成与主流框架的区别；且"双面"把未来扩展（支付宝/抖音端）定死为 2 |
| Hermes（赫尔墨斯，翻译之神） | "编译器 = 翻译器"映射虽好，但 Hermes 已被 React Native 的 JS 引擎占用，必然混淆 |
| Kairos / Metis | 冷门，传播性弱 |

### 命名衍生物（统一规范）

- **配置**：`proteus.config.ts`（即 v2.0 中的 `framework.config.ts`，全文档已统一更名）
- **CLI**（未来）：`proteus dev:mp` / `proteus build:web`
- **包**：`proteus-vue`（核心）、`@proteus-vue/plugin-*`（Vite 插件等）
- **Tagline**："One Vue source. Every form."（一份源码，千端形态）
- **Logo 意象**：变形/流体形态 + 双端之门

### 传播要点

- **Protean**（千变万化）是英语常用词，英文语境下名字自带解释、天然有传播钩子
- 一句话介绍："写标准 Vue，让 Proteus 化作两端形态"（Write standard Vue, let Proteus shape the rest）

---

## 0. 框架动机：主流国产跨端框架的痛点与本框架对策

> 本节是整个框架的"为什么"。所有后续设计决策（编译策略、适配层、映射表、批量桥接）都由此推导。LLM 在生成任何模块前应先读本节，确保代码不违背这些对策。

### 0.1 主流国产跨端框架痛点清单

**uni-app（DCloud）**
- 非标准 DSL：业务代码必须写 `<view>/<text>/<image>` 而非标准 HTML，从 Vue 生态迁移成本高、心智负担重
- 工具链锁定：强依赖 HBuilderX IDE，CLI 是二等公民，CI/CD 集成困难
- Vue 3 支持滞后且不完整，框架升级被工具链绑架
- 编译黑盒：产物不可读、报错定位难
- 条件编译 `#ifdef MP-WEIXIN` 散落业务代码，跨端代码被平台标签污染
- setData 大对象全量同步，高频更新性能差
- 生态锁定：私有插件市场 + 私有云服务

**Taro（京东）**
- Taro 3 运行时方案：JS 层模拟 DOM + 自研 diff，首屏性能差、内存占用高、包体积大
- React 各版本分裂（Taro 1/2/3 迁移成本高），Vue 支持是二等公民
- 编译链复杂（长 babel 插件链），依赖升级易 break
- 动态渲染能力受限，复杂交互（富文本/Canvas/原生组件）仍需写小程序原生代码

**mpvue / kbone（均基本停更）**
- Vue 2 专用、性能差、运行时开销大，无后续维护

**共性痛点归纳**：DSL 分裂、工具链锁定、编译黑盒、运行时性能、setData 低效、Vue 版本滞后、条件编译污染、类型安全缺失、跨端 CSS 不一致、主包体积限制、原生能力受限、生态锁定。

### 0.2 痛点 → 对策对照表（设计决策依据）

| # | 主流痛点 | 代表框架 | 本框架对策 | 落地模块 |
|---|---|---|---|---|
| 1 | 非标准 DSL（view/text） | uni-app | 业务代码只写**标准 HTML 标签 + 标准 Vue SFC**，`div→view` 等映射全部收敛在编译器内部 | §P4 映射表 |
| 2 | 工具链锁定（HBuilderX） | uni-app | 纯 Vite 插件 + 标准 npm scripts，无 IDE 依赖，任何 CI 可跑 | §P1 / §P4 |
| 3 | 编译黑盒、难调试 | uni-app | 产物贴近手写 + **产物自校验**（坏产物当场报错指明文件）+ `PROTEUS_DEBUG=1` 行号注释 / 中间产物转储 + warnings 汇总摘要；转换函数独立可单测 | §P4 / §P6 |
| 4 | 运行时模拟 DOM + diff | Taro 3 | **编译期为主**：静态模板全部编译成 WXML，运行期无虚拟 DOM | §P4 / §P5 |
| 5 | setData 全量大对象 | uni-app | 脏路径收集 + 16ms 批量 + **路径合并** + 值比较去重 | §P5-1 |
| 6 | Vue 版本滞后/锁定 | uni-app | 直接绑定官方 Vue 3.4+ 主线，编译器用官方 `@vue/compiler-sfc`，不自研编译语言 | §P1 |
| 7 | 条件编译 `#ifdef` 污染 | uni-app | 平台差异收敛到 `proteus.config.ts` + `platform/adapter.ts`，**业务代码零条件编译** | §0.3 原则 4 / §P1-6 |
| 8 | 类型安全缺失 | 多数 | 路由表、路由参数、事件全链路 TS 类型推导 | §P2 / §P3 |
| 9 | 跨端 CSS 不一致（rpx） | uni-app | MP 端编译期 px→rpx；**Web 端保持标准 CSS 不转换**，差异由编译器吸收 | §P4-1-c |
| 10 | 主包 2MB 限制 | 微信平台 | 分包声明写入 `proteus.config.ts`，编译期生成 `app.json` subPackages | §P2 |
| 11 | 原生能力受限 | Taro 3 | 原生组件逃生舱：允许 WXML 产物混用原生组件，`v-html → rich-text` 等兜底 | §P4-1-a |
| 12 | 生态锁定（私有市场） | uni-app | 标准 Vue 组件体系 + npm 生态；Web 端直接复用 Vue 生态组件，MP 端编译 | §0.3 原则 9 |

### 0.3 核心设计原则（任何模块不得违反）

1. **标准 Vue 优先**：业务代码 = 标准 Vue 3 SFC + 标准 HTML 标签。平台差异由编译器吸收，而非要求开发者写平台 DSL。对标 uni-app 的 `<view>/<text>` 写法，本框架开发者**零学习成本**。
2. **Web 原生、MP 编译**：Web 端**零转换**直接跑标准 Vite SPA（完整 devtools + HMR）；仅小程序端走编译器。Web 端不是二等公民。
3. **编译期为主、运行期为辅**：静态模板全部编译期转换；运行期只做数据桥接（setData）与路由导航。**不做运行时 DOM 模拟**（Taro 3 的教训）。
4. **平台差异收敛**：所有 `wx.*` 访问必须经 `src/platform/adapter.ts` 抽象层；业务代码与 router/runtime 模块**禁止直连 wx**（`skyline.ts` 是唯一例外，允许访问 `wx.router`）。业务代码零 `#ifdef`。
5. **约定优于配置**：路由、分包从目录结构 + `proteus.config.ts` 推导，不手写 `pages.json`。
6. **类型安全全链路**：路由表、路由参数、事件处理函数全链路 TS 类型推导。
7. **Skyline 优先**：页面默认 `"renderer": "skyline"`，`wx.router` 自定义路由作为一等公民。
8. **产物可读**：编译产物贴近手写小程序代码，可读、可调试、可审计。
9. **跟随上游**：Vue / Vite / `@vue/compiler-sfc` 全用官方主线版本，不自研编译器语言与 DSL。生态用 npm 标准包，无私有市场。
10. **MVP 收缩**：只做 **Web + 微信 Skyline** 两个目标。架构上为多端留扩展位（adapter 接口 + 映射表可插拔），但不实现。

### 0.4 非目标（MVP 明确不做，LLM 不得擅自扩展）

- **支付宝/抖音/快手小程序**：非目标。仅保证 adapter + 映射表结构上可扩展。
- **WebView 渲染**：Skyline 优先；WebView 降级仅保证可运行，不保证视觉/交互完全一致。
- **App 原生端（iOS/Android）**：MVP 非目标；**规划 v0.6** 用 Vue 官方自定义渲染器（createRenderer）实现——走 Vue 官方渲染器而非自研 diff（见 docs/roadmap.md v0.6）。
- **Vapor 兼容**：MVP 非目标；规划 v0.4 借鉴 codegen + v0.6 Web 端 Vapor 模式（业务代码双模式可编译，见 docs/roadmap.md v0.6）。
- **运行时动态渲染完整方案**（`renderer.ts` 走 glass-easel 动态建节点）：MVP 不做，降级为可选扩展（见 §P5-2 说明）。动态内容一律走"模板 + 数据驱动 + WXS"。
- **自研 UI 组件库**：不提供。Web 端直接用 Vue 生态组件；MP 端编译。
- **SSR / 服务端渲染**：不做。

### 0.5 定位：AI-native 透明跨端编译框架（★项目宪章，任何模块不得违背）

框架的差异化定位不止于"跨端"，而是 **AI-native 透明编译**：

1. **规则即文档**：所有转换规则集中为自描述的规则注册表 `packages/compiler/src/transforms/`（v0.2 起 monorepo 独立包）——每条规则 = 一份 AI 说明书（what/why/when/example/verify/决策号/source），`listTransformRules()` 可枚举、`getTransformRule(id)` 可查询。
2. **防漂移**：规则的 `mapping` 与 `packages/compiler/src/tags.ts` 常量同源引用，`tests/transforms.test.ts` 校验覆盖完整性——改映射表遗漏会当场报错。
3. **LLM 生成新规则时必须同步注册**：在对应阶段文件（`transforms/template.ts` / `script.ts` / `style.ts` / `validate.ts`）登记规则 + AI 说明书，并更新 `tests/transforms.test.ts`（如涉及新映射表键）——**规则注册表与实现永不脱节**。
4. **阶段二演进**（随 `@proteus-vue/compiler` 独立包）：每条规则增加 `apply()` → 注册表升级为分派层 → `explainTransform(source)` 输出决策 trace。现阶段注册表只描述不执行。

> 设计意图：编译器的每个决定都对 AI 代理与人类开发者透明（拒绝黑盒）；详见 `packages/compiler/README.md`。

---

## 1. 框架定位与核心约束

### 1.1 框架目标
- 基于 **Vue 3 + Vite + TypeScript** 构建
- 输入：标准 Vue SFC（`.vue`）源码（标准 HTML 标签写法）
- 输出：
  - **微信小程序（Skyline 渲染）**：`.wxml` + `.wxss` + `.js` + `.json`
  - **Web（SPA）**：标准 Vue 3 SPA 产物（零转换，Vite 原生输出）
- 优先支持微信 Skyline 新架构（`glass-easel` + `wx.router` 自定义路由）
- 其他端（支付宝/抖音/WebView 小程序）优雅降级或明确非目标

### 1.2 平台硬边界（任何模块不得突破）
- 小程序页面路径必须在 `app.json` 的 `pages` 数组**静态声明**（最多 32 个）
- 主包体积 ≤ **2MB**（分包可突破，分包由编译期配置生成）
- 页面栈最多 **10 层**，`navigateTo` 超限报错（仅 MP 端约束，Web 端不受此限制）
- `switchTab` 仅跳转 `tabBar.list` 声明页面，传参被忽略
- `tabBar.list` **至少 2 项**（微信平台校验，gen-routes 已加守卫：不足时告警并忽略 tabBar）
- Skyline 渲染前提：`app.json` 需声明 `lazyCodeLoading: "requiredComponents"`（gen-routes 按 skyline 开关自动补齐）
- `wx.router` 自定义路由**仅在连续 Skyline 页面间生效**（基础库 ≥ 2.29.2）
- **自定义路由跳转不能从 tabBar 页面发起**（半屏/转场从 tab 页发起点不生效，报 `applyAnimatedStyle can not find corresponding nodes`；必须从非 tab 页发起。★真机确诊）
- **自定义路由转场（routeType/worklet/barrier）是 Skyline 平台能力，Web 端无对等机制**：`routeType` 在 Web 被优雅忽略（`isSkyline()=false`），导航行为一致；Web 端转场用 Vue `<Transition>`（Web 一等公民），两者 API 统一（`router.push({ routeType })`）但视觉机制各自平台原生
- 运行时**禁止动态注册页面/路由**（平台限制，编译期静态声明）

---

## 2. 项目目录结构（最终形态）

```
proteus/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── proteus.config.ts               # Proteus 统一配置（LLM 读取此文件理解项目）
├── index.html                       # 示例应用 Web 入口
├── scripts/
│   └── gen-routes.ts                # 路由表生成脚本（编译期）
├── src/                             # ★ 框架本体（未来 npm 包来源）
│   ├── compiler/                    # ★ 编译引擎（纯函数模块，可独立开源为 @proteus-vue/compiler）
│   │   ├── index.ts                 # compileVueSfc 统一入口
│   │   ├── template.ts              # template → wxml
│   │   ├── script.ts                # script → Page/Component 构造器
│   │   ├── style.ts                 # style → wxss
│   │   ├── validate.ts              # 产物自校验（反黑盒）
│   │   ├── types.ts                 # 公开 API 类型
│   │   └── README.md                # 模块边界契约 + 独立开源提取路径
│   ├── platform/                    # ★ 平台适配层
│   │   ├── adapter.ts               # PlatformAdapter 接口（纯类型定义）
│   │   ├── index.ts                 # 按构建 mode 选择实现
│   │   ├── mp-adapter.ts            # MP 端实现：代理 wx.*
│   │   └── web-adapter.ts           # Web 端实现：History API + popstate
│   ├── router/
│   │   ├── index.ts                 # 统一路由 API（只依赖 adapter + auto-routes，不直连 wx）
│   │   ├── types.ts                 # 路由类型定义
│   │   ├── guards.ts                # 路由守卫 beforeEach/afterEach
│   │   ├── skyline.ts               # wx.router 自定义路由 bridge（唯一允许直连 wx.router 的模块）
│   │   ├── auto-routes.ts           # 编译期生成（AUTO-GENERATED，勿手动编辑）
│   │   └── builders/                # 自定义 routeBuilder（halfScreen/slideUp）
│   ├── runtime/
│   │   ├── setDataBridge.ts         # 响应式 → setData 批量桥接（路径合并）
│   │   ├── pageLifecycle.ts         # Vue 生命周期 → 小程序 Page()/Component() 映射
│   │   └── renderer.ts              # 【可选扩展】Vue3 自定义渲染器 → glass-easel
│   └── shims/
│       └── mp.d.ts                  # 小程序 API 类型声明
├── examples/                        # ★ 示例应用（框架使用方视角，验证项目独立于此）
│   ├── main.ts                      # Web 端入口
│   ├── main.mp.ts                   # 小程序端入口（编译为 app.js）
│   ├── App.vue                      # 根组件（SPA 壳）
│   ├── pages/                       # 主包页面（目录结构 = 路由结构）
│   │   └── user/
│   │       └── profile.vue          # → 路由 /user/profile
│   ├── subpackages/                 # 分包页面（需在 config 声明）
│   │   └── order/
│   │       └── pages/list.vue       # → 路由 /subpackages/order/pages/list
│   └── router/
│       └── RouterView.vue           # Web 渲染容器（应用壳，随示例存放）
├── tests/
│   ├── fixtures/pages/...           # P4 转换 golden test 的 .vue 样例
│   ├── router.test.ts               # adapter mock 下的 router 单测
│   ├── runtime.test.ts              # setDataBridge / pageLifecycle 单测
│   ├── mp-transform.test.ts         # 编译引擎单测
│   ├── golden.test.ts               # fixtures 快照
│   └── e2e-web.test.ts              # Playwright Web E2E
└── dist/
    ├── web/                         # Web 产物（Vite 标准输出，零转换）
    └── mp-weixin/                   # 微信小程序产物
        ├── app.js
        ├── app.json
        ├── app.wxss
        └── pages/...
```

---

## 3. LLM 执行总览：6 个阶段 × N 个任务

| 阶段 | 目标 | 交付物 |
|---|---|---|
| **P1 工程脚手架** | 初始化项目、配置、类型基础 + 平台适配层接口 | `package.json` / `tsconfig.json` / `vite.config.ts` / `proteus.config.ts` / `src/shims/mp.d.ts` / `src/platform/adapter.ts` |
| **P2 编译期路由表** | 扫描 pages 目录，自动生成路由表 + app.json（含分包） | `scripts/gen-routes.ts` / `src/router/types.ts` |
| **P3 运行期路由 API** | 封装跨端统一 router，双端 adapter 实现，命名路由 + params + 守卫 | `src/router/index.ts` / `guards.ts` / `skyline.ts` / `platform/{mp,web}-adapter.ts` / `RouterView.vue` |
| **P4 Vue→小程序编译转换** | SFC 标准标签 → WXML/WXSS，标签/事件映射（Web 端零转换） | Vite 插件 `vite-plugin-mp-transform.ts` |
| **P5 运行时桥接** | 响应式 → setData 批量（路径合并）；生命周期映射 | `src/runtime/setDataBridge.ts` / `pageLifecycle.ts` / `renderer.ts`（可选） |
| **P6 调试与验证** | 产物可读性、golden test、性能基准 | `tests/` 夹具与用例 / debug 开关 / 基准脚本 |

> LLM 执行顺序：P1 → P2 → P3 → P4 → P5 → P6。每个任务独立生成，生成后通过 `proteus.config.ts` 中的开关控制是否启用该模块。

---

## P1 工程脚手架

### 任务 P1-1：生成 `package.json`

**LLM 指令**：生成一个支持 Vue 3 + Vite + TypeScript 的 `package.json`，包含以下依赖与脚本：

- **name**：`proteus-vue`（框架名定案，见"框架命名"章节）
- **dependencies**：`vue`（^3.4.0）
- **devDependencies**：`vite`（^5.0.0）、`@vitejs/plugin-vue`（^5.0.0）、`typescript`（^5.4.0）、`vue-tsc`（^2.0.0）、`tsx`（^4.0.0，跑 gen-routes）、`vitest`（^1.0.0，P6 用）
- **scripts**：
  - `"dev:web"` → `vite --mode web`
  - `"build:web"` → `vue-tsc --noEmit && vite build --mode web`
  - `"dev:mp"` → `tsx scripts/gen-routes.ts && vite --mode mp-weixin`
  - `"build:mp"` → `tsx scripts/gen-routes.ts && vue-tsc --noEmit && vite build --mode mp-weixin`
  - `"test"` → `vitest run`
- 无任何私有依赖/私有源（规避生态锁定）

### 任务 P1-2：生成 `tsconfig.json`

**LLM 指令**：生成标准 Vue 3 + Vite 的 `tsconfig.json`，启用 `strict: true`、`moduleResolution: "bundler"`、`jsx: "preserve"`，`types` 包含 `["vite/client", "./src/shims/mp.d.ts"]`。

### 任务 P1-3：生成 `proteus.config.ts`

**LLM 指令**：生成框架统一配置文件，内容如下（LLM 按此文件理解项目约束；v2.0 新增 `subPackages` 与 `style`）：

```typescript
// proteus.config.ts
export interface ProteusConfig {
  /** 目标平台 */
  platform: 'mp-weixin' | 'web'
  /** 是否启用 Skyline 渲染（仅 mp-weixin 生效） */
  skyline: boolean
  /** 小程序 AppID */
  appid: string
  /** 页面根目录（主包路由扫描起点） */
  pagesDir: string
  /** 路由输出文件（编译期生成，勿手动编辑） */
  routesOutput: string
  /** 分包配置（可选）：root 相对项目根目录，如 'src/subpackages/order' */
  subPackages?: Array<{ root: string; name?: string }>
  /** wx.router 自定义路由配置 */
  customRoute: {
    /** 是否注册内置预设路由（wx://bottom-sheet 等） */
    registerPresets: boolean
    /** 自定义 routeBuilder 注册表（name → builder 模块路径） */
    builders: Record<string, string>
  }
  /** 响应式 → setData 桥接策略 */
  setDataBridge: {
    /** 批量合并窗口（ms），防止高频更新风暴 */
    batchWindow: number
    /** 是否按组件粒度收集脏数据 */
    perComponent: boolean
  }
  /** 样式换算策略（跨端 CSS 一致性） */
  style: {
    /** MP 端是否 px → rpx（仅编译期生效，Web 端永不转换） */
    px2rpx: boolean
    /** px→rpx 比例，默认 2 */
    rpxRatio: number
  }
}

const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000', // 使用者替换为真实 AppID
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  subPackages: [], // 示例：[{ root: 'src/subpackages/order', name: 'order' }]
  customRoute: {
    registerPresets: true,
    builders: {
      halfScreen: 'src/router/builders/halfScreen.ts',
      slideUp: 'src/router/builders/slideUp.ts',
    },
  },
  setDataBridge: {
    batchWindow: 16, // ~1 帧
    perComponent: true,
  },
  style: {
    px2rpx: true,
    rpxRatio: 2,
  },
}

export default config
```

### 任务 P1-4：生成 `src/shims/mp.d.ts`

**LLM 指令**：生成小程序 API 的 TypeScript 类型声明垫片，至少包含：

- `declare const wx: any` 及常用 API 的 minimal 类型：`navigateTo` / `redirectTo` / `reLaunch` / `switchTab` / `getCurrentPages` / `setStorage` / `getStorage`
- `wx.router` 命名空间：`addRouteBuilder(name: string, builder: RouteBuilder)` / 预设路由常量
- `App()` / `Page()` / `Component()` 构造器的 minimal 类型
- `RouteBuilder` 接口：`(ctx: RouteContext) => RouteBuilderResult`
- `RouteContext`：`{ primaryAnimation: { value: number }, secondaryAnimation: { value: number } }`
- `RouteBuilderResult`：`{ opaque?: boolean, barrierDismissible?: boolean, handlePrimaryAnimation?: () => WorkletValue, handleSecondaryAnimation?: () => WorkletValue }`
- `WorkletValue`：`{ transform?: string, opacity?: number }` 及 `'worklet'` 指令注释

> 此文件是 LLM 后续生成运行时模块时的类型依据，务必完整。

### 任务 P1-5：生成 `vite.config.ts`（骨架，P4 填充插件）

**LLM 指令**：生成 `vite.config.ts` 骨架，包含：

- 根据 `--mode` 读取 `proteus.config.ts` 的 `platform`
- 使用 `@vitejs/plugin-vue` 处理 `.vue`
- **mode=web 时零额外插件**（Web 零转换原则，P4 插件只在 mode=mp-weixin 时注入）
- 预留 `plugins` 数组（P4 阶段注入 `vite-plugin-mp-transform`，仅 mp-weixin mode）
- `build` 配置：`target: 'es2018'`（小程序兼容）、`cssCodeSplit: false`（小程序单文件样式）
- `resolve.alias`：`@` → `src`

### 任务 P1-6：生成 `src/platform/adapter.ts`（★ v2.0 核心新增）

**LLM 指令**：生成平台适配层**接口定义**（纯类型，无平台依赖），这是规避"业务代码直连 wx、Web 端无法运行"痛点的关键。所有 `wx.*` 访问必须收敛到此接口之下：

```typescript
// src/platform/adapter.ts
/**
 * 平台无关的运行时能力抽象。
 * - MP 端实现（mp-adapter.ts）：代理 wx.*
 * - Web 端实现（web-adapter.ts）：基于 History API / popstate
 * 业务代码、router、runtime 模块只允许依赖此接口，禁止直连 wx。
 */
export interface PageInstance {
  route: string
  setData?(data: Record<string, unknown>): void
}

export interface PlatformAdapter {
  /** 是否为小程序环境 */
  isMP: boolean
  /** 当前页面栈（MP 返回完整栈；Web 返回长度 1 的当前页） */
  getCurrentPages(): PageInstance[]
  /** 导航（MP: navigateTo；Web: history.pushState） */
  navigateTo(opts: { url: string; routeType?: string }): Promise<void>
  /** 替换当前页（MP: redirectTo；Web: history.replaceState） */
  redirectTo(opts: { url: string }): Promise<void>
  /** 重启（MP: reLaunch；Web: replaceState） */
  reLaunch(opts: { url: string }): Promise<void>
  /** 切换 Tab（MP: switchTab；Web: 同 navigateTo 语义） */
  switchTab(opts: { url: string }): Promise<void>
  /** 后退（MP: navigateBack；Web: history.go(-delta)） */
  navigateBack(opts: { delta: number }): void
  /** 订阅路由变化（Web 端 popstate 驱动，供 RouterView 渲染） */
  onPageLoad?(cb: (route: string, query: Record<string, string>) => void): void
}

/** 路由变化事件载荷（Web 端使用） */
export interface RouteChangeEvent {
  route: string
  query: Record<string, string>
}
```

> **契约**：下游 `router/index.ts`、`setDataBridge.ts` 只依赖此接口。所有导航/栈操作一律返回 Promise（MP 端 resolve 在 success 回调）。失败时不 reject（降级策略由调用方决定），避免未捕获异常。

---

## P2 编译期路由表

### 任务 P2-1：生成 `src/router/types.ts`

**LLM 指令**：生成路由类型定义文件（与 v1 相同，是 P3 的接口契约）：

```typescript
// src/router/types.ts

/** 单个路由记录（编译期生成，勿手动编辑） */
export interface RouteRecord {
  /** 命名路由（kebab-case，由文件路径推导） */
  name: string
  /** 小程序页面路径（相对小程序根目录，含分包 root 前缀） */
  path: string
  /** 对应 .vue 文件的路径（相对项目根，Web 端 RouterView 据此加载组件） */
  component: string
  /** 父路由 name（用于嵌套路由） */
  parent?: string
  /** 路由元信息 */
  meta?: RouteMeta
  /** Skyline 自定义路由 key（对应 page.json 的 customRouteKeyName） */
  customRouteKeyName?: string
  /** 所属分包名（主包为 undefined） */
  subPackage?: string
}

export interface RouteMeta {
  /** 是否需要登录 */
  requiresAuth?: boolean
  /** 页面标题 */
  title?: string
  /** 是否为 TabBar 页面 */
  isTab?: boolean
  /** 任意扩展字段 */
  [key: string]: unknown
}

/** 路由参数（跳转时传入） */
export interface RouteParams {
  [key: string]: string | number | boolean | undefined
}

/** 路由跳转选项 */
export interface NavigateOptions {
  /** 命名路由 */
  name?: string
  /** 页面路径（命名路由优先） */
  path?: string
  /** 路由参数（自动序列化为 query） */
  params?: RouteParams
  /** URL query（与 params 合并） */
  query?: RouteParams
  /** Skyline 自定义路由类型 */
  routeType?: string
  /** 是否替换当前页面（redirectTo） */
  replace?: boolean
  /** 是否重新启动（reLaunch） */
  reLaunch?: boolean
  /** 是否切换 Tab（switchTab，需 isTab=true） */
  switchTab?: boolean
}
```

### 任务 P2-2：生成 `scripts/gen-routes.ts`

**LLM 指令**：生成路由表生成脚本，逻辑如下（LLM 用 TypeScript 实现，使用 Node `fs`/`path`/`glob`）。

**输入**：读取 `proteus.config.ts` 的 `pagesDir`（默认 `src/pages`）与 `subPackages`。

**扫描规则**：
1. 递归遍历 `pagesDir` 下所有 `.vue` 文件（主包）；若配置了 `subPackages`，再递归遍历每个分包的 `root` 目录
2. 文件路径 → 路由推导：
   - `src/pages/user/profile.vue` → `name: "user-profile"`, `path: "pages/user/profile"`
   - `src/pages/index.vue` → `name: "index"`, `path: "pages/index"`
   - `src/subpackages/order/pages/list.vue` → `name: "order-pages-list"`, `path: "subpackages/order/pages/list"`, `subPackage: "order"`
3. 读取每个 `.vue` 文件的 `<route>` 块（若存在），解析 JSON 内容，提取 `meta` 和 `customRouteKeyName`
4. 目录层级 → 父子关系：`src/pages/user/profile.vue` 的 parent 为 `src/pages/user/index.vue` 的 name（若存在）

**输出**：生成 `src/router/auto-routes.ts`，内容为：

```typescript
// src/router/auto-routes.ts
// AUTO-GENERATED by scripts/gen-routes.ts. DO NOT EDIT.
import type { RouteRecord } from './types'

export const routes: RouteRecord[] = [
  { name: 'index', path: 'pages/index', component: '../pages/index.vue', meta: {...} },
  { name: 'user-profile', path: 'pages/user/profile', component: '../pages/user/profile.vue', parent: 'user', meta: {...}, customRouteKeyName: 'halfScreen' },
  // ... 更多记录
]

export const tabRoutes: RouteRecord[] = routes.filter(r => r.meta?.isTab)
export const routeMap: Record<string, RouteRecord> = routes.reduce((m, r) => { m[r.name] = r; return m }, {} as Record<string, RouteRecord>)
```

> `component` 字段使用**相对项目根的路径**（如 `../pages/index.vue`），供 Web 端 `import.meta.glob` 匹配加载（见 §P3-6）。

**同时生成 `app.json`**（输出到 `dist/mp-weixin/app.json` 或临时目录供 Vite 插件读取）：

```json
{
  "pages": ["pages/index", "pages/user/profile"],
  "subPackages": [
    { "root": "subpackages/order", "name": "order", "pages": ["pages/list"] }
  ],
  "window": { "renderer": "skyline", "navigationStyle": "custom" },
  "tabBar": { "list": [ { "pagePath": "pages/index", "text": "首页" } ] }
}
```

- 若 `proteus.config.ts` 的 `skyline=true`，则 `window.renderer` 设为 `"skyline"`；否则不设置（默认 WebView）
- `subPackages` 字段仅在配置了分包时输出（**规避主包 2MB 限制**）
- 校验：主包页面数 ≤ 32，超限在编译期报错

### 任务 P2-3：生成各页面的 `page.json`（Skyline 配置）

**LLM 指令**：在 `gen-routes.ts` 中增加逻辑——为每个页面生成对应的 `page.json`（写入 `dist/mp-weixin/pages/<dir>/<file>.json`，分包页面写入对应分包目录），内容：

```json
{
  "renderer": "skyline",
  "componentFramework": "glass-easel",
  "customRouteKeyName": "halfScreen"
}
```

`customRouteKeyName` 取自该 `.vue` 文件 `<route>` 块中的声明；若未声明则不输出该字段。

---

## P3 运行期路由 API

> v2.0 关键变化：所有导航代码**不再直连 `wx`**，改为经 `platform/adapter.ts` 接口（对应痛点 #7 条件编译污染 / Web 端悬空）。

### 任务 P3-1：生成 `src/router/index.ts`

**LLM 指令**：生成统一路由 API 模块，提供类 Vue Router 的开发体验。核心逻辑：

```typescript
// src/router/index.ts
import { routes, routeMap } from './auto-routes'
import type { NavigateOptions, RouteParams } from './types'
import { runBeforeEach, runAfterEach } from './guards'
import { isSkyline, navigateWithCustomRoute } from './skyline'
import { adapter } from '../platform'

class Router {
  /** 当前页面栈深度（MP 返回真实栈深；Web 恒为 1） */
  get stackDepth(): number {
    return adapter.getCurrentPages().length
  }

  /** 命名路由跳转（推荐） */
  async push(options: NavigateOptions): Promise<void> {
    const target = this.resolve(options)
    if (!target) throw new Error(`[router] route not found: ${JSON.stringify(options)}`)

    // 路由守卫
    const guardResult = await runBeforeEach(target)
    if (guardResult === false) return // 守卫取消导航

    const url = this.buildUrl(target.path, { ...options.params, ...options.query })

    // Skyline 自定义路由（仅 MP + Skyline 环境）
    if (options.routeType && isSkyline()) {
      await navigateWithCustomRoute(url, options.routeType)
    }
    // TabBar 页面
    else if (options.switchTab || target.meta?.isTab) {
      await adapter.switchTab({ url: target.path })
    }
    // 替换当前页
    else if (options.replace) {
      await adapter.redirectTo({ url })
    }
    // 重启
    else if (options.reLaunch) {
      await adapter.reLaunch({ url })
    }
    // 普通跳转（栈深保护仅 MP 生效；Web 端不受 10 层限制）
    else {
      if (adapter.isMP && this.stackDepth >= 9) {
        // MP 栈深≥9 自动降级为 redirectTo，避免第 10 层报错
        await adapter.redirectTo({ url })
      } else {
        await adapter.navigateTo({ url })
      }
    }

    await runAfterEach(target)
  }

  /** 后退 */
  back(delta = 1): void {
    adapter.navigateBack({ delta })
  }

  /** 替换当前页 */
  replace(options: NavigateOptions): Promise<void> {
    return this.push({ ...options, replace: true })
  }

  /** 根据命名路由/路径解析目标 */
  private resolve(options: NavigateOptions) {
    if (options.name && routeMap[options.name]) return routeMap[options.name]
    if (options.path) {
      const found = routes.find(r => r.path === options.path || r.name === options.path)
      return found
    }
    return null
  }

  /** 拼接 URL（params + query → query string，自动 encode） */
  private buildUrl(path: string, params?: RouteParams): string {
    if (!params) return `/${path}`
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `/${path}?${qs}` : `/${path}`
  }
}

export const router = new Router()
```

### 任务 P3-2：生成 `src/router/guards.ts`

**LLM 指令**：生成路由守卫模块，支持全局 `beforeEach` / `afterEach`。与 v1 相同，但 `getCurrentFrom` 改走 adapter：

```typescript
// src/router/guards.ts
import type { RouteRecord } from './types'
import { routeMap } from './auto-routes'
import { adapter } from '../platform'

type Guard = (to: RouteRecord, from: RouteRecord | null) => boolean | Promise<boolean> | void | Promise<void>
type AfterGuard = (to: RouteRecord, from: RouteRecord | null) => void

const beforeGuards: Guard[] = []
const afterGuards: AfterGuard[] = []

/** 注册全局前置守卫 */
export function beforeEach(guard: Guard): void { beforeGuards.push(guard) }
/** 注册全局后置守卫 */
export function afterEach(guard: AfterGuard): void { afterGuards.push(guard) }

export async function runBeforeEach(to: RouteRecord): Promise<boolean> {
  const from = getCurrentFrom()
  for (const g of beforeGuards) {
    const result = await g(to, from)
    if (result === false) return false
  }
  return true
}

export async function runAfterEach(to: RouteRecord): Promise<void> {
  const from = getCurrentFrom()
  for (const g of afterGuards) g(to, from)
}

function getCurrentFrom(): RouteRecord | null {
  const stack = adapter.getCurrentPages()
  if (stack.length === 0) return null
  const path = stack[stack.length - 1].route
  // 反查 routeMap：name / path 双键匹配
  return routeMap[path] || Object.values(routeMap).find(r => r.path === path) || null
}
```

### 任务 P3-3：生成 `src/router/skyline.ts`

**LLM 指令**：生成 Skyline `wx.router` 自定义路由 bridge 模块。**本模块是整个项目唯一允许直连 `wx.router` 的模块**（执行规则 5）。只保留 router 运行所需能力；**builder 注册不在框架内**（由应用在 main.mp.ts 编写，见 P3-4）：

```typescript
// src/router/skyline.ts
import config from '../../proteus.config'

/** 判断是否处于 Skyline 渲染环境（Web 端 wx 不存在 → false） */
export function isSkyline(): boolean {
  if (typeof wx === 'undefined' || !wx.getWindowInfo) return false
  return config.skyline // 以 proteus.config 的 skyline 开关为主判断
}

/** 使用自定义路由跳转（仅 MP 环境被调用；Web 端 routeType 直接忽略） */
export function navigateWithCustomRoute(url: string, routeType: string): Promise<void> {
  return new Promise((resolve) => {
    wx.navigateTo({
      url,
      routeType,
      success: () => resolve(),
      fail: () => {
        // 降级：自定义路由失败 → 普通跳转
        wx.navigateTo({ url, success: () => resolve() })
      },
    })
  })
}
```

> 注意 `navigateWithCustomRoute` 仅在 `isSkyline()` 为 true 时被 `index.ts` 调用，Web 端不会进入此分支，因此无需 Web 实现。
> **⚠ 平台约束（真机确诊）**：builder 必须与 `addRouteBuilder` 注册**同一文件内静态可分析**（官方形态 `const fn = ...; wx.router.addRouteBuilder(name, fn)`）；配置驱动的注册表 / 跨模块引用 / rollup 打包均不可行（PROJECT_MEMORY 决策 #33/#37）。

### 任务 P3-4：自定义路由 builder（框架开放能力）

**LLM 指令**：两种提供方式——**内置预设**（推荐）与**应用自写**（高级）：

**① 内置预设（配置声明，零手写）**：预设源码位于 `src/router/presets/`（halfScreen 半屏 / slideUp 全屏上推 / scaleDown 缩放转场，均真机验证）。在 `proteus.config.ts` 的 `customRoute.builders` 声明后，**vite-plugin-mp-transform 在直出 app.js 时自动内联预设函数并生成注册块**（绕开"同文件静态可分析"平台约束，开发者零手写）：

```typescript
// proteus.config.ts
customRoute: {
  builders: {
    halfScreen: 'src/router/presets/halfScreen.ts',
    slideUp: 'src/router/presets/slideUp.ts',
    scaleDown: 'src/router/presets/scaleDown.ts',
  },
},
```

**② 应用自写与覆盖预设（高级）**：在应用入口 `examples/main.mp.ts`（直出为 app.js，不得 import）编写具名函数并注册；**同名注册即覆盖内置预设**（插件检测到 main 中已 `addRouteBuilder('<name>'` 后跳过同名预设的自动注册，开发者优先）：

```typescript
// examples/main.mp.ts（★极简模式：不需要写 App()，app 骨架由插件自动生成）
// 只需写自定义 builder + 注册；onLaunch 调试日志 / 全局错误捕获 / 预设注册全部由框架自动补全
function myHalfScreenVariant(customRouteContext: RouteContext): RouteBuilderResult {
  const primaryAnimation = customRouteContext.primaryAnimation
  const handlePrimaryAnimation = () => {
    'worklet'
    const t = primaryAnimation.value
    return { transform: `translateY(${(1 - t) * 100}%)` }
  }
  return { opaque: false, barrierDismissible: true, barrierColor: 'rgba(0,0,0,0.6)', handlePrimaryAnimation }
}

if (typeof wx !== 'undefined' && wx.router) {
  // 同名注册：覆盖内置预设 halfScreen（插件自动跳过预设注册）
  wx.router.addRouteBuilder('halfScreen', myHalfScreenVariant)
}
```

> **极简模式说明（决策 #70）**：插件检测入口不含 `App(` 时，自动拼装 `src/runtime/appSkeleton.ts` 骨架（App 包装 / onLaunch 调试日志 / 全局错误捕获 / 内置预设注册）——开发者零样板；如需完全自定义 app 生命周期（自写 onLaunch 等），写含 `App()` 的完整入口即可（全量模式，插件尊重原样，向后兼容）。

**可自定义项**（`RouteBuilderResult`，mp.d.ts 已按官方 CustomRouteConfig 补全 14 字段）：
- 动画：`handlePrimaryAnimation` / `handleSecondaryAnimation` / `handlePreviousPageAnimation`（≥3.0.0）
- 遮罩：`barrierColor` / `barrierDismissible` / `barrierLabel`
- 联动：`canTransitionTo` / `canTransitionFrom` / `maintainState`
- 时长：`transitionDuration` / `reverseTransitionDuration`
- 手势：`fullscreenDrag` / `popGestureDirection`
- 优化：`allowEnterRouteSnapshotting` / `allowExitRouteSnapshotting`

**真机经验（务必遵守，详见 PROJECT_MEMORY 决策 #33–#41）**：worklet 局部具名 const 箭头 + 单引号 + 简写返回；尺寸逻辑层 wx.getWindowInfo 闭包捕获；borderRadius 静态（逐帧掉帧）；曲线用内联多项式（Easing/derived 提取不稳定）；避免整页 scale；物理引擎 spring/timing 用于手势驱动场景；自定义路由不能从 tab 页发起；A 页联动仅 handlePreviousPageAnimation 生效。
```

### 任务 P3-5：生成平台适配层双端实现（★ v2.0 核心新增）

**LLM 指令**：实现 `src/platform/index.ts`、`src/platform/mp-adapter.ts`、`src/platform/web-adapter.ts`。

`src/platform/index.ts`（按配置选择实现）：
```typescript
// src/platform/index.ts
import config from '../../proteus.config'
import type { PlatformAdapter } from './adapter'
import { createMpAdapter } from './mp-adapter'
import { createWebAdapter } from './web-adapter'

/** 全局唯一适配器实例。业务代码只 import 这个实例。 */
export const adapter: PlatformAdapter =
  config.platform === 'mp-weixin' ? createMpAdapter() : createWebAdapter()
```

`src/platform/mp-adapter.ts`（代理 wx，所有失败静默 resolve，降级策略由调用方决定）：
```typescript
// src/platform/mp-adapter.ts
import type { PlatformAdapter, PageInstance } from './adapter'

function norm(p: any): PageInstance {
  return { route: p.route || p.__route__ || '', setData: p.setData?.bind(p) }
}

export function createMpAdapter(): PlatformAdapter {
  return {
    isMP: true,
    getCurrentPages: () => {
      if (typeof wx === 'undefined' || !wx.getCurrentPages) return []
      return wx.getCurrentPages().map(norm)
    },
    navigateTo: (opts) => new Promise(resolve => {
      wx.navigateTo({ url: opts.url, success: () => resolve(), fail: () => resolve() })
    }),
    redirectTo: (opts) => new Promise(resolve => {
      wx.redirectTo({ url: opts.url, success: () => resolve(), fail: () => resolve() })
    }),
    reLaunch: (opts) => new Promise(resolve => {
      wx.reLaunch({ url: opts.url, success: () => resolve(), fail: () => resolve() })
    }),
    switchTab: (opts) => new Promise(resolve => {
      wx.switchTab({ url: opts.url, success: () => resolve(), fail: () => resolve() })
    }),
    navigateBack: ({ delta }) => { wx.navigateBack({ delta }) },
  }
}
```

`src/platform/web-adapter.ts`（History API；Web 端页面栈恒为 1，`popstate` 驱动 RouterView）：
```typescript
// src/platform/web-adapter.ts
import type { PlatformAdapter, PageInstance } from './adapter'

function parseQuery(url: string): Record<string, string> {
  const q = url.split('?')[1] || ''
  const out: Record<string, string> = {}
  for (const seg of q.split('&').filter(Boolean)) {
    const [k, v] = seg.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '')
  }
  return out
}

export function createWebAdapter(): PlatformAdapter {
  const listeners: Array<(route: string, query: Record<string, string>) => void> = []
  let current: PageInstance = { route: location.pathname.replace(/^\//, '') }

  const emit = (url: string) => {
    current = { route: url.split('?')[0].replace(/^\//, '') }
    listeners.forEach(l => l(current.route, parseQuery(url)))
  }

  // 浏览器前进/后退
  window.addEventListener('popstate', () => emit(location.pathname + location.search))

  return {
    isMP: false,
    getCurrentPages: () => [current],
    navigateTo: async ({ url }) => { history.pushState({}, '', url); emit(url) },
    redirectTo: async ({ url }) => { history.replaceState({}, '', url); emit(url) },
    reLaunch: async ({ url }) => { history.replaceState({}, '', url); emit(url) },
    switchTab: async ({ url }) => { history.replaceState({}, '', url); emit(url) },
    navigateBack: ({ delta }) => { history.go(-delta) },
    onPageLoad: (cb) => { listeners.push(cb) },
  }
}
```

### 任务 P3-6：生成 `src/router/RouterView.vue`（Web 端渲染容器）

**LLM 指令**：生成 Web 端页面渲染容器，仅 Web 构建使用。根据 adapter 的当前路由 + `routeMap` 渲染对应页面组件（懒加载）：

```vue
<!-- src/router/RouterView.vue — Web 端渲染容器（仅 Web 构建使用） -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { routeMap } from './auto-routes'
import { adapter } from '../platform'

// 懒加载所有页面（Web 端产物按页面分包 code-split）
const modules = import.meta.glob('../pages/**/*.vue')
const current = ref(adapter.getCurrentPages()[0]?.route || 'pages/index')

adapter.onPageLoad?.((route) => { current.value = route })

const view = computed(() => {
  const rec = routeMap[current.value]
  if (!rec) return null
  // rec.component 为相对项目根路径，转成 glob 键匹配（实现细节可按构建配置微调）
  return modules[rec.component] || null
})
</script>

<template>
  <component :is="view" v-if="view" />
  <div v-else>404 Not Found</div>
</template>
```

> Web 端 `<div>` 就是标准 HTML，无需转换（§0.3 原则 2）。`App.vue` 中放置 `<RouterView />` 即可完成 SPA 壳。

---

## P4 Vue → 小程序编译转换（Vite 插件）

> **前置原则（v2.0 强化）**：业务代码使用**标准 HTML 标签**。Web 端 Vite 直接渲染，**零转换**；本插件仅在 `mode=mp-weixin` 时注入。这就是对标 uni-app 非标准 DSL 痛点的核心决策（§0.2 痛点 #1）。

### 任务 P4-1：生成 `vite-plugin-mp-transform.ts`

**LLM 指令**：生成一个 Vite 插件，在 `transform` 钩子中对 `.vue` 文件做编译期转换。插件逻辑分三段：

#### 4-1-a Template 转换（`.vue` → `.wxml`）

将 `<template>` 中的标准 HTML 标签/事件映射为小程序标签/事件。完整映射表：

| Vue/HTML 标签 | 小程序 WXML | 备注 |
|---|---|---|
| `<div>` | `<view>` | 基础容器 |
| `<span>` / `<p>` | `<text>` | 行内文本 |
| `<h1>`–`<h6>` | `<text>` | 语义降级，样式由 class 控制 |
| `<img :src>` | `<image src="{{...}}" mode="aspectFit">` | |
| `<a @click>` | `<view bindtap="...">` | 路由跳转一律走 router，不生成 href |
| `<button>` | `<button>` | 事件映射 bindtap；form-type 保留 |
| `<input>` | `<input>` | `v-model` → `value + bindinput`（见下） |
| `<textarea>` | `<textarea>` | 同上 |
| `<video>` | `<video>` | 原生组件，Skyline 支持；src/id 保留 |
| `<canvas>` | `<canvas type="2d">` | 需 canvasId 管理（逃生舱场景） |
| `<scroll-view>` | `<scroll-view>` | 滚动容器 |
| `<slot>` | `<slot>` | 组件插槽 |
| `<transition>` | （忽略） | Skyline 下由 routeType 控制转场 |

指令/属性映射：

| Vue 写法 | 小程序写法 |
|---|---|
| `v-if` | `wx:if` |
| `v-else` | `wx:else` |
| `v-for="(item,idx) in list"` | `wx:for="{{list}}" wx:for-item="item" wx:for-index="idx"` |
| `:class="{active:isActive}"` | `class="{{isActive?'active':''}}"` |
| `:style="{color:c}"` | `style="color:{{c}}"` |
| `@click="handleClick"` | `bindtap="handleClick"` |
| `@input="onInput"` | `bindinput="onInput"` |
| `@change` / `@submit` / `@focus` / `@blur` / `@touchstart` / `@touchmove` / `@longpress` | `bindchange` / `bindsubmit` / `bindfocus` / `bindblur` / `bindtouchstart` / `bindtouchmove` / `bindlongpress` |
| `v-model="text"` | `value="{{text}}" bindinput="__onTextInput"`（编译器生成对应 handler） |
| `v-html="html"` | `<rich-text nodes="{{html}}">`（逃生舱兜底） |
| `@click.stop` / `@click.prevent` | `catchtap` / `catchtap`（stop 用 catch 前缀） |

实现要点：
- 使用 `@vue/compiler-dom` 的 `parse` + `transform` + `generate` 流程
- 自定义 `nodeTransforms` 数组，遍历 AST 节点做标签名/属性名替换
- 输出字符串即 `.wxml` 内容

#### 4-1-b Script 转换（`.vue` → `.js` Page/Component 构造器）

将 `<script setup>` 编译为小程序 `Page({ data, methods, onLoad, onReady, ... })` 构造器调用。要点：

- 使用 `@vue/compiler-sfc` 解析 `<script setup>` 的编译结果
- 将 `ref`/`reactive` 声明的响应式变量收集为 `data()` 的初始值
- 将函数声明收集为 `methods`
- Vue 生命周期映射：
  - `onMounted` → `onReady`
  - `onUnmounted` → `onUnload`
  - `onLoad(options)` → 小程序 `onLoad`，options 即路由 query 参数
- `defineProps` / `defineEmits` → 小程序组件场景的 `properties` / `triggerEvent` 封装
- 页面文件 → `Page()`；`src/components/` 下文件 → `Component()`（见 §P5-3）

#### 4-1-c Style 转换（`.vue` → `.wxss`）

- **仅 MP 端**将 `px` 单位自动转换为 `rpx`（默认 `1px = 2rpx`，比例取自 `proteus.config.ts` 的 `style.rpxRatio`）；**Web 端永不转换**（§0.2 痛点 #9）
- 处理 `scoped` 属性：小程序不支持属性选择器，将 `.scoped-{hash}` 类降级为普通类名拼接
- CSS 变量（`--xxx`）保留（Skyline 支持 CSS 变量）
- `float` / `position: fixed` 等 Skyline 不支持的属性在编译期输出警告

#### 4-1-d 插件骨架

```typescript
// vite-plugin-mp-transform.ts
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { transform as vueTransform } from '@vue/compiler-dom'
import config from './proteus.config'

interface PluginOptions {
  px2rpx?: boolean      // 是否将 px 转为 rpx，默认取 config.style.px2rpx
  rpxRatio?: number     // px→rpx 比例，默认取 config.style.rpxRatio
}

export default function mpTransform(opts: PluginOptions = {}): Plugin {
  const { px2rpx = config.style.px2rpx, rpxRatio = config.style.rpxRatio } = opts
  return {
    name: 'vite-plugin-mp-transform',
    enforce: 'pre',
    async transform(code: string, id: string) {
      if (!id.endsWith('.vue')) return null
      const { descriptor } = parse(code)

      // 1. Template → WXML
      const tpl = compileTemplate({
        source: descriptor.template?.content || '',
        filename: id,
        compilerOptions: { mode: 'wx' }, // 自定义 mode，需配套 nodeTransforms
      })
      const wxml = transformTemplateToWxml(tpl.code, { px2rpx, rpxRatio })

      // 2. Script → Page/Component 构造器 JS
      const script = compileScript(descriptor, { id })
      const js = transformScriptToPage(script.content, { px2rpx, rpxRatio })

      // 3. Style → WXSS
      const wxss = transformStyleToWxss(descriptor.styles.map(s => s.content).join('\n'), { px2rpx, rpxRatio })

      // 4. 输出为多模块（Vite 虚拟模块约定）
      return {
        code: js, // 主模块为 Page 构造器
        map: null,
        // 通过虚拟模块暴露 wxml/wxss
        // 实际实现可用 this.emitFile 输出 .wxml/.wxss 到 dist
      }
    },
  }
}
```

> LLM 实现提示：`transformTemplateToWxml` / `transformScriptToPage` / `transformStyleToWxss` 三个函数各自独立、**不依赖 Vite 上下文**（便于 P6 golden test 直接调用）。先实现核心映射（标签名、v-if/v-for、@click→bindtap、:src→src="{{}}"），再逐步补充边缘情况。

---

## P5 运行时桥接

### 任务 P5-1：生成 `src/runtime/setDataBridge.ts`（v2.0 强化）

**LLM 指令**：生成响应式 → `setData` 批量桥接模块。核心职责：**按组件粒度收集脏数据，在 `batchWindow`（默认 16ms ≈ 1 帧）内合并多次状态变更为一次 `setData` 调用**。v2.0 新增**路径合并**与**值比较去重**（§0.2 痛点 #5）：

```typescript
// src/runtime/setDataBridge.ts
import config from '../../proteus.config'
import { adapter } from '../platform'

interface DirtyRecord {
  path: string   // 数据路径，如 "list[0].name"
  value: unknown
}

class SetDataBridge {
  private dirty = new Map<string, Map<string, DirtyRecord>>() // key=pagePath
  private lastValues = new Map<string, Map<string, unknown>>() // 上次已 setData 的值（去重）
  private timer: ReturnType<typeof setTimeout> | null = null

  /** 标记某个页面/组件的某个数据路径为脏 */
  markDirty(pagePath: string, dataPath: string, value: unknown): void {
    // 1. 值比较去重：与上次已推送的值相同 → 跳过
    if (this.lastValues.get(pagePath)?.get(dataPath) === value) return

    let map = this.dirty.get(pagePath)
    if (!map) { map = new Map(); this.dirty.set(pagePath, map) }

    // 2. 路径合并（父覆盖子）：
    //    - 已有祖先路径脏 → 子路径被覆盖，跳过
    for (const existing of map.keys()) {
      if (dataPath.startsWith(existing + '.')) return
    }
    //    - 新路径是已有脏路径的祖先 → 移除被覆盖的子路径
    for (const existing of [...map.keys()]) {
      if (existing.startsWith(dataPath + '.')) map.delete(existing)
    }

    map.set(dataPath, { path: dataPath, value })
    this.scheduleFlush()
  }

  /** 调度批量刷新 */
  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), config.setDataBridge.batchWindow)
  }

  /** 执行批量 setData */
  private flush(): void {
    this.timer = null
    for (const [pagePath, dirtyMap] of this.dirty) {
      const page = adapter.getCurrentPages().find(p => p.route === pagePath)
      if (!page?.setData) continue
      const data: Record<string, unknown> = {}
      for (const { path, value } of dirtyMap.values()) data[path] = value
      page.setData(data)
      // 记录本次推送值，供值比较去重
      let last = this.lastValues.get(pagePath)
      if (!last) { last = new Map(); this.lastValues.set(pagePath, last) }
      for (const [path, value] of Object.entries(data)) last.set(path, value)
    }
    this.dirty.clear()
  }

  /** 立即刷新（同步，用于 onUnload 等场景） */
  flushSync(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.flush()
  }
}

export const setDataBridge = new SetDataBridge()
```

> 路径合并示例：同一帧内先写 `list[0].name` 再写 `list[0]`，最终只推送 `list[0]` 一条；先写 `list[0]` 再写 `list[0].name`，则子路径被跳过。对比 uni-app 全量 setData，payload 显著收敛。

### 任务 P5-2：生成 `src/runtime/renderer.ts`（【可选扩展】）

**LLM 指令**：此任务为**可选扩展**，MVP 阶段 LLM 可跳过，仅生成接口骨架与说明。

**为什么降级为可选**：glass-easel 的运行时动态创建节点 API 支持有限；"编译期为主"路线已覆盖 95% 场景。若实现运行时渲染器，相当于重走 Taro 3 运行时 DOM 模拟的老路（§0.2 痛点 #4），复杂度高、收益低。

**保留的价值**：动态创建/更新节点的补充场景（如 Canvas 编辑器、富文本实时渲染）。

**实现要点**（若后续实现）：
- 基于 Vue 3 的 `createRenderer` API（`@vue/runtime-core`）
- `createElement(tag)` → 返回小程序组件对应的节点描述（tag 映射同 P4 模板映射表）
- `insert(child, parent, anchor)` → 调用父组件实例的 `appendChild`/插入节点方法
- `remove(child)` → 调用父组件实例的 `removeChild`
- `patchProp(el, key, prev, next)` → 属性/事件映射（`onClick` → `bindtap` 等）
- `setText` / `setElementText` → 文本节点处理

> **MVP 决策**：动态内容一律用"模板 + setData 数据驱动 + WXS（局部计算）"实现，不依赖此模块。P5 完成标准不包含 renderer。

### 任务 P5-3：生成 `src/runtime/pageLifecycle.ts`

**LLM 指令**：生成 Vue 生命周期 → 小程序 `Page()`/`Component()` 生命周期映射模块。v2.0 明确区分**页面级**与**组件级**：

```typescript
// src/runtime/pageLifecycle.ts
import { setDataBridge } from './setDataBridge'
import { adapter } from '../platform'

/** Vue onMounted → 小程序 onReady（页面级） */
export function onReady(hook: () => void): void {
  ;(getCurrentPage() as any)?.__onReadyHooks?.push(hook)
}

/** Vue onUnmounted → 小程序 onUnload（页面级） */
export function onUnload(hook: () => void): void {
  ;(getCurrentPage() as any)?.__onUnloadHooks?.push(hook)
}

/** 获取当前页面实例 */
function getCurrentPage(): any {
  const stack = adapter.getCurrentPages()
  return stack.length > 0 ? stack[stack.length - 1] : null
}

/**
 * 生成小程序 Page 构造器配置（供编译期生成的页面 JS 调用）
 * 将 Vue setup 的返回值挂载为 data + methods
 */
export function createPage(vueSetupResult: { data: Record<string, unknown>, methods: Record<string, Function> }): PageOptions {
  const { data, methods } = vueSetupResult
  return {
    data() { return data },
    onLoad(options: Record<string, string>) {
      // 路由参数自动注入 data
      const params: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(options || {})) {
        try { params[k] = JSON.parse(decodeURIComponent(v)) } catch { params[k] = v }
      }
      this.setData(params)
    },
    onReady() { this.__onReadyHooks?.forEach((h: () => void) => h()) },
    onUnload() {
      setDataBridge.flushSync() // 卸载前刷完脏数据
      this.__onUnloadHooks?.forEach((h: () => void) => h())
    },
    ...methods,
  }
}

/**
 * 生成小程序 Component 构造器配置（供编译期生成的组件 JS 调用，位于 src/components/）
 * 对应 P4-1-b 的 defineProps/defineEmits → properties/methods 转换
 */
export function createComponent(vueSetupResult: {
  properties: Record<string, any>
  data: Record<string, unknown>
  methods: Record<string, Function>
}): ComponentOptions {
  return {
    properties: vueSetupResult.properties,
    data: vueSetupResult.data,
    methods: vueSetupResult.methods,
    lifetimes: {
      // Vue onMounted → 组件 attached（组件挂载）
      attached() { this.__onReadyHooks?.forEach((h: () => void) => h()) },
      detached() {
        setDataBridge.flushSync()
        this.__onUnloadHooks?.forEach((h: () => void) => h())
      },
    },
  }
}
```

> **组件级说明**：Vue 的组件 `onMounted` 在小程序端没有直接对等物——页面用 `Page()` 的 `onReady`，组件用 `Component()` 的 `lifetimes.attached`。P4-1-b 按文件位置（`pages/` vs `components/`）决定生成 `createPage` 还是 `createComponent` 调用。

---

## P6 调试与验证（v2.0 新增阶段）

> 目标：规避"编译黑盒、调试难"痛点（§0.2 痛点 #3）。LLM 生成 P1-P5 后必须完成本阶段，否则产物不可验证。

### 任务 P6-1：产物可读性与调试辅助（反编译黑盒机制，P4 已部分落地）

**LLM 指令**：
- 编译产物的 .wxml 保持与源码结构一致（缩进、注释保留），命名贴近手写小程序（✅ 已落地）
- **产物自校验**：js 语法校验 + wxml 标签配对校验，坏产物当场抛 `CompilerError` 并指明源文件（✅ 已落地：`packages/compiler/src/validate.ts`，绝不静默输出坏产物）
- `PROTEUS_DEBUG=1` 构建：WXML 注入 `<!-- @12 div -->` 源码行号注释 + 输出中间产物到 `dist/mp-weixin/.transform-debug/`（✅ 已落地，转换过程完全透明）
- `build:mp` 时调试产物不产出（默认关闭，✅ 已落地）
- buildEnd 输出编译警告汇总摘要（文件 × 条数 + 明细，✅ 已落地）
- 待办：JS 产物方法级源码定位（每方法行号注释 / 接入微信开发者工具 sourcemap）

### 任务 P6-2：转换 golden test（vitest）（✅ 已落地）

**LLM 指令**：生成测试夹具与用例，直接调用编译引擎 `compileVueSfc`（不依赖 Vite 上下文）：

```
tests/fixtures/
├── pages/basic.vue          # div/span/img/a + v-if/v-for + @click + :src
├── pages/input.vue          # v-model
├── pages/rich.vue           # v-html
└── pages/tab.vue            # <route> 块声明 isTab
```

- 每个 fixture 对应一份期望产物快照（wxml / js / wxss + warnings）——✅ 已落地 `tests/golden.test.ts` + `__snapshots__`
- `npm test` 断言转换结果与快照一致——✅ 已落地（全量 52 用例）
- 新增映射规则时先补 fixture 再实现（测试驱动）

### 任务 P6-3：router 单测（adapter mock）（✅ 已落地）

**LLM 指令**：在 Node 环境 mock `platform/adapter`，验证 router 逻辑：

- `router.push({ name: 'user-profile', params: { id: 1 } })` → adapter.navigateTo 收到 `url === '/pages/user/profile?id=1'`
- 守卫返回 `false` → 不调用 adapter 导航
- `adapter.isMP = true` 且栈深 9 → 降级为 `redirectTo`；`isMP = false` → 不降级
- `routeType` + `isSkyline()` → 走 `navigateWithCustomRoute`

---

## LLM 执行规则（必须遵守）

1. **逐任务生成**：LLM 每次只生成一个任务对应的文件（或一组强相关文件），生成后验证该文件可独立编译（TypeScript 无类型错误），再进入下一个任务。
2. **接口契约优先**：任务间通过 `types.ts` / `proteus.config.ts` / `platform/adapter.ts` 中定义的接口衔接。修改接口时须同步更新所有依赖方。
3. **不一次性生成全部代码**：禁止在一个回复中生成 P1-P6 全部文件。按阶段顺序，每阶段生成后等待用户确认/编译验证。
4. **适配层规则（v2.0 强化）**：所有 `wx.*` 访问必须经 `platform/adapter.ts` 抽象；业务代码与 router/runtime 模块禁止直连 wx；`skyline.ts` 是唯一允许访问 `wx.router` 的模块。Web 端构建时 MP 专有代码通过 mode 条件天然剔除。
5. **Skyline 相关代码隔离**：`wx.router` / `worklet` / `glass-easel` 相关代码集中在 `src/router/skyline.ts` 和 `src/runtime/renderer.ts`（可选），其他模块不直接调用。
6. **生成文件前先读项目记忆与配置**：LLM 在开始任何任务前，应先读取项目根目录的 `PROJECT_MEMORY.md`（当前进度与决策偏差）与 `proteus.config.ts`（`platform` / `skyline` / `pagesDir` / `subPackages` / `style` 等配置），确保生成代码与配置、进度一致。
7. **每个任务产出后输出"任务完成摘要"**：包含生成的文件路径、对外暴露的接口/类型、依赖的上游任务、供下游任务使用的契约。
8. **遇到平台限制时明确标注**：若某能力受平台硬边界限制（如"运行时动态注册页面"、"主包 2MB"），在生成的代码注释中明确标注"平台限制，无法突破"，并提供降级方案。
9. **转换函数独立可测（v2.0 新增）**：P4 的三个转换函数必须不依赖 Vite 插件上下文，纯函数签名，便于 P6 golden test 直接调用。

---

## 模块依赖关系图

```
P1 工程脚手架
  ├── proteus.config.ts ───────────┐
  ├── tsconfig.json                │
  ├── shims/mp.d.ts                │
  └── platform/adapter.ts（接口） ──┤
                                   ▼
P2 编译期路由表 ◄─────────────── 读取 proteus.config.ts（pagesDir/subPackages）
  ├── router/types.ts              │
  └── scripts/gen-routes.ts ───────┘
                                   │
                                   ▼
P3 运行期路由 API ◄──────────── 依赖 P2 的 auto-routes.ts + P1 的 adapter 接口
  ├── router/index.ts              │
  ├── router/guards.ts             │
  ├── router/skyline.ts            │
  ├── platform/mp-adapter.ts ──── wx 代理（唯一 wx 触点）
  ├── platform/web-adapter.ts ──── History API
  └── router/RouterView.vue ────── Web 端渲染容器
                                   │
                                   ▼
P4 编译转换插件 ◄─────────────── 依赖 P1 的 vite.config.ts 注入插件（仅 mp mode）
  └── vite-plugin-mp-transform.ts（transform 三函数独立可测）
                                   │
                                   ▼
P5 运行时桥接 ◄─────────────── 依赖 P3 的 adapter + P4 的转换结果
  ├── runtime/setDataBridge.ts（走 adapter.getCurrentPages）
  ├── runtime/pageLifecycle.ts
  └── runtime/renderer.ts（可选扩展）

P6 调试与验证 ◄─────────────── 依赖 P4 转换函数 + P3 router
  ├── tests/fixtures + golden test
  └── router 单测（adapter mock）
```

---

## 验证清单（每个阶段完成后自查）

### P1 完成标准
- [ ] `npm install` 成功
- [ ] `npm run dev:web` 可启动 Vite dev server，打开 `index.html` 不报错
- [ ] `proteus.config.ts` 配置项完整，`skyline`/`platform`/`pagesDir`/`subPackages`/`style` 可读
- [ ] `src/shims/mp.d.ts` 中 `wx.router` / `RouteBuilder` 类型可被正确引用
- [ ] `platform/adapter.ts` 接口编译通过，router/runtime 模块无直连 `wx` 的 import（可 grep 校验）

### P2 完成标准
- [ ] 在 `src/pages/` 下新建一个 `.vue` 文件（含 `<route>` 块），运行 `npm run dev:mp`，`src/router/auto-routes.ts` 自动生成，包含该页面记录
- [ ] `dist/mp-weixin/app.json` 的 `pages` 数组包含该页面路径
- [ ] 配置分包后 `app.json` 正确输出 `subPackages`
- [ ] 该页面对应的 `page.json` 正确输出 `"renderer": "skyline"`（若 skyline=true）
- [ ] 主包页面数 > 32 时编译期报错

### P3 完成标准
- [x] 在页面中调用 `router.push({ name: 'user-profile', params: { id: 1 } })`，目标页面 `onLoad(options)` 中 `options.id === '1'`（MP 实测）
- [x] `npm run dev:web` 下 `router.push` 正常跳转，浏览器地址栏 URL 正确，刷新可恢复（✅ E2E 实测：tests/e2e-web.test.ts）
- [x] `router.beforeEach` 守卫可拦截跳转（返回 `false` 时跳转取消）
- [x] MP 栈深 ≥ 9 时自动降级为 `redirectTo`（不报错）；**Web 端不降级**
- [x] `routeType: 'halfScreen'` 时调用 `wx.navigateTo({ routeType: 'halfScreen' })`
- [x] P6-3 router 单测全部通过

### P4 完成标准
- [ ] `.vue` 模板中的 `<div>` 在产物 `.wxml` 中变为 `<view>`（**Web 端产物仍是 `<div>`**，零转换）
- [ ] `@click="fn"` 在产物中变为 `bindtap="fn"`
- [ ] `:src="url"` 在产物中变为 `src="{{url}}"`
- [ ] `v-if` / `v-for` 正确转换为 `wx:if` / `wx:for`
- [ ] `v-model` 正确转换为 `value + bindinput + __onTextInput`
- [ ] `v-html` 转换为 `<rich-text>`
- [ ] `<style>` 中的 `px` 被转换为 `rpx`（MP 端）；Web 端样式不转换
- [ ] Skyline 不支持的 CSS 属性（如 `float`）在编译期输出警告
- [ ] P6-2 golden test 全部通过

### P5 完成标准
- [ ] 页面状态变更时，`setDataBridge` 在 16ms 内批量合并为一次 `setData`
- [ ] 路径合并生效：同帧 `list[0].name` + `list[0]` 只推送 1 条；值未变化不推送
- [ ] 页面 `onUnload` 时脏数据被 `flushSync` 清空
- [ ] Vue `onMounted` 钩子在页面 `onReady` 时执行；组件 `onMounted` 在 `attached` 时执行
- [ ] 路由参数在 `onLoad` 中被自动 decode 并注入 `data`
- [ ] renderer.ts 未实现时不影响 P5 任何功能（可选模块隔离验证）

### P6 完成标准
- [x] `PROTEUS_DEBUG=1` 产物 WXML 含行号注释，可定位 `.vue` 源码；`build:mp` 默认无调试注释
- [x] golden test / router / runtime 单测全部可跑（`npm test`，52 用例）
- [x] `npm run verify` 一键全量验证（test + build:web + build:mp）
- [x] Web E2E 实测通过（`npm run test:e2e:web`，6 用例）

---

## 附录：LLM 快速启动 Prompt 模板

> 以下 Prompt 供使用者在新会话中快速让 LLM 进入开发状态。复制后替换 `{项目路径}` 即可。

```
你是一个 Vue 3 跨端编译框架（小程序 Skyline + Web）的开发助手。
项目根目录：{项目路径}
请先阅读以下文件理解项目约束与当前进度：
0. {项目路径}/PROJECT_MEMORY.md —— 项目本地记忆：当前进度 / 已落地文件 / 关键决策与偏差 / 验证状态（**新会话必读**）
1. {项目路径}/proteus.config.ts —— Proteus 统一配置（platform/skyline/pagesDir/subPackages 等）
2. {项目路径}/LLM_IMPLEMENTATION_GUIDE.md —— 本文档，定义 6 个阶段的任务拆分；§0 痛点对照是设计决策依据，必须遵守
3. {项目路径}/src/router/types.ts —— 路由类型契约（若已生成）
4. {项目路径}/src/platform/adapter.ts —— 平台适配层接口（若已生成，所有 wx 访问必须经此接口）

当前待执行阶段：P{阶段编号} 任务 P{阶段编号}-{任务编号}
请严格按本文档该任务的"LLM 指令"生成对应文件，生成后输出"任务完成摘要"（生成路径/对外接口/上游依赖/下游契约）。
禁止一次性生成多个阶段的文件；生成前先读 proteus.config.ts 确认配置。
```

---

## 变更记录

| 版本 | 变更 |
|---|---|
| v2.52 | **v0.2 工程化基线**：`src/compiler` → `packages/compiler/` monorepo 独立包 `@proteus-vue/compiler`（tsc 声明文件 + esbuild 单文件构建，workspace 链接验证通过）；`.github/workflows/ci.yml`（verify + e2e-web 双 job）；CONTRIBUTING.md + Issue 模板；vite alias / tsconfig paths 加 `@proteus-vue/compiler`（决策 #72） |
| v2.49 | **git 仓库关联**：https://github.com/proteus-vue/proteus（main 分支）；.gitignore（node_modules/dist/.env）；package.json 补 repository/homepage/bugs；首次提交推送 |
| v2.48 | **开源协议 + 对标大厂路线图**：LICENSE 选 Apache-2.0（宽松可商用 + 专利授权，package.json/README 同步）；新增 docs/roadmap.md——九域能力矩阵（对标 uni-app/Taro）+ v0.2~v2.0 分里程碑路线（独立包/编译能力/性能/多端/生态）+ monorepo 架构 + 量化性能目标 + 验收清单 |
| v2.47 | **文档体系落地**：根 README.md（命名来源/痛点对照/核心特性/快速开始/目录/测试/路线图）+ docs/ 四篇中文文档（getting-started / configuration / compiler / routing），内容基于真实代码与已归档决策 |
| v2.46 | **语义标签选择器改为类选择器（修复 h3 被染灰）**：h3/p 都映射 text 导致 `.card h3` 与 `.card p` 重写后同为 `.card text`（同特异性，后写覆盖先写 → 卡片 h3 被 p 的 color:#666 污染）；语义标签（h1-h6/p/a）选择器重写为 `.proteus-*` 类（模板已附加该类，精确匹配），非语义标签（div/img/input…）仍映射为标签；多对一映射不再撞选择器 |
| v2.45 | **修复多行字面量提取（showcase v-for 内容丢失）**：const 正则 `(.*)$` 不跨行，多行对象数组只抓到首行 → data.cards=undefined → v-for 无内容；改括号平衡扫描（extractInitializer：深度追踪 + 字符串/注释跳过，字符串内括号不干扰）+ 只提取零缩进顶层 const（函数体/生命周期体局部 const 不再误提取）+ ref 内层正则 s 标志与可选分号 |
| v2.44 | **基础样式 margin 改单边 em（p 换行高度对齐 Web 标准）**：HTML 标准附录 D 中 p 为 display:block + margin-block 1em（h1-h6 为 0.67~2.33em 相对自身字号），原注入 8rpx=4px 比 Web 1em=16px 小 4 倍；Skyline 自研引擎不折叠 margin（WebView 才折叠），双边 em 会翻倍——改**单边 bottom + em 相对自身字号**，主流组合（p→p、h1→p）在两端视觉间距恰好一致；p 不设 font-size 保持继承 |
| v2.43 | **标签语义基础样式注入（h1/p/a 视觉还原）**：h1-h6/p/a 映射为 text/view 后无 UA 默认样式（Web 有浏览器默认大标题/加粗/链接色），注入 `proteus-h*` 基础类还原语义——tags.ts 新增 SEMANTIC_CLASS、template.ts 映射时自动附加（与静态 class 合并、与 :class 插值拼接、v-html 不附加）、style.ts 注入对齐 Web UA 的基础 WXSS（rpx 直书不过 px2rpx）；用户样式特异性更高可覆盖 |
| v2.42 | **修复标签样式丢失（样式选择器标签映射）**：`<h1>/<p>/<a>` 模板已映射为 text/view 但 WXSS 选择器未重写导致样式匹配不到；新建 `src/compiler/tags.ts` 共享 `TAG_MAP`/`EVENT_MAP`，style.ts 选择器标签重写（`.links a → .links view`、`h1 → text`）；命中条件=标签名在起始/组合器之后（类名 `.a`、`#input`、`tag-a` 不误伤），属性选择器掩码还原，@media/@keyframes 骨架保留；纯函数签名不变，Web 端零影响 |
| v2.41 | **导航类型全转场（replace/reset/tab）**：adapter 方向参数扩展为导航类型（forward/back/replace/reLaunch/switchTab）；RouterView 按类型选转场——redirectTo→replace（旧页缩小淡出+新页淡入）、reLaunch→reset（淡入）、switchTab→tab（淡入淡出），三者 out-in；routeType 前进/后退仍层叠；isLayered 改为显式名单 |
| v2.40 | **修复刷新后首次后退无动画（historyIndex 恢复）**：web-adapter 初始化从当前 history.state.proteusIndex 恢复栈深（刷新后 history 保留旧条目，归零会导致首次后退被误判 forward → 走 fade 无反向动画）；redirectTo/reLaunch/switchTab 的 replaceState 也携带 proteusIndex 保持栈深一致 |
| v2.39 | **修复首次转场无动画（异步组件预热）**：根因——首次导航目标页为异步组件（chunk 加载中），Vue Transition 在异步首次挂载时跳过动画（"第二次才有下沉"= chunk 缓存后同步挂载）；修复：RouterView 启动时预热全部页面 + `pageCache` 缓存已解析组件，首次导航同步挂载保证转场 |
| v2.38 | **Web 反向转场补遮罩（back 分层）**：back 转场也显示遮罩——前页(A)进入时降到 z:0 暴露在遮罩下，遮罩由 barrier-in 切换为 **barrier-out（淡出抬起）**；scale-back/halfscreen-back 的 A 页在恢复过程中被压暗，B 滑出时分层清晰；isBack 由 transitionName 的 `-back` 后缀判断 |
| v2.37 | **Web 反向转场（返回动画）**：adapter 用 history.state.proteusIndex 栈深判断前进/后退；RouterView 后退时用退出页进入时的转场名 + `-back`（scale-back/slide-up-back/halfscreen-back）——B 页反向滑出底部、A 页恢复原态（对应 MP reverse 转场）；replace 视为前进 |
| v2.36 | **遮罩改为纯 CSS 方案（无事件时序问题）**：弃用 barrierDone/Transition 事件（before-enter 在新元素入场才触发、遮罩重置不可靠）；改 `.page` 基类恒 `z-index: 2`——停留页永远盖住遮罩(z:1)，旧页仅 leave 时降 z:0 暴露在遮罩下；遮罩常驻挂载、转场期间天然可见、结束后被停留页盖住 |
| v2.35 | **修复遮罩残留**：转场结束后新页 enter-active(z:2) 类移除、遮罩(z:1)仍挂着 → 遮罩盖在停留页上；修复：Transition `@after-enter` 移除遮罩（barrierDone）、`@before-enter` 重新挂载；reduced-motion 下遮罩瞬时显示 |
| v2.34 | **Web 遮罩层对齐 MP barrierColor**：层叠转场新增 `.route-barrier` 遮罩（旧页 z:0 之上、新页 z:2 之下，淡入压暗旧页）——halfScreen 0.4 / scaleDown 0.8（与 MP 预设 rgba 一致）；slideUp opaque 无遮罩；旧页 leave z-index 1→0 让遮罩可见 |
| v2.33 | **Web 转场全面层叠化 + 无障碍**：所有 routeType 转场改层叠（default 模式 + 绝对定位重叠）——slideUp 新页推入+旧页被推出视口上方（对应 MP secondaryAnimation）、halfScreen 新页滑入+旧页保持淡出、scale 旧页下沉缩放；fade（普通导航/回退）保持 out-in；新增 `prefers-reduced-motion` 关闭全部转场 |
| v2.32 | **Web 页面纸片化（层叠转场修复）**：demo 页面根元素透明导致层叠时只有文字在滑——RouterView `.page` 基础样式加 `background: #fff + min-height: 100vh`，每页成为独立白色纸片；层叠缩放时新旧两页纸片叠动、层次清晰 |
| v2.31 | **Web 层叠缩放转场（scaleDown 同屏层叠）**：scaleDown 改用 default 模式 + 绝对定位重叠——新页从底部滑入覆盖（z:2），旧页同时下沉缩放（scale 0.92 + translateY 4% + 圆角，z:1），复刻 MP 层叠效果；其余转场保持 out-in；`:mode` 按是否层叠动态切换 |
| v2.30 | **Web 原生转场（routeType → Vue Transition）**：同一套 `routeType` API 双端生效——MP 走 Skyline worklet，Web 走 Vue `<Transition>` CSS 动画（halfScreen/slideUp→上滑缓出、scaleDown→缩放淡入、默认 fade）；链路打通：router.push 透传 routeType → web-adapter（navigateTo + `<a route-type>` 点击拦截）→ RouterView `:name` 动态过渡（out-in + 按路由 :key 重挂载） |
| v2.29 | **Web 端平台边界文档化**：自定义路由转场（routeType/worklet/barrier）明确为 Skyline 平台能力，Web 无对等机制——routeType 在 Web 优雅忽略（isSkyline=false）、导航一致；Web 转场用 Vue `<Transition>`；API 统一、机制各平台原生 |
| v2.28 | **手写覆盖内置预设**：插件新增 `filterOverriddenPresets`——main.mp.ts 中同名 `addRouteBuilder` 注册时跳过同名预设自动注册（开发者优先）；demo 演示覆盖 halfScreen（改遮罩/高度）；65 测试 |
| v2.27 | **内置预设 builders（零手写）**：真机验证过的 halfScreen/slideUp/scaleDown 沉淀为框架预设源码 `src/router/presets/`；开发者在 `proteus.config.ts` 声明后，mp 插件直出 app.js 时**自动内联预设函数 + 生成注册块**（绕开"同文件静态可分析"约束）；main.mp.ts 精简为纯入口；新增 plugin 单测（extractBuilderFnName/assembleAppJs） |
| v2.26 | **转场能力验证收官（最终版 scaleDown）**：B 页动画/曲线/遮罩/时长/手势全部真机验证通过；前后页联动采用 `handlePreviousPageAnimation`（≥3.0.0，唯一生效方式）；归档平台差异：经典架构（A 页自带 builder 的 secondaryAnimation）在本环境不生效、handlePreviousPageAnimation 掉帧且不跟踪手势、分包页不能作 A 页；掉帧规避：borderRadius 静态 + 内联多项式曲线（弃 Easing/derived）+ 不做整页 scale；遮罩加深 0.8 |
| v2.25 | **综合能力演示 builder（scaleDown 缩放转场）**：示例新增「转场演示」页 + scaleDown builder，一次覆盖 Easing 进出曲线（cubicBezier + derived + AnimationStatus 切换）/ 遮罩 / 前后页联动下沉缩放（官方 Step-3 效果）/ 时长 / 手势（fullscreenDrag + 下滑返回）；`RouteContext` 类型按官方 CustomRouteContext 补全 8 字段（含 status/手势回调） |
| v2.24 | **自定义路由 builder 开放为框架能力**：builder（曲线/遮罩/联动/时长）由应用开发者在 `examples/main.mp.ts` 编写注册（平台约束：与 addRouteBuilder 同文件静态可分析，官方形态）；demo builder 重构为具名函数+直接引用；删除框架内已失效的 builders 注册表（真机不可行，避免误导）；`RouteBuilderResult` 14 字段可自定义项文档化 |
| v2.23 | **halfScreen 半屏视觉修复**：前页被挤开/右侧黑屏——根因 builder 未声明 `canTransitionFrom: false`（微信默认给前页套压出动画）；已补上并优化圆角为上圆角（16px 16px 0 0）；`RouteBuilderResult` 类型按官方 CustomRouteConfig 补全 14 个字段 |
| v2.22 | **自定义路由根因确诊（★长线真机排查收官）**：真机对照确诊——**半屏/自定义路由不能从 tabBar 页面发起**（报 `applyAnimatedStyle can not find corresponding nodes`，连官方预设 wx://bottom-sheet 也一样）；从非 tab 页发起即正常；框架代码始终正确，demo 测试链接此前全部放在首页（tab 页）导致全失败；demo 已调整（半屏演示移入非 tab 页），平台硬边界文档化 |
| v2.21 | **真机预览修复（?? 运算符）**：真机预览报 `SyntaxError: Unexpected token ?`（pages/index.js `this.data.count ?? 0`）——`??` 在真机/预览管线不支持；生成代码统一改用显式 null 检查三元（`=== undefined \|\| === null ? 0 : ...`），MP 产物扫描零 `??`/`?.` 残留 |
| v2.20 | **Skyline 自定义路由真机排查收官（★长线真机经验）**：全链路机制零报错、官方形态 builder + app.js 插件直出（绕开 rollup）；但微信**官方预设 wx://bottom-sheet 同样报 `applyAnimatedStyle can not find corresponding nodes`**（UI 线程）→ 定案为环境问题（devtools Skyline 模拟 + 灰度基础库 3.17.2），非框架代码；建议切稳定基础库 + 真机预览验证；半屏视觉列为待真机确认项 |
| v2.19 | **全链路调试机制（★反"猜问题"）**：`npm run debug:mp`（PROTEUS_DEBUG=1）一键构建；统一 `[proteus][环节]` 日志 + 时间戳覆盖 App 启动 / builder 注册 / 页面 onLoad/onReady / 导航 tap/navigateTo/成功失败 / 全局错误（wx.onError）；页面日志由编译器注入（debug 门控），app 层走 runtime/debug（vite define 注入 `__PROTEUS_DEBUG__`，正式构建常量折叠全摇掉零残留） |
| v2.18 | **修复微信 ES5 转译 babel helper 报错**：`module '@babel/runtime/helpers/arrayWithHoles.js' is not defined`——生成代码里的数组解构（`for (const [k,v] of ...)`）、对象展开、builder 对象解构在微信 ES6→ES5 转译时依赖 babel helper 模块；全部改写为索引循环 / 直接属性赋值 / `ctx.primaryAnimation`（无需 helper 的写法） |
| v2.17 | **修复 Skyline 转场不生效（worklet 箭头函数）**：真机日志 `routeType(halfScreen) handlePrimaryAnimation should be a worklet function`——微信 Skyline **不识别箭头函数为 worklet**；builder 的 worklet 方法改用 `function` 关键字；顺带移除 demo 首页不存在的 /logo.png（控制台 500） |
| v2.16 | **小程序导航修复（微信相对路径解析）**：真机日志显示 `navigateTo:fail page "pages/pages/user/index" is not found`——微信 navigateTo 不带前导 `/` 的 url 按相对当前页解析（当前页 pages/index → 目录 pages/ + url）；修复：handler 保留前导 `/`（绝对路径）；调试日志改为无条件输出（临时） |
| v2.15 | **修复小程序导航无效（__ 前缀方法名）**：微信保留 `_` 前缀，`bindtap="__navigateTo"` 可能绑定失败 → 方法改名 `proteusNavigateTo`（v-model handler 同理 `proteusOnXxxInput`）；`PROTEUS_DEBUG=1` 时自动 handler 输出 dataset/url 调试日志；修正 demo 链接 `/pages/user` → `/pages/user/index`（页面路径为完整路径） |
| v2.14 | **修复真机校验两处无效配置**：① 移除 app.json `window.renderer`（真机报"无效"，Skyline 改由页面级 `renderer: skyline` 声明，原实现臆想了该字段）；② 移除 page.json `customRouteKeyName`（真机报"无效"，自定义路由仅靠 `routeType` + 已注册 builder 生效）；demo 个人资料链接加 `route-type="halfScreen"` 演示转场（handler 带失败降级） |
| v2.13 | **修复 Skyline 校验报错**：页面 renderer=skyline 时微信要求 app.json 声明 `lazyCodeLoading: requiredComponents`，gen-routes 已按 skyline 开关自动补齐 |
| v2.12 | **修复小程序真机校验报错（tabBar 至少 2 项）**：demo 新增第二个 Tab 页 `examples/pages/mine.vue`（我的）；gen-routes 加守卫——tabRoutes < 2 时告警并忽略 tabBar，不再产出非法 app.json |
| v2.11 | **Web 端 SPA 导航**：web-adapter 全局拦截站内 `<a>` 链接（`preventDefault` + `pushState`，外部链接/_blank/修饰键点击不拦截），点击导航不再整页刷新；E2E 新增 window 标记验证无刷新 + 浏览器后退链路 |
| v2.10 | **页面导航链接（<a href> / <router-link>）**：模板转换编译为 `view bindtap="__navigateTo" + data-url`（支持 route-type），script 转换自动注入 `__navigateTo` handler（wx.navigateTo，仅 MP 产物）；Web 端 `<a href>` 走浏览器导航（SPA fallback）双端可用；demo 首页新增 3 个导航链接；新增 E2E「A 页点击跳转 B 页」用例；产物自校验机制当场捕获并修复一处生成的非法正则（`/^\//` → `/^[/]/`） |
| v2.9 | **示例项目独立化**：示例应用（pages / subpackages / App / main 入口 / RouterView）移入 `examples/`，`src/` 仅保留框架本体；gen-routes 与 mp 插件按 `pagesDir` 推导应用根目录；新增 `@proteus-vue/*` 别名（与未来 npm 包导入路径一致）；`auto-routes.ts` 生成位置保持在 `src/router/`（框架单例 router 依赖，见 PROJECT_MEMORY 决策 #23） |
| v2.8 | **方法内 ref 写入支持**：编译引擎新增 ref 访问重写（`count.value++` / `--` / 赋值 / 读取 → `setData` / `this.data`），消除"方法体不能引用 setup ref"限制（复合赋值除外）；demo 页 tap 按钮改为可见计数（Web 响应式 + MP setData 双端可用）；新增 E2E 点击用例（7/7） |
| v2.7 | **Web E2E 实测（P6 验收）**：Playwright 无头浏览器 6 用例（首页 / SPA 跳转 / 前进后退 / 刷新恢复 / 分包页 / 404），实测发现并修复 RouterView 两处缺陷（空路由归一化、routeMap 按 path 回退查找）；新增 `vitest.config.ts` 独立配置避免测试触发 mp 构建副作用 |
| v2.6 | **调试与验证收尾（P6）**：golden test fixtures 正式化（tests/fixtures/pages/ 4 个 fixture + 快照锁定产物）、新增 `preview:web` / `verify` 总验证脚本；**P1-P5 全部代码任务完成，进入验收阶段** |
| v2.5 | **运行时桥接（P5）**：`setDataBridge`（数组下标感知路径合并 + 值去重 + 16ms 批量）、`pageLifecycle`（createPage/createComponent + 路由参数 decode）、`main.mp.ts` 接入 `App()` + `registerRouteBuilders()`；编译产物默认 onLoad 注入路由参数（与 runtime 对齐）；mp 构建关闭压缩（反黑盒） |
| v2.4 | **反编译黑盒机制**：编译引擎新增产物自校验（`validateJs`/`validateWxml`，坏产物抛 `CompilerError` 指明文件）、`PROTEUS_DEBUG=1` 行号注释 + 中间产物转储、buildEnd 警告汇总摘要 |
| v2.3 | **编译器模块化**：编译引擎拆分为独立模块 `src/compiler/`（零 Vite / 零配置依赖的纯函数模块），`vite-plugin-mp-transform.ts` 降为薄适配层；新增 `src/compiler/README.md` 记录模块边界与独立开源提取路径（后期发布 `@proteus-vue/compiler`） |
| v2.2 | **项目记忆**：新增根目录 `PROJECT_MEMORY.md` 项目本地记忆文件（进度 / 已落地文件 / 关键决策与偏差 / 验证状态），执行规则 6 与附录 Prompt 模板要求新会话先读该文件 |
| v2.1 | **框架命名**：正式定名 **Proteus（普罗透斯）**，新增"框架命名"章节记录名字来源与设计意图；统一更名 `framework.config.ts` → `proteus.config.ts`，目录结构 / 代码示例 / 附录 Prompt 中的命名引用同步更新 |
| v2.0 | **§0 痛点对照**：新增动机章节，12 条主流痛点 → 对策对照表，10 条设计原则，非目标声明<br>**适配层**：新增 `platform/adapter.ts` 接口 + 双端实现，router/runtime 不再直连 `wx`（§0.2 #7）<br>**Web 端策略**：明确"Web 原生、MP 编译"，`RouterView.vue` + web-adapter（§0.3 原则 2）<br>**分包**：`framework.config.ts` 增 `subPackages`，`gen-routes` 生成 subPackages（§0.2 #10）<br>**setData 强化**：路径合并 + 值比较去重（§0.2 #5）<br>**renderer 降级**：改为可选扩展，MVP 不做（§0.2 #4）<br>**组件级生命周期**：`createComponent` + attached/detached（§P5-3）<br>**调试与测试**：新增 P6 阶段（golden test、adapter mock 单测、产物可读性）（§0.2 #3） |
| v1.0 | 初始版本：5 阶段 × 14 任务 |

---

**文档版本**：v2.49
**适用框架版本**：Vue 3.4+ / Vite 5+ / TypeScript 5.4+ / 微信基础库 2.29.2+（Skyline + wx.router）
**维护者**：自研框架项目组
