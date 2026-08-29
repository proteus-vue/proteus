# 模块 05：SSR 实例隔离与 Hydration

> **里程碑**：M4
> **依赖**：模块 04（四端工厂）
> **目标**：SSR 下每个请求独立 Pinia 实例，客户端 hydration 正确恢复状态，无跨请求污染。

---

## 1. 问题本质

**错误示范**（会导致跨请求状态污染）：
```ts
// ❌ 模块顶层创建 —— 所有请求共享！
export const pinia = createPinia()
```

Node.js 单例在 SSR 长生命周期下会被并发请求共享 → A 用户的 `userStore.token` 泄漏给 B 用户。

**正确做法**：每个请求创建独立实例，通过 Vue 的 `app.runWithContext()` 绑定。

---

## 2. 服务端：每请求创建实例

```ts
// platforms/ssr/pinia.ts
import { createPinia } from 'pinia'

export function createSsrPinia() {
  return createPinia()   // ← 纯函数，无单例
}
```

```ts
// entry-server.ts
import { createSSRApp } from 'vue'
import { createSsrPinia } from './pinia'
import App from './App.vue'

export async function render(url: string, manifest: any) {
  const app = createSSRApp(App)
  const pinia = createSsrPinia()

  app.use(pinia)

  // 触发 asyncData / onServerPrefetch，让 store 填充数据
  await router.isReady()

  const html = await renderToString(app)

  // 收集当前 state 用于客户端 hydration
  const initialState = JSON.stringify(pinia.state.value)

  return { html, initialState }
}
```

---

## 3. 客户端：Hydration 恢复

```ts
// entry-client.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

const app = createApp(App)
const pinia = createPinia()

// 从服务端注入的 window.__INITIAL_STATE__ 恢复
const initialState = window.__INITIAL_STATE__
if (initialState) {
  pinia.state.value = JSON.parse(initialState)
}

app.use(pinia)
app.mount('#app')
```

**注意**：必须先 `pinia.state.value = ...` **再** `app.use(pinia)`，否则组件首次渲染读到的 state 是空的，导致 hydration mismatch。

---

## 4. 持久化在 SSR 下的行为

| 阶段 | 服务端 | 客户端 |
|------|--------|--------|
| 持久化读写 | ❌ 跳过（无 localStorage） | ✅ 正常 |
| store 初始值 | 来自 `initialState`（服务端渲染时填充） | 来自 `initialState` + 本地 storage |
| `$subscribe` 写盘 | ❌ 禁用 | ✅ 启用 |

**实现**（在持久化插件里）：
```ts
if (typeof window === 'undefined') {
  // 服务端：不 hydrate（state 由 entry-server 直接赋值），不 subscribe
  return
}
```

**原则**：服务端只负责"渲染出正确的 HTML + 收集 state"，持久化是客户端的事。

---

## 5. 并发隔离验证（测试核心）

```ts
// ssr-isolation.test.ts
import { createSSRApp } from 'vue'
import { createSsrPinia } from './pinia'
import { useUserStore } from '@/stores/user'

test('两个并发请求状态隔离', async () => {
  const { promise: p1 } = simulateRequest('userA')
  const { promise: p2 } = simulateRequest('userB')

  const [state1, state2] = await Promise.all([p1, p2])

  expect(state1.user.name).toBe('userA')
  expect(state2.user.name).toBe('userB')
})

async function simulateRequest(name: string) {
  const app = createSSRApp({})
  const pinia = createSsrPinia()
  app.use(pinia)

  const user = useUserStore(pinia)
  user.name = name

  return { pinia, user }
}
```

**压测建议**：用 `autocannon` 打 1000 QPS，持续 30s，断言无交叉状态。

---

## 6. 与 Nuxt 的对比（文档说明）

Nuxt 3 用 `useState()` + `Pinia` 自动 SSR 集成，原理相同：每个请求独立 store 实例 + 序列化到 payload。

Proteus SSR 的差异化：**手动控制但透明**——开发者显式写 `createSsrPinia()` + `initialState` 注入，编译层不隐藏这个过程（对齐"透明编译"哲学）。

---

## 7. 测试要点

- [ ] 模块顶层**无** `createPinia()` 调用（grep 校验）
- [ ] 并发请求状态完全隔离（核心测试）
- [ ] Hydration mismatch 检测（Vue 开发模式 warning 为 0）
- [ ] 服务端 `$subscribe` 不执行写盘
- [ ] 客户端先恢复 state 再 `app.use(pinia)`

---

## 验收
- SSR 压测 1000 QPS × 30s 无状态污染
- 客户端 hydration 后 store 值与服务端一致
- `pnpm test ssr` 全绿
