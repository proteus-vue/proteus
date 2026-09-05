---
title: 脚本转换
order: 6
group: 编译期
---

# 脚本转换

`<script setup>` 的响应式代码在小程序端没有直接对等物（无 Proxy 响应式、无 computed/watch 原生概念）——编译器把它重写为 `Page()` 构造器 + `setData` 调用。

## 核心规则

| 规则 | 业务写法 | 产物 |
|---|---|---|
| ref 读写 | `count.value++` | `this.setData({ count: this.data.count + 1 })` |
| computed | `const double = computed(() => count.value * 2)` | data 不存；`onLoad` 初始化 + 依赖 ref 写入时同步重算合并进同一 setData |
| watch | `watch(count, (n, o) => {...})` | 生成 `proteusWatchCount`；依赖 ref 写入 setData 后自动调用（旧值写入前保存） |
| 顶层静态求值失败 | `const store = usePlayerStore()` | data 不含该字段；`onLoad/attached` 注入实例属性（ES5 安全） |
| import 共享模块 | 相对路径 import | 编译为独立产物 + require 转换（跨模块引用真正可用） |
| provide/inject | `provide("key", expr)` | `getApp().__proteusProvides` 全局注册表注入 |

## setData 批量合并

运行期 `setDataBridge` 按**页面粒度**收集脏路径，在 **16ms（≈ 1 帧）批量窗口**内合并多次变更为一次 `setData`——`ref` 的连续修改不会产生多次桥接。

```ts
count.value++          // 脏路径 count
count.value++          // 同窗口再变更 → 合并
// 16ms 后：一次 setData({ count: 2 })
```

## 诚实边界

- watch 模拟 MVP 仅支持单 ref 直接引用 + 箭头函数回调（数组源/函数源/function 回调警告）
- 顶层静态求值失败的绑定不支持模板读取（共享逻辑请用模块 import）
- 模板复杂表达式支持度以规则清单为准（`npx proteus rules`）

## 下一步

- [样式转换](/docs/framework/compile-style)
