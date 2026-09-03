# Proteus（普罗透斯）—— 语义收敛的跨端应用框架

> **One semantic model. Any render engine. Zero native glue.**
> 一套语义内核，任意渲染引擎，任意原生能力。业务代码只和语义层对话——渲染底座、编译器、宿主容器、执行载体全部可插拔。
>
> **不跨端翻译，做跨端操作系统：语义是内核，后端是驱动。**

[方法论哲学](#方法论哲学统一语义收敛) · [杀手特性](#杀手特性) · [快速开始](docs/getting-started.md) · [架构全景](docs/board-inventory.md) · [对外定位](docs/proteus-positioning-v3.md)

---

## 为什么叫 Proteus（名字来源）

**普罗透斯（Proteus）** 是古希腊神话中的海神，波塞冬的牧人，被称作"海中老人"。《奥德赛》中他在法罗斯岛被擒时化作狮子、蛇、野猪、流水与大树，英语中 **protean（千变万化）** 一词正源于他的名字；同时他通晓过去、现在与未来。

| 普罗透斯的神格 | 框架的差异化优势 |
|---|---|
| **变形**：同一存在变换出多种形态 | **一套语义，多端形态**：同一份业务语义 → Vue DOM / 原生 / Flutter / Skia / 小程序，形态可变、本质不变 |
| **先知**：预知未来 | **编译期优先**：语义 IR 在 build-time 校验收敛，能编译期发现的问题绝不留到运行时 |
| **本质恒定**：变形后本体仍是普罗透斯 | **语义恒定**：业务代码只依赖语义内核，平台差异全部下沉为后端实现细节 |
| **通晓万物**：知过去、现在、未来 | **可验证**：每层 SPI 都有 conformance 门禁，后端实现是否合规机器可判、CI 强制 |
| **化身为光**：变形即显形，无所遁形 | **透明编译**：转换规则自描述（AI 说明书）、决策 trace 可枚举可反查，拒绝黑盒 |

## 方法论哲学：统一语义收敛（Unified Semantic Convergence）

> **Proteus 不做跨端翻译，而是定义与平台无关的语义内核；一切平台差异下沉为"后端实现细节"。**

核心公式：

```
任何跨端问题 = 语义定义（框架做） + 后端实现（平台做）
```

框架只做两件事：**定义"你要什么"**（语义接口 / IR），**定义"怎么验证做对了"**（conformance / 铁律 / 编译期约束）。平台只做一件事：提供"怎么做"（Backend 实现）。**业务开发者只消费语义接口，对后端零感知。**

**同一个 shape，贯穿全部架构维度**——这正是"框架不绑定任何单一平台"的来源（原则 #0 的同族投影）：

| 「不绑定」系列 | 语义层（框架定义） | 后端 SPI（可插拔实现） | 状态 |
|---|---|---|---|
| 不绑定平台 API（G-31/32） | p-* 语义组件 + 128 原语 SSOT + Capability Hook | 各端语义实现（小程序降级为 Layer 1 兼容层） | ✅ |
| 不绑定渲染引擎（G-27/37） | VNode / Component IR / LayoutConstraint IR | `ProteusRenderBackend`（VueDom / Native×3 / Flutter / Headless） | ✅ |
| 不绑定编译器（G-29/38） | Compiler IR（SFC → 中间表示） | `ProteusCompilerBackend`（Node ✅ / Rust ✅ / WASM 📋） | 🟡 |
| 不绑定容器形态（G-42） | 页面生命周期状态机 + IR 单一 Owner | 六容器策略（Stack / SuperApp / Window / MiniProgram / Embedded / SinglePage） | ✅ |
| 不绑定宿主运行时（G-39） | Host Runtime 接口（bootstrap / worker / engine / native 桥） | 宿主实现（Web / Terminal 参考实现已备） | 📋 |
| 不绑定执行载体（G-40） | Execution Carrier SPI + 批处理差分 + 零拷贝通道 | JSI（默认）/ bytecode / AOT——载体只是插槽上的当前实现 | 📋 |
| 不绑定端（G-30） | Platform = (R, C, J) 三元组 + Tier 1-4 | 任意能提供渲染宿主/能力宿主/JS 运行时之一的端 | 📋 |

**验证先于运行**：每层 SPI 都有 conformance 套件（Render / Compiler / Host / Container / Ownership / Test 各 32-42 项），CI 自动校验。约束挂在 IR 上而不是挂在某个平台上——这也是 AI Agent 能安全介入的原因：它操作的是 IR，IR 上有约束。

方法论全文：[PROTEUS-METHODOLOGY.md](docs/proteus-methodology-plan/PROTEUS-METHODOLOGY.md) · 原则与铁律总表：[proteus-architecture.md](docs/proteus-architecture.md)

## 杀手特性

> 状态标注：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库（plan + 参考实现，无可运行集成）

### ① 可插拔渲染底座（G-27）✅

`@proteus-vue/render-backend`：RenderBackend SPI + conformance 门禁，五官方后端原型集齐（Headless / VueDom / Native×3 / Flutter widget 映射）。**同一个 App 按页面选引擎**：商品详情 → Native（体验优先）、品牌动效 → Flutter（一致性）、数据大屏 → Skia（高频绘制）、H5 落地页 → Vue DOM（Web 生态）——业务代码完全一样。nodeOps Dispatcher 热切换（切换 = 一次赋值）+ 混合渲染（区域级切后端 + 纹理共享 + DevTools 路由 trace）。Flutter 锁死 Skia、RN 锁死原生——只有"上层模型 + 可插拔后端"这条路线能做到渲染引擎自由。

### ② 可插拔编译器（G-29/G-38）🟡

`proteus.config.ts` 一个 flag 切编译后端：`config.compiler.backend: 'node' | 'rust'`（或 `proteus build --compiler rust`）。RustBackend 是独立 cargo crate（proteus-cc-rust CLI → **同一份 CompilerIR JSON**），Node/Rust 语义等价 Golden 门禁 81 用例双端对齐。CompilerBackend SPI 已冻结（parse/transform/emit 三阶段 + IncrementalSession 增量 + FallbackBackend 自动降级），conformance 42 项。WASM 后端规划中。

### ③ 语义原语 SSOT + 能力 Hook（G-31/G-32）✅

128 语义原语清单（`PRIMITIVE_CATALOG` 单一事实源）→ 59 个 p-* 语义组件双端落地 → 45 个 implemented 语义 × 6 后端 conformance 门禁 → 50 个 Capability Hook（useCamera / useLocation / usePayment / useBiometric… 双端真实实现，缺桥诚实降级不崩溃）+ 28 个工程原语（useQuery / useRouter / useAnimation…）+ `proteus audit coverage` / `api-check` 编译期门禁。**业务依赖能力，不依赖平台。**

### ④ 宿主层三件套（G-41/42/43）✅

- **宿主接入（G-41）**：三方正交（框架 × 渲染引擎 × 宿主），6 宿主 × 6 引擎 = 36 组合矩阵 Tier 1 全部 conformance 验证
- **宿主容器（G-42）**：六容器策略可插拔——超级应用容器（业务沙箱 + 崩溃隔离 + 自动重启 + 签名/白名单安全网关）、Stack / Window / MiniProgram / Embedded / SinglePage；IR 单一 Owner + 五原子销毁；严禁 fork（`proteus conformance --repo` 仓库治理 CLI 一键扫描）
- **资源所有权（G-43）**：Owned / Borrow / Weak 语义层 + 借用检查器（PSS strict 编译期完备——use-after-move / double-move / 借用逃逸编译期拦截）+ Drop 五阶段协议 + DevTools 所有权图。**GC 管可达性，所有权管意图。**

### ⑤ AI-native 全链路（G-21/23/36）✅

编译器内置规则注册表（69 条转换规则，每条自带 AI 说明书 what / why / when / example / verify）+ `proteus explain` 决策 trace + Compiler Plugin API（IR 可编程访问，AI 覆盖规则实现即获得新能力）。Agent 基建：MCP Server（11 工具 + 5 Resources + 鉴权）、Agent Kit SDK（IRBuilder + withProteusRules + generateWithRetry 自修复循环）、migrate-miniprogram Skill、三层护栏（L1 IR Schema / L2 风格 / L3 六端 conformance）。**AI 产出的是符合 IR 契约的标准代码，而非自由文本。**

### ⑥ 小程序 = Layer 1 兼容层（G-31 B6）✅

业务代码只写标准 HTML 标签 + 标准 Vue SFC，**业务零条件编译**；`@proteus-vue/compat-miniprogram` 提供 wx 桥 + `proteus migrate mp` codemod（wx.* API 扫描 + 映射日志 + 覆盖率）。编译器 mpTransform 管线生成 Skyline 原生四件套：脏路径收集 + 16ms 批量 setData、编译期 px→rpx、分包声明写入 app.json、路由表全链路 TS 类型推导。纯 Vite 插件，无 IDE 锁定，任何 CI 可跑。**小程序不是标准，是兼容层。**

### ⑦ 桌面交互原语（G-24）✅

p-hover / p-shortcut（mod+s 平台惯例自动映射 ⌘S/Ctrl+S）/ p-focus-trap / p-context-menu / p-notify / p-permission / p-deeplink / p-command（⌘K）/ p-master-detail / p-breadcrumb 等 17 模块 + v-p-* 指令，Pure logic 双端接线。全终端三维断点 W×H×F（车机 driving-safe / TV 焦点引擎 / 手表表冠，G-25）📋 规划中。

### ⑧ 测试即架构（G-44）🟡

`@proteus-vue/test-ir`：Test IR + TestBackend SPI（vue-test-utils / jsdom / happy-dom / node / native-web / mp-mock）+ conformance runner + 断点矩阵——**测试断言本身成为可插拔 IR**，一套断言跨后端复用，后端合规性由机器判定。

### ⑨ 执行载体可插拔（G-39/G-40）📋

`createEngine(config)`：JSI 只是"执行载体"插槽上的默认实现，不是架构绑定。emit 产物三选一（JS bundle / bytecode / **AOT 原生代码**——AOT 路径下 JS 跨边界成本归零 + 真并发）；批处理差分（一帧 N 次属性变更聚合为一次跨界提交）；零拷贝通道（大块数据强制 ArrayBuffer）；实时能力原生闭环（音频/传感器高频流由原生线程驱动，JS 只下发配置 + 接收事件）。规划已入库（双参考实现 JSICarrier / AOTCarrier + verify 14/14）。

### ⑩ 柔性布局 / 自适应容器 / 系统级玻璃（G-22 / G-22.5 / G-07）🟡

p-fluid / p-grid / p-stack / p-fit 柔性布局——把 iOS `UICollectionView` / Android `GridLayoutManager` / CSS Grid 的系统级布局能力收敛为语义原语，屏幕越宽自动排越多列，折叠屏展开、窗口拖拽实时 reflow（✅ `@proteus-vue/fluid` + FLD 门禁）；p-adaptive 弹窗整个形态随宽度自动切换（`sheet | dialog | popover` 映射各端原生容器）（✅ B1/B2/B4）；系统级玻璃材质 `<pg-glass>`（iOS UIGlassEffect / 鸿蒙 fractal / RenderEffect / backdrop-filter，L1/L2/L3 降级不崩溃）（📋 规划中）。

### ⑪ 99% 零原生代码（G-28）📋

语义接口 + NativeBackend SPI 帕累托分层：Top 30 能力框架内置（80%）+ 官方 Backend（+18%）+ 社区包（+1.9%）= 99% 业务场景不写 Swift/Kotlin/Java 桥接；Compiler 扫描 `capabilities` 自动生成 iOS `Info.plist` / Android `AndroidManifest.xml` / 鸿蒙 `module.json5` 权限声明。规划已入库（native-backend-1-plan）。

### 工程化基座 ✅

路由（命名路由 + 守卫 + Skyline 自定义转场，Web 端 Vue Transition 复刻同一套 API）、分包（编译期生成 subPackages）、模块化（契约 / 依赖图谱 / 懒加载 / CI 审计门禁）、状态（pinia-sync：LWW 零依赖默认 + CRDT 接口）、i18n（类型安全 t() + ICU 子集 + 审计）、DevTools（十视图：TraceBus / 所有权图 / 性能…）、CLI（build / explain / rules / audit / conformance / migrate / capabilities / i18n:check）、create-proteus 一键双端工程。

## 对标矩阵（核心差异）

| 维度 | uni-app | React Native | Flutter | **Proteus** |
|------|---------|--------------|---------|-------------|
| 渲染底座 | WebView | 原生（锁定） | Skia（锁定） | **可插拔（Vue/Native/Flutter/Skia）✅** |
| 同 App 多后端 | ❌ | ❌ | ❌ | **✅ 按页面切换 + 混合渲染** |
| 编译器 | 锁定 | 锁定（Metro） | 锁定 | **可插拔 SPI（Node/Rust 一个 flag）✅** |
| 业务写法 | `view/text` DSL | JSX + 原生组件 | Dart | **标准 HTML + 标准 Vue SFC** |
| 布局适配 | rpx（单位换算） | LayoutBuilder | AdaptiveScaffold | **系统级柔性布局（p-*）✅** |
| 手写原生插件 | 插件市场碰运气 | 必须写 Native Module | 必须写 Plugin | **语义接口 + NativeBackend（📋 规划）** |
| 权限声明 | 手动配 | 手动配 | 手动 | **Compiler 自动生成（📋 规划）** |
| 内存治理 | GC 兜底 | GC 兜底 | GC + 手动 | **所有权 + 借用检查编译期拦截 ✅** |
| AI 介入方式 | 无 IR，只能文本替换 | 同左 | 同左 | **操作 IR + 强制校验 + 自修复 ✅** |
| 工具链 | HBuilderX 依赖 | RN CLI | Flutter SDK | **纯 Vite 插件，任何 CI 可跑** |

**结论**：竞品缺的不是某个 API，而是"显式语义 + 可编程 IR + 后端原生映射 + 强制校验"这套方法论。普通 DSL 映射是"换种语法写原生代码"；Proteus 是"定义语义，让任何后端实现它"——这是语法翻译与架构方法论的代际差。

## 架构分层

```
┌─ 应用层（业务）         标准 Vue SFC / 路由 / 状态 / 页面
├─ 语义层（框架核心）     p-* 原语 / 128 原语 SSOT / Capability Hook / Fluid / Adaptive / Glass
├─ 编译层                Compiler + Plugin API + CompilerBackend SPI（Node / Rust / WASM）
├─ 渲染层                RenderBackend SPI（VueDom / Native / Flutter / Skia / Headless）+ Dispatcher 热切换
├─ 宿主层                HostRuntime SPI + 六容器策略 + 所有权/借用检查 + ExecutionCarrier（JSI/AOT）
└─ 能力层                NativeBackend SPI（规划）+ Capability Hook 50（iOS / Android / Harmony / Web / MP）
```

**核心洞察**：框架通过 IR 层只描述"要什么"（一个毛玻璃卡片、一次扫码调用、一个编译产物），后端决定"怎么做"（UIGlassEffect 还是 backdrop-filter、AVCapture 还是 CameraX、Node 还是 Rust）。**两套后端共用同一套 SPI 方法论，这正是"天然适配任意渲染引擎 + 任意原生能力 + 任意编译器"的来源。**

## 快速开始

### 环境要求

- Node.js ≥ 18
- 微信开发者工具（小程序端调试，需真实 AppID；基础库 ≥ 2.29.2 以启用 Skyline）

### 安装与启动

```bash
npm install

# Web 端（浏览器打开 Vite 提示的地址）
npm run dev:web

# 小程序端（构建后导入微信开发者工具）
npm run build:mp

# 切换编译后端（node 默认 / rust）
# proteus.config.ts → config.compiler.backend: 'node' | 'rust'
```

构建产物：

- Web：`dist/web/`（标准 Vite SPA，可 `npm run preview:web` 预览）
- 小程序：`dist/mp-weixin/`（微信开发者工具「导入项目」指向此目录，详情见[快速开始](docs/getting-started.md)）

### 第一个页面

```vue
<route>
{ "meta": { "title": "首页", "isTab": true } }
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)

function handleTap() {
  count.value++
}
</script>

<template>
  <div class="home">
    <h1>Hello Proteus</h1>
    <p>tapped {{ count }} times</p>
    <button @click="handleTap">tap</button>
  </div>
</template>

<style>
.home { text-align: center; padding: 48px 0; }
</style>
```

标准写法，无平台 DSL。同样的源码在 Web 端由渲染后端直出 Vue DOM，在小程序端由编译器转为 WXML + WXSS + `Page()` JS——将来接入 Native / Flutter 后端时，这份代码一行不改。完整示例见 `examples/pages/`。

## 路由与自定义转场

```ts
import { router } from '@proteus-vue/router'
import { beforeEach } from '@proteus-vue/router/guards'

// 命名路由 + 参数（自动序列化为 query，全链路 TS 类型推导）
router.push({ name: 'user-profile', params: { id: 1 } })

// Skyline 自定义路由转场（Web 端自动映射为 Vue Transition 等价转场）
router.push({ name: 'user-profile', routeType: 'halfScreen' })

// 守卫
beforeEach((to, from) => to.meta?.requiresAuth ? !!getToken() : true)
```

内置转场预设：`halfScreen`（半屏弹层）/ `slideUp`（底部上滑）/ `scaleDown`（层叠缩放），配置在 `proteus.config.ts`。详见[路由与转场](docs/routing.md)。

## 目录结构

```
proteus/
├── proteus.config.ts               # 框架统一配置（平台 / 路由 / 转场 / 规则覆盖 / compiler.backend）
├── packages/                       # 37 个 @proteus-vue/* workspace 包
│   ├── compiler/                   #   编译引擎 + 规则注册表（69 条 AI 说明书 + apply 分派层）
│   ├── compiler-backend/           #   CompilerIR 契约 + NodeBackend + 双端等价 Golden
│   ├── compiler-backend-rust/      #   Rust 编译后端（cargo crate proteus-cc-rust → 同一 CompilerIR）
│   ├── plugin-vite/                #   Vite 插件（mpTransform 管线 + gen-routes + webOnly 排除）
│   ├── render-backend/             #   渲染 SPI + 五后端 + 混合渲染 + 容器/所有权/宿主层（G-27/41/42/43）
│   ├── compat-miniprogram/         #   wx 桥 + migrate codemod（Layer 1 兼容层，G-31 B6）
│   ├── component-ir/ contracts/ types/ shared/    # C-IR schema / 契约 / 全局类型 / 公共层
│   ├── built-in-components/        #   59 个 p-* 语义组件（128 原语 SSOT）
│   ├── fluid/ desktop/ gesture/    #   G-22 柔性布局 / G-24 桌面原语 / 手势识别器
│   ├── api/ capabilities/ security/ #  Capability Hook 50 / Adapter Registry / 安全
│   ├── router/ runtime/ module/    #   路由 / setData 桥接 / 模块化
│   ├── pinia-sync/ i18n/ css-compat/ style-safety/ # 状态协同 / 国际化 / CSS 兼容 / 样式安全
│   ├── app-config/ hmr/ web/ renderer-app/ devtools/ devtools-runtime/ # 配置 / 热更 / Web 壳 / 渲染壳 / DevTools
│   ├── agent/ mcp/ docs/ test-ir/ test-core/      # Agent Kit / MCP Server / 文档引擎 / 测试 IR / 测试核心
│   └── cli/ create-proteus/        #   CLI（build/explain/audit/conformance/migrate）/ 一键工程
├── docs/                           # 60 份 plan + 规约 + positioning v3 + methodology + board-inventory
├── examples/                       # 示例应用（20 页能力矩阵活文档 + 文档引擎 demo）
├── tests/                          # 1923 单测 / 183 文件 + Web e2e 18 例
├── .github/workflows/              # CI：test / vue-tsc / 双端构建 / 独立包构建 / e2e / consistency
└── CONTRIBUTING.md                 # 贡献指南（规则改动同步约定）
```

## 测试与验证

```bash
npm test                # 1923 个单测 / 183 文件（compiler / render-backend / compiler-backend / 容器 / 所有权 / conformance / …）
npm run test:e2e:web    # Web e2e 18 例（Playwright：基础流 + 关键路径 + 渲染后端 demo）
npm run verify          # test + build:web + build:mp 一键全过
npm run check:pkg       # 37 包依赖一致性 0 error
npm run proteus -- explain <vue-file | rule-id>     # 决策 trace / AI 说明书
npm run proteus -- conformance --repo .             # 严禁 fork 仓库治理扫描
```

## 文档导航

| 文档 | 内容 |
|---|---|
| [PROTEUS-METHODOLOGY](docs/proteus-methodology-plan/PROTEUS-METHODOLOGY.md) | 方法论哲学：统一语义收敛、五支柱、Tier 模型（onboarding 第一课） |
| [定位 v3](docs/proteus-positioning-v3.md) | 对外定位：一句话定位 + 杀手特性详解 + 对标矩阵 + 对外话术 |
| [架构全景](docs/board-inventory.md) | 六层分层 + 双路线 + 60 份 plan 状态总表（单一权威索引） |
| [规约](docs/proteus-architecture.md) | 原则 #0-#13 + 铁律总表 + 严格规则（真理来源） |
| [快速开始](docs/getting-started.md) / [配置参考](docs/configuration.md) / [编译原理](docs/compiler.md) / [路由与转场](docs/routing.md) | 开发者文档 |
| [路线图](docs/roadmap.md) · [里程碑线](docs/proteus-roadmap-2-plan/01-master-roadmap.md) | 版本线 v0.1→v2.0 · M1-M3 里程碑线 |

## 开发状态与路线图

- **已落地**（37 包 / 1923 单测全绿 / 双端构建通过）：语义 IR + 双 SPI 定案（#290）→ G-27 渲染后端 B1-B6（五后端 + 混合渲染）→ G-31/G-32 语义 SSOT（128 原语 + 59 组件 + 50 Hook）→ G-29/G-38 编译双后端（Node/Rust 等价门禁 + SPI 冻结）→ G-41/42/43 宿主层（36 组合矩阵 + 六容器 + 所有权/借用检查）→ G-36 AI 基建（MCP / Agent Kit / Skill / 护栏）→ G-24 桌面原语 B1-B4 → G-44 测试 IR B1 → 文档引擎（Markdown→IR→双端渲染）
- **进行中 / 规划**：G-38 B3 Rust native 深化（oxc/swc + napi-rs）与 B4 WASM Playground、G-28 NativeBackend 实现（99% 零原生）、G-39/G-40 宿主运行时与执行载体实现、G-25 全终端（车机/TV/手表）、G-30 任意端接入、npm 发布（changesets 就绪）——完整分里程碑路线见 [roadmap](docs/roadmap.md) 与 [board-inventory](docs/board-inventory.md)

## 开源协议

Proteus 使用 [Apache-2.0](LICENSE) 协议：宽松可商用（与 MIT 同等核心自由），并附**专利授权**条款——对采用者与贡献者都更友好，适合作为被嵌入商业项目的基建类框架。

## 已知限制（诚实边界）

- 支持 Web 全功能 + 微信小程序（Skyline 优先，WebView 降级仅保证可运行）；支付宝 / 抖音 / 快手为非目标
- **规划已入库、尚未有可运行实现**：G-28 NativeBackend（零原生代码）、G-39/G-40 宿主运行时与执行载体（AOT 路径）、G-25 全终端（车机/TV/手表）、G-30 任意端——plan + conformance 套件 + 参考实现已备，按路线图分批落地
- 渲染后端五后端中 Native×3 / Flutter 为原型映射（widget 级），原生工程接线待 G-37 分批推进
- 自定义路由转场是 Skyline 平台能力：不能从 tabBar 页发起；Web 端用 Vue Transition 复刻同一套 API
- 运行时禁止动态注册页面 / 路由（编译期静态声明）
- Skyline 在 iOS 真机偶发白屏（微信平台已知问题）：降级兜底策略已规划在 roadmap v0.5
- 强实时 / 强安全隔离场景（航空、医疗）不适合（方法论诚实边界：见 [PROTEUS-METHODOLOGY §8](docs/proteus-methodology-plan/PROTEUS-METHODOLOGY.md)）

---

**文档版本**：v3.0（重构：对齐定位 v3 + 方法论哲学「统一语义收敛」；37 包 / 1923 测试 / 60 plan）· **适用框架**：Vue 3.4+ / Vite 5+ / TypeScript 5.4+ / 微信基础库 2.29.2+
