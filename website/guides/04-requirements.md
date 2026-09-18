---
title: 环境要求
order: 4
group: 开始
---

# 环境要求

开始之前，准备以下环境：

| 依赖 | 版本要求 | 用途 |
|---|---|---|
| Node.js | ≥ 18 | 构建工具链（Vite 5 / esbuild / tsx） |
| npm | 随 Node | 依赖管理（`@proteus-vue/*` 包安装） |
| Vue / Vite / TypeScript | Vue ≥ 3.4 / Vite ≥ 5 / TS ≥ 5.4 | 框架运行基线（模板工程 package.json 已锁定） |
| 微信开发者工具 | 最新稳定版 | 小程序端调试（需真实 AppID） |
| 微信基础库 | ≥ 2.29.2 | 启用 Skyline 渲染与 wx.router 自定义路由 |

> 无真实 AppID 时可在开发者工具「详情 → 基本信息」使用测试号，但 Skyline 能力建议用真实 AppID 验证。

## 两端的不同依赖面

| 你要做什么 | 需要安装 | 不需要 |
|---|---|---|
| 只跑 Web 端（`dev:web` / `build:web`） | Node.js 一项 | 微信开发者工具 / AppID |
| 调试小程序端（`dev:mp`） | + 微信开发者工具 + AppID（测试号可用） | — |
| 构建小程序产物（`build:mp`） | + 微信基础库 ≥ 2.29.2（工具内切换） | — |
| 上线发布 | + 真实 AppID（替换模板占位 `wx0000000000`） | — |

只需要跑 Web 端的话，Node.js 就够了——微信开发者工具在你要调试小程序端时再装也不迟。

## 版本出处

- **微信基础库 ≥ 2.29.2**：Skyline 渲染引擎与 `wx.router` 自定义路由的最低版本要求（低于此版本 skyline 页面回退 WebView 且自定义转场不可用）
- **Vue ≥ 3.4**：编译器消费 `@vue/compiler-sfc` 的 AST 形态基线
- **Node ≥ 18**：构建脚本（tsx / esbuild）的运行时基线

## 下一步

- [创建你的第一个工程](/docs/05-create-project)
