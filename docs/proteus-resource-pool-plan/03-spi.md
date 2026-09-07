# G-46 ResourcePool SPI

## 1. 资源池接口（语义层，平台无关）

```ts
interface ResourcePool {
  // L1 登录态
  setCookie(key: string, value: string, opts: CookieOpts): boolean
  getCookie(key: string): string | null          // HttpOnly 返回 null
  setToken(origin: string, token: string): boolean
  getToken(origin: string): string | null         // 吊销后返回 null
  revokeToken(origin: string): void
  exchangeSSO(code: string, accountId: string): SsoResult | null  // 一次性

  // 双轨桥接
  getAuth(domain: string, origin: string): AuthHandle | null

  // L2 请求
  fetch(input: RequestInput, init?: RequestInit): Promise<Response>

  // L3 缓存
  cacheSet(origin: string, key: string, val: unknown, ttlMs: number): void
  cacheGet(origin: string, key: string): unknown

  // 生命周期
  logout(): void  // RSC-02 级联清理
}
```

## 2. 平台 Backend（可插拔，须过 conformance）

| Backend | 实现路径 | 特殊处理 |
|---------|---------|---------|
| `AndroidBackend` | `CookieManager` + OkHttp CookieJar | `flush()` 同步；两世界桥接 |
| `IOSBackend` | `WKHTTPCookieStore` | **`WKProcessPool` 单例**；await 异步 |
| `HarmonyBackend` | `WebCookieManager` + Header 注入 | `onInterceptRequest` 注入 |

```ts
interface PlatformBackend {
  readonly name: string
  setCookie(key: string, value: string, opts: CookieOpts): Promise<void>
  getCookie(key: string): Promise<string | null>
  clearAll(): Promise<void>
  // conformance 自检
  conformance(): Promise<ConformanceReport>
}
```

## 3. 能力网关（G-42 复用，签名同源）

所有跨页能力调用须过网关：

```
页面 → ResourceFacade → [签名校验] → [同源白名单] → PlatformBackend
                              ↓ 失败
                         拒绝 + 降级兜底
```

- **签名同源**：动态资源模块须与宿主同签名链（G-45.7）
- **同源白名单**：跨域同步默认拒绝，显式 opt-in（RSC-03）

## 4. 错误分类

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `PLATFORM_UNAVAILABLE` | Backend 不可用 | 降级兜底后端 |
| `SSO_FAILED` | SSO 换取失败 | 引导重新登录 |
| `SYNC_CONFLICT` | 多页并发写冲突 | 以宿主为准，页面回滚 |
| `CROSS_ORIGIN_DENIED` | 跨域未白名单 | 拒绝（RSC-03） |

## 5. Conformance（CMP089-096）

见 `conformance.md`。任何 Backend 实现**必须通过同一份测试**才能接入——这正是 G-44 的方法论在「资源层」的复用。
