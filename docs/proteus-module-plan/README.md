# Proteus Modularization Plan

> 小程序产物是单文件、无模块系统 — 如何用"编译期静态图谱 + 三端各按各原生方式分块"解决跨模块引用。

## 速览

主流框架用 `#ifdef` + `require` + 全局注册做跨端，导致**业务代码散落、难回归**。Proteus 用 **Module Boundary Layer**：业务只写标准 import，编译期按平台分叉。

## 五层架构

```
L5 模块（业务域）       trade / user / content
L4 公共契约            types + interfaces + events + config schema
L3 编排器              ModuleOrchestrator + DependencyGraph + 三端打包器
L2 平台后端            web(ESM) / skyline(分包+单例) / app(Native Module)
L1 平台原生            import / wx.* / iOS/Android
```

## 铁律

1. 业务代码不写平台分支
2. **公共契约是唯一允许跨模块 import 的东西**
3. 编译期检测循环依赖（环 → 报错）
4. 三端产物符合平台原生规范（Web=ESM / Skyline=分包 / App=Native Module）
5. 产物可审计（`proteus audit module`）

## 文档结构

| 文件 | 内容 |
|------|------|
| `00-overview.md` | 架构 + 铁律 + 里程碑 |
| `01-m1-module-contract.md` | 模块契约定义 |
| `02-m2-orchestrator.md` | Orchestrator + 生命周期 |
| `03-m3-dependency-graph.md` | 循环检测 + 拓扑排序 |
| `04-m4-web-codegen.md` | Web Rollup 分包 |
| `05-m5-skyline.md` | Skyline subPackages + 模块桶 |
| `06-m6-app-module.md` | App Native Module + JSI |
| `07-m7-reliability.md` | 可靠性加固 |
| `08-m8-observability.md` | 可观测 + CI 审计 |
| `09-execution-batches.md` | 分批策略 + Prompt 模板 |
| `10-migration.md` | 迁移指南 |

## 使用方式（防撑爆）

LLM 一次只喂 `00-overview.md` + 当前 Batch 文件（≤3 文件）。依赖下层代码直接引用，不重新解释。

## 进度（★B0-B8 已实现，B9 文档整合完成）

| 能力 | 落地 | 验证 |
|------|------|------|
| B0 跨模块引用（import → require） | compiler + plugin-vite | tests/module-import.test.ts |
| B1 模块契约（defineModule + 校验） | @proteus-vue/module + CLI module:check | tests/module-contract.test.ts |
| B2 运行时编排器（createModuleSystem） | @proteus-vue/module | tests/module-orchestrator.test.ts |
| B3 依赖图谱（环检测 + 拓扑 + manifest） | @proteus-vue/module | tests/module-graph.test.ts |
| B4 Web 打包（manualChunks） | @proteus-vue/module + vite.config | tests/module-web-codegen.test.ts |
| B5 Skyline 分包（dependencies/preloadRule） | gen-routes | tests/gen-routes.test.ts |
| B7a 分包体积监控 / B7b 去重检测 / B7c 懒加载 | bundle-report + CLI | tests/bundle-report / module-duplicates / module-orchestrator |
| B8 综合审计门禁（audit module） | @proteus-vue/module + CLI | tests/module-audit.test.ts |
| B9 整合（init module + 迁移指南） | CLI + docs | tests/module-init.test.ts |

**快速上手**：`proteus init module` → 编辑契约 → `proteus module:check --graph` → `proteus audit module`

## 依赖关系

- Module 是**横向基础设施**，所有层（Pinia/Router/API/Component/Platform）依赖它
- Skyline 分包（M5）对齐 Router M7.1 chunk（共用 chunk manifest）
- Capability 按 module 粒度注册（Platform 层）

## 启动顺序建议

1. **Platform B1**（Capability 契约）
2. **Module B1**（模块契约）— 不依赖任何人
3. 两者稳定 → Pinia → Router → API → Component
