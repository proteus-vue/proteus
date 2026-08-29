# 模块 04：四端 createPinia 工厂

> **里程碑**：M3
> **依赖**：模块 01、02、03
> **目标**：每个平台一个 `createXxxPinia()` 工厂函数，业务代码只 `import { useStore }`，不感知平台。

---

## 1. 统一入口设计

```ts
// src/stores/index.ts（业务统一入口）
export { useUserStore } from './user'
export { usePlayerStore } from './player'
// ... 业务 store 集中导出
```

**关键**：`stores/` 内部**禁止** `createPinia()`。Pinia 实例由平台入口创建并注入。

---

## 2. 各平台工厂

### 2.1 Web SPA

```ts
// platforms/web/pinia.ts
import { createPinia } from 'pinia'
import { createPersistence } from '@proteus/persistence'
import { LocalStorageAdapter } from '@/shared/storage/localStorage'
import { createDevtoolsPlugin } from '@/shared/devtools'  // 见模块 06

export function createWebPinia() {
  const pinia = createPinia()

  pinia.use(createPersistence({ storage: new LocalStorageAdapter() }))
  // 社区插件兼容层（可选，按需引入）
  // pinia.use(createPersistedStatePlugin({ storage: new LocalStorageAdapter() }))

  if (import.meta.env.DEV) {
    pinia.use(createDevtoolsPlugin())  // 仅开发模式
  }

  return pinia
}
```

### 2.2 微信小程序 Skyline

```ts
// platforms/mp/pinia.ts
import { createPinia } from 'pinia'
import { createPersistence } from '@proteus/persistence'
import { WxStorageAdapter } from '@/shared/storage/wxStorage'

export function createMpPinia() {
  const pinia = createPinia()

  pinia.use(createPersistence({
    storage: new WxStorageAdapter(),
    // Skyline 小程序特有：storage 写盘防抖可拉长（主线程敏感）
    debounceMs: 100,
  }))

  return pinia
}
```

**注意**：小程序无 DevTools 扩展（`window.__PINIA_DEVTOOLS__` 不存在），模块 06 的 DevTools 插件在 mp 端自动 no-op。

### 2.3 App（Custom Renderer，未来）

```ts
// platforms/app/pinia.ts
import { createPinia } from 'pinia'
import { createPersistence } from '@proteus/persistence'
import { NativeKVAdapter } from '@/shared/storage/nativeKV'

export function createAppPinia() {
  const pinia = createPinia()

  pinia.use(createPersistence({ storage: new NativeKVAdapter() }))

  return pinia
}
```

**App 端额外考量**（文档占位，实现待 M3 后）：
- **序列化边界**：通过 Bridge 传递的 state 必须是可序列化 JSON（不能传函数 / Promise）
- **跨线程**：若 store 在 JS 线程、UI 在原生线程，状态变更需通过 Bridge 通知 → 用 `$subscribe` + Bridge emit
- **性能**：MMKV 同步读写，无需防抖

### 2.4 SSR

```ts
// platforms/ssr/pinia.ts
import { createPinia } from 'pinia'
import { MemoryAdapter } from '@/shared/storage/memory'

export function createSsrPinia() {
  const pinia = createPinia()

  // SSR 下仍可用 MemoryAdapter（每请求独立实例）
  pinia.use(createPersistence({ storage: new MemoryAdapter() }))

  return pinia
}
```

**关键**：`createSsrPinia()` **必须在每个请求内调用**（见模块 05），绝不在模块顶层调用。

---

## 3. 应用入口挂载

### Web（`main.web.ts`）
```ts
import { createApp } from 'vue'
import { createWebPinia } from '@/platforms/web/pinia'
import App from './App.vue'

const app = createApp(App)
app.use(createWebPinia())
app.mount('#app')
```

### 小程序（`main.mp.ts`）
```ts
import { createMpPinia } from '@/platforms/mp/pinia'
import { mountMpApp } from '@proteus/runtime'

mountMpApp({
  pinia: createMpPinia(),   // ← 注入 Pinia
})
```

### SSR（`entry-server.ts`）
```ts
import { createSsrPinia } from '@/platforms/ssr/pinia'

export function render(url: string) {
  const pinia = createSsrPinia()   // ← 每请求一份
  const app = createApp(App)
  app.use(pinia)

  // 渲染后收集状态用于客户端 hydration
  const html = renderToString(app)
  const state = pinia.state.value   // 收集所有 store 当前 state
  return { html, state }
}
```

---

## 4. 平台检测与类型安全

```ts
// shared/platform.ts
export type Platform = 'web' | 'mp' | 'app' | 'ssr'

let current: Platform = 'web'

export function setPlatform(p: Platform) { current = p }
export function getPlatform(): Platform { return current }

// 各平台入口在最早时机调用 setPlatform()
```

**禁止**在 store 里用 `getPlatform()` 做分支逻辑（只在 `platforms/` 和 `shared/` 使用）。

---

## 5. 测试要点

- [ ] 四端工厂各自返回独立 Pinia 实例
- [ ] store 源码无任何平台判断代码（grep 校验）
- [ ] 小程序端无 `window` 引用（避免 SSR / mp 报错）
- [ ] SSR 端每次 `createSsrPinia()` 返回全新 state（无残留）

---

## 验收
- `examples/` 下 Web + mp 两个 demo 跑通同一份 `stores/player.ts`
- `pnpm test cross-platform` 四端矩阵全绿
