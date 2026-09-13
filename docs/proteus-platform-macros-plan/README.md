# 平台条件编译（编译期宏）· 方案

> **状态**：已落地（p-button 双端验证）
> **关联**：`packages/compiler/src/platform-macros.ts`（实现）· `packages/compiler/src/template.ts`（静态裁剪）· `showcase/subpackages/components/pages/p-button.vue`（演示 09）
> **一句话**：**不引入 `#ifdef` 式非标准语法**，用**标准 Vue 条件渲染 + 构建期常量宏** `__MP__`/`__WEB__`/`__TARGET__`——编译期静态求值 → 死分支整块消除（产物纯净）。

---

## 1. 问题

Proteus 不做 uni-app 式条件编译（`#ifdef MP-WEIXIN`），但页面内确实需要按平台显隐：
比如 `open-type` 开放能力只能在微信小程序用，Web 端必须不出现。

**现状三层能力**（本方案补第三层）：

| 粒度 | 机制 | 局限 |
|------|------|------|
| 整页 | `<route> webOnly: true` | 只能整页，不能页内某块 |
| 组件内部 | `isMp ? <camera> : <video>` 运行时双分支 | 是组件实现细节，非业务 API；两端产物都含死分支 |
| **页内元素** | **本方案：编译期宏** | —— |

## 2. 用法（标准 Vue，零新语法）

```vue
<template>
  <!-- 仅小程序：open-type 开放能力（Web 无对等，编译期整块消除） -->
  <p-button v-if="__MP__" open-type="contact" @contact="onContact">客服会话</p-button>
  <p-button v-else @click="onFallback">普通按钮</p-button>

  <!-- 按具体目标判断（预留 native：v0.6 App 原生后端） -->
  <view v-if="__TARGET__ === 'web'">仅 Web</view>
  <view v-else-if="__TARGET__ === 'mp'">仅小程序</view>
</template>

<script setup>
// script 内同样可用（构建期替换为字面量）
const isMpBuild = __MP__
const target = __TARGET__        // 'mp' | 'web' | 'native'
</script>
```

**宏语义**：

| 宏 | mp 构建 | web 构建 | native 构建（预留） |
|----|---------|---------|---------------------|
| `__MP__` | `true` | `false` | `false` |
| `__WEB__` | `false` | `true` | `false` |
| `__TARGET__` | `'mp'` | `'web'` | `'native'` |

## 3. 实现（两条通道，同源取值）

```
platformDefines(platform) —— 单一取值表（packages/compiler/src/platform-macros.ts）
        │
   ┌────┴─────────────────────────────────┐
   │ MP 通道                               │ Web 通道
   │ .vue 走自定义编译器 compileVueSfc      │ .vue 走标准 @vitejs/plugin-vue
   │  → 入口 applyPlatformMacros           │  → platformMacroPlugin（enforce:'pre'，源码替换）
   │  → 模板阶段 pruneStaticConditionals    │  → vue 编译出 v-if(false) → rollup tree-shake
   │    （AST 级静态裁剪，死分支不进产物）    │
   │ 共享 .ts 模块：esbuild define          │ 非 .vue 模块：vite define
   └──────────────────────────────────────┘
```

### 3.1 关键坑（实测确立的约束）

| # | 约束 | 原因 |
|---|------|------|
| M1 | **vite define 对 `.vue` 不生效** | 实测 `define: { __MP__: 'false' }` 后 `.vue` 模板/script 内 `__MP__` 仍残留 → Web 端必须用 `enforce:'pre'` 源码替换插件 |
| M2 | **script 替换必须跳过字符串字面量** | 代码示例字符串 `codes.x = '<p-button v-if="__MP__">'` 若被替换 → 引号结构被破坏、编译失败（实测事故）。故分两模式：template 用原始替换，script 用「跳过字符串/注释」模式 |
| M3 | **模板替换不做字符串跳过** | `v-if="__MP__"` 的标识符位于 HTML 属性引号内，但语义是表达式——必须替换 |
| M4 | **静态裁剪只处理可求值链** | 链上有运行时变量（`v-if="a"`）→ 整链保留走 `wx:if` 运行时判定，不误裁 |
| M5 | **缓存键须含 platform** | 否则同源码跨平台命中错误缓存 |

### 3.2 静态裁剪规则（`pruneStaticConditionals`）

对 `v-if` / `v-else-if` / `v-else` **链**做 AST 级前置裁剪：
- 链上某支表达式**静态可求值**为 `true` → 保留该支（并移除其条件指令，避免 `wx:if="{{true}}"` 残留）、删除其余支
- 整链静态可求值但全 `false` → 全删（`v-if="__MP__"` 在 Web 构建整块消失）
- 链上存在**不可静态求值**的支 → 整链原样保留（语义不变）

支持的字面量求值：`true`/`false`、字符串比较（`'mp' === 'web'`）、布尔比较、数字比较。

## 4. 证据（2026-09-13）

**产物对照**（showcase p-button 演示 09）：

| 检查项 | MP 产物 | Web 产物 |
|--------|---------|----------|
| `open-type="contact"`（MP-only 块） | ✅ 存在 | ❌ 不存在 |
| `Web 端占位`（Web-only 块） | ❌ 不存在 | ✅ 存在 |
| `当前构建目标：小程序` | ✅ | ❌ |
| `当前构建目标：Web` | ❌ | ✅ |
| 宏标识符残留（`__MP__` 等） | 0 | 0 |
| 代码示例字符串（教学用途） | ✅ 原样保留 | ✅ 原样保留 |

**测试**：`tests/platform-macros.test.ts`（12 用例，★破坏性验证过：禁用裁剪 → 3 用例红）；
showcase E2E 新增「平台宏：Web 构建 MP-only 块不出现」门禁。

**真机**：MP 模拟器截图确认「客服会话（仅小程序）」按钮渲染、Web-only 块无。

## 5. 与 uni-app `#ifdef` 的对比

| | uni-app `#ifdef` | Proteus 编译期宏 |
|---|---|---|
| 语法 | 预处理指令（非标准） | **标准 Vue `v-if` + 常量** |
| 作用范围 | 模板/样式/JS 注释块 | 模板表达式 + script 代码 |
| 类型安全 | 无（注释块） | ✅ TS 可见（`declare const __MP__: boolean`） |
| Web 端 | 需框架转换 | ✅ 标准 Vue 构建，rollup 天然 tree-shake |
| 死分支产物 | 平台转换时剔除 | ✅ 编译期静态裁剪 |

## 6. 诚实边界

1. **`native`（App 原生）为预留取值**：当前只有 `mp`/`web` 两个真实构建目标；待 v0.6 原生后端接入时启用。
2. **静态求值范围有限**：仅字面量布尔/字符串/数字比较；复杂表达式（含函数调用）不裁剪，走运行时判定。
3. **样式块（`<style>`）内的宏不替换**：条件样式请用 CSS 变量/主题通道，或平台类名。
4. **`v-if` 与 `v-for` 同节点**：裁剪只处理条件链，`v-for` 语义不变。
