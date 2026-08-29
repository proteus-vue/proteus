# 模块 03：自研轻量持久化方案

> **里程碑**：M2（后半）
> **依赖**：模块 01（Storage 抽象层）
> **目标**：提供比社区插件更轻、API 更贴合 Proteus 的持久化方案，同时保留社区插件兼容层。

---

## 1. 设计动机

`pinia-plugin-persistedstate` 是通用方案，但 Proteus 用户需要：
- **更少的样板**：不想每个 store 都写 `persist: { ... }`
- **响应式自动同步**：store 变化自动写盘，无需手动 `$subscribe`
- **类型安全**：`useUserStore().token` 的持久化配置在定义时声明，带类型提示
- **零运行时开销**：未配置的 store 完全不走持久化逻辑

---

## 2. API 设计

### 2.1 定义 Store 时声明持久化

```ts
import { defineStore } from 'pinia'
import { persisted } from '@proteus/persistence'

export const useUserStore = defineStore('user', () => {
  const token = ref('')
  const profile = ref<UserProfile | null>(null)

  return { token, profile }
}, {
  // 直接在 store options 里声明，类型安全
  persistence: persisted({
    pick: ['token'],        // 只持久化 token，profile 不存
    // storage 不传 → 平台默认 Adapter
  }),
})
```

`persisted()` 是一个**标识函数**，编译期/运行时标记该 store 需要持久化，返回 `PersistenceOptions` 类型。

### 2.2 全局配置（平台入口）

```ts
// platforms/mp/pinia.ts
import { createPinia } from 'pinia'
import { createPersistence } from '@proteus/persistence'
import { WxStorageAdapter } from '@/shared/storage/wxStorage'

export function createMpPinia() {
  const pinia = createPinia()
  pinia.use(createPersistence({
    storage: new WxStorageAdapter(),
    // 全局默认：所有 persisted store 都走这个 storage
  }))
  return pinia
}
```

---

## 3. 实现

```ts
// shared/persistence/lightweight.ts
import type { PiniaPluginContext } from 'pinia'
import type { StorageAdapter } from '@/shared/storage'
import { serialize, deserialize } from './serialize'

export interface PersistenceOptions {
  pick?: string[]              // 白名单字段
  omit?: string[]              // 黑名单字段（与 pick 二选一）
  storage?: StorageAdapter     // 覆盖全局默认
  key?: string                 // 默认 store.$id
}

export function persisted(options: PersistenceOptions = {}): PersistenceOptions {
  return { __persisted: true, ...options }
}

export function createPersistence(global: { storage: StorageAdapter }) {
  return function persistencePlugin(ctx: PiniaPluginContext) {
    const { store, options } = ctx
    const opt = options.persistence as (PersistenceOptions & { __persisted?: boolean }) | undefined

    if (!opt?.__persisted) return  // ← 未声明则零开销

    const storage = opt.storage ?? global.storage
    const key = opt.key ?? store.$id

    // Hydrate
    storage.getItem(key).then(raw => {
      if (raw) {
        const saved = deserialize(raw)
        const data = applyPick(saved, opt.pick, opt.omit)
        store.$patch(data)
      }
    })

    // Subscribe（防抖，避免高频写入）
    let timer: ReturnType<typeof setTimeout> | null = null
    store.$subscribe((_m, state) => {
      const data = serialize(applyPick(state, opt.pick, opt.omit))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        storage.setItem(key, data)
      }, 50)  // 50ms 防抖
    }, { detached: true })
  }
}

function applyPick(state: any, pick?: string[], omit?: string[]): any {
  if (pick) {
    const out: any = {}
    for (const p of pick) out[p] = state[p]
    return out
  }
  if (omit) {
    const out = { ...state }
    for (const o of omit) delete out[o]
    return out
  }
  return state
}
```

---

## 4. 与社区插件的关系

| 维度 | 社区插件兼容层（模块 02） | 自研轻量方案（模块 03） |
|------|------------------------|----------------------|
| 适用人群 | 迁移老项目 | 新项目 / Proteus 原生 |
| 声明位置 | store options 里 `persist: {...}` | store options 里 `persistence: persisted({...})` |
| 默认 storage | 需传 / 自动选平台 | **必须平台入口注入** |
| 防抖 | 无（每次 mutation 写盘） | 50ms 防抖（可配） |
| 体积 | ~3KB | ~1.5KB |
| 生态 | 兼容现有教程 / 代码 | Proteus 专属，文档自含 |

**两者共存**：同一个 Pinia 实例可以同时 `pinia.use(createPersistedStatePlugin())` + `pinia.use(createPersistence(...))`，不冲突（识别标记不同）。

---

## 5. 进阶：派生状态 / 计算属性不持久化

**规则**：只持久化 `state` 字段，`getters` 自动忽略（因为可从 state 重新计算）。

`applyPick` 只操作 `state`，天然排除 getters。文档需明确说明。

---

## 6. 测试要点

- [ ] `persisted()` 标记正确识别（`__persisted` 标记）
- [ ] `pick` / `omit` 过滤正确
- [ ] 防抖：100 次连续 mutation → 只写盘 1 次
- [ ] 未声明 `persistence` 的 store → 不挂载 `$subscribe`（零开销，可用 spy 验证）
- [ ] 嵌套 `pick: ['a.b.c']` 路径提取正确

---

## 验收
- 新项目用 `persisted()` API，单 store 配置 ≤ 3 行
- 老项目用社区插件兼容层，零改动
- 两者可共存于同一 Pinia 实例
