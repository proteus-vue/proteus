# 模块 02：兼容 pinia-plugin-persistedstate

> **里程碑**：M2（前半）
> **依赖**：模块 01（Storage 抽象层）
> **目标**：让现有使用 `pinia-plugin-persistedstate` 的项目**零改动**迁移到 Proteus 多端环境。

---

## 1. 背景

社区标准用法：
```ts
import { defineStore } from 'pinia'
import { persistedstatePlugin } from 'pinia-plugin-persistedstate'

const pinia = createPinia()
pinia.use(persistedstatePlugin)

export const useUserStore = defineStore('user', {
  state: () => ({ token: '', profile: null }),
  persist: {
    key: 'user',
    storage: localStorage,   // ← Web only，小程序 / SSR 会炸
  },
})
```

**问题**：`storage: localStorage` 在小程序和 SSR 环境不存在。

**Proteus 方案**：提供**兼容层插件**，把 `storage` 选项自动替换为当前平台的 Adapter。

---

## 2. 兼容层设计

```ts
// shared/persistence/plugin.ts
import type { PiniaPluginContext } from 'pinia'
import { createStorage, type StorageAdapter } from '@/shared/storage'

interface PersistOptions {
  key?: string
  storage?: StorageAdapter | Storage  // 允许传 Web Storage 兼容对象
  paths?: string[]                    // 只持久化指定字段
  beforeRestore?: (ctx: PiniaPluginContext) => void
  afterRestore?: (ctx: PiniaPluginContext) => void
}

export function createPersistedStatePlugin(options: { storage?: StorageAdapter } = {}) {
  const defaultStorage = options.storage ?? createStorage()

  return function persistedStatePlugin(ctx: PiniaPluginContext) {
    const { store, options: storeOptions } = ctx
    const persist = storeOptions.persist as PersistOptions | undefined

    if (!persist) return  // 该 store 不需要持久化

    const storage = persist.storage
      ? normalizeStorage(persist.storage)   // 允许传 localStorage，自动包成 Adapter
      : defaultStorage

    const key = persist.key ?? store.$id

    // 1. 初始化：从 storage 恢复
    persist.beforeRestore?.(ctx)
    hydrate(store, storage, key, persist.paths)
    persist.afterRestore?.(ctx)

    // 2. 订阅变化：写入 storage
    store.$subscribe((_mutation, state) => {
      const data = persist.paths
        ? pickPaths(state, persist.paths)
        : state
      storage.setItem(key, serialize(data))
    }, { detached: true })
  }
}

/** 把 Web Storage 兼容对象包成 StorageAdapter */
function normalizeStorage(s: Storage | StorageAdapter): StorageAdapter {
  if ('getItem' in s && typeof (s as any).getItem === 'function'
      && (s as Storage).removeItem !== undefined) {
    // 看起来像 Web Storage
    const web = s as Storage
    return {
      getItem: (k) => Promise.resolve(web.getItem(k)),
      setItem: (k, v) => { web.setItem(k, v) },
      removeItem: (k) => { web.removeItem(k) },
    }
  }
  return s as StorageAdapter
}
```

---

## 3. 使用方式（迁移后）

```ts
// platforms/web/pinia.ts
import { createPinia } from 'pinia'
import { createPersistedStatePlugin } from '@/shared/persistence/plugin'
import { LocalStorageAdapter } from '@/shared/storage/localStorage'

export function createWebPinia() {
  const pinia = createPinia()
  pinia.use(createPersistedStatePlugin({ storage: new LocalStorageAdapter() }))
  return pinia
}
```

**用户 store 代码零改动**：
```ts
export const useUserStore = defineStore('user', {
  state: () => ({ token: '' }),
  persist: { key: 'user' },   // ← 不再写 storage: localStorage
})
```

`storage` 由平台入口统一注入，store 文件保持平台无关。

---

## 4. 与官方插件的差异点（文档需明确）

| 特性 | pinia-plugin-persistedstate | Proteus 兼容层 |
|------|---------------------------|---------------|
| `storage` 选项 | 必传（Web Storage） | **可选**，不传自动选平台 Adapter |
| `paths` | ✅ | ✅ |
| `beforeRestore` / `afterRestore` | ✅ | ✅ |
| 多 storage 实例 | 需手动 | 支持（每个 store 可配不同 Adapter） |
| SSR 安全 | ❌（需手动处理） | ✅（MemoryAdapter + 跳过服务端写入） |
| `cookieOptions` | ✅ | ❌（App 端无 cookie 概念，未来按需） |

---

## 5. SSR 处理

```ts
// 在插件内判断
if (typeof window === 'undefined') {
  // 服务端：跳过 hydrate + subscribe
  return
}
```

**原则**：服务端**只创建空 state**（避免 hydration mismatch），客户端 `hydrate` 从 storage 恢复。

---

## 6. 测试要点

- [ ] 官方插件 demo store 直接跑 Proteus 兼容层，行为一致
- [ ] `storage` 不传时自动选平台 Adapter
- [ ] `paths` 只持久化指定字段（嵌套路径用 lodash-style `a.b.c`）
- [ ] SSR 下 `$subscribe` 不执行写入
- [ ] 多 store 各自独立 key，不冲突

---

## 验收
- 从 `pinia-plugin-persistedstate` 迁移的项目，**store 文件改动 ≤ 2 行**（删掉 `storage:` 配置）
- 四端持久化行为一致（同一份 state，同一份 storage key）
