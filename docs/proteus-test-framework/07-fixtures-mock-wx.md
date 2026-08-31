# Fixture 工厂 + wx Polyfill

## 目标
对齐 Compiler IR 构造跨层可复用的测试数据，让 fixture 成为**单一事实源**。

## Fixture 工厂

```ts
// fixtures/page.ts
export function createPageFixture(overrides: Partial<PageIR> = {}): PageIR {
  return {
    path: '/pages/index/index',
    components: ['p-button'],
    route: { name: 'index', chunk: 'main' },
    ...overrides,
  }
}
```

## wx Mock 分级

| 方法 | 默认 mock | 说明 |
|---|---|---|
| `wx.request` | 返回 200 + 空 data | 可被用例覆写 |
| `wx.getSystemInfoSync` | `{ platform: 'ios', SDKVersion: '3.0.0' }` | 驱动 Platform 分叉 |
| `wx.setStorageSync` | Map 内存存储 | 支持 Pinia persist |
| `wx.authorize` | 默认拒绝 | 驱动 Security 权限 UI |
| `wx.playBackgroundAudio` | noop | 播放器测试覆写 |

## 真实 Polyfill（可选）

接入 `wechat-miniprogram-mock` 让逻辑层更接近真实：
```ts
import { mockWx } from 'wechat-miniprogram-mock'
mockWx({ platform: 'android' })
```

仅在 L3 集成测试使用；L1 单元用轻量 mock 即可。

## 快照 fixture

```ts
// fixtures/snapshots/button.wxml
export const buttonWxml = `<view class="p-button"><text>ok</text></view>`
```

## 铁律
- fixture 禁止包含真实业务敏感数据（对齐 Security M6 脱敏）
- wx mock 默认行为必须稳定，用例内覆写用 `vi.mocked(wx.x).mockImplementation`
- fixture 工厂是唯一构造 IR 的入口

---
