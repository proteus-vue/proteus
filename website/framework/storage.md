---
title: 存储
order: 31
group: 基础能力
---

# 存储

跨端存储两条规则：**持久化配置化**（不直连存储 API）与**响应式增强**（createReactiveStorage）。

## 终端落地进度

| 端 | 状态 | 载体说明 |
|---|---|---|
| 微信小程序 | ✅ | wx sync 存储（getStorage 桥） |
| Web SPA | ✅ | localStorage（webBridge.getStorage 已实现） |
| Headless（SSR / 测试） | ✅ | 内存存储（mock / createMockContext 内置） |
| iOS / Android / 鸿蒙 | 🟡 | 端原型映射——NativeKVAdapter（MMKV）待接入 |
| Flutter 混合 | 🟡 | 桥待接 |
| 快应用 | ⬜ | 端未开始 |

> store 持久化载体另有平台工厂选择（Web localStorage / MP wx storage 写盘防抖——见[状态工厂](/docs/framework/state-factories)）。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

## useStorage（能力句柄）

```ts
const storage = useStorage()
storage.set('key', value)
storage.get('key')
```

- 句柄缺平台桥时抛错（宿主未安装存储能力）
- 桥实现：小程序 `wx sync 存储` / Web `localStorage` / 测试 mock（其余端随桥接线逐个启用）

## 不直连存储的铁律

业务与 store 禁止出现 `localStorage.setItem` / `wx.setStorageSync`——持久化走两层：

1. **store 持久化**：`defineStore` 第 3 参 `persistence: persisted({...})`，平台工厂自动选载体（Web localStorage / MP wx storage 写盘防抖）
2. **能力句柄**：非 store 的零散读写走 `useStorage()`（桥归一）

CI 硬卡口：stores-purity 用例扫平台直连（见[状态管理四端工厂](/docs/framework/state-factories)）。

## createReactiveStorage（响应式增强）

`createReactiveStorage(storage, reactive?)`：普通读写升级为响应式镜像——`set` 始终同步 state（新增 + 更新），remove/clear 清理；reactivity 由消费方注入（api 包零 vue 依赖）。

## 诚实边界

- 缺存储桥的测试环境：内存兜底（`createMockContext` 内置 memory storage）
- Cookie 语义（`useCookie`）双端实现不同（Web document.cookie / MP storage 兜底罐），不做同语义承诺

## 下一步

- [分包与按需注入](/docs/framework/subpackages)
