---
title: 编译管线
order: 20
group: 工程化
---

# 编译管线

Proteus 的编译器是**纯函数模块**（`@proteus-vue/compiler`）：零 Vite 依赖、零项目配置依赖、选项全部入参——所以它能在浏览器里实时跑（官网 Playground 的「输入 SFC → 秒出产物 + 决策 trace」就是这么来的）。编译器把同一份语义模型翻译成各端形态，是「语义定义 + 后端实现」公式里框架侧的生产车间。

> **透明编译：输入 → 输出规则固定、可预测、可审计，无隐式注入。**
> 每条转换规则一份 AI 说明书；产物可反查源码；坏产物当场抛错，绝不静默输出。

## 两条管线，一个内核

| 管线 | 输入 → 输出 | 消费方 |
|---|---|---|
| 语义编译（G-29/38） | SFC → `CompilerIR`（render / semantic / bindings） | 渲染后端（G-37）、AI Agent、conformance |
| 小程序产物编译 | 标准 Vue SFC → wxml / js / wxss / json 四件套 | 小程序宿主 |

一份标准 Vue SFC 走小程序管线：

```text
hello.vue
├── <template>  ── transformTemplateToWxml ──►  .wxml   （标签/指令映射）
├── <script>    ── transformScriptToPage ────►  .js     （Page() 构造器）
├── <style>     ── transformStyleToWxss ─────►  .wxss   （px→rpx + 选择器重写 + scoped）
└── <route>     ── 路由生成器 ────────────────►  .json   （app.json / 页面配置）
```

阶段划分与规则注册表对应四个真实阶段名：`template` / `script` / `style` / `validate`。每条规则一份结构化说明书（`TransformRule`：id / title / why / when / example 前后对照 / verify / source 实现位置），`listTransformRules()` 枚举全部规则，`explainTransform(source)` 输出一份源码实际触发的全部转换（决策 trace，Playground 同屏展示）——这是 AI 改编译器行为、人类审计编译决策的入口。Web 端**不走**这条产物管线：标准 Vite + `@vitejs/plugin-vue` 原生渲染，零转换。

## CompilerIR：语义的单一真相

G-29 定义的中间表示——四个字段各有分工：

```ts
interface CompilerIR {
  version: 1              // IR 契约版本（CMP004 版本协商：backend.minCompatVersion ≤ 1）
  render: RenderIR        // 渲染树：{ type, semantic?, props, children, loc }
  semantic: SemanticIR    // C-IR 语义树（G-31）+ semanticCount / compatCount
  bindings: BindingIR     // capabilities / models / handlers
  layout?: LayoutConstraintIR // G-22 柔性布局约束（占位）
}
```

- **render**：每个节点带 `semantic`（如 `layout.grid`）——渲染后端按语义映射，`p-*` 标签经 `TAG_SEMANTIC_MAP` 链接语义；非 `p-` 标签不携带（Layer 1 兼容层）。
- **semantic**：真实模板编译产出的 C-IR 语义树，`semanticCount` 与渲染树语义节点数交叉核对（conformance 锚点）。
- **bindings**：`capabilities`（`p-scan-qr` / `p-pick-photo` / `p-location` 等 `capability.*` 能力入口，G-28 消费）、`models`（v-model 绑定）、`handlers`（事件处理器）。

## CompilerBackend SPI：编译可插拔

编译器本身也是「语义接口 + 可插拔后端」。G-29 的后端接口围绕 `CompilerIR`：

```ts
interface ProteusCompilerBackend {
  readonly id: string
  readonly minCompatVersion: number   // 契约版本协商（当前 = 1）
  readonly capabilities: CompilerCapabilities
  compile(sfc: SFCSource): CompilerIR // SFC → IR（核心）
  parse(template: string): TemplateAST
  generate(ir: CompilerIR): { code: string; warnings: string[] }
}
```

G-38 则是「写编译后端的插头标准」：`parse(source) → ProgramIR`（语法树）→ `transform(ast) → IRModule`（语义 IR，含 `ComponentIR[]`，直接交 G-37 消费）→ `emit(module) → CompiledArtifact` 三阶段——**每个阶段可独立换实现**（transform 从 Node 换 Rust，parse/emit 可不动），另含 `IncrementalSession`（依赖图 + 签名缓存 + 局部重算）与 `FallbackBackend`（首选后端不可用 → 自动降级 node + 可观测事件）。

| 后端 | 状态 | 说明 |
|---|---|---|
| node（TS） | ✅ 参考实现 | `createNodeCompilerBackend` / `createG38NodeBackend`——基于 `@vue/compiler-sfc` + `@vue/compiler-dom` 真实解析，产物 codegen 主力 |
| rust | ✅ 校验源 / 📋 产物 codegen | `proteus-cc-rust` CLI（cargo crate）：同一 SFC → 语义等价 CompilerIR JSON；「双编译等价门禁」diff 语义序列 / 计数 / bindings，不一致即构建红。产物级 Rust codegen 属后续批次 |
| wasm | 📋 规划 | 浏览器内编译（Playground 当前直跑 Node 侧 TS 实现） |

切后端是配置动作：`config.compiler.backend = 'rust'`（或 `proteus build --compiler rust`）→ 构建内自动跑双编译语义等价校验；Rust 二进制缺失时降级 Node 校验并明确报告——不是静默跳过。

## 产物与可审计

| 产物 | 内容 |
|---|---|
| IR 产物 | `CompilerIR`（渲染树 / 语义树 / bindings）——语义层单一真相 |
| 小程序四件套 | wxml / js / wxss（+ 路由生成器负责的 json），贴近手写、不压缩 |
| 决策 trace | `explainTransform` 输出源码触发的全部规则（ruleId / phase / line / before / after） |
| sourcemap | 调试构建产出方法级 sourcemap（v3 / VLQ）+ `annotateLines` 行号注释，产物可反查源码 |

反黑盒三件套：**产物自校验**（JS 语法错误 / WXML 标签不配对 → 当场抛错并指明文件）、**规则注册表防漂移**（映射表改动若未同步规则文档，CI 硬卡）、**双编译等价门禁**（Node/Rust 语义序列必须一致）。

## conformance：写后端的验收门

任何 CompilerBackend 接入前必须跑 `runCompilerConformance(backend)`：CMP004 版本协商、CMP002 IR 契约合规（render 树 shape + semantic 计数交叉核对）、G-31.1 语义链接（`p-*` 元素必须映射到 `TAG_SEMANTIC_MAP` 语义）、bindings shape、parse/generate 可用性。G-38 套件共 42 项（C-01~C-10），**按能力声明门控：`capabilities.x = false` 的项 SKIP 而非 FAIL**——诚实声明让「未实现」与「实现坏了」机器可分。详见[一致性验证](/docs/26-conformance)。

## 下一步

- [语义模型](/docs/03-semantic-model)：IR 与语义链接的上游
- [路由](/docs/21-router)：`<route>` 块如何被编译成双端路由表
- [一致性验证](/docs/26-conformance)：编译层 conformance 的完整清单
