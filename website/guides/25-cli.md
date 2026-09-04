---
title: CLI 与工程命令
order: 25
group: 工程化
---

# CLI 与工程命令

`proteus` CLI（`@proteus-vue/cli`，bin 名 `proteus`）是框架的开发者入口：创建、开发、构建、门禁、可观测一条命令链。设计原则与框架一致——每条命令独立可用、失败给指引、**FAIL > 0 即 exit 1**，CI 可直接当门禁消费。

> 仓库根 `package.json` 的 `dev:web` / `build:mp` 等脚本与 CLI 复用同一条 Vite 管线；CLI 额外提供脱离 Vite 的独立编译与四域门禁聚合。

## 工程生命周期

| 命令 | 用途 | 关键 flag |
|---|---|---|
| `npm create @proteus-vue/proteus <name>` | 复制模板工程（Web + Skyline 双端脚本 + CI 模板），替换项目名 | —— |
| `proteus dev` | 启动开发服务（复用项目 Vite） | `--target web\|skyline`（缺省 web） |
| `proteus build <dir>` | 独立编译：目录内 `.vue` → 小程序三件套（wxml / js / wxss） | `--out` `--debug`（决策 trace 落盘 `.transform-debug/`）`--rules <json>` `--no-px2rpx` `--rpx-ratio <n>` `--compiler node\|rust` |
| `proteus build --target` | 工程构建：spawn 项目 `build:web` / `build:mp` 脚本 | `--target web\|skyline\|all` |
| `proteus test` | 测试编排（详见[测试与部署](/docs/10-testing-deploy)） | `unit`（缺省）`e2e:web` `e2e:mp [root]`；`--ide` `--port` `--debugger <模块>` |

`--compiler rust` 开启后，每页先跑 **Node/Rust 双编译语义等价校验**（G-29.1），不一致即构建红——这是编译器可插拔的安全网。

## 质量门禁

```bash
proteus check [dir]   # ★一键全量门禁：css + style + router + config 四域聚合
                      # 默认全开，--no-strict-css 等可按域关闭；任一域失败 exit 1
```

专项命令可单独跑，也可被 `proteus audit all` 七域聚合（route / module / config / i18n / capabilities / components / devtools-budget + CI 耗时预算）：

| 命令 | 检查内容 |
|---|---|
| `css:check` | CSS 跨端兼容（CSS001-012）+ 字节 / 选择器预算门禁（`--fix` 自动修，`--report` 落盘） |
| `style:check` | `:style` 运行时安全白名单（STS001-006，`--platform` 选端） |
| `fluid:check` | 柔性布局规则（禁手写 `@media` / 硬编码断点等 FLD 系列） |
| `api-check` | CMP007 门禁：回调式平台 API / 同步存储 / 裸全局调用 → 改 `useXxx()` Hook |
| `capabilities:manifest` / `capabilities:check` | 能力清单扫描 / 平台原生模块规范（业务目录禁 `wx.*`） |
| `router:check` / `config:check` / `app-config:check` / `i18n:check` | 路由块 / 工程配置 / 应用配置 / 硬编码文案 |
| `module:check` / `module:duplicates` / `audit module` | 模块契约 / 分包重复依赖 / 综合审计 |
| `health` | 工程环境体检：Node 版本 / 结构 / 依赖 / 产物 / appid / IDE 一次性诊断 |

## 编译器可观测

```bash
proteus explain src/pages/index.vue   # 该文件触发的全部转换规则（决策 trace）
proteus explain <规则 ID>             # 规则 → AI 说明书（what/why/when/example/verify）
proteus rules                         # 编译器规则目录（每条附 AI 说明书）
proteus conformance                   # 42 项编译器 conformance（FAIL > 0 → exit 1）
proteus conformance --repo .          # 仓库治理扫描：严禁 fork 框架内部（命中即 FAIL）
```

## 迁移与 CI

| 命令 | 用途 |
|---|---|
| `proteus migrate mp <file\|dir> [--dry-run]` | 小程序 → Proteus 语义 codemod（`view→p-box` 自动替换 + 同步存储直改 + 手工项标注） |
| `proteus migrate types <file>` | 旧类型写法 → 收口类型 |
| `proteus gen config` | 生成 `app.config.ts` 类型安全骨架 |
| `proteus init module [dir]` | 生成模块契约骨架 |
| `proteus generate types [--out <path>] [--check]` | 生成全局类型产物（JSON Schema + d.ts，`--check` 校验漂移） |
| `proteus ci:init` | 生成 CI/CD 流水线模板（check 门禁 → 逐端构建 → 产物归档） |
| `proteus host push <module-dir>` | 调试基座推送插件模块（前置校验 + push 信封） |

## 典型工作流

```bash
# ① 创建工程（模板自带双端脚本；路由 .json 由 gen-routes 自动生成）
npm create @proteus-vue/proteus my-app && cd my-app && npm install

# ② 双端并行开发
npm run dev:web     # vite --mode web
npm run dev:mp      # gen-routes + vite --mode mp-weixin

# ③ 构建
npm run build:mp    # dist/mp-weixin/（微信开发者工具导入；替换 proteus.config.ts 的 appid）
npx proteus build --target all    # 或用 CLI 一次构建双端

# ④ 门禁 + 测试
npx proteus check && npx proteus test e2e:web
```

原生端（iOS / Android / Harmony）的 `dev` / `build --target` 与五端产物编排随原生工程同步分批接入（📋 规划；当前 `--target` 支持 web / skyline）。

## 下一步

- [快速开始](/docs/02-quick-start)：两分钟跑通 Web + 小程序双端
- [测试与部署](/docs/10-testing-deploy)：测试矩阵与 CI 门禁
- [编译管线](/docs/20-compiler-pipeline)：build / explain 背后的编译器
