# Proteus Compiler Plan

> **★实现状态（2026-08）**：✅ 已实现——@proteus-vue/compiler 完整落地（parse/template/script/style/transforms 规则注册表 69 条 + explain + 产物自校验 + sourcemap），587 测试覆盖（含组件库 B1-B8）；本规划文档为设计蓝图（实现已超越批次）。

> 应用层多 main 架构下的**透明编译内核** —— AI-native、规则模块化、产物可审计。

## 这份文档解决什么

前面 7 份运行时文档（Platform / Lifecycle / Module / Pinia / Router / API / Component）反复引用：

- `transforms/` 模块化规则
- `--trace-transform` 映射链
- IR（中间表示）可追溯
- 三端 codegen（Web / Skyline / App）

但**编译内核本身一直没有规划**。`proteus-compiler-plan` 补齐这块地基 —— 所有运行时层的 transform 都跑在它上面。

## 防止上下文撑爆（必读）

1. 每份 `.md` 是**独立上下文单元**，喂 LLM 时一次只加载：当前模块 + `00-overview.md` + 其直接依赖模块
2. 分批执行：每个 Batch = 一个独立 PR，每批 ≤ 3 个 `.md` + 对应源码
3. `transforms/` 每个规则一个文件 + JSDoc 契约，AI 可读可改
4. 永远不全量塞进单次对话

## 目录结构

```
proteus-compiler-plan/
├── README.md          ← 本文件
├── 00-overview.md     ← 架构 + 铁律 + 里程碑
├── 01-parse-pipeline.md       ← SFC 三段解析
├── 02-ir.md                  ← 中间表示设计
├── 03-transform-system.md     ← 插件系统 + 规则契约
├── 04-codegen-web.md         ← Web 后端
├── 05-codegen-skyline.md     ← Skyline/WXML 后端
├── 06-codegen-app.md         ← App/Native 后端
├── 07-sourcemap-trace.md     ← Source Map + --trace-transform
├── 08-incremental-hmr.md     ← 增量编译 + HMR
├── 09-m7-performance.md      ← 超级应用加固：性能/缓存
├── 10-m8-observability.md    ← 可观测 + audit
├── 11-testing-migration.md   ← 测试 + 迁移
└── 12-execution-batches.md   ← 分批策略 + Prompt 模板
```

## 设计原则（对齐框架整体哲学）

1. **透明编译**：输入 → 输出规则固定、可预测、可审计，无隐式注入
2. **AI-native**：每条 transform 独立文件 + JSDoc，AI 能读能改
3. **三端共享 IR**：Web/Skyline/App 共用 IR，仅 codegen 分化
4. **规则可开关**：每条规则在 `proteus.config.ts` 独立可关
5. **产物可追溯**：`--trace-transform` 输出 源码行 → 规则名 → 产物位置

## 与其他计划的关系

| 计划 | 依赖编译器 |
|------|-----------|
| Router | `<route>` 块解析 + pages.json 生成 |
| Component | `p-*` 组件映射 + appBar codegen |
| Platform | capability 编译期分叉 |
| Lifecycle | `defineApp` 阶段编排 |
| Pinia | Vapor IR → 三端 binding |
| Module | 分包 + 依赖图 |

> 编译器是**所有运行时层的地基**，建议优先落地 B1（parse + IR）。
