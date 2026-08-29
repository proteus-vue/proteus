# 路线图：对标大厂跨端框架的完整规划

> 本文档定义 Proteus 从 MVP 到**生产级跨端框架**（对标 uni-app / Taro 3）的完整路线：能力差距矩阵 → 版本里程碑 → 架构演进 → 性能目标 → 生态建设。
> 所有规划项都落在现有代码结构上（`src/compiler` / `src/router` / `src/platform` / `src/runtime`），每项标注对应模块，保证可落地。

## 1. 定位：差异化内核（为什么这条路能对标大厂）

Proteus 与 uni-app / Taro 的核心差异，也是规划路线的主轴：

| 维度 | uni-app | Taro 3 | **Proteus** |
|---|---|---|---|
| 开发范式 | 非标准 DSL（`view/text`）+ 条件编译 | 标准框架 API，但运行时模拟 DOM | **标准 Vue 3 SFC + 标准 HTML**，编译期吸收差异 |
| 编译策略 | 编译黑盒 | 长 babel 链 + 运行时 diff | **编译期为主**，产物贴近手写、自校验、可调试 |
| Web 端 | 转换产物 | 转换产物 | **零转换**标准 Vite SPA |
| 运行策略 | setData 全量 | 运行时 DOM 模拟 | 仅数据桥接 + 路由导航 |
| 透明性 / AI 友好 | 黑盒，产物不可读 | 长链难追踪 | **规则注册表 + 每条规则 AI 说明书**（`transforms/`），产物可枚举、可查询、可反查源码 |

> **定位主线**：AI-native 透明跨端编译框架。透明（规则注册表 + 自校验 + 全链路调试）既是差异化卖点，也是 AI 代理驱动编译器的前提——
> AI 写标准 Vue → 编译 → 查规则说明书理解产物 → 改编译器 → 单测兜底，全程无黑盒。

规划的全部能力建设都围绕这四条主线展开：**标准 Vue 能力补全 → 编译引擎工程化 → 运行时性能 → 多端扩展**。

## 2. 对标能力矩阵（现状 → 目标）

