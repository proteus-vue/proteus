# A1 — 网络请求（Request）适配

> P0 · Batch B1 · 依赖：无（地基模块，其他能力域复用其拦截器/重试机制）

---

## 1. 目标

统一 `wx.request` / `fetch` / App Native HTTP 为单一 `api.request(config)`，业务无平台分支。

## 2. 标准接口

```ts
// 业务层用法（L4）
import { api } from 'proteus'

const { data } = await api.request<User>({
  url: '/api/user/123',
  method: 'GET',
  params: { v: 2 },       // query 参数
  timeout: 10000,
  retry: 2,               // 自动重试次数
  cache: 'auto',          // 'no' | 'auto' | 'force'
  signal: abortController.signal,  // 取消
})

// 快捷方法
api.get<T>(url, config?)
api.post<T>(url, data, config?)
api.put / api.delete / api.patch
```

## 3. 适配器接口（L2）

```ts
// platforms/types.ts
export interface IRequestAdapter {
  readonly name: 'wx' | 'web' | 'app'
  request<T = unknown>(config: RequestConfig): Promise<RequestResponse<T>>
  upload?(file: UploadTask): Promise<UploadResult>   // A2 复用
  download?(url: string): Promise<DownloadResult>
}

export interface RequestConfig {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  baseURL?: string          // 来自 createApi({ baseURL })
  params?: Record<string, any>   // → query string
  data?: unknown             // body
  headers?: Record<string, string>
  timeout?: number           // ms，默认 15000
  retry?: number             // 默认 0
  retryDelay?: number        // 默认 300，指数退避
  cache?: 'no' | 'auto' | 'force'
  signal?: AbortSignal
  /** 跳过拦截器（用于 refresh token 请求自身防循环） */
  skipAuth?: boolean
}

export interface RequestResponse<T> {
  data: T
  status: number
  headers: Record<string, string>
  config: RequestConfig
}
```

## 4. 三端适配器实现要点

### 4.1 Web：`fetch` 适配
```ts
// platforms/web/request.adapter.ts
export const createWebRequestAdapter = (): IRequestAdapter => ({
  name: 'web',
  async request(config) {
    const controller = new AbortController()
    config.signal?.addEventListener('abort', () => controller.abort())
    const res = await fetch(buildURL(config), {
      method: config.method,
      body: config.data ? JSON.stringify(config.data) : undefined,
      headers: { 'Content-Type': 'application/json', ...config.headers },
      signal: controller.signal,
    })
    return { data: await res.json(), status: res.status, headers: obj(res.headers), config }
  },
})
```

### 4.2 微信小程序：`wx.request` 适配
```ts
// platforms/mp/request.adapter.ts
export const createMpRequestAdapter = (): IRequestAdapter => ({
  name: 'wx',
  request(config) {
    return new Promise((resolve, reject) => {
      const task = wx.request({
        url: buildURL(config),
        method: config.method,
        data: config.data,
        header: config.headers,
        timeout: config.timeout,
        success: (r) => resolve({ data: r.data, status: r.statusCode, headers: {}, config }),
        fail: reject,
      })
      config.signal?.addEventListener('abort', () => task.abort())
    })
  },
  upload(file) { return wx.uploadFile(file) as any },
})
```

⚠️ **Skyline 注意**：
- `wx.request` 无 streaming，大文件用 `wx.downloadFile` + 本地临时路径
- 小程序域名必须在微信公众平台「服务器域名」白名单，开发时需 `checkDomain: false`
- header 中 `referer` / `user-agent` 为只读，不可自定义

### 4.3 App：Native HTTP 适配
```ts
// platforms/app/request.adapter.ts
// Custom Renderer 侧实现 OkHttp(Android) / URLSession(iOS)，通过 Bridge 暴露
export const createAppRequestAdapter = (bridge: NativeBridge): IRequestAdapter => ({
  name: 'app',
  request(config) { return bridge.invoke('http.request', config) },
})
```

## 5. 核心能力（L3 实现，平台无关）

### 5.1 拦截器
```ts
api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${tokenStore.accessToken}`
  return config
})
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.status === 401 && !err.config.skipAuth) {
      await auth.refresh()              // A4
      return api.request(err.config)    // 用新 token 重放
    }
    return Promise.reject(err)
  },
)
```

### 5.2 重试（指数退避 + 抖动）
- 只对幂等方法（GET/PUT/DELETE）重试，POST 默认不重试（除非 `retrySafe: true`）
- `delay = retryDelay * 2^attempt + random(0, 100)`

### 5.3 取消（AbortController）
- 标准 Web API，三端统一；小程序/App 适配器把 signal 转成各自取消调用

### 5.4 并发去重（dedupe）
- 相同 `url + method + params` 的 GET 请求在飞行中合并为单个网络调用
- 用在：页面初始化多个组件同时拉同一份配置

### 5.5 缓存（A3 协作）
- `cache: 'auto'` → 命中则立即返回缓存 + 后台 revalidate
- 缓存 key = `method:url:query`，存储走 StorageAdapter（Pinia M1）

## 6. 错误模型

```ts
export class ApiError extends Error {
  code: 'NETWORK' | 'TIMEOUT' | 'HTTP' | 'ABORT' | 'BUSINESS'
  status?: number
  bizCode?: number       // 业务码（如 10001 库存不足）
  config: RequestConfig
}
```

- 网络/超时 → `NETWORK` / `TIMEOUT`
- HTTP 4xx/5xx → `HTTP`（401 由拦截器处理，不透传业务）
- `wx.request` `fail` 回调 → 映射为 `NETWORK`（小程序无 HTTP 状态码时）

## 7. 测试（详见 09-testing 矩阵）

| 用例 | 预期 |
|------|------|
| 模拟弱网超时 | 触发重试 2 次后抛 `TIMEOUT` |
| 并发 5 个相同 GET | 网络只发 1 次 |
| 调用 `signal.abort()` | 小程序/App 端真实取消 |
| 401 响应 + 并发 3 请求 | 只触发 1 次 refresh，3 个全部重放成功 |
| 切换适配器（mock ↔ real） | 业务代码零改动 |

## 8. 产物可追溯性（`--trace-api`）

```
[api:request] wx GET /api/user/123
  ├─ request 拦截器: +Authorization
  ├─ cache: MISS → 发起网络
  ├─ wx.request success 200 (142ms)
  └─ response 拦截器: 透传
```
对应源文件：`transforms/trace-api.ts`（见 10-transforms-contract）。

## 9. 分批执行文件清单（B1）

LLM 单次只吃：`00-overview.md` + `01-a1-request.md` + `02-a1-codegen.md`（若有）

交付文件：
- `packages/api/src/request/types.ts`
- `packages/api/src/request/core.ts`（拦截器/重试/取消/去重）
- `packages/api/src/request/index.ts`（`createApi` 工厂）
- `platforms/web/request.adapter.ts`
- `platforms/mp/request.adapter.ts`
- `platforms/app/request.adapter.ts`
- `packages/api/test/request.test.ts`
