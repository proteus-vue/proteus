# Proteus（普罗透斯）—— AI-native 透明跨端编译框架

> **一份标准 Vue 源码，编译器化作千端形态。**
> Web 端零转换直跑标准 SPA；微信小程序端编译为 Skyline 原生四件套（`.wxml` / `.wxss` / `.js` / `.json`）。
>
> **AI-native 透明编译**：所有转换规则集中为自描述的**规则注册表**（`src/compiler/transforms/`），
> 每条规则自带一份 AI 说明书（what / why / when / example / verify / 决策号），
> 产物可枚举、可查询、可反查源码——编译器对 AI 代理与人类开发者都是透明的，拒绝黑盒。

[文档导航](#文档导航) · [快速开始](docs/getting-started.md) · [配置参考](docs/configuration.md) · [编译原理](docs/compiler.md) · [路由与转场](docs/routing.md)

---

## 为什么叫 Proteus（名字来源）

**普罗透斯（Proteus）** 是古希腊神话中的海神，波塞冬的牧人，被称作"海中老人"。《奥德赛》中他在法罗斯岛被擒时化作狮子、蛇、野猪、流水与大树，英语中 **protean（千变万化）** 一词正源于他的名字；同时他通晓过去、现在与未来。

| 普罗透斯的神格 | 框架的差异化优势 |
|---|---|
| **变形**：同一存在变换出多种形态 | **编译转换**：一份标准 Vue SFC → Web 形态 + 小程序形态，形态可变、本质不变 |
| **先知**：预知未来 | **编译期为主**：一切转换在 build-time 完成，运行期零虚拟 DOM |
| **本质恒定**：变形后本体仍是普罗透斯 | **标准写法**：业务代码始终是标准 Vue + 标准 HTML，平台差异由编译器吸收 |
| **通晓万物**：知过去、现在、未来 | **双端一致**：一套代码在 Web 与小程序两端行为一致 |
| **化身为光**：变形即显形，无所遁形 | **透明编译**：所有转换规则自描述、可枚举、可查询（AI 说明书），产物可反查源码，拒绝黑盒 |

## 主流国产跨端框架的痛点，与 Proteus 的对策

| # | 主流痛点 | 代表框架 | Proteus 对策 |
|---|---|---|---|
| 1 | 非标准 DSL（必须写 `<view>/<text>`） | uni-app | 业务代码只写**标准 HTML 标签 + 标准 Vue SFC**，`div→view` 等映射全部收敛在编译器内部 |
| 2 | 工具链锁定（强依赖 HBuilderX） | uni-app | 纯 Vite 插件 + 标准 npm scripts，无 IDE 依赖，任何 CI 可跑 |
| 3 | 编译黑盒、产物不可读、报错难定位 | uni-app | 产物贴近手写 + **产物自校验**（坏产物当场报错指明文件）+ `PROTEUS_DEBUG=1` 全链路日志 |
| 4 | 运行时模拟 DOM + 自研 diff，首屏差 | Taro 3 | **编译期为主**：静态模板全部编译成 WXML，运行期无虚拟 DOM |
| 5 | setData 全量大对象同步，高频更新卡顿 | uni-app | 脏路径收集 + 16ms 批量 + 路径合并 + 值比较去重 |
| 6 | Vue 版本滞后 / 升级被工具链绑架 | uni-app | 直接绑定官方 Vue 3.4+ 主线，编译器用官方 `@vue/compiler-sfc` |
| 7 | 条件编译 `#ifdef` 散落业务代码 | uni-app | 平台差异收敛到 `proteus.config.ts` + `platform/adapter.ts`，**业务代码零条件编译** |
| 8 | 类型安全缺失 | 多数 | 路由表、路由参数、事件全链路 TS 类型推导 |
| 9 | 跨端 CSS 不一致 | uni-app | MP 端编译期 px→rpx；**Web 端保持标准 CSS 不转换**，差异由编译器吸收 |
| 10 | 主包 2MB 限制 | 微信平台 | 分包声明写入配置，编译期生成 `app.json` subPackages |
| 11 | 生态锁定（私有插件市场） | uni-app | 标准 Vue 组件体系 + npm 生态，无私有市场 |

## 核心特性

- **标准 Vue 3 SFC 开发**：`<div>`/`<p>`/`<h1>`/`<a>` 照写不误，映射到小程序标签由编译器完成；`h1-h6/p/a` 自动注入对齐 Web UA 的语义基础样式（大标题/段距/链接色），两端视觉一致
- **AI-native 透明编译**：编译引擎内置**规则注册表**（`src/compiler/transforms/`），49 条转换规则每条自带 AI 说明书（what/why/when/example/verify/决策号），`listTransformRules()` / `getTransformRule(id)` 可枚举可查询；`explainTransform()` 对任意 Vue 文件输出**决策 trace**（该文件触发的全部转换规则 + 行号）——AI 代理与开发者都可读懂编译器的每一个决定，映射表与实现同源引用防漂移
- **底线三循环（规则覆盖）**：`proteus.config.ts` 的 `rules` 段（`disabled` / `mapping` / `customTags`）按规则 ID 开关编译行为，改配置即生效、无需改框架代码——AI 写规则 → 框架获得新能力；debug 构建 `.transform-debug/` 携带完整决策链，产物问题一处定位到规则
- **Web 零转换**：Web 端直接跑标准 Vite SPA（完整 devtools + HMR），不做二等公民
- **Skyline 一等公民**：页面默认 `"renderer": "skyline"`，`wx.router` 自定义路由转场（半屏 / 上滑 / 层叠缩放）作为一等能力；Web 端用 Vue `<Transition>` 复刻同一套 `routeType` API
- **反编译黑盒**：产物自校验 + 调试日志 + 源码行号注释 + 转换函数独立可单测，坏产物当场报错
- **运行时极简**：只做数据桥接（setData 批量合并）与路由导航，无运行时 DOM 模拟
- **类型安全全链路**：`gen-routes` 编译期生成路由表与类型，`router.push({ name, params })` 全程推导
- **分包内置**：主包 / 分包从目录结构 + 配置推导，编译期生成 `app.json`
- **全链路调试**：`npm run debug:mp` 一键注入 `[proteus][环节]` 日志，正式构建零残留

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

同样的源码在 Web 端由 Vue 原生渲染，在小程序端由编译器转为 WXML + WXSS + `Page()` JS。完整示例见 `examples/pages/`。

## 路由与自定义转场

```ts
import { router } from '@proteus/router'
import { beforeEach } from '@proteus/router/guards'

// 命名路由 + 参数（自动序列化为 query）
router.push({ name: 'user-profile', params: { id: 1 } })

// Skyline 自定义路由转场（Web 端自动映射为 Vue Transition 等价转场）
router.push({ name: 'user-profile', routeType: 'halfScreen' })

// 守卫
beforeEach((to, from) => to.meta?.requiresAuth ? !!getToken() : true)
```

内置转场预设：`halfScreen`（半屏弹层）/ `slideUp`（底部上滑）/ `scaleDown`（层叠缩放），配置在 `proteus.config.ts`，可在 `examples/main.mp.ts` 手写覆盖（**极简入口**：只需写自定义 builder，app 骨架由框架自动生成），也可用微信预设 `routeType: 'wx://bottom-sheet'`。详见[路由与转场](docs/routing.md)。

## 目录结构

```
proteus/
├── proteus.config.ts               # 框架统一配置（平台 / 路由 / 转场 / 样式策略 / 规则覆盖）
├── vite-plugin-mp-transform.ts     # 小程序编译 Vite 插件（薄适配层，@proteus/plugin-vite 前身）
├── scripts/gen-routes.ts           # 编译期路由生成器（app.json / page.json / 路由表）
├── packages/compiler/              # ★ @proteus/compiler 编译引擎独立包（v0.2 起 monorepo）
│   └── src/                        #   纯函数引擎 + transforms 规则注册表（49 条 AI 说明书）
├── src/
│   ├── platform/                   # 平台适配层（adapter / web-adapter / mp-adapter）
│   ├── router/                     # 路由（index / guards / skyline / presets 内置转场）
│   ├── runtime/                    # 运行时桥接（setData 批量 / 页面生命周期 / app 骨架 / 调试）
│   └── shims/                      # wx / Page / RouteBuilder 类型声明
├── examples/                       # 示例应用（能力矩阵活文档：表单指令 / config 规则演示 / 转场 / 分包）
├── tests/                          # 117 个单元测试 + 8 个 Web e2e 测试
├── .github/workflows/ci.yml        # CI：test / vue-tsc / build:web / build:mp / 独立包构建 / e2e
└── CONTRIBUTING.md                 # 贡献指南（规则改动同步约定）
```

## 测试与验证

```bash
npm test                # 114 个单测（router / mp-transform / runtime / transforms / explain / overrides / golden / plugin）
npm run test:e2e:web    # 8 个 Web 端 e2e（Playwright）
npm run verify          # test + build:web + build:mp 一键全过
npm run debug:mp        # 小程序全链路调试构建（注入 [proteus][环节] 日志）
```

## 文档导航

| 文档 | 内容 |
|---|---|
| [快速开始](docs/getting-started.md) | 环境、命令、首个页面、开发者工具导入、调试 |
| [配置参考](docs/configuration.md) | `proteus.config.ts` 全量字段说明 |
| [编译原理](docs/compiler.md) | 编译管线、标签/指令映射表、样式转换、反黑盒机制 |
| [路由与转场](docs/routing.md) | 路由生成、Router API、守卫、自定义转场、平台硬边界 |
| [规划路线](docs/roadmap.md) | 对标 uni-app / Taro 的分里程碑路线：能力矩阵、架构演进、性能目标 |
| `src/compiler/README.md` | 编译引擎模块边界与独立开源提取路径 |

## 开发状态与路线图

- **MVP 已完成**：Web + 微信 Skyline 双端编译、路由/导航/分包/tabBar、自定义路由转场、setData 桥接、反黑盒调试、AI-native 规则注册表（49 条 AI 说明书）+ 决策 trace（explainTransform）+ 底线三循环（规则覆盖 config 开关）、114 单测 + 8 e2e
- **规划**：编译引擎独立开源 `@proteus/compiler` + CLI、组件系统/computed/watch 补全、多端扩展（支付宝/抖音/鸿蒙/**App 原生 via Vue 自定义渲染器**）、**Vapor 兼容**、性能优化、生态建设——完整对标大厂跨端框架（uni-app / Taro）的**分里程碑路线见 [docs/roadmap.md](docs/roadmap.md)**

## 开源协议

Proteus 使用 [Apache-2.0](LICENSE) 协议：宽松可商用（与 MIT 同等核心自由），并附**专利授权**条款——对采用者与贡献者都更友好，适合作为被嵌入商业项目的基建类框架。

## 已知限制（MVP）

- 支持微信小程序（Skyline 优先，WebView 降级仅保证可运行）；支付宝 / 抖音 / 快手为非目标
- `computed` / `watch` / 跨模块引用、`:class` 数组语法、`v-show`、复杂事件表达式暂不支持（编译期警告）
- 自定义路由转场是 Skyline 平台能力：**不能从 tabBar 页发起**；Web 端用 Vue Transition 复刻同一套 API
- 运行时禁止动态注册页面 / 路由（编译期静态声明）
- **Skyline 在 iOS 真机偶发白屏**（微信平台已知问题）：降级兜底策略（能力兼容清单 + 页面级 WebView 降级通道）已规划在 [roadmap.md](docs/roadmap.md) v0.5，v1.0 真机验收覆盖

---

**文档版本**：v2.47 · **适用框架**：Vue 3.4+ / Vite 5+ / TypeScript 5.4+ / 微信基础库 2.29.2+
