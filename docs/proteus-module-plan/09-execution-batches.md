# 分批执行策略

## 原则

- 9 个 Batch = 9 个独立 PR
- 每批 LLM 单次喂 ≤3 文件（含 overview）
- 单批 ≈ 18-27k tokens，**绝不一次塞全部文档**
- 依赖下层稳定后再启动上层

## Batch 明细

### B0 — 跨模块引用最小闭环（★先导批次，后续所有基建的地基）
**喂 LLM**：`00-overview.md` + 本文件 B0 段 + `packages/compiler/src/script.ts`（import 剥离 + extractData）
**产出**：
1. **共享模块编译**（plugin-vite）：扫描页面/组件 import 的本地模块（相对路径、非 .vue、非 vue、非 @proteus-vue/*）→ BFS 收集依赖链 → esbuild 转 CommonJS → 产物 `dist/mp-weixin/<源码相对路径>.js`
2. **import → require**（compiler script.ts）：`import { a } from '../stores/player'` → 产物顶部 `const { a } = require('<相对产物路径>.js')`（named/default/namespace 三形态；vue/@proteus-vue/*/.vue 组件维持现状跳过/剥离）
3. **函数调用初始化运行时化**（compiler extractData）：`const store = usePlayerStore()` 不再静态求值失败丢调用——收集为运行时初始化，onLoad/attached 注入 `this.store = usePlayerStore()`（实例属性，MVP 模板绑定不支持，逻辑层可用）
4. **警告降级**：可解析的跨模块 import 不再报"引用将 undefined"；仅不可解析路径保留剥离警告
**验证**：compiler 三形态 require 单测 + 运行时初始化单测 + demo（utils/format 纯函数跨页 + Pinia store 逻辑调用）；双端构建（Web 不变）
**依赖**：无（不依赖 B1-B9）

### B1 — M1 模块契约（地基）
**喂 LLM**：`00-overview.md` + `01-m1-module-contract.md`
**产出**：`defineModule()` API + `proteus-module.config.ts` 解析器 + Schema 校验
**验证**：fixture 解析 + 缺失字段报错

### B2 — M2 Orchestrator + 生命周期
**喂 LLM**：`02-m2-orchestrator.md`
**产出**：`createModuleSystem()` + 生命周期状态机
**依赖**：B1

### B3 — M3 DependencyGraph
**喂 LLM**：`03-m3-dependency-graph.md`
**产出**：循环检测 + 拓扑排序 + `module-graph.json` 生成
**依赖**：B1
**验证**：环检测单测（简单环 / 复杂环 / 自环）

### B4 — M4 Web 打包
**喂 LLM**：`04-m4-web-codegen.md`
**产出**：Rollup `manualChunks` 生成 + 动态 import 转换 + preload
**依赖**：B3（消费拓扑序）

### B5 — M5 Skyline 分包（关键）
**喂 LLM**：`05-m5-skyline.md`
**产出**：`subPackages` + `preloadRule` 生成 + 模块桶 + require 转换
**依赖**：B3、对齐 Router M7.1 chunk
**验证**：fixture → app.json diff + 单例验证

### B6 — M6 App 模块
**喂 LLM**：`06-m6-app-module.md`
**产出**：Native 模块协议 + JSI 桥接骨架
**依赖**：B2（生命周期对齐）

### B7 — M7 可靠性
**喂 LLM**：`07-m7-reliability.md`
**产出**：循环 CI 卡口 + 去重检测 + 懒加载骨架 + 体积监控
**依赖**：B3 + B5

### B8 — M8 可观测
**喂 LLM**：`08-m8-observability.md`
**产出**：trace span + DevTools 面板 + audit CLI + ESLint 插件
**依赖**：B2 + traceId 体系（Pinia/Router/API）

### B9 — 整合 + 文档
**喂 LLM**：全部文档（分批读，不一次塞）
**产出**：示例项目 + README + 迁移指南
**依赖**：B1-B8 全部

## 依赖图

```
B1 ──┬── B2 ──┬── B6
     │         │
     └── B3 ──┼── B4
               │
               ├── B5 (对齐 Router M7.1)
               │
               └── B7 ── B8 ── B9
```

**可并行**：B4/B5/B6（B3 完成后）；B7/B8（B5/B2 完成后）

## Prompt 模板（每批复用）

```
你正在实现 Proteus 模块化方案的 [Batch X]。

## 设计原则（不可违反）
1. 业务代码不写平台分支
2. 公共契约是唯一允许跨模块 import 的东西
3. 产物可审计（--trace-transform / audit module）
4. 对齐现有架构：透明编译 + AI 可读

## 本批范围
[列出本批文件 + 产出]

## 直接依赖（已完成的代码，直接引用不用重新解释）
[列出依赖模块的路径 + 关键 API 签名]

## 产出要求
- TypeScript，带 JSDoc
- 每个公开 API 有单测
- --trace-transform 输出映射链
- 对齐已有命名风格（见 examples/）

开始实现。
```

