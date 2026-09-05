---
title: 常见问题
order: 36
group: 参考
---

# 常见问题

这里集中回答选型时最常问的十个问题。每条答案都有仓库文档或已落地代码作为依据，不能证实的内容会明确标注 📋。

> Proteus 的回答习惯是**诚实分级**：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库。选型决策值得建立在真实边界上。

## 和 uni-app / Taro 的区别是什么？

路线不同：uni-app / Taro 是「逻辑跨端 / DSL 翻译」路线——把一套 DSL 转换到各端；Proteus 是**语义收敛**——定义与平台无关的语义内核，平台差异全部下沉为后端实现细节。具体差异：

| 维度 | uni-app / Taro 3 | Proteus |
|---|---|---|
| 开发范式 | 非标准 DSL（`view/text`）+ 条件编译 / 运行时模拟 DOM | 标准 Vue 3 SFC + 标准标签，编译期吸收差异 |
| Web 端 | 转换产物 | **零转换**标准 Vite SPA |
| 渲染底座 | WebView（锁定） | 可插拔（VueDom / Native / Flutter / Headless） |
| 编译器 | 锁定 | 可插拔 SPI（Node / Rust 一个 flag） |
| 同 App 多后端 | ❌ | ✅ 按页面切换 + 混合渲染 |

一句话：普通 DSL 映射是「换种语法写原生代码」；Proteus 是「定义语义，让任何后端实现它」——这是语法翻译与架构方法论的代际差。

## 和 Flutter 的区别是什么？

Flutter 走**自绘引擎**路线：自己算布局（Skia 自己画像素），追求像素级一致。Proteus 选择第三条路线：**语义统一 + 原生实现**——框架只定义语义契约，各端映射到最强原生实现（iOS 遵循 HIG、鸿蒙遵循 HarmonyOS 指南、Android 遵循 Material）。两者关键差异：

- **像素一致 vs 语义一致**：Flutter 要求五端逐像素相同；Proteus 要求对语义的理解相同，视觉表现符合该平台规范
- **系统新特性**：自绘路线滞后于系统；语义映射路线即时可用（如系统级玻璃直接映射 UIGlassEffect）
- **关系不是互斥**：Flutter 本身可以成为 Proteus 的一个渲染后端（Flutter widget 映射后端已原型落地）——Flutter 锁死 Skia，Proteus 不锁任何引擎

## 为什么用 p-* 语义组件，而不是直接写 HTML / wx 标签？

因为框架标准必须**不绑定任何单一平台**（原则 #0 第五投影）：禁止把任何既有平台的组件名、属性名、API 形态直接上升为框架标准。落到规则上：

- `p-*` 前缀 + 语义命名；`view` / `scroll-view` / `swiper` 等小程序组件集属于 Layer 1 兼容层，不是标准（G-31.1）
- 每个组件属性必须声明 Tier 降级行为，编译期拦截缺失（G-31.2）
- Layer 0 所有 API 必须 Promise / Hook 化，没有 `wx.xxx` 式全局对象（G-31.3）
- 连 AI Agent 也不得生成小程序组件名，必须走语义原语（G-36.2）

业务侧的体验不是变复杂，而是变简单：写标准 Vue SFC、零条件编译；`wx.*` 存量代码用 `@proteus-vue/compat-miniprogram` + `proteus migrate mp` 渐进迁移。

## 现在支持哪些端？（诚实版）

- **✅ Web 全功能 + 微信小程序**（Skyline 优先，WebView 降级仅保证可运行）；支付宝 / 抖音 / 快手小程序为非目标
- **🟡 原生 / Flutter**：五官方渲染后端中 Native×3 / Flutter 已有 widget 级原型映射（官网 Playground 可见其描述树），原生工程接线待 G-37 分批推进
- **📋 车机 / TV / 手表**（G-25）、**任意端接入**（G-30）、宿主运行时与执行载体（G-39/40）规划已入库，按路线图分批落地

## 性能怎么样？

