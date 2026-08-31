# @proteus-vue/api

Proteus API 层（api-plan A1/A8 + B3 auth + B9 PlatformAPI）——网络请求统一抽象（`wx.request` / `fetch`）+ 设备信息 + 平台 API 收口。业务代码零平台分支。

## 导出

| API | 说明 |
|-----|------|
| `createApi(options?)` | **API 客户端工厂**：注入 baseURL/拦截器/适配器，业务零平台分支（Web 走 `fetch` 适配器，MP 走 `wx.request` 适配器，由 `createRequestAdapter` 按平台选择） |
| `createRequestAdapter(platform)` | 请求适配器工厂（`web` → fetch / `skyline` → wx.request），可自定义扩展 |
| `createAuth(api, options?)` | 认证管理（token 存取 + 过期刷新），配合 `AuthStorage` 自定义存储 |
| `createPlatformAPI(platform)` | **平台 API 收口**（B9）：`router` / `storage` / `ui` 子域统一接口，替代业务直写 `wx.*` |
| `getDeviceInfo()` / `buildUrl(base, path, params?)` | 设备信息（平台差异归一）/ URL 拼接 |
| `ApiError` | 统一错误类型（status/code/message） |
| `ALL_METHODS` | 支持的 HTTP 方法常量 |

## 使用

```ts
import { createApi, createPlatformAPI, getDeviceInfo } from '@proteus-vue/api'

// 1. API 客户端（main.ts 初始化一次）
const api = createApi({ baseURL: 'https://api.example.com', timeout: 10_000 })

// 2. 请求——同一份代码双端直跑
const res = await api.get('/user/profile', { token: true })
console.log(res.data)

// 3. 平台 API 收口（业务不碰 wx.*）
const platform = createPlatformAPI(/* 由编译期/运行时注入平台 */)
await platform.ui.showToast({ title: '已保存' })
platform.storage.set('lastVisited', Date.now())

// 4. 设备信息
const { platform, system, version } = getDeviceInfo()
```

## 设计要点

- **业务零平台分支（铁律 1）**：网络层差异全部收敛在 adapter 内部，业务代码不出现 `if (isMp)` 之类判断
- **PlatformAPI 收口（B9）**：`wx.showToast` / `wx.getStorageSync` / `wx.navigateTo` 等统一为 `router/storage/ui` 三域接口，是后续移除业务直用 `wx.*` 的过渡层
