# M1 — 单元测试 (L1)

> 占比 70%，跑 store / util / adapter / capability，毫秒级

## 1. 技术选型

- **Runner**: `vitest`（ESM 原生、快、与 Vite 共享配置）
- **DOM 环境**: `happy-dom`（Web 端组件）/ `jsdom`（小程序端模拟）
- **小程序宿主**: `@proteus-vue/test-utils` 提供 `createMockContext()`
- **断言**: `vitest` 内置 `expect` + `@testing-library/jest-dom`

## 2. 目录约定

```
src/
  stores/__tests__/          ← Pinia store 单测
  utils/__tests__/
  platforms/
    mp/__tests__/            ← 小程序适配单测
    web/__tests__/
  test/
    setup.ts                 ← 全局 mock + capability stub
    fixtures/                ← 共享测试数据
```

## 3. capability mock 机制（核心）

小程序无 `wx`，需用 mock 隔离平台 API：

```ts
// test/setup.ts
import { vi } from 'vitest'

globalThis.wx = {
  getSystemInfoSync: vi.fn(() => ({ platform: 'ios', SDKVersion: '2.29.2' })),
  setStorageSync: vi.fn(),
  getStorageSync: vi.fn(),
  request: vi.fn(),
}

// 每个测试可覆盖
it('storage fallback', () => {
  vi.mocked(wx.getStorageSync).mockReturnValue(null)
  // ...
})
```

**规则**：
- 真实 `wx.*` 永不出现在测试文件 → ESLint `no-restricted-globals: ['wx']` 在 `__tests__/`
- capability 降级用 `mockImplementationOnce` 模拟"不支持"

## 4. Store 单测示例（Pinia）

```ts
import { setActivePinia, createPinia } from 'pinia'
import { useUserStore } from '@/stores/user'

beforeEach(() => setActivePinia(createPinia()))

it('persist hydrated state', () => {
  const store = useUserStore()
  store.$patch({ name: 'proteus' })
  expect(store.name).toBe('proteus')
})
```

**SSR 隔离测试**（Pinia M5）：每个请求 new Pinia，验证 state 不串台。

## 5. Adapter 单测（Platform）

```ts
import { share } from '@proteus-vue/capabilities/share'

describe('share adapter', () => {
  it('web uses navigator.share', async () => {
    ;(navigator as any).share = vi.fn().mockResolvedValue(undefined)
    await share({ title: 'x' })
    expect(navigator.share).toHaveBeenCalled()
  })

  it('mp falls back to wx.shareAppMessage', async () => {
    vi.mocked(wx.shareAppMessage).mockImplementation(() => {})
    await share({ title: 'x' })
    expect(wx.shareAppMessage).toHaveBeenCalled()
  })
})
```

## 6. 命名与组织

- 文件：`*.test.ts` 或 `*.spec.ts`，与源文件同目录
- 分组：`describe('capability:share')` 对应 Platform M1 命名
- 快照：`expect(x).toMatchSnapshot()` 仅用于复杂 IR 对象

## 7. 验收

- [ ] `vitest run` 全绿，无真实 `wx`/`window` 调用
- [ ] 每个 capability 至少 2 case（支持 / 降级）
- [ ] CI 单测 < 60s
