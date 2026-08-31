# M1 · L1 单元 + `wx` Mock 策略

## 目标
业务逻辑（store / composable / transform / IR / 工具函数）在**无 DOM、无 wx** 环境下 100% 跑通。

## 配置：`vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',       // L1 默认 node，不依赖 DOM
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
})
```

`test/setup.ts`：
```ts
import { vi } from 'vitest'
import { installWxMock } from '@proteus-vue/test-core/mock-wx'

installWxMock()                 // 全局注入 wx（默认 happy 实现）
vi.mock('wx')                   // 业务直接 import wx 时也生效
```

## Mock 分级

| 级别 | 用途 | 示例 |
|---|---|---|
| L1 单元 | 纯逻辑，无需 wx | `useCounter()`、`parseSFC()` |
| L2 快照 | 解析产物 AST | 不触发 wx |
| L3 组件 | 需要 wx 返回结构化数据 | `wx.getSystemInfoSync` → mock |
| L4 E2E | **真实 wx 运行时** | 不用 mock |

## `createMockContext`（对齐 Testing plan B1）

```ts
export function createMockContext(overrides: Partial<Wx> = {}) {
  return {
    request: vi.fn().mockResolvedValue({ data: {}, statusCode: 200 }),
    getSystemInfoSync: vi.fn().mockReturnValue({ platform: 'ios', SDKVersion: '3.0.0' }),
    ...overrides,
  } as unknown as Wx
}
```

## 断言示例（跨端共用）

```ts
// store/cart.spec.ts
import { useCart } from './cart'

it('添加商品后总数+1（Web/小程序共用）', () => {
  const cart = useCart()
  cart.add({ id: 1, name: 'A' })
  expect(cart.total.value).toBe(1)   // ✅ 只断言状态，不碰 DOM
})
```

## 铁律
- 禁止 L1 用例引用 `document` / `window` / `wx` 真实对象
- 所有 wx 调用走 `vi.mocked(wx.xxx)` 校验调用参数

---
