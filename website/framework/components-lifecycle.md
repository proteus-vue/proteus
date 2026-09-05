---
title: 组件生命周期与事件
order: 17
group: 组件框架
---

# 组件生命周期与事件

组件的生命周期钩子与事件在双端由编译器映射——业务只写 Vue 语义。

## 生命周期映射

| Vue 写法 | Web 端 | 小程序端产物 |
|---|---|---|
| `onMounted(() => {...})` | 原生 mounted | `onReady()` |
| `onUnmounted(() => {...})` | 原生 unmounted | `onUnload()` |
| `onLoad`（小程序语义） | — | 透传 |
| 组件 attached 初始化 | — | 顶层静态求值注入点 |

编译规则 `生命周期映射 onMounted → onReady / onUnmounted → onUnload` 自动完成，业务零条件编译。

## 事件系统

| 规则 ID | 映射 |
|---|---|
| `event/click-to-tap` | `@click → bindtap`（Web 原生 click） |
| `event/modifier-catch` | 事件修饰符 → `catchtap`（阻止冒泡） |
| `event/modifier-self-once` | `.self` / `.once` 编译期处理 |
| `event/handler-simple-ref` | 处理器简单引用直接映射 |
| `event/inline-expression` | 内联表达式（MVP 支持简单形态） |

事件对象在双端归一（Web 原生 event / 小程序 touch 事件统一读取）。

## provide / inject

`provide/inject` 编译为 `getApp().__proteusProvides` 注册表桥：

- 页面 onLoad 注册；组件 provide 放 created（先于子组件 attached 注入）、inject 放 attached
- **响应式联动**：provide 传 ref → 写入点自动同步注册表 + 通知订阅者；传值 → 静态快照（对齐 Vue 语义）
- **页面级隔离**：注册表按 pageId 命名空间，onUnload 删除防泄漏

## 下一步

- [组件样式与插槽](/docs/framework/components-style)
