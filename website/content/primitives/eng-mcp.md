---
title: WebMCP 接入（E30：useMCP / capabilityToTool）
order: 82
group: 工程语义原语
---

# WebMCP 接入（E30：useMCP / capabilityToTool）

把框架能力暴露为浏览器内 agent 可调用工具——能力派生自动归一（ok → 结果 / Err → isError + 错误码）；小程序端诚实降级

> 来源模块 `@proteus-vue/api`（工程原语工厂——**注入式**：消费方注入 reactivity/driver/routerLike 等，api 包零 vue 依赖；MP 产物安全子集：无 `?.`/`??`/数组解构）。

**★WebMCP 接入（G-32 ⑥ 工程原语 E30 · engineering.mcp）：把**框架能力**暴露为 agent 可调用工具**
—— 规范面（2026-09 核实）——
WebMCP = 页面把工具注册给浏览器内 agent 的 Web 标准，要点四条（易记错处已标注）：
· 命名空间是 `document.modelContext`（★**不是** navigator——规范与 VueUse 实现均为 document）
· 注册 `registerTool(descriptor, { signal })`；**规范无 unregisterTool**，注销靠 `signal.abort()`
· descriptor 字段：`name` / `description` / `inputSchema` / `execute`
· 探测须判**方法可调用**而非「对象存在」（部分实现只暴露空对象——同 VueUse `useSupported` 的做法）
—— 灵感来源与差异化（★不是照抄）——
借鉴 VueUse v15 `useWebMCP` 四点：document 命名空间 / signal 注销 / 方法可调用探测 /
返回 `{ isSupported, isRegistered, error }` 三元组。
本实现的差异化来自**框架自身的能力契约**：本仓能力原语全部返回 `Promise<CapResult<T>>`
（G-32.4 铁律：无回调 / 无全局对象 / 全类型 / 失败即 Err）→ 于是可以**自动**把能力派生为 MCP 工具：
`ok` → 工具结果、`Err` → `isError` + 错误码。业务只写「工具名 + 描述 + 参数 schema」，
响应归一交给框架（这正是 `capabilityToTool` 相对于手写每个工具的增量）。
—— 降级与产物安全 ——
**★MP/SSR 诚实降级：小程序无 `document`（WebMCP 是浏览器侧 agent 通道）→ `isSupported=false`、**
不注册、**不抛错**（同 G-32.3 降级语义：能力不可用如实反映，不静默假装成功）。
**★MP 产物安全（决策 #32/#36）：无 `?.` / `??` / 数组解构；顶层不触碰 `document`；**
不 import vue（作用域销毁经**注入**，同 Engineering 的 reactivity 注入惯例）。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | 官方 demo 接线（examples/platform-api-demo 全工厂调用） |
| 微信小程序 | 🟡 | 注入式可在逻辑层跑（MP 产物安全子集）；组件形态接线部分先行 |
| Headless（SSR / 测试） | ✅ | Node 注入 reactivity 等即可跑（工具/测试档） |
| iOS 原生 | 🟡 | 原生端验证未开始（E 系注入面随宿主批次） |
| Android 原生 | 🟡 | 原生端验证未开始 |
| 鸿蒙 | 🟡 | 原生端验证未开始 |
| Flutter 混合 | 🟡 | 同一 JS 逻辑层——接线未开始 |
| 快应用 | ⬜ | 端未开始 |

> 状态口径：✅ 端已落地·本原语可用；🟡 端原型映射·接线未开始；⬜ 端未开始。本表为家族级机制口径（非逐端真机验证矩阵）；端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。

## 核心导出（SSOT：`packages/api/src/mcp.ts`）

| 导出 | 形态 | 一句话（源码注释） |
|---|---|---|
| `McpModelContextLike` | interface | `document.modelContext` 最小面 |
| `McpDocumentLike` | interface | `document` 最小面（注入用：测试 / 非浏览器环境传 mock） |
| `McpToolArgs` | type | agent 传入的工具参数（框架侧透传；约束由 inputSchema 声明） |
| `McpToolResponse` | interface | MCP 工具响应（规范 content 形状 + isError 可选） |
| `McpToolDescriptor` | interface | 工具描述符（规范字段子集） |
| `McpCapabilityToolSpec` | interface | ★能力 → 工具规格（框架差异化入口） |
| `toToolResponse` | function | 值 → 工具响应：字符串直出；undefined/null → 成功但无载荷的可读标记；其余 JSON 序列化 |
| `toErrorResponse` | function | 错误 → 工具响应（`isError: true`——agent 据此重试或换策略，而非当成功解析） |
| `capabilityToTool` | function | ★能力 → MCP 工具：把框架统一契约 `CapResult<T>` 归一为工具响应 |
| `UseMCPOptions` | interface | useMCP 入参：工具来源（显式/能力派生）+ document 注入 + 生命周期钩子 |
| `UseMCPReturn` | interface | useMCP 返回值：状态经 getter 实时读（异步注册/注销后可见）+ 注册工具名 + ready + dispose |
| `useMCP` | function | ★useMCP：把工具（显式声明 + 能力派生）注册到 `document.modelContext` |

