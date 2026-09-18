# Proteus 模块化跨端引用 — 落地执行文档

## 背景痛点

小程序产物是**单文件组件（WXML+JS+WXSS+JSON 四件套）**，没有浏览器那样的 ES Module 模块系统。主流框架用 `#ifdef` + `require` + 全局注册解决，导致：

- 跨模块引用散落在业务代码中，难以回归
- 循环依赖静默失败
- 公共依赖被重复打包（vue 两份）
- 模块边界模糊，新人随便 import

## 核心方案：Module Boundary Layer

```
L5 模块（业务域）       trade / user / content
L4 公共契约            types + interfaces + events + config schema
L3 编排器              ModuleOrchestrator + DependencyGraph + 三端打包器
L2 平台后端            web(ESM) / skyline(分包+单例) / app(Native Module)
L1 平台原生            import / wx.* / iOS/Android
```

**关键区别**：主流框架把"跨模块引用"做成运行时（`require`/全局注册/事件总线），Proteus 把它做成**编译期静态图谱 + 三端各按各的原生方式分块**。

## 设计原则（铁律）

1. **业务代码不写平台分支** — 只用 `import { useTradeModule } from '@proteus-vue/module'`
2. **公共契约是唯一允许跨模块 import 的东西** — 其余走 ModuleBoundary
3. **编译期检测循环依赖** — 环存在直接报错，不静默
4. **三端产物各自符合平台原生规范** — Web=ESM、Skyline=分包、App=Native Module
5. **产物可审计** — `proteus audit module` 输出依赖图谱

## 里程碑

- M1 模块契约定义（proteus-module.config.ts）
- M2 ModuleOrchestrator + 生命周期
- M3 DependencyGraph（循环检测 + 拓扑排序）
- M4 Web 打包（Rollup code-splitting）
- M5 Skyline 分包（subPackages + preloadRule + 模块桶）
- M6 App 模块（iOS Framework / Android AAR + JSI）
- M7 可靠性加固（共享依赖去重 / 懒加载 / 沙箱 / 内存守护）
- M8 可观测（依赖图谱 / trace / DevTools / CI 审计）

## 依赖关系

- Module 是**横向基础设施**，所有层（Pinia/Router/API/Component/Platform）的代码组织依赖它
- Skyline 分包方案（M5）必须对齐 **Router M7.1 的 chunk 字段** — 共用 chunk manifest
- Capability 按 module 粒度注册（见 Platform 层）

## 分批策略

详见 `09-execution-batches.md`。9 个 Batch = 9 个独立 PR，每批 ≤3 文件。
