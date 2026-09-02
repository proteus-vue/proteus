# @proteus-vue/compiler-backend

> **G-29 编译器可插拔后端**（`docs/proteus-compiler-backend-1-plan/`）· B1

## 一句话

**编译器从"固定 Node 工具链"升级为"可插拔后端"**——Node / Rust(SWC-ecosystem) / WASM 三端后端对同一份 SFC 产出语义等价的 `CompilerIR`，业务零感知一个 flag 切换。与 G-27 `ProteusRenderBackend`、G-28 `ProteusNativeBackend` 同构（语义契约 + 后端实现 + conformance）。

## 内容

| 模块 | 说明 |
|------|------|
| `spi.ts` | `ProteusCompilerBackend` 接口 + `CompilerIR` 契约（version/render/semantic/bindings）+ `CompilerCapabilities`（对齐 plan 02-compiler-backend-spi.md） |
| `conformance.ts` | `runCompilerConformance(backend)` 自检——CMP004 版本协商 + CMP002 IR 合规（render/semantic 计数交叉核对）+ ★G-31.1 语义链接（p-* 标签 → TAG_SEMANTIC_MAP） |
| `node.ts` | **NodeBackend** 参考实现：真实模板编译（@vue/compiler-sfc + @vue/compiler-dom）→ CompilerIR，**semantic = toComponentIR 产物**——「源码 → C-IR」生产端雏形 |

## 用法

```ts
import { createNodeCompilerBackend, runCompilerConformance } from '@proteus-vue/compiler-backend'

const backend = createNodeCompilerBackend()
const result = runCompilerConformance(backend) // { ok: true, checks: [...] } —— CMP002/CMP004

const ir = backend.compile({ filename: 'grid.vue', source: `<template><p-grid :min-col-width="160" :max-cols="4"><p-box /></p-grid></template>` })
ir.semantic.tree    // { tag: 'p-grid', semantic: 'layout.grid', props: { minColWidth: { expr: '160' }, maxCols: { expr: '4' } }, children: [...] }
ir.render.root      // 渲染树（含 semantic 字段——G-27 nodeOps 消费）
ir.bindings         // capability 入口 + v-model + 事件（G-28 消费）
```

## 与 G-31 衔接

`CompilerIR.semantic` = C-IR 树（`toComponentIR` 产物）——**真实模板编译接语义层**：
Renderer 树兼含语义组件（Layer 0）与兼容层标签（Layer 1）；语义计数交叉核对（render semantic 节点数 == semanticCount == C-IR 树节点数）保证两棵树同源不漂移。

## 严格规则

- **G-29.1**：三端 Backend 对同一份 SFC 必须产出语义等价的 CompilerIR（IR Golden Test 强制）
- **G-29.2**：新 Compiler Backend 必须通过 conformance test
- **G-29.3**：HMR 语义三端一致
- **CMP001-004**：依赖私有 API / IR 不合规 / HMR 不一致 / 版本不兼容

## 路线

B1 CompilerIR 契约 + NodeBackend ✅ → B2 RustBackend（SWC-ecosystem）→ B3 WASM Backend（Playground）→ B4 HMR 三端一致 + Source Map + Tree-shaking