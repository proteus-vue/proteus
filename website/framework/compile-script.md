---
title: 脚本转换
order: 7
group: 编译期
---

# 脚本转换

`<script setup>` 的响应式代码在小程序端没有直接对等物（无 Proxy 响应式、无 computed/watch 原生概念）——编译器把它重写为 `Page()` / `Component()` 构造器 + `setData` 调用。每次转换触发规则可在 trace 逐条观察。

> **端范围**：本页描述 **mp-weixin** 目标的编译管线（Layer 1）。Web 端 `ref`/`computed`/`watch` 是真实 Vue 响应式零重写；其余端随桥接线启用。

## 核心规则

| 规则 ID | 业务写法 | 产物 |
|---|---|---|
| `script/define-props` | `defineProps({...})` | `properties`（type 映射：String/Number/Boolean/Object/Array——不支持类型报警告） |
| `script/define-emits` | `defineEmits([...])` | `triggerEvent` 封装（事件契约显式化） |
| `script/define-expose` | `defineExpose({ a, b })` | no-op（组件 methods 天然可被 selectComponent 访问） |
| `script/const-to-data` | `const count = ref(0)` | `data.count` |
| `script/ref-read` | `count.value` | `this.data.count` |
| `script/ref-write` | `count.value = expr` | `this.setData({ count: expr })` |
| `script/ref-incdec` | `count.value++` / `--` | `this.setData({ count: this.data.count ± 1 })` |
| `script/computed-to-data` | `const double = computed(...)` | **data 不存**；onLoad 初始化 + 依赖 ref 写入时同步重算、合并进同一 setData |
| `script/watch-to-methods` | `watch(count, (n, o) => {...})` | `proteusWatchCount`：依赖 ref 写入 setData 后自动调用（旧值写入前保存） |
| `script/watch-props` | `watch(() => props.x, cb)` | `observers: { x(n, o) {...} }`（immediate 额外生成 attached 初始化调用） |
| `script/const-to-data`（静态失败） | `const store = usePlayerStore()` | data 不含该字段；`onLoad/attached` 注入**实例属性**（模板绑定不支持——见诚实边界） |
| `script/function-to-methods` | `function handleTap() {...}` | `methods.handleTap` |
| `script/arrow-to-methods` | `const handleTap = () => {...}` | `methods.handleTap` |
| `script/lifecycle-map` | `onMounted` / `onUnmounted` / `onLoad` | `onReady` / `onUnload` / `onLoad` |
| `script/module-import` | 相对路径 import | 编译为独立产物 + `require` 转换（跨模块引用真正可用） |
| `script/provide-inject` | `provide("key", expr)` / `inject("key")` | `getApp().__proteusProvides` 全局注册表读写（MVP **值快照，非响应式**） |
| `script/store-binding` | 模板 `{{ store.count }}` | onLoad `setData(映射)` + `store.$subscribe → setData`（Pinia MP 绑定） |
| `script/vmodel-handler` | `v-model="name"` | `proteusOnNameInput`（setData 回写） |
| `script/nav-handler` | 导航调用 | wx.router 接线 |
| `script/onload-params` | `onLoad(options)` | 页面参数透传 |
| `script/runtime-init` | 运行时初始化段 | onLoad/attached 注入 |
| `script/component-mode` | 组件形态 | Page → Component 构造器切换 |

## 生命周期映射

| Vue 写法 | 小程序产物 | 说明 |
|---|---|---|
| `onMounted(...)` | `onReady(...)` | |
| `onUnmounted(...)` | `onUnload(...)` | |
| `onLoad(...)` | `onLoad(...)` | 同名直通 |
| `onErrorCaptured` 等其余 | **剥离 + 显式警告** | 小程序无 Vue 运行时无对等钩子——反黑盒：不再静默剥离，警告明确提示 Web 端保留原生语义 |

## setData 批量合并

运行期 `setDataBridge` 按**页面粒度**收集脏路径，在 **16ms（≈ 1 帧）批量窗口**内合并多次变更为一次 `setData`——`ref` 的连续修改不会产生多次桥接（窗口/粒度由 `proteus.config.ts` 的 `setDataBridge.batchWindow` / `perComponent` 配置）：

```ts
count.value++          // 脏路径 count
count.value++          // 同窗口再变更 → 合并
// 16ms 后：一次 setData({ count: 2 })
```

派生/computed 联动合并进同一窗口——`count` 写入触发 `double` 重算，一次 `setData({ count: 2, double: 4 })`。

## 诚实边界

- watch 模拟 MVP 仅支持**单 ref 直接引用** + 箭头函数回调（数组源/函数源/function 回调编译期警告）
- 顶层静态求值失败的绑定不支持模板读取（共享逻辑请用模块 import——`script/module-import` 是全功能路径）
- provide/inject 是值快照非响应式（MVP）
- 未映射生命周期钩子显式警告剥离（`onErrorCaptured` 等 Web 专属能力）
- 模板复杂表达式支持度以规则清单为准（`npx proteus rules`）
- prop 类型映射仅支持 String/Number/Boolean/Object/Array（编译期警告，按 String 兜底）

## 下一步

- [样式转换](/docs/framework/compile-style)
- [setData 桥接](/docs/framework/runtime-mp)