## ★★★B1-npm — 外部模块导入（2026-10-04 · 用户点名"一刀切"）

**用户原话**：「小程序没有模块化就直接判定我们也不支持模块化太一刀切了，不支持导入外部 ts 这个会劝退
大部分开发者的，**跨端框架的基本任务就是让开发者在业务开发代码里面不感知平台环境差异**，不是直接把限制
丢给开发者自己」。

**B1 覆盖的四条能力（业务代码写标准 import，MP 端零感知）**：

| 能力 | 实现 | 产物 |
|---|---|---|
| **npm 裸包**（`import ms from "ms"`） | esbuild 构建期打包（**browser 条件优先**——避开 npm 包的 Node fallback 分支，实测 nanoid 的 CJS 入口 `require("crypto")`）；**leaf**（BFS 不深入 node_modules，包内依赖由 esbuild 整体内联）；已知叶子**单例 external**（防「页面直连」与「共享模块内引」各内联一份） | `_proteus/npm/<id>.js`（require 缓存单例） |
| **路径别名**（`@/utils/x`） | 复用 vite `resolve.alias`（configResolved 快照——**与 Web 端同源**）；string（精确/前缀）/RegExp 两形态 | 按展开后的相对路径 |
| **框架包子路径**（`@proteus-vue/router/scan`） | package.json `exports` 条件直解（此前只认 dist/index.js） | `_proteus/router-scan.js` |
| **`node:path` polyfill** | 纯字符串函数（无 IO/平台语义——正当职责）；**其余 Node 内置显式报错**（无对等物，不做假实现） | 构建期注入 |

**警告分级（反黑盒但不噪音）**：未解析 import 由插件（唯一有完整解析上下文的一侧）逐条给**准确原因**——
npm 未找到/npm 依赖 Node 内置/别名命中但目标不存在/框架包未构建/node 内置/样式文件…各不同文案；
**设计语义静默**（`@proteus-vue/components` 的组件 import 在 MP 端经 usingComponents 解析——返回空串 ⇒ 只进 trace）。
实测：showcase 构建从 **232 条噪音 → 0**。

**顺带修的真缺陷（B1 暴露）**：① `@proteus-vue/router` 的 index re-export `./scan`（构建期工具）
⇒ 把 796KB `@vue/compiler-sfc` 拖进小程序产物（现改子路径导出，消费方 `@proteus-vue/router/scan`）；
② `@vue/runtime-core`/`@vue/reactivity`/`@vue/shared` 未在 vendor 单例清单 ⇒ 重复内联（现单例化）。

**测试**：`tests/module-npm-b1.test.ts` 12 组（npm leaf/scoped id/browser 条件/别名四形态/exports 子路径/
polyfill 与 Node 原生 **19 组对拍**）；端到端：`examples/subpackages/svg-lab/pages/module-import-demo.vue`
（源码 `import ms from "ms"` → 产物 `require("../../../_proteus/npm/ms.js")`，实测构建绿）。

**诚实边界**：依赖 Node 内置且无 browser 分支的 npm 包 → 构建期**显式报错**（不做 polyfill 假实现）；
打进来的包**进代码包体积**（大包按需 import 子路径）；polyfill 仅覆盖 posix 语义与常用面。

## 进度追踪

| Batch | 状态 | PR | 验收 |
|-------|------|-----|------|
| B0 | ✅ | | 跨模块 import 产物可运行（require + 运行时初始化） |
| B1 | ✅ | | Schema 校验通过 |
| B2 | ✅ | | 生命周期单测通过 |
| B3 | ✅ | | 环检测 + 拓扑排序通过 |
| B4 | ✅ | | Web 分包产物验证（manualChunks 生成） |
| B7a | ✅ | | 分包体积监控（M7.6：扫描 + 阈值门禁） |
| B7b | ✅ | | 共享依赖去重检测（module:duplicates） |
| B7c | ✅ | | 懒加载 loadModule（M7.3 简化版） |
| B7d | ⬜ | | 沙箱 / 内存守护（B7 子项拆批） |
| B8 | ✅ | | audit + ESLint 阻断（audit module 硬卡） |
| B9 | ✅ | | 示例 + 迁移指南 + init module（B9 文档整合） |
| **B1-npm** | ✅ | | **外部模块导入（2026-10-04，用户点名："不支持导入外部 ts 会劝退大部分开发者"）**——npm 裸包/路径别名/框架包子路径/path polyfill 四能力 + 逐条精确原因（见下节） |
| B5 | ✅ | | Skyline subPackages 生成（分包依赖 + preloadRule） |
| B4 | ⬜ | | Web 分包产物验证 |
| B5 | ⬜ | | Skyline subPackages 生成 |
| B6 | ⬜ | | JSI 桥接骨架 |
| B7 | ⬜ | | CI 卡口生效 |
| B8 | ⬜ | | audit + ESLint 阻断 |
| B9 | ⬜ | | 示例项目跑通 |
