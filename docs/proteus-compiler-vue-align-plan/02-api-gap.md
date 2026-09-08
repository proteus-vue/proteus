# 02 · 基准线 = Vue 全能力（SSOT，权威拉取）

> **基准线（用户确认）**：**Vue 全能力**——因为开发者写的是**标准 SFC** 去跨端，期望标准 Vue 能力全部对齐。**不是框架自选一个"支持的子集"**，而是以 Vue 全集为基准，能力矩阵记录**每个能力的对齐状态**（aligned / partial / unsupported + 依据 + 机器门禁）。
> 本清单**权威拉取自 `@vue/runtime-core@3.5.42` + `@vue/reactivity` + `@vue/shared`** 的公共导出，是开发者可用面的不可置疑 SSOT（随 Vue 版本演进唯一来源）。

## A. 响应式 / 核心（@vue/reactivity + runtime-core）

**工厂/对象**：`ref` `reactive` `computed` `shallowRef` `shallowReactive` `shallowReadonly` `readonly` `customRef` `toRef` `toRefs` `toValue` `proxyRefs` `effect` `stop` `triggerRef` `markRaw` `unref`

**判断/工具**：`isRef` `isReactive` `isReadonly` `isProxy` `isShallow` `toRaw` `getCurrentScope` `effectScope` `onScopeDispose` `onWatcherCleanup` `getCurrentWatcher`

**副作用 watch**：`watch` `watchEffect` `watchPostEffect` `watchSyncEffect`

## B. 组件 API（runtime-core）

**定义**：`defineComponent` `defineAsyncComponent` `defineProps` `defineEmits` `defineExpose` `defineSlots` `defineOptions` `defineModel` `useModel` `withDefaults` `withDirectives` `isVNode` `cloneVNode` `h` `createVNode` `createApp`
（`createApp`/`render` 在 runtime-dom 层；`h`/`createVNode`/`cloneVNode`/`isVNode` 属运行时渲染，框架非目标 §0.4）

**实例/环境**：`getCurrentInstance` `useSlots` `useAttrs` `useTemplateRef` `useId` `useSSRContext` `hasInjectionContext` `provide` `inject` `nextTick` `queuePostFlushCb`

## C. 生命周期（runtime-core）

`onMounted` `onUnmounted` `onBeforeMount` `onBeforeUnmount` `onUpdated` `onBeforeUpdate` `onActivated` `onDeactivated` `onErrorCaptured` `onRenderTracked` `onRenderTriggered` `onServerPrefetch`

## D. 模板指令 / 内置组件 / SFC 面（@vue/compiler-* + runtime）

**指令**：`v-if` `v-else` `v-else-if` `v-for` `v-show` `v-bind` (`:`) `v-on` (`@`) `v-model` `v-html` `v-text` `v-pre` `v-once` `v-cloak` `v-slot` `v-memo` `v-slot` 自定义指令（directives）

**内置组件**：`<transition>` `<transition-group>` `<keep-alive>` `<teleport>` `<suspense>` `<component :is>` `<slot>`（默认/具名/作用域）

**SFC 特性**：`<script setup>` `defineProps`/`defineEmits`/`defineExpose`/`defineSlots` 宏、`<style scoped>` `:deep` `<style lang=scss>`、`<template #slot>`、`ref` 模板引用、类型注解（TS）

**渲染工具**：`resolveComponent` `resolveDirective` `resolveDynamicComponent` `renderSlot` `mergeProps` `toHandlers` `normalizeClass` `normalizeStyle`

## 基准线下的三类状态（能力矩阵的列，不是"选子集"）

| 状态 | 定义 | 门禁 |
|---|---|---|
| **aligned** | 在 MP 编译产物**正确翻译**（等价语义/可运行） | 编译断言（黄金 fixture） |
| **partial** | 翻译了子集 / 语义受限（如作用域插槽平台限制、事件表达式受限） | 编译期警告 + 文档（反黑盒） |
| **unsupported** | 框架明确不支持（动态渲染/运行时对内 API/无对等平台能力） | 编译期显式警告/报错（反黑盒红线） |

**关键**：基准线是**全集**（上面 A-D），矩阵按**每个能力**标状态。开发者写任何标准 Vue 特性，编译器必须给出**明确三类之一的结果**（可跑 / 受限警告 / 明确报错）——**绝不静默**输出未定义引用或无效产物。

> 状态赋值来源：优先 `vue-compat-plan` §1 实测（✅主路径/⚠️/❌）+ `vue-compat-advance` Batch 1-7 + `roadmap` #2；未覆盖的按"能否翻译"评估。**getCurrentInstance 等运行时对内 API = `unsupported` 或单独立项框架语义 API（决策点）**。
