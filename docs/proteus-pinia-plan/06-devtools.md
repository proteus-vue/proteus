# 模块 06：DevTools 集成

> **里程碑**：M5
> **依赖**：模块 04（四端工厂）
> **目标**：Web 端接入 Pinia 官方 DevTools；小程序 / App / SSR 端优雅降级（no-op），并提供 Proteus 自有的状态追踪能力。

---

## 1. 支持矩阵

| 端 | Pinia DevTools | Proteus Trace（`--trace-storage`） |
|----|---------------|----------------------------------|
| Web | ✅（Vue DevTools 插件） | ✅ |
| 小程序 Skyline | ❌（无浏览器扩展环境） | ✅ |
| App | ❌ | ✅ |
| SSR | ⚠️（仅客户端 hydrate 后） | ✅ |

**决策**：DevTools 连接仅在 Web + 开发模式启用；其他端靠 `--trace-storage` / `--trace-pinia` 提供等价可观测性。

---

## 2. Web 端：标准 DevTools 插件

Pinia 官方 DevTools 通过 `window.__PINIA_DEVTOOLS__` 通信，由 `pinia._p` 插件机制接入，用户正常使用 Vue DevTools 即可，**Proteus 无需额外代码**——只要保证：

1. `createWebPinia()` 在 `import.meta.env.DEV` 下正常运行（不做任何屏蔽）
2. 不使用 `pinia.state.value = xxx` 之外的黑魔法改写内部（hydration 那步是官方推荐做法，安全）

**验证**：`pnpm dev` 打开 Vue DevTools → Pinia 标签页可见所有 store + state + mutation 时间线。

---

## 3. 非 Web 端的替代：`@proteus/trace`

由于小程序 / App 无浏览器 DevTools，提供轻量状态追踪：

```ts
// shared/devtools/trace.ts
let enabled = false

export function enablePiniaTrace() { enabled = true }

export function traceMutation(storeId: string, mutation: string, payload?: unknown) {
  if (!enabled) return
  console.log(`[pinia] ${storeId} ${mutation}`, payload ?? '')
}

export function traceState(storeId: string, state: unknown) {
  if (!enabled) return
  console.log(`[pinia:state] ${storeId}`, JSON.parse(JSON.stringify(state)))
}
```

**挂载到 Pinia**：
```ts
// shared/devtools/plugin.ts
import type { PiniaPluginContext } from 'pinia'
import { traceMutation } from './trace'

export function createDevtoolsPlugin() {
  return function devtoolsPlugin(ctx: PiniaPluginContext) {
    const { store } = ctx

    store.$onAction(({ name, args, after, onError }) => {
      traceMutation(store.$id, `action:${name}`, args)
    })

    store.$subscribe((mutation, state) => {
      traceMutation(store.$id, `${mutation.type}:${mutation.key ?? ''}`)
    })
  }
}
```

---

## 4. 接入各平台工厂

```ts
// platforms/web/pinia.ts
if (import.meta.env.DEV) {
  pinia.use(createDevtoolsPlugin())   // 仅在 Web + DEV 启用 trace
}

// platforms/mp/pinia.ts
if (process.env.NODE_ENV !== 'production') {
  pinia.use(createDevtoolsPlugin())   // 小程序开发版启用 trace
}
```

**编译期开关**：`proteus.config.ts` 的 `devtools: true` → 注入 `enablePiniaTrace()`。

---

## 5. 小程序端状态调试体验优化

`console.log` 在微信开发者工具里不够用，提供**状态快照导出**：

```ts
// 在 store 里暴露（仅 DEV）
if (import.meta.env.DEV) {
  ;(globalThis as any).__PROTEUS_STORES__ = () => {
    // 返回所有 store 当前 state 的 JSON
    return JSON.stringify(pinia.state.value, null, 2)
  }
}
```

微信开发者工具 Console 里调 `__PROTEUS_STORES__()` 即可拿到完整状态树，复制到 Vue DevTools 的 "Import State" 复现问题。

---

## 6. 持久化追踪（对齐 `--trace-transform`）

```ts
// shared/persistence/trace.ts
export async function tracedRead(storage: StorageAdapter, key: string) {
  if (!enabled) return storage.getItem(key)
  const start = Date.now()
  const v = await storage.getItem(key)
  console.log(`[persistence] GET ${key} (${(Date.now() - start)}ms)`)
  return v
}
```

启用方式：`proteus.config.ts` 里 `storage: { trace: true }`。

---

## 7. 测试要点

- [ ] Web DEV：`window.__PINIA_DEVTOOLS__` 存在，DevTools 可连
- [ ] Web PROD：trace 代码被 tree-shake 掉（bundle 分析确认 0 字节）
- [ ] 小程序 DEV：`[pinia]` 日志正常输出
- [ ] `__PROTEUS_STORES__()` 返回合法 JSON

---

## 验收
- Web 开发体验与标准 Pinia 项目一致（Vue DevTools 开箱即用）
- 小程序 / App 端有可用的状态追踪（trace + 快照导出）
- 生产包不含 DevTools / trace 代码
