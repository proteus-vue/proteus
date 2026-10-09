---
title: 环境要求
order: 4
group: 开始
---

# 环境要求

## 30 秒创建工程

环境就绪后，一条命令生成工程骨架（脚手架生成 Web / 微信小程序工程；App 三端（iOS/Android/鸿蒙）直食同一语义 IR——`proteus build --target ios|android|harmony` 编译屏内容、宿主工程打包，接入进度见[端与成熟度](/docs/framework/ends-matrix)，详见[创建你的第一个工程](/docs/05-create-project)）：

```bash
npm create @proteus-vue/proteus my-app
cd my-app && npm install
npm run dev:web     # 浏览器直接跑 Web 端
```

> 想先看看能做出什么？打开 [Playground](/playground) 在浏览器里改代码、实时看编译产物——零安装。

## 环境清单

开始之前，准备以下环境：

| 依赖 | 版本要求 | 用途 |
|---|---|---|
| Node.js | Web/MP：≥ 18 · App 三端 / 框架仓：≥ 22.12 | 构建工具链（Vite 5 / esbuild / tsx）；App 打包与框架仓测试需 `require(ESM)` |
| npm | 随 Node | 依赖管理（`@proteus-vue/*` 包安装） |
| Vue / Vite / TypeScript | Vue ≥ 3.4 / Vite ≥ 5 / TS ≥ 5.4 | 框架运行基线（模板工程 package.json 已锁定） |
| 微信开发者工具 | 最新稳定版 | 小程序端调试（需真实 AppID） |
| 微信基础库 | ≥ 2.29.2 | 启用 Skyline 渲染与 wx.router 自定义路由 |

> 无真实 AppID 时可在开发者工具「详情 → 基本信息」使用测试号，但 Skyline 能力建议用真实 AppID 验证。

## 各端的不同依赖面

| 你要做什么 | 需要安装 | 不需要 |
|---|---|---|
| 只跑 Web 端（`dev:web` / `build:web`） | Node.js 一项 | 微信开发者工具 / AppID |
| 调试小程序端（`dev:mp`） | + 微信开发者工具 + AppID（测试号可用） | — |
| 构建小程序产物（`build:mp`） | + 微信基础库 ≥ 2.29.2（工具内切换） | — |
| 构建 iOS（`build --target ios`） | + Xcode ≥ 15（含 iOS SDK + `devicectl`）+ **Rust 工具链（cargo）** | 小程序端工具 / Android SDK |
| 构建 Android（`build --target android`） | + Android SDK（platforms + build-tools）+ JDK 17 | Xcode（用随包预编译的 runtime AAR，无需 cargo） |
| 构建鸿蒙（`build --target harmony`） | + DevEco Studio（含 hvigor + hdc） | 小程序端工具 |
| 上线发布 | + 真实 AppID（替换模板占位 `wx0000000000`） | — |

只需要跑 Web 端的话，Node.js 就够了——微信开发者工具（小程序端）与各端原生工具链（App 三端）在你要构建对应端时再装也不迟。

## 版本出处

- **微信基础库 ≥ 2.29.2**：Skyline 渲染引擎与 `wx.router` 自定义路由的最低版本要求（低于此版本 skyline 页面回退 WebView 且自定义转场不可用）
- **Vue ≥ 3.4**：编译器消费 `@vue/compiler-sfc` 的 AST 形态基线
- **Node ≥ 18（Web/MP）· ≥ 22.12（App 三端 / 框架仓）**：`require(ESM)` 自 Node 22.12 起稳定支持；框架仓测试套件（jsdom 27）与 App 打包链依赖它。用户工程的 Web/MP 端在 Node 18 下即可运行；`proteus doctor` 会在框架仓将其判为阻断、在用户工程降为提示。
- **Rust 工具链（`cargo`）· 仅 iOS**：iOS 打包用 `cargo build --target aarch64-apple-ios` 交叉编译排版内核（`packages/layout-core-rust` + `packages/host-abi`）；Android 与鸿蒙使用随包预编译的 runtime，无需 cargo。

## 下一步

- [创建你的第一个工程](/docs/05-create-project)
