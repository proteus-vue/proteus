---
title: 状态管理
order: 22
group: 工程化
---

# 状态管理

Proteus 的状态管理基于 **Pinia**：state / getters / actions / `storeToRefs` 四端共用同一份 `.ts` 源码。平台差异——持久化载体、DevTools 连接、SSR 实例隔离——全部收敛在 `@proteus-vue/runtime` 的四端工厂里，业务 store 对端零感知。

> **铁律**：`stores/` 目录禁止任何平台判断（`window.` / `wx.` / `getPlatform()` 一律不得出现）。平台差异只允许存在于工厂与 storage 适配层，`npm test` 的 stores-purity 用例做 CI 硬卡口。

## 四端工厂，一份 store

应用入口按端选择工厂，业务代码不变：

| 工厂 | 端 | 持久化载体 | 状态 |
|---|---|---|---|
| `createWebPinia()` | Web SPA | `LocalStorageAdapter`（localStorage） | ✅ |
| `createMpPinia()` | 微信小程序 Skyline | `WxStorageAdapter`（`wx.setStorageSync`，写盘防抖） | ✅ |
| `createAppPinia()` | App（Custom Renderer） | `NativeKVAdapter`（MMKV 桥待 v0.6 接入） | 🟡 |
| `createSsrPinia()` | SSR | `MemoryAdapter`（每请求独立实例） | ✅ |

```ts
// main.web.ts —— Web 入口
import { createWebPinia } from '@proteus-vue/runtime'

app.use(createWebPinia())
```

小程序端在全量入口（`main.mp.ts`）调用一次 `createMpPinia()` 后，页面内 `useStore()` 直接可用。Web 端 Vue DevTools 原生接入；小程序无浏览器 DevTools，开发构建（`PROTEUS_DEBUG=1`）自动挂 trace 日志与 `__PROTEUS_STORES__()` 状态快照。

## store 纯逻辑约定

- **持久化只写在 `defineStore` 第 3 参数**（`persistence: persisted({...})`），禁止运行时动态拼接
- **不直连存储**：`localStorage.setItem` / `wx.setStorage` 一律不出现，走 persist 配置由平台自动选后端
- **瞬时态不持久化**：播放进度、loading 等运行态留给内存，持久化面收敛到 `pick`

`examples/stores/player.ts` 是官方真例——同一份 store 在四端行为一致：

```ts
import { defineStore } from 'pinia'
import { persisted } from '@proteus-vue/runtime'

export interface Track {
  title: string
  durationSec: number
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    playing: false,
    current: null as Track | null,
    volume: 0.8,
    history: [] as string[],
  }),
  getters: {
    volumePercent: (s) => Math.round(s.volume * 100),
  },
  actions: {
    play(track: Track) {
      this.current = track
      this.playing = true
      if (this.history.indexOf(track.title) === -1) this.history.push(track.title)
    },
    toggle() {
      if (this.current) this.playing = !this.playing
    },
    setVolume(v: number) {
      this.volume = Math.max(0, Math.min(1, v))
    },
  },
  // 持久化声明：volume/history 跨端恢复；playing/current 瞬时态不存
  persistence: persisted({ pick: ['volume', 'history'], key: 'player-state' }),
})
```

## 持久化：一份声明，四端生效

`persisted()` 是轻量持久化标记：未声明的 store **零开销**（不挂订阅）；声明后由当前端工厂注入的 storage 自动防抖写盘。常用选项：

| 选项 | 作用 |
|---|---|
| `pick` / `omit` | 白名单 / 黑名单字段（支持 `a.b.c` 嵌套路径） |
| `key` | 存储 key（缺省 `store.$id`） |
| `debounce` | 写盘防抖（缺省 50ms，传 `0` 关闭） |
| `version` + `migrations` | schema 版本迁移，失败回落初始值不崩溃 |
| `volatile` / `encrypted` | 不落盘字段 / 加密存储字段 |
| `keys` + `eager: false` | 分片惰性 hydrate（`store.$hydrate()` 手动恢复） |
| `scope: 'page'` | 页面级 store，页面 onUnload 批量 dispose |

已有一个使用 `pinia-plugin-persistedstate` 的项目？`persist: {...}` 写法由兼容层（`createPersistedStatePlugin`）原样支持——`persist.storage` 不写时自动按平台选 Adapter，写了 `localStorage` 也会被包装成 Adapter，store 零改动。

## SSR 隔离

SSR 状态泄漏是跨请求安全事故，三条约束堵死：

1. **每请求独立实例**：`createSsrPinia()` 必须在请求处理器内调用，禁止模块顶层 `createPinia()`
2. **持久化自动跳过**：`ssr` 平台下持久化插件直接返回——服务端只创建空 state，避免 hydration mismatch
3. **客户端注水**：先恢复 state 再 `app.use(pinia)`（见 `examples/ssr/`）

## 从原生 Pinia 迁移

目标：已有 Vue + Pinia 项目 **≤ 10 行改动**接入 Proteus 多端（store 本身 0 行）：

1. 入口替换：`app.use(createWebPinia())`（Web 端行为完全一致，零风险）；小程序入口加 `createMpPinia()`
2. 移除 store 里的 `persist.storage`（平台自动选后端；不删也能跑）
3. 跑 `npm test` 确认 cross-platform 矩阵全绿；可选地把 `persist` 逐步换成 `persistence: persisted({...})`

## 下一步

- [路由](/docs/21-router)：页面导航与路由检查
- [所有权工程](/docs/23-ownership)：页面级资源的确定性回收
- [测试与部署](/docs/10-testing-deploy)：跨端矩阵测试与 CI 门禁
