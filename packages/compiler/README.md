# @proteus/compiler —— 编译引擎独立包

> Proteus 的**编译引擎**，v0.2 起独立为 monorepo 包（`packages/compiler/`）。
> 设计目标：**零 Vite 依赖、零项目配置依赖、纯函数、选项全入参**——可独立分发、独立测试、被任何构建器消费。

## 模块边界（必须遵守）

| 允许 | 禁止 |
|---|---|
| import `@vue/compiler-sfc` / `@vue/compiler-dom`（编译期 AST 处理） | import `vite` 或任何 Vite 相关 API |
| import 同包 `./src` 内部模块 | import `proteus.config.ts` 或读取项目配置 |
| 选项全部通过函数入参传入 | 读写文件系统 / 网络（纯函数） |

- 所有转换函数是**纯函数**：相同输入 → 相同输出，可独立单测
- 编译期警告通过返回值 `warnings` 透出（不直接抛错，除非不可恢复）

## 公开 API

```typescript
// 整包编译（推荐入口）
compileVueSfc(source: string, options: CompileOptions): CompileResult
// CompileResult = { wxml, js, wxss, warnings, trace }

// 分步转换（精细控制 / 单测）
transformTemplateToWxml(templateSource, styleOpts): { wxml, vModelBindings, warnings }
transformScriptToPage(scriptSource, styleOpts, { file, isComponent, vModelBindings }): { js, warnings }
transformStyleToWxss(styleSource, styleOpts): string

// ★ AI-native 透明：编译规则注册表（67 条规则，每条一份 AI 说明书）
listTransformRules(phase?)    // 枚举规则（能力清单）
getTransformRule(id)          // 查单条规则
formatTransformRule(rule)     // 渲染单条 AI 说明书
formatTransformCatalog()      // 渲染全量目录

// ★ 阶段三分派层（底线循环 ① 完全形态）：AI 覆盖规则 apply 即获得新能力
// （implemented 规则可携带 apply()；style/px-to-rpx、template/scope-attr 已登记示范）
executeRule(id, ctx)          // 按规则 ID 执行（RuleContext：input → output）

// ★ 决策 trace（底线循环 ②）：源码 → 实际触发的全部规则
explainTransform(source, options?)  // → { events: [{ ruleId, phase, line, before, after }] }
formatTransformTrace(result)        // 渲染为按阶段分组的可读文本

// 规则覆盖（底线循环 ①③）：AI / config 改写或禁用规则
// （TransformRuleOverrides：disabled / mapping / customTags，经 CompileOptions.rules 传入）
```

## 产物契约

- `.wxml`：标准标签 → 小程序标签（`div→view` / `span,p,h1-h6→text` / `img→image` …）+ 指令映射
- `.js`：`Page({ data, methods, onReady, onUnload, onLoad, proteusOnXInput, proteusNavigateTo })`（组件为 `Component()`）
- `.wxss`：px → rpx、Skyline 不支持属性编译期警告、语义基础样式注入
- `.json`：**不属于本引擎**，由 `scripts/gen-routes.ts`（框架路由生成器）负责

## 消费方

- `vite-plugin-mp-transform.ts`（monorepo 根，`@proteus/plugin-vite` 前身）：薄适配层——扫描页面、传选项（含 `rules` 覆盖）、`emitFile` 产物
- `tests/*.test.ts`：直接 import `../packages/compiler/src` 调纯函数（vitest，无 Vite 依赖）
- 未来 CLI `@proteus/cli`：`proteus build` / `proteus explain` 核心即调 `compileVueSfc` + `explainTransform`

## 构建与发布

```bash
cd packages/compiler
npm run build        # tsc -p tsconfig.build.json → dist/（ESM + .d.ts）
npm publish          # 发布 @proteus/compiler（main/types/exports 指向 dist）
```

发布后适配层可改为 `import { compileVueSfc } from '@proteus/compiler'`（npm workspace 链接或直接依赖），
`proteus.config.ts` 的 `style` / `rules` 选项由适配层读取后传入——编译引擎 API 不变。

## MVP 限制（逐步补充边缘情况）

computed 读路径（v0.3 已支持：`computed(() => 表达式)` → data 派生 + setData 合并重算）/ watch / 跨模块引用、复杂事件表达式、`:class` 数组语法、
方法体对 setup ref 的复合赋值、`<template v-slot>` —— 均编译期警告或忽略。
