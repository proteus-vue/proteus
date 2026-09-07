# 模块 07：测试策略

> **里程碑**：M6（前半）
> **依赖**：模块 01-06
> **目标**：分层测试覆盖 Storage / 持久化 / SSR / 跨端一致性，保证"同一份 store 四端行为一致"。

---

## 1. 测试分层

```
L1 ── 单元测试（Vitest）         shared/ + stores/    最快，CI 必跑
L2 ── 集成测试（Vitest + happy-dom）  平台工厂 + 插件组合   验证逻辑链
L3 ── 跨端矩阵测试              同一 store × 四端 Adapter   核心差异化验证
L4 ── E2E（Playwright）          examples/ 真实运行        最终验收
```

---

## 2. L1：单元测试

### 2.1 Storage Adapter 契约测试

```ts
// storage.contract.test.ts
import { describe, it, expect } from 'vitest'
import type { StorageAdapter } from './types'

export function runStorageContract(name: string, createAdapter: () => StorageAdapter) {
  describe(`StorageAdapter: ${name}`, () => {
    let adapter: StorageAdapter

    beforeEach(() => { adapter = createAdapter() })

    it('getItem 返回 null（不存在时）', async () => {
      expect(await adapter.getItem('__not_exist__')).toBeNull()
    })

    it('setItem → getItem 往返', async () => {
      await adapter.setItem('k', 'v')
      expect(await adapter.getItem('k')).toBe('v')
    })

    it('removeItem 后 get 返回 null', async () => {
      await adapter.setItem('k', 'v')
      await adapter.removeItem('k')
      expect(await adapter.getItem('k')).toBeNull()
    })

    it('clear(prefix) 只清指定前缀', async () => {
      await adapter.setItem('proteus:a', '1')
      await adapter.setItem('other:b', '2')
      await adapter.clear('proteus:')
      expect(await adapter.getItem('proteus:a')).toBeNull()
      expect(await adapter.getItem('other:b')).toBe('2')
    })
  })
}

// 四端各跑一遍
runStorageContract('Memory', () => new MemoryAdapter())
runStorageContract('LocalStorage', () => new LocalStorageAdapter())
runStorageContract('WxStorage', () => new WxStorageAdapter())
// runStorageContract('NativeKV', () => new NativeKVAdapter())  // 待实现
```

**价值**：一条契约，四端实现一次验证。未来加 App 端只需加一行。

### 2.2 序列化测试

```ts
// serialize.test.ts
import { serialize, deserialize } from './serialize'

it('Date round-trip', () => {
  const d = new Date('2024-01-01T00:00:00Z')
  expect(deserialize<Date>(serialize(d)).toISOString()).toBe(d.toISOString())
})

it('Map / Set round-trip', () => {
  const m = new Map([['a', 1]])
  const s = new Set([1, 2, 3])
  expect(deserialize(serialize(m))).toEqual(m)
  expect(deserialize(serialize(s))).toEqual(s)
})

it('循环引用抛错（DEV）', () => {
  const obj: any = { a: 1 }
  obj.self = obj
  expect(() => serialize(obj)).toThrow()
})
```

### 2.3 Store 测试（不依赖平台）

```ts
// stores/player.test.ts
import { setActivePinia, createPinia } from 'pinia'
import { usePlayerStore } from './player'

beforeEach(() => {
  setActivePinia(createPinia())  // ← 用原生 createPinia，不依赖平台
})

it('play() 设置 currentTrack', () => {
  const player = usePlayerStore()
  player.play({ id: '1', title: 'Test' })
  expect(player.currentTrack?.title).toBe('Test')
})
```

**关键**：store 测试**直接用 `createPinia()`**，因为 store 源码无平台代码。这证明适配层真正收敛在 `platforms/` 之外。

---

## 3. L2：集成测试

```ts
// persistence.integration.test.ts
import { createPinia } from 'pinia'
import { createPersistence } from './lightweight'
import { MemoryAdapter } from './storage/memory'
import { useUserStore } from '@/stores/user'

it('store 变更自动持久化', async () => {
  const storage = new MemoryAdapter()
  const pinia = createPinia()
  pinia.use(createPersistence({ storage }))

  const user = useUserStore(pinia)
  user.token = 'abc123'

  await new Promise(r => setTimeout(r, 60))  // 等防抖

  expect(await storage.getItem('user')).toContain('abc123')
})
```

---

## 4. L3：跨端矩阵测试（核心差异化）

```ts
// cross-platform.test.ts
import { platforms } from '@/platforms'
import { usePlayerStore } from '@/stores/player'

const matrix = [
  { name: 'web', create: platforms.createWebPinia },
  { name: 'mp',  create: platforms.createMpPinia },
  { name: 'ssr', create: platforms.createSsrPinia },
  // { name: 'app', create: platforms.createAppPinia },  // 待实现
]

describe('跨端一致性', () => {
  it.each(matrix)('$name: playerStore 基本操作一致', async ({ create }) => {
    const pinia = create()
    const player = usePlayerStore(pinia)

    player.play({ id: '1', title: 'Song' })
    expect(player.currentTrack?.title).toBe('Song')

    player.pause()
    expect(player.isPlaying).toBe(false)

    player.seek(30)
    expect(player.position).toBe(30)
  })
})
```

**验收标准**：同一组 `it` 用例在四端全部通过 → "store 行为一致"的硬证明。

---

## 5. L4：E2E（Playwright）

```ts
// e2e/persistence.spec.ts
import { test, expect } from '@playwright/test'

test('Web: 刷新后状态保留', async ({ page }) => {
  await page.goto('/')
  await page.click('[data-test=play]')
  await page.reload()
  await expect(page.locator('[data-test=current-track]')).toHaveText('Song')
})

test('小程序: 刷新后状态保留', async ({ page }) => {
  // 用微信开发者工具自动化 / miniprogram-ci
  // 逻辑同 Web，验证 wx.setStorageSync 持久化
})
```

---

## 6. CI 矩阵

```yaml
# .github/workflows/test.yml
strategy:
  matrix:
    platform: [web, mp, ssr]
    node: [18, 20]
steps:
  - run: pnpm test:unit
  - run: pnpm test:integration
  - run: pnpm test:cross-platform ${{ matrix.platform }}
```

---

## 7. 覆盖率要求

| 模块 | 目标 |
|------|------|
| `shared/storage/` | ≥ 90% |
| `shared/persistence/` | ≥ 85% |
| `stores/` | ≥ 80% |
| `platforms/` | ≥ 70%（工厂逻辑简单） |

---

## 验收
- `pnpm test` 本地一键全绿
- CI 四端矩阵全绿
- 覆盖率达标
