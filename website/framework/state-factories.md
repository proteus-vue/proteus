---
title: 状态管理四端工厂
order: 33
group: 数据与状态
---

# 状态管理四端工厂

> 初学者入口见[状态管理](/docs/15-state-management)——本页讲框架侧的机制。

平台差异（持久化载体、DevTools、SSR 隔离）收敛在 `@proteus-vue/runtime` 的四端工厂，业务 store 对端零感知。**铁律**：`stores/` 目录禁止任何平台判断——`npm test` 的 stores-purity 用例做 CI 硬卡口。

## 工厂矩阵

| 工厂 | 端 | 平台标记 | 持久化载体 | 调试 | 状态 |
|---|---|---|---|---|---|
| `createWebPinia()` | Web SPA | `web` | LocalStorageAdapter（命名空间隔离） | Vue DevTools 原生 + 开发构建 trace/快照 | ✅ |
| `createMpPinia()` | 微信小程序 | `mp` | WxStorageAdapter（**写盘防抖 100ms**——setStorageSync 阻塞主线程） | 开发构建 trace + `__PROTEUS_STORES__()` 快照 | ✅ |
| `createAppPinia()` | App（Custom Renderer） | `app` | NativeKVAdapter（MMKV 桥 v0.6 接入） | — | 🟡 |
| `createSsrPinia()` | SSR | `ssr` | MemoryAdapter（**每请求独立实例**） | — | ✅ |

```ts
// 典型接线（Web）
app.use(createWebPinia())
// SSR 必须在每个请求内调用，绝不在模块顶层（§05 SSR 隔离）
```

## 持久化：persisted() 选项全表

持久化只写在 `defineStore` 第 3 参数——`persistence: persisted({...})`。**未标记的 store 零开销**（编译期/运行时识别 `__persisted__` 标记，不挂订阅）：

| 选项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `pick` | `string[]` | — | 白名单字段（支持嵌套路径 `a.b.c`、数组下标 `a.0.b`） |
| `omit` | `string[]` | — | 黑名单字段（与 pick 二选一） |
| `storage` | `StorageAdapter` | 平台默认 | 覆盖全局 storage 实现 |
| `key` | `string` | `store.$id` | 存储 key |
| `debounce` | `number` | `50` | 写盘防抖窗口（ms，`0` 关闭） |
| `scheduler` | `PersistSchedulerOptions` | — | 调度器（maxWait / 高频合并——M7.2） |
| `quota` | `QuotaOptions` | — | 存储配额管理（M7.3） |
| `scope` | `'app' 或 'page'` | `'app'` | 生命周期作用域（`page` 级在 dispose 时清除） |
| `eager` | `boolean` | `true` | 启动即 hydrate；`false` 惰性（首次 `$hydrate()`） |
| `lazy` | `boolean` | — | 同 eager=false（语义更明确）；`$hydrated` 状态供组件 loading |
| `keys` | `string[]` | — | hydrate 只恢复指定字段（减少反序列化量——M7.1 分片） |
| `version` | `number` | `0` | 持久化 schema 版本（配合 migrations 做版本迁移） |
| `migrations` | `Migration[]` | — | 迁移链（按 from 排序逐条执行） |
| `volatile` | `string[]` | — | 不落盘字段（内存保留，hydrate/persist 均跳过） |
| `encrypted` | `string[] 或 SecureFields` | — | 加密字段（默认加密实现或自定义 encrypt/decrypt） |

## store 纯逻辑约定

- **持久化只写在 `defineStore` 第 3 参数**（`persisted({...})`），禁止运行时动态拼接
- **不直连存储**：`localStorage.setItem` / `wx.setStorage` 一律不出现——走 persist 配置由平台自动选后端
- **瞬时态不持久化**：播放进度、loading 等运行态留给内存，持久化面收敛到 `pick`
- **App 端序列化边界**：经 Bridge 传递的 state 必须可序列化 JSON（不能传函数/Promise）；跨线程状态变更经 `$subscribe` + Bridge emit 通知原生

## 开发期调试

- **Web**：Vue DevTools 原生接入（pinia 官方插件）；开发构建（`PROTEUS_DEBUG=1`）挂动作/变更 trace + 状态快照
- **小程序**：无浏览器 DevTools 扩展——开发构建自动挂 `[pinia]` trace 日志 + `__PROTEUS_STORES__()` 全量 store 状态快照（微信开发者工具 Console 直接调用，对齐 Vue DevTools 的 Import State）

## 下一步

- [数据更新策略](/docs/framework/data-updates)：setData 合并与 watch 模拟的运行时机制
