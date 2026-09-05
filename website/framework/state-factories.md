---
title: 状态管理四端工厂
order: 33
group: 数据与状态
---

# 状态管理四端工厂

> 初学者入口见[状态管理](/docs/15-state-management)——本页讲框架侧的机制。

平台差异（持久化载体、DevTools、SSR 隔离）收敛在 `@proteus-vue/runtime` 的四端工厂，业务 store 对端零感知。**铁律**：`stores/` 目录禁止任何平台判断——`npm test` 的 stores-purity 用例做 CI 硬卡口。

## 工厂矩阵

| 工厂 | 端 | 持久化载体 | 状态 |
|---|---|---|---|
| `createWebPinia()` | Web SPA | LocalStorageAdapter | ✅ |
| `createMpPinia()` | 微信小程序 Skyline | WxStorageAdapter（写盘防抖） | ✅ |
| `createAppPinia()` | App | NativeKVAdapter（MMKV 桥待接入） | 🟡 |
| `createSsrPinia()` | SSR | MemoryAdapter（每请求独立实例） | ✅ |

## store 纯逻辑约定

- **持久化只写在 `defineStore` 第 3 参数**（`persistence: persisted({...})`），禁止运行时动态拼接
- **不直连存储**：`localStorage.setItem` / `wx.setStorage` 一律不出现——走 persist 配置由平台自动选后端
- **瞬时态不持久化**：播放进度、loading 等运行态留给内存，持久化面收敛到 `pick`

## 开发期调试

- Web：Vue DevTools 原生接入
- 小程序：开发构建（`PROTEUS_DEBUG=1`）自动挂 trace 日志与 `__PROTEUS_STORES__()` 状态快照（全量 store 可枚举）

## 下一步

- [数据更新策略](/docs/framework/data-updates)：setData 合并与 watch 模拟的运行时机制