### API 明细

#### `useMCP`

- 签名：`useMCP(options: UseMCPOptions): UseMCPReturn`
- `options`：`tools`（显式工具）· `capabilities`（能力派生）· `prefix`（工具名前缀）· `document`（注入，测试用）· `enabled`（只探测不注册）· `onDispose`（作用域销毁钩子）
- 返回：`{ isSupported, isRegistered, error, toolNames, ready, dispose }` —— ★状态为 **getter**（异步注册 / 注销后能读到最新值，而非创建时的快照）
- `ready`：Promise，等注册完成（含异步 `registerTool`）——需要确定性时 `await`

#### `capabilityToTool`

- 签名：`capabilityToTool(spec: McpCapabilityToolSpec, prefix?: string): McpToolDescriptor`
- `spec.run` 返回 `CapResult<T>`（或 Promise 包装）→ 自动归一：`ok` → 工具结果；`Err` → `isError: true` + `code: message`
- 实现抛错同样归一为工具响应（异常不穿透到 agent 通道）

#### `toToolResponse`

- 值 → 工具响应：字符串直出；**空载荷（`undefined`/`null`）→ `ok（无返回数据）`**——★不能产出字面量 `"undefined"`（多数能力是 `CapResult<void>`，agent 会把该字符串当有效数据）；其余走 `JSON.stringify`
- 循环引用 / BigInt 等序列化失败 → 降级为字符串（工具响应必须可序列化，不得抛给 agent）

#### `toErrorResponse`

- `Error` / 非 Error 值 → `{ content, isError: true }`——agent 据此重试或换策略，而非当成功解析

## 真实用法（dogfooding 出处——官网自身/示例工程在跑，非示意图）

```ts
const cap = createCapabilityHooks()

const mcp = useMCP({
  prefix: 'app_',
  capabilities: [
    { name: 'vibrate', description: '震动提示', run: () => cap.useVibrate(30) },
    { name: 'clipboard_read', description: '读取剪贴板', run: () => cap.useClipboard() },
  ],
  onDispose: onScopeDispose, // 或 onUnmounted——生命周期交还调用方（零 vue 依赖）
})

mcp.isSupported  // 本环境是否实现 WebMCP（方法可调用判定）
mcp.toolNames    // 实际注册的工具名（含前缀）
```
> 出处：`examples/pages/platform-api-demo.vue:836`

```ts
// 能力 → 工具：ok → 结果；Err → isError + 错误码（CapResult 自动归一）
const t = capabilityToTool({ name: 'locate', description: '定位', run: () => capOk({ lat: 1, lng: 2 }) })
```
> 出处：`tests/use-mcp.test.ts:120`

## 用法与降级

- **两步注册**：`useMCP({ capabilities | tools })` —— `capabilities` 走**能力派生**（框架据 `CapResult` 自动归一响应）；`tools` 走**显式声明**（完全自定义 `execute`）。
- **能力派生（本原语的核心增量）**：只写「工具名 + 描述 + 参数 schema」，响应归一交给框架——`ok` → 工具结果、`Err` → `isError` + 错误码、实现抛错也不穿透到 agent 通道。
- **生命周期**：`onDispose` **注入式**（Vue 侧传 `onScopeDispose` / `onUnmounted`）；本包零 vue 依赖——同一份实现可进 MP 产物与 Node 测试。
- **注销语义**：规范无 `unregisterTool`，`dispose()` 即中断 `AbortSignal`（幂等）。
- **降级**：无 `document.modelContext`（小程序 / SSR / 未实现该标准的浏览器）→ `isSupported=false`、不注册、**不抛错**——如实反映而非静默假装成功。
- **探测纪律**：判 `registerTool` **可调用**而非对象存在（空对象会被误判为支持）。

<!-- generated by website/scripts/gen-primitives.mjs · SSOT：packages/api/src -->