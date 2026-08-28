# @proteus/compiler —— 编译引擎模块

> 本目录是 Proteus 的**编译引擎**（最核心的基建），当前以项目内模块形式存在，
> 设计目标：**零 Vite 依赖、零项目配置依赖**，可随时独立提取为开源包 `@proteus/compiler`。

## 模块边界（必须遵守）

| 允许 | 禁止 |
|---|---|
| import `@vue/compiler-sfc` / `@vue/compiler-dom`（编译期 AST 处理） | import `vite` 或任何 Vite 相关 API |
| import 同目录 `./types` | import `proteus.config.ts` 或读取项目配置 |
| 选项全部通过函数入参传入 | 读写文件系统 / 网络（纯函数） |

- 所有转换函数是**纯函数**：相同输入 → 相同输出，可独立单测（执行规则 9）
- 编译期警告通过返回值 `warnings` 透出（不直接抛错，除非不可恢复）

## 公开 API

```typescript
// 整包编译（推荐入口）
compileVueSfc(source: string, options: CompileOptions): CompileResult
// CompileResult = { wxml, js, wxss, warnings }

// 分步转换（精细控制 / 单测）
transformTemplateToWxml(templateSource, styleOpts): { wxml, vModelBindings, warnings }
transformScriptToPage(scriptSource, styleOpts, { file, isComponent, vModelBindings }): { js, warnings }
transformStyleToWxss(styleSource, styleOpts): string
```

## 产物契约

- `.wxml`：标准标签 → 小程序标签（`div→view` / `span,p,h1-h6→text` / `img→image` …）
- `.js`：`Page({ data, methods, onReady, onUnload, onLoad, __onXxxInput })`（组件为 `Component()`）
- `.wxss`：px → rpx、Skyline 不支持属性编译期警告
- `.json`：**不属于本引擎**，由 `scripts/gen-routes.ts`（框架路由生成器）负责

## 消费方

- `vite-plugin-mp-transform.ts`（项目根）：薄适配层，负责扫描页面、传选项、`emitFile` 产物
- `tests/mp-transform.test.ts`：直接调纯函数做 golden test

## 独立开源提取路径（后期执行）

1. 将本目录整体移到 monorepo：`packages/compiler/`
2. 添加 `packages/compiler/package.json`：
   - `name: "@proteus/compiler"`
   - `peerDependencies: { "@vue/compiler-sfc": "^3.4", "@vue/compiler-dom": "^3.4" }`（编译期依赖放 devDependencies 亦可，产物为 Node 工具）
   - `type: "module"`，`exports` 指向 `./dist/index.js`
3. 构建：`tsc -p tsconfig.build.json`（声明文件 + ESM）
4. 发布：`npm publish --access public`
5. 适配层改为 `import { compileVueSfc } from '@proteus/compiler'`，`proteus.config.ts` 中的 `style` 选项由适配层读取后传入
6. 附赠能力：可同时发布 CLI `@proteus/cli`（`proteus build <dir> --out <dir>`），核心就是调 `compileVueSfc`

## MVP 限制（逐步补充边缘情况）

computed/watch/跨模块引用、复杂事件表达式、`:class` 数组语法、`v-show`、
方法体对 setup ref 的读写、`<template v-slot>` —— 均编译期警告或忽略。