框架有一条铁律：**性能数据必须实测，未实测的数字禁止对外宣称**。所以这里没有跑分，只有可证实的机制：

- **编译期为主**：小程序侧脏路径收集 + 16ms 批量 setData、编译期 px→rpx、分包声明自动写入 app.json；Web 侧零转换标准 Vite SPA，无跨端桥
- **基准门禁**：性能基准固化入仓库，退化超过 5% 即阻断合并（G-44.5），可用 `npm run bench` 复现
- **原生端现状**：处于原型映射阶段，性能数字待 benchmark 基线（📋）
- **v1.0 量化目标**（📋 目标而非承诺）：主包 ≤1.2MB、高频更新 setData ≤60 次/秒、冷启动 ≤1.5s、百页工程编译 ≤30s

## TypeScript 支持情况？

TypeScript 是一等公民，不是「顺便支持」：

- 全仓 TypeScript 5.4+ 编写，适用环境 Vue 3.4+ / Vite 5+；`vue-tsc` 零错误是 CI 门禁
- `@proteus-vue/types` 提供全局 Registry + Platform 判别联合，规约铁律要求运行时模型「无 any」
- 路由表全链路 TS 类型推导：`router.push({ name, params })` 的参数类型由路由表自动推导
- i18n 的 `t()` 类型安全、app.config schema 编译期校验、`api-check` 能力门禁均为 TS 生态内工具

## 学习成本大吗？心智模型是什么？

一句话：**只学语义组件，不学各端**。心智模型只有一条公式——语义定义（框架做）+ 后端实现（平台做）：业务代码只消费语义接口（p-* 组件 + 50 个 Capability Hook），对渲染后端、编译后端、宿主零感知。已经会 Vue 3 SFC 的团队几乎没有新语法要学；方法论细节可从「统一语义收敛」五支柱读起，那是官方指定的 onboarding 第一课。

## 某端不支持某个能力怎么办？

**降级不崩溃**（原则 #4）：不支持的能力沿 L3→L2→L1→solid 降级链处理，绝不崩溃。配套机制保证降级不变成静默劣化：

- 后端必须诚实声明 capabilities，未声明 = 不支持（G-37.3）
- 降级必须可见：开发期警告 + 生产期日志，禁止静默（G-37.6）
- Capability Hook（如 `useCamera` / `usePayment`）缺桥时诚实降级，业务零平台分支
- 小程序 Platform Adapter 为每个能力声明兼容级别（L0-L3），L2/L3 必须有显式降级路径，禁止静默失败

## 我有存量小程序代码，怎么迁移？

迁移是渐进的，不是重写。`@proteus-vue/compat-miniprogram` 提供 wx 兼容桥；`proteus migrate mp` codemod 做 `wx.*` API 扫描、生成映射日志（tag/api × 自动/手动）与覆盖率报告；Agent 侧另有 migrate-miniprogram Skill 复用同一条链路。存量页面先跑在兼容层上，再按语义组件逐步收敛——小程序组件集被定位为 Layer 1 兼容层，正是为了这条迁移路径。

## 如何参与贡献 / 查看路线图？

- **路线图**：`docs/board-inventory.md` 是全部 plan 的单一权威索引（状态总表）📋；版本线见 `docs/roadmap.md`（v0.1→v2.0），里程碑线 M1-M3 见 roadmap-2
- **当前进行中**：渲染后端 SPI 规范（G-37）、宿主运行时（G-39）、执行载体（G-40）、测试框架 B1、以及 G-46~G-52 七个新规划的 B 批次（均为 📋 待启）
- **贡献**：仓库提供 CONTRIBUTING.md（含规则改动同步约定），协议为 Apache-2.0（宽松可商用 + 专利授权）

## 相关页面

- [什么是 Proteus](/docs/01-intro)：核心公式与设计哲学
- [可插拔架构](/docs/22-architecture)：G 系列分层与 SPI-First 三件套
- [一致性验证](/docs/29-conformance)：上述所有承诺的机器判定机制
