# 01 - Parse Pipeline（SFC 解析管线）

## 目标

将 `.vue` SFC + `.ts` 入口 解析为**结构化 AST + 自定义块**，作为 IR 输入。

## 解析流程

```
.vue File
   │
   ├─▶ <template>  → TemplateAST (基于 @vue/compiler-core)
   ├─▶ <script>    → ScriptAST  (基于 @babel/parser / ts-morph)
   ├─▶ <style>     → StyleAST   (基于 postcss)
   ├─▶ <route>     → RouteMeta  (自定义块，Router M2)
   ├─▶ <config>    → ConfigMeta (自定义块，Component M1)
   └─▶ <其他>       → 警告/忽略
```

## 输入示例

```vue
<!-- pages/home/Home.vue -->
<route>
{ "path": "/", "meta": { "title": "首页" } }
</route>

<config>
{ "componentFramework": "glass-easel" }
</config>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <view @click="count++">{{ count }}</view>
</template>

<style scoped>
view { color: red; }
</style>
```

## 输出（SourceUnit）

```ts
interface SourceUnit {
  id: string                    // 模块 id（相对路径）
  template?: TemplateNode       // 模板 AST 根
  script?: ScriptBlock          // 脚本（含 setup 解析）
  styles: StyleBlock[]          // 样式（scoped / module）
  customBlocks: CustomBlock[]   // <route> / <config> / ...
  dependencies: Dependency[]    // import 依赖
  loc: SourceLocation           // 源文件位置
}
```

## 关键设计

### 1. 自定义块注册表

```ts
interface CustomBlockParser {
  type: string                    // 'route' | 'config' | ...
  parse(raw: string, ctx): unknown
  validate?(data: unknown): boolean
}

// 注册（框架/插件扩展）
compiler.registerCustomBlock({
  type: 'route',
  parse: JSON.parse,
  validate: (d) => typeof d.path === 'string',
})
```

> 自定义块是**可扩展的**：Router 注册 `<route>`，Component 注册 `<config>`，Pinia 可注册 `<store>`。

### 2. `<script setup>` 解析

- 复用 `@vue/compiler-sfc` 的 `compileScript` 提取：
  - 顶层绑定 → `props` / `emits` / `expose`
  - 变量引用 → 模板作用域映射
- 输出 `ScriptBlock.bindings: Map<string, BindingType>` 供 transform 使用

### 3. Scoped CSS 哈希

```ts
// 输入
<style scoped> view { color: red; } </style>

// 输出（IR 阶段只记录策略，codegen 阶段落地）
StyleBlock {
  scoped: true,
  id: 'data-v-1a2b3c',   // 确定性哈希（基于文件路径）
  rules: [...]
}
```

> 哈希必须**确定性**（同文件同内容 → 同 hash），保证增量编译缓存有效。

### 4. 多 Main 入口识别

```ts
// proteus.config.ts
export default defineConfig({
  platforms: {
    web: { entry: 'src/main.web.ts' },
    mp:  { entry: 'src/main.mp.ts' },
    app: { entry: 'src/main.app.ts' },
  },
})
```

解析器为每个 entry 建立独立 `CompileContext`，但**共享 IR 缓存**（同一组件只解析一次）。

## 错误定位

所有解析错误带 `loc: { line, column, file }`，并映射回源码：
```
✘ [proteus/parse] <route> JSON 解析失败
  pages/home/Home.vue:2:5
  1 | <route>
> 2 | { path: /, }   ← 缺少引号
    |     ^^^
```
规则名前缀（`proteus/parse`）让 AI 能定位到具体 transform。

## 与其他模块的关系

- 输出 `SourceUnit` → **IR (02)** 消费
- 自定义块 `<route>` → Router 计划 M1
- 自定义块 `<config>` → Component 计划 M1
- scoped 哈希 → Codegen (04/05/06) 落地

## 验收

- [ ] `.vue` 三段 + 自定义块正确分离
- [ ] `<script setup>` 绑定提取准确
- [ ] 自定义块可扩展注册
- [ ] 错误信息带源码位置 + 规则名
- [ ] 确定性哈希（多次构建结果一致）
