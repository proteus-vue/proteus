# 模块 01：Storage 抽象层

> **里程碑**：M1
> **依赖**：无（基础设施层）
> **目标**：定义统一 `StorageAdapter` 接口，提供四端实现 + 统一序列化。

---

## 1. 接口定义

```ts
// shared/storage/types.ts

export interface StorageAdapter {
  /** 读取，统一返回 Promise（同步后端内部 await 微任务即可） */
  getItem(key: string): Promise<string | null>
  /** 写入 */
  setItem(key: string, value: string): Promise<void>
  /** 删除 */
  removeItem(key: string): Promise<void>
  /** 清空命名空间（可选，用于登出等） */
  clear?(prefix?: string): Promise<void>
}
```

**关键决策**：即使 `localStorage` / `wx.setStorageSync` 是同步 API，**接口统一为 async**。
- 理由：App 端（MMKV / SQLite）和 SSR（内存 / Redis）多为异步；统一 async 让 store 代码无平台分支。
- 性能代价：单次 microtask，可忽略。

---

## 2. 各端实现规范

### 2.1 MemoryAdapter（SSR / 测试）
```ts
// shared/storage/memory.ts
export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, string>()
  async getItem(key: string) { return this.store.get(key) ?? null }
  async setItem(key: string, value: string) { this.store.set(key, value) }
  async removeItem(key: string) { this.store.delete(key) }
  async clear() { this.store.clear() }
}
```
- SSR 下每个请求创建一个独立 `MemoryAdapter` 实例，天然隔离。

### 2.2 LocalStorageAdapter（Web）
```ts
// shared/storage/localStorage.ts
export class LocalStorageAdapter implements StorageAdapter {
  constructor(private prefix = 'proteus:') {}
  async getItem(key: string) {
    return localStorage.getItem(this.prefix + key)
  }
  async setItem(key: string, value: string) {
    localStorage.setItem(this.prefix + key, value)
  }
  async removeItem(key: string) {
    localStorage.removeItem(this.prefix + key)
  }
  async clear(prefix?: string) {
    const p = prefix ?? this.prefix
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(p)) localStorage.removeItem(k)
    }
  }
}
```

### 2.3 WxStorageAdapter（微信小程序 Skyline）
```ts
// shared/storage/wxStorage.ts
export class WxStorageAdapter implements StorageAdapter {
  constructor(private prefix = 'proteus:') {}

  async getItem(key: string): Promise<string | null> {
    try {
      return wx.getStorageSync(this.prefix + key) || null
    } catch {
      return null  // 主包过大 / 存储满时容错
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      wx.setStorageSync(this.prefix + key, value)
    } catch (e) {
      // 小程序 storage 上限约 10MB，超限需降级
      console.warn('[Proteus] wx.setStorageSync failed', key, e)
    }
  }

  async removeItem(key: string) {
    wx.removeStorageSync(this.prefix + key)
  }

  async clear(prefix?: string) {
    const p = prefix ?? this.prefix
    const keys = wx.getStorageInfoSync().keys
    keys.filter(k => k.startsWith(p)).forEach(k => wx.removeStorageSync(k))
  }
}
```

**小程序特有坑**（务必在 JSDoc 记录）：
1. **主包体积**：持久化数据占主包空间，大型播放列表建议拆到云存储
2. **同步 API 阻塞**：`setStorageSync` 在主线程，单次 > 1MB 会卡 UI → 大对象分片
3. **Skyline 逻辑层限制**：无 `window` / `document`，不可使用 Web-only 序列化库

### 2.4 NativeKVAdapter（App 端，占位）
```ts
// shared/storage/nativeKV.ts
// TODO: 对接 MMKV / SQLite via JSI / Bridge
export class NativeKVAdapter implements StorageAdapter {
  // 接口契约：所有调用通过 Bridge 发到原生侧
  // 原生侧用 MMKV（同步，性能接近内存）
  // 序列化统一在 JS 侧完成（同 web / mp）
  async getItem(key: string): Promise<string | null> { throw new Error('Not implemented') }
  async setItem(key: string, value: string): Promise<void> { throw new Error('Not implemented') }
  async removeItem(key: string): Promise<void> { throw new Error('Not implemented') }
}
```

---

## 3. 工厂函数

```ts
// shared/storage/index.ts
import { getPlatform } from '@/shared/platform'  // 由 Proteus 注入

export function createStorage(): StorageAdapter {
  switch (getPlatform()) {
    case 'web':   return new LocalStorageAdapter()
    case 'mp':    return new WxStorageAdapter()
    case 'app':   return new NativeKVAdapter()
    case 'ssr':   return new MemoryAdapter()
    default:      return new MemoryAdapter()
  }
}
```

**平台检测**：由 `platforms/*/pinia.ts` 在初始化时设置 `globalThis.__PROTEUS_PLATFORM__`，`getPlatform()` 仅读取该值 —— 避免在 store 里直接 `if (typeof window === 'undefined')`。

---

## 4. 序列化层

```ts
// shared/persistence/serialize.ts

const TYPE_TAG = '__proteus_type__'

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v instanceof Date) return { [TYPE_TAG]: 'Date', value: v.toISOString() }
    if (v instanceof Map)  return { [TYPE_TAG]: 'Map', value: [...v.entries()] }
    if (v instanceof Set)  return { [TYPE_TAG]: 'Set', value: [...v.values()] }
    return v
  })
}

export function deserialize<T = unknown>(raw: string): T {
  return JSON.parse(raw, (_, v) => {
    if (v && typeof v === 'object' && TYPE_TAG in v) {
      switch (v[TYPE_TAG]) {
        case 'Date': return new Date(v.value)
        case 'Map':  return new Map(v.value)
        case 'Set':  return new Set(v.value)
        default:     return v
      }
    }
    return v
  })
}
```

**扩展点**：自定义 class 需持久化时，在 store 里提供 `hydrate()` action，序列化层不负责复活 class 实例（保持通用性）。

---

## 5. 可观测性（对齐 `--trace-transform`）

```ts
// shared/storage/trace.ts
let tracing = false
export function enableStorageTrace() { tracing = true }

export async function traced<T>(op: string, key: string, fn: () => Promise<T>): Promise<T> {
  if (!tracing) return fn()
  const start = performance.now()
  const result = await fn()
  console.log(`[storage] ${op} ${key} (${(performance.now() - start).toFixed(2)}ms)`)
  return result
}
```

启用方式：`proteus.config.ts` 里 `storage: { trace: true }` → 编译期注入 `enableStorageTrace()`。

---

## 6. 测试要点

- [ ] 四端 Adapter 实现 `StorageAdapter` 接口（TypeScript 编译通过即契约校验）
- [ ] 序列化 round-trip：`serialize(deserialize(x)) === x` 对 Date / Map / Set / 嵌套对象
- [ ] 循环引用：开发模式抛错，生产模式丢
- [ ] WxStorageAdapter：模拟 `setStorageSync` 抛错时不阻断应用
- [ ] 命名空间 `clear()` 只清指定 prefix

---

## 验收
- `stores/` 里任何代码通过 `createStorage()` 拿到存储，**不知道自己在哪个端**
- `pnpm test storage` 全部通过
- 覆盖率 ≥ 90%（存储是基础设施，值得高覆盖）