| # | 能力域 | uni-app | Taro 3 | Proteus 现状 | 规划版本 |
|---|---|---|---|---|---|
| 1 | **开发体验**：脚手架 / HMR / devtools / 错误定位 / 类型提示 | ✅ | ✅ | 🟡 HMR+devtools（Web 原生）；MP 无 devtools 插件 | v0.2 脚手架 + v1.0 devtools |
| 2 | **编译能力**：组件系统（props/emits/slots）/ computed/watch / 指令全集 / scoped CSS / 预处理器 | ✅ | ✅ | ✅ 组件 props/emits/slots、computed 读路径、watch、v-show、:class 数组、scoped CSS、scss 预处理器、sourcemap（v0.3）；🟡 类型提示 / computed 写路径 | v0.3 + v0.3 尾 |
| 3 | **路由**：嵌套 / tabBar / 分包 / 自定义转场 / 守卫 / 深链 | ✅ | ✅ | ✅ 全量（MVP 已交付，含 Skyline 自定义转场） | — |
| 4 | **状态管理**：Pinia 集成 / 持久化 | ✅ | ✅ | 🟡 Web 原生 Pinia + MP store 桥（v0.4）；❌ MP 编译 / 持久化 | v0.4 + v0.4 尾 |
| 5 | **组件生态**：内置 UI 组件库 / 三方组件适配 | ✅ | ✅ | 🟡 框架内置组件（virtual-list）；走 Vue 生态（Web 原生复用） | v0.3 适配层 + v2.0 组件库 |
| 6 | **原生能力**：原生组件 / 插件体系 / 原生事件桥 | ✅ | ✅ | 🟡 `v-html→rich-text` 等兜底；❌ 插件体系 | v0.5 |
| 7 | **工程化**：CI / monorepo / 测试 / 规范 / 版本发布 | ✅ | ✅ | ✅ 222 单测 + CI（拆包完成：7 个 @proteus/* 包独立构建 + 模板快照一致性检查）；✅ 框架本体拆包（8 步全落地，决策 #98-#105）；🟡 npm 发包待启用 | v0.2 + 拆包尾 |
| 8 | **性能**：setData 优化 / 虚拟列表 / 渲染性能 / 包体积 | ✅ | 🟡 | ✅ setData 深层 diff + 批量 + 虚拟列表 + 性能基准 + 包体积仪表（v0.4） | — |
| 9 | **多端覆盖**：微信 / 支付宝 / 抖音 / 鸿蒙 / **App 原生（Vue 自定义渲染器）** / H5 | ✅（11 端） | ✅（12 端） | 🟡 微信 Skyline + Web | v0.5 起 + v0.6 App/Vapor |

> ✅ 已具备 · 🟡 部分具备 · ❌ 缺失。**差距即路线**：以下里程碑按此矩阵排布。

## 3. 版本里程碑总览

```
v0.1 ────► v0.2 ────► v0.3 ────► v0.4 ────► v0.5 ────► v0.6 ────► v1.0 ────► v2.0+
MVP       工程化基线   编译能力补全  运行时与性能  多端扩展    App 原生    生产可用    生态成熟
✅ 已完成  独立开源包  组件/派生    虚拟列表/状态  支付宝抖音  自定义渲染器 能力矩阵     devtools/插件
           CLI/脚手架  sourcemap    性能基准      鸿蒙/WebView Vapor 兼容   达标        组件库/社区
```

## 4. 里程碑详解

### v0.1 MVP（✅ 已完成）

Web + 微信 Skyline 双端编译、编译期路由/分包/tabBar、自定义路由转场（Skyline worklet + Web Transition 双端同 API）、setData 批量桥接、反编译黑盒（自校验 + 全链路调试）、79 单测 + 8 e2e、文档体系（README + docs/ 四篇）+ Apache-2.0 协议。

### v0.2 工程化基线（编译引擎独立，对标"工具链不锁定"）

**目标**：把"编译引擎可独立开源"从设计变成现实，建立标准开源工程设施。

| 任务 | 落地位置 | 验收标准 |
|---|---|---|
| 编译引擎独立包 `@proteus/compiler`（✅ 已落地） | `packages/compiler/`（monorepo） | ✅ `npm run build -w @proteus/compiler` 产出 dist（esbuild 单文件 + tsc 声明文件）；插件 `@proteus/plugin-vite` 以 npm 包形态消费（prepare 钩子保 dist 新鲜）；纯函数 API 不变 |
| 规则注册表随包发布（✅ 已落地） | `packages/compiler/src/transforms/` | ✅ `@proteus/compiler` 导出 `listTransformRules` / `getTransformRule` / `formatTransformRule` / `explainTransform`（49 条 AI 说明书随包携带） |
| CLI `@proteus/cli`（✅ 已落地） | `packages/cli/` | ✅ `proteus build <dir> --out <dir> [--debug] [--rules]`（独立编译，esbuild 单文件 + shebang，`node_modules/.bin/proteus` 验证）；`proteus explain <vue-file | rule-id>`（决策 trace / AI 说明书）；`proteus rules`（能力目录）；核心逻辑纯函数可单测（tests/cli.test.ts 9 用例） |
| 脚手架 `create-proteus`（✅ 已落地） | `packages/create-proteus/` | ✅ `npm create proteus my-app` 生成双端工程（应用壳 + shims，框架走 @proteus/* npm 包，无 vendored 副本）；模板同步脚本 `scripts/snapshot-template.ts`（CI 快照一致性检查） |
| CI（✅ 已落地） | `.github/workflows/ci.yml` | ✅ `vue-tsc / test / build:mp / build:web / 独立包构建` + `e2e-web` 双 job 全绿 |
| 发布流水线（✅ 已就绪：changesets 配置 + 流程验证，npm 发布待启用） | `.changeset/` + 脚本 | ✅ `changeset`（写变更）/ `changeset version`（bump + CHANGELOG）/ `changeset publish`（发布，待 npm 登录）；实测：初始 changeset → version → 三包 0.1.0→0.2.0 + CHANGELOG.md 生成 + 内部依赖自动更新；CI 发布 job 待启用 |
| 贡献设施（✅ 已落地） | `CONTRIBUTING.md` / Issue & PR 模板 / 行为准则 | ✅ 规则改动同步约定（实现/AI 说明书/映射表/测试四处一致） |

### v0.3 编译能力补全（对标"标准 Vue 能力"，最大差距域）

**目标**：把"业务代码 = 标准 Vue SFC"从"核心子集"推进到"主流能力全覆盖"。

| 任务 | 落地位置 | 说明 |
|---|---|---|
| `computed` / `watch` 编译支持（✅ 读路径 + 写路径 + watch 全源，决策 #76/#78/#89/#90） | `packages/compiler/src/script.ts` | 已有：`computed(() => 表达式)` / `computed({ get, set })` → data 派生字段 + proteusSetX setter 方法（只读赋值注释忽略）；`watch` 单 ref / 数组源 / 函数源 → proteusWatch 方法（写入联动 + immediate；多源回调数组） |
| 转换决策 trace（✅ 已实现：内嵌 trace + explainTransform） | `src/compiler/explain.ts` + `src/compiler/trace.ts` | 已有：`explainTransform(source)` 输出逐节点决策 trace（`L9 tag/link-to-view：<a> → <view>`）；debug 构建 `.transform-debug/` 携带决策链（底线循环 ②）；规则 apply() 分派层（阶段三）随 @proteus/compiler 独立包 |
| 规则覆盖（✅ 已实现：底线循环 ①③） | `src/compiler/overrides.ts` + `proteus.config.ts rules` 段 | 已有：disabled / mapping / customTags 贯通三转换函数（17 用例）；阶段三：规则 apply() 升级为完整插件体系（自定义 AST 转换，roadmap v2.0 编译期插件） |
| 组件系统（✅ 已实现，决策 #79/#91/#92） | `packages/compiler/` + `scripts/gen-routes.ts` | 已有：defineProps（对象 + TS 泛型）→ properties、defineEmits + emit() → triggerEvent、defineExpose（no-op 校验）、<slot> 透传、attached 生命周期；父模板标签 + bind: 冒号事件 + **usingComponents 自动注入**（页面 page.json + 组件 component.json 嵌套，应用/框架组件双目录）；TS 参数标注剥离 |
| scoped CSS（✅ 已实现，决策 #77） | `packages/compiler/src/style.ts` + `template.ts` | 已有：`<style scoped>` → 模板元素附加 `data-v-xxx` + 选择器末尾追加 `[data-v-xxx]`（:deep 去包装、@media 骨架保留、scopeId 由文件名 djb2 哈希稳定生成）；MVP 简化：任一 scoped 全量作用域化 |
| 指令补全（✅ v-show / :class 数组 / .self / .once 已实现，决策 #76/#77/#88） | `packages/compiler/src/template.ts` + `script.ts` | 已有：`v-show` → `hidden="{{!expr}}"`、`:class` 数组（逐项拼接）、`.self/.once` 修饰符 → proteusSelf/Once 包装方法（target 判断 / data 标记）；`@keyup.enter` 等键位警告（无对等键盘事件，input 用 `@confirm`） |
| CSS 预处理器（✅ scss 已实现，决策 #87） | 插件 `preprocessStyle` 钩子 + `sass` | 已有：编译器新增 `CompileOptions.preprocessStyle(lang, content)` 钩子（保持 @proteus/compiler 零依赖）；插件注入 sass 实现——`<style lang="scss">` 编译为 css 后进 WXSS（Web 端 Vite 原生处理 scss）；forms.vue 演示（变量 $brand + 嵌套）；less 待内置 |
| 方法级 sourcemap（✅ 已实现，决策 #80） | `packages/compiler/src/script.ts` + `vite-plugin-mp-transform.ts` | 已有：sourcemap v3（VLQ 编码，产物行 → 源码行：方法体 / watch 回调体）+ 调试构建落盘 .js.map + sourceMappingURL + 方法行号注释（微信开发者工具可定位源码） |
| 类型提示全链路（✅ 已实现，决策 #93-#97） | `src/router/types.ts` + `scripts/gen-routes.ts` + `src/shims/events.d.ts` | 已有：`<route>.params` 声明 → `RouteParamsByName` 类型表（gen-routes 生成）；`router.push` 泛型（name 受限 + params 匹配 + 多余字段 EPC）；`PageOnLoad<N>` 页面 onLoad 参数（runtime onLoad Web no-op）；事件类型 `MpEvent/MpInputEvent/TapEvent`（shims 全局）；类型测试 tests/types/；三处全链路用法见 docs/types.md |

### v0.4 运行时与性能（对标"运行时性能"差距）

**目标**：把运行期开销做到可量化优于 uni-app / Taro 3（编译期为主的红利兑现）。

| 任务 | 落地位置 | 说明 |
|---|---|---|
| setData 深度优化（✅ 已实现，决策 #81） | `src/runtime/setDataBridge.ts` | 已有：批量合并（16ms 窗口）+ 路径合并 + 值去重 + **深层对象/数组 diff**（变更递归出叶路径补丁，只推送变化子路径——对象更新从整对象 → 变化字段；首次推送展开叶路径）+ reset（测试隔离） |
| Vapor codegen 借鉴 | `src/runtime/setDataBridge.ts` | 对照已落地：setData 依赖追踪精确化 = 编译器路径化写入（ref/computed/watch 写入点合并）+ 运行时深层叶路径 diff——与 Vapor reset/effect 命令式更新同构；v0.6 再对照 Vapor 运行时做基准 |
| 虚拟列表（✅ 已实现并框架内置化，决策 #82/#83） | `src/components/virtual-list/`（★框架内置组件） | 已有：`<virtual-list :items :item-height :height>` 数据切片 + 占位（只渲染可视区，多 2 行缓冲）；双端同源码（scroll-view 模板 → MP 原生滚动 + bindscroll / Web 自定义元素 + CSS overflow）；onMounted 首屏计算 + scroll 联动；**框架内置**：产物 `proteus/<name>/index` 前缀（与应用组件 `/components/...` 隔离），gen-routes 组件解析应用优先、回退框架，demo 万条数据；通用插槽渲染待编译器支持作用域插槽 |
| Pinia 状态管理适配（✅ Web 端完整 + MP 运行时桥，决策 #85） | `examples/stores/` + `src/runtime/store/` | 已有：Web 原生 Pinia（main.ts createPinia + counter store + pinia-demo 页）；MP 端框架级 store 桥 `createStore`（单例 + subscribe 广播）+ `connectPageStore`（订阅 → page.setData）；MP 端 Pinia 编译（跨模块内联）待跨模块编译能力 |
| 包体积控制（✅ 已实现，决策 #86） | `scripts/bundle-report.ts` + `proteus.config.ts budget` | 已有：构建期主包体积仪表（扫描 dist/mp-weixin 排除分包/调试目录 + Top 大文件报告 + 预算门禁——config.budget.mainPackageKB 默认 1200KB，strict 时超限构建失败）；实测 32KB / 1200KB |
| 性能基准（✅ 已落地，决策 #81） | `tests/perf/` | 已有：setData 桥接基准（1000 次变更 → 1 次批量 / 对象 diff 全量 4 条 vs 变化 1 条 / 同值去重零推送）+ 编译引擎基准（典型页平均耗时报告 + 宽松阈值门禁），随 npm test 运行 |

### v0.5 多端扩展（对标"多端覆盖"差距）

**目标**：证明 adapter + 映射表"可插拔"架构（决策 §0.3 原则 10），先覆盖国内小程序主流平台；并补齐渲染器可靠性（**Skyline iOS 真机白屏兜底**）。

| 任务 | 落地位置 | 说明 |
|---|---|---|
| 支付宝小程序 | `src/platform/` 新增 adapter + 编译器目标平台选项 | 映射表插拔（`view/text` 同为支付宝原生标签，工作量主要在 API 差异）；`platform: 'mp-alipay'` |
| 抖音小程序 | 同上 | 抖音标签与微信高度同构，成本最低 |
| WebView 渲染补齐 | 编译器产物兼容层 | 降级模式从"可运行"提升到"视觉一致"（补齐 WebView 不支持能力告警清单） |
| **Skyline iOS 真机白屏兜底** | 编译器产物 + 页面 renderer 配置 | iOS 真机偶发白屏（微信平台已知问题，需真机复现路径）。对策三层：① **能力兼容清单**——编译期警告扩充（float/fixed 已有先例），白屏高发场景（动效 / worklet / 特定组件）编译期预警；② **页面级降级通道**——`renderer` 可配置 WebView 兜底（仅白屏风险页启用，不全局降级）；③ **v1.0 真机验收**必须覆盖 iOS Skyline 白屏复现与降级切换 |
| HarmonyOS | 小程序侧（微信基础库 3.7+ 已支持） | `wx.getDeviceInfo()` 平台兼容分支 |
| 原生能力桥 | 插件体系设计 | 原生组件包装 / 原生事件映射 / `wx` API 白名单管理（对标 Taro 插件体系） |

### v0.6 App 原生 + Vapor 兼容（标准 Vue 原则的长期红利）

**目标**：把"业务代码 = 标准 Vue SFC"推进到 App 原生端与 Vapor 模式——借助 **Vue 官方能力**（自定义渲染器 / Vapor 运行时）复用同一份代码，证明"标准 Vue 优先"原则的生态红利（生态锁定的反面：生态越大，Proteus 越强）。

| 任务 | 落地位置 | 说明 |
|---|---|---|
| App 端自定义渲染器（iOS/Android） | 新增 `packages/renderer-app/`（`@proteus/renderer-app`） | `@vue/runtime-core` 的 `createRenderer` 定义原生 host config（view → 原生视图、text → 原生文本、事件桥接、diff 策略），**标准 Vue SFC 直接运行**；与编译期为主的关系：Web/小程序仍走编译期通道，App 端是平台适配层的**运行时通道**——两条通道共享同一份源码、同一套 Router/守卫 API、同一份规则注册表心智 |
| App 端路由 / 状态桥接 | `packages/router/` 新增 app adapter | 复用既有 Router API（守卫 / 参数 / routeType），映射到原生导航栈；Pinia 原生侧 state 同步 |
| 原生能力桥（App） | 插件体系 | 原生组件 / 原生事件 / 原生模块调用（对标 Taro 插件体系，v0.5 原生能力桥复用） |
| **Vapor 运行时兼容（Web 端 Vapor 模式）** | `packages/plugin-vite/` + 运行时 | 业务代码用 `@vue/vapor` 编译跑 Web（无虚拟 DOM、更小包体、更快）；Proteus MP 编译管线验证与 Vapor 特性子集兼容——**同一份源码双模式可编译**（Vapor 跑 Web + Proteus 编译 MP） |

**架构要点**：App 端 = **运行时渲染通道**（Vue 官方渲染器，非自研 diff），与 Web/MP 的编译期通道并列；"编译期为主"原则约束 Web/MP（不引入运行时 DOM 模拟），App 端用 Vue 官方能力属平台适配层扩展而非原则妥协。Vapor 与 Proteus 哲学同构（都拒绝虚拟 DOM），互为镜像：Vapor 的 codegen 借鉴进 setData（v0.4），Proteus 的产物契约可作为 Vapor 多端化的参考。

### v1.0 生产可用（能力矩阵达标）

**目标**：能力矩阵 9 域全部达标 + 真实项目验证，可对外宣传"生产级"。

- 能力矩阵（第 2 节）全部 ✅
- 至少 1 个中大型真实项目落地验证（含分包、复杂页面、长列表、状态管理）
- **真机验证含 iOS Skyline 白屏场景**：复现路径记录 + 页面级 WebView 降级兜底生效（v0.5 对策验收）
- 性能基准达标（见第 6 节量化指标）
- 文档站（对标 vuejs.org 风格）：API 参考、迁移指南、示例库
- 稳定 API 承诺 + 版本兼容策略（semver）

### v2.0+ 生态成熟（对标"生态建设"）

| 任务 | 说明 |
|---|---|
| 调试 devtools | 小程序端编译产物可读面板（转场 / setData / 路由时间线），对标 Taro devtools / uni-app HBuilderX 调试器 |
| 组件库 | 首个由社区共建的跨端组件库（走"标准 Vue + 编译"路线，天然双端可用） |
| 插件体系 | 编译期插件（自定义映射 / 自定义产物）、运行时插件（中间件） |
| 社区设施 | 示例仓库、Gitter/Discord、贡献者指南、RFC 流程 |

## 5. 架构演进（monorepo 拆分）

```
proteus/                        # monorepo（v0.2 起）
├── packages/
│   ├── compiler/               # @proteus/compiler  编译引擎（纯函数，零依赖，当前 src/compiler）
│   ├── runtime/                # @proteus/runtime   setData 桥接 / 生命周期 / 状态管理（当前 src/runtime）
│   ├── router/                 # @proteus/router    路由 API / 守卫 / 转场（当前 src/router）
│   ├── plugin-vite/            # @proteus/plugin-vite  小程序编译 Vite 插件（当前 vite-plugin-mp-transform.ts）
│   ├── renderer-app/           # @proteus/renderer-app  App 原生渲染器（v0.6：Vue 自定义渲染器宿主）
│   ├── cli/                    # @proteus/cli       proteus build / dev
│   ├── create-proteus/         # create-proteus     脚手架
│   └── shared/                 # @proteus/shared    公共类型与工具
├── examples/                   # 示例应用（随版本更新持续演示新能力）
└── docs/                       # 文档（本文件 + 快速开始/配置/编译/路由）
```

依赖方向（单向）：`plugin-vite → compiler + shared`，`cli → compiler + gen-routes`，`runtime/router → shared`。业务代码只依赖 `@proteus/*` 公开包。

## 6. 性能目标（量化）

| 指标 | MVP 现状 | v1.0 目标 | 对标 |
|---|---|---|---|
| 主包体积预算 | 未测 | ≤ 1.2MB（含框架运行时，留 2MB 平台上限余量） | uni-app 常超 2MB 需分包 |
| setData 频次 | 16ms 合并窗口 | 高频更新场景 ≤ 60 次/秒（1 帧 1 次） | uni-app 全量同步远超 |
| 首屏渲染 | 未测 | 冷启动 ≤ 1.5s（中端机） | Taro 3 运行时模拟开销高 |
| 长列表滚动 | 未支持 | 万条数据虚拟列表 60fps | 对齐 Taro VirtualList |
| 编译耗时 | ~100ms（9 页） | 百页工程 ≤ 30s | uni-app 大工程编译缓慢 |

## 7. 非目标与原则（延续决策 §0.4，规划不越界）

- **SSR / 服务端渲染**：不做（跨端框架非目标）
- **App 原生端（iOS/Android 原生渲染）**：MVP 非目标；**规划 v0.6**——通过 Vue 官方自定义渲染器（`createRenderer`）实现，复用标准 Vue 业务代码；走 Vue 官方渲染器而非自研 diff
- **Vapor 兼容**：MVP 非目标；规划 v0.4 借鉴 codegen + v0.6 Web 端 Vapor 模式（业务代码双模式可编译）
- **自研 UI 组件库（初期）**：v2.0 前不提供，Web 直接复用 Vue 生态组件，MP 编译
- **全平台覆盖**：按 v0.5/v0.6 列表扩展，不为"端数量"牺牲"端质量"
- **编译期为主原则不妥协**：Web/MP 不引入运行时 DOM 模拟（Taro 3 教训，决策 §0.3 原则 3）；App 端走 Vue 官方渲染器属**平台适配层扩展**（与编译期通道并列，业务代码仍为零转换标准 Vue），不构成原则妥协
- **标准 Vue 优先不妥协**：不为平台能力引入非标准 DSL（决策 §0.3 原则 1）

## 8. 里程碑验收清单

| 里程碑 | 验收 |
|---|---|
| v0.2 | `@proteus/compiler` 已发布 npm 且示例工程改用 npm 包（含 49 条规则 AI 说明书随包导出）——✅ 独立包/CLI/脚手架/CI/贡献设施/发布流水线（changesets）已就绪，**npm 发布待启用**（用户指示暂不真实发布）；`proteus explain` 可用（✅） |
| v0.3 | 组件 props/emits/slots、computed、scoped CSS、`v-show` 均有单测与 demo（✅ 全部落地，决策 #76-#80）；sourcemap 接入开发者工具（✅ 已实现：sourcemap v3 + 调试构建落盘） |
| v0.4 | 虚拟列表 demo + 性能基准套件落地（✅ 已落地，决策 #81/#82/#83）；Pinia 双端可用（🟡 Web 完整 + MP 运行时桥，MP 编译待跨模块） |
| v0.5 | 支付宝 + 抖音端 demo 构建通过并真机验证 |
| v0.6 | App 端 demo（iOS/Android）用 Vue 自定义渲染器跑通同一份示例代码；Web 端 Vapor 模式构建通过；setData 依赖追踪基准达标 |
| v1.0 | 能力矩阵全 ✅；真实项目验证报告（含 iOS 真机 Skyline 白屏场景兜底验证）；性能指标达标；文档站上线 |
| v2.0 | devtools 可用；首个社区组件库发布；插件体系文档化 |

---

**文档版本**：v2.54（欠账清理：能力矩阵 v0.2-v0.4 同步）· 本路线图随能力落地持续更新，每完成一个里程碑在 [PROJECT_MEMORY.md](../PROJECT_MEMORY.md) 归档决策。
