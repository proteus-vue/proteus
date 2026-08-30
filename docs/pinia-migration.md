# Pinia 多端适配迁移指南

> 来源：docs/proteus-pinia-plan 08-migration-guide.md（M6 落地版）
> 目标：已有 Vue + Pinia 项目（Web / uni-app / Taro）在 **≤ 10 行改动**内接入 Proteus 多端持久化

## 迁移场景与改动量

| 来源 | 目标 | 改动量 |
|------|------|--------|
| Vue 3 + Pinia + pinia-plugin-persistedstate（Web） | Proteus Web + 小程序 | ~5 行（store 0 行） |
| uni-app Vue3（pinia 已在用） | Proteus（保留 pinia，换平台入口） | ~8 行 |
| Taro 3 + Redux / zustand | Proteus + Pinia | 较大（状态库迁移，非本指南重点） |

## 场景 A：Web 项目 → Proteus 多端（store 零改动）

**Before**（原项目）：

```ts
// stores/user.ts
import { persistedstatePlugin } from 'pinia-plugin-persistedstate'
export const useUserStore = defineStore('user', {
  state: () => ({ token: '' }),
  persist: { key: 'user', storage: localStorage }, // ← Web only
})

// main.ts
const pinia = createPinia()
pinia.use(persistedstatePlugin)
app.use(pinia)
```

**After**（Proteus）：

```ts
// stores/user.ts —— 0 行改动（persist.storage 保留也能跑：兼容层自动包成 Adapter）
// main.web.ts（替换 1 行）
import { createWebPinia } from '@proteus-vue/runtime'
app.use(createWebPinia())

// main.mp.ts（新增 ~3 行）
import { createMpPinia } from '@proteus-vue/runtime'
createMpPinia() // 首屏逻辑调用后，页面 useStore() 直接可用
```

**要点**：`persist.storage` 不写 → 自动按平台选 Adapter（Web=LocalStorage / MP=wx.setStorageSync / SSR=Memory）。写了 `localStorage` 也能跑（兼容层 normalizeStorage 包成 Adapter）。

## 场景 B：社区插件 → Proteus 自研轻量 API（可选）

```ts
// stores/user.ts
import { persisted } from '@proteus-vue/runtime'   // 新增 import
export const useUserStore = defineStore('user', {
  state: () => ({ token: '', profile: null }),
  persistence: persisted({ pick: ['token'] }), // 改动 1 行：persist → persistence: persisted()
})
```

优势：防抖写盘（50ms，可配）、零开销（未标记 store 不挂订阅）、嵌套路径 pick。

## 场景 C：uni-app → Proteus

```ts
// Step 1：替换 Pinia 创建
import { createMpPinia } from '@proteus-vue/runtime'  // 替代 createPinia()
app.use(createMpPinia())

// Step 2：删掉 persist.storage（小程序端 localStorage 会炸，Proteus 自动选 WxStorageAdapter）
persist: { key: 'user' }
```

## 渐进式迁移（推荐顺序）

```
1. 先接入 createWebPinia()（Web 端零风险，行为完全一致）
2. 跑通 examples/ 的 pinia-demo（player store）
3. 加 createMpPinia()，验证小程序端持久化（WxStorageAdapter）
4. 确认跨端矩阵测试全绿（npm test 含 cross-platform）
5. （可选）逐步 persist → persistence（自研 API）
6. 最后接入 SSR（createSsrPinia + hydration，见 examples/ssr/）
```

## 不兼容项（Breaking Changes）

| 场景 | 说明 | 解决方案 |
|------|------|---------|
| `pinia.state.value = xxx`（SSR） | 官方 API 保留，但需注意顺序 | 先恢复 state 再 `app.use(pinia)`（examples/ssr/entry-client.ts） |
| 自定义 Pinia 插件 | 需在平台工厂注册 | 在 `createXxxPinia()` 里 `pinia.use(yourPlugin)` |
| 直接访问 `window.localStorage` | 小程序 / SSR 会炸 | 改用 `createStorage()`（平台自动选择） |

## 检查清单

- [ ] package.json 新增 `@proteus-vue/runtime` 依赖（含 pinia peer）
- [ ] 入口替换为平台工厂调用
- [ ] store 的 `persist.storage` 移除（改为平台注入；不删也能跑）
- [ ] `npm test` 全绿（含 cross-platform 矩阵）
- [ ] Web 端 Vue DevTools 正常连接（pinia 原生支持）
- [ ] 小程序端 `PROTEUS_DEBUG=1` 构建后 `[pinia]` trace 日志 + `__PROTEUS_STORES__()` 快照可调
