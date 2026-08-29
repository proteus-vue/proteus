# A3 — 存储（Storage）适配

> P0 · Batch B2 · 依赖：**Pinia M1（StorageAdapter）**

> 复用 Pinia 已抽象的 Storage 层，**API 层不再另造轮子**，只做能力封装。

---

## 1. 复用关系

```
Pinia M1 StorageAdapter (IAsyncStorage)
        ▲
        │ 实现复用
        │
api.storage  (L3 封装：命名空间 / 加密 / 序列化 / 容量)
        ▲
        │
业务层 / A4 Auth / A1 Request cache
```

`api.storage` 直接持有 `StorageAdapter` 实例，**不绕过它直接调 `wx.setStorage`**。

## 2. 标准接口

```ts
api.storage.get<T>(key: string): Promise<T | null>
api.storage.set(key: string, value: T, opts?: StorageOptions): Promise<void>
api.storage.remove(key: string): Promise<void>
api.storage.clear(prefix?: string): Promise<void>
api.storage.keys(prefix?: string): Promise<string[]>
api.storage.size(): Promise<number>  // 估算字节数

interface StorageOptions {
  encrypt?: boolean       // 走 A6 secure storage
  ttl?: number            // 过期时间（秒）
  namespace?: string      // 默认 'app'
}
```

## 3. 与 Pinia 持久化的差异

| 维度 | Pinia StorageAdapter | api.storage |
|------|---------------------|-------------|
| 定位 | 状态持久化的底层驱动 | 业务主动读写 KV |
| 序列化 | 由持久化插件调用 | 自带（含 Date/Map/Set/BigInt type tag）|
| 加密 | 无 | 支持 `encrypt` |
| TTL | 无 | 支持 |

底层是**同一个 adapter 实例**，只是封装层不同。

## 4. Skyline 约束

- `wx.setStorageSync` 同步写 → **主线程阻塞**，禁止在 scroll/seek 等高频回调中使用
- 改用 `wx.setStorage`（异步）+ A1 的防抖缓冲（对齐 Pinia M7.2）
- 单 key value 大小有限制（具体值查微信文档，通常数 MB），大对象分片

---

# A4 — 认证（Auth）适配

> P0 · Batch B3 · 依赖：**A1（Request）**

## 1. 标准接口

```ts
api.auth.login(params: LoginParams): Promise<LoginResult>
api.auth.logout(): Promise<void>
api.auth.getAccessToken(): Promise<string | null>
api.auth.refresh(): Promise<string>           // 静默刷新
api.auth.onAuthStateChange(cb: (state) => void): () => void  // 返回取消函数
```

## 2. 三端实现差异

| 平台 | `login` 实现 |
|------|-------------|
| 微信小程序 | `wx.login()` → 拿 `code` → 后端 `code2Session` 换 `openid + token` |
| Web | 跳转 OAuth / 弹窗授权 → 回调拿 `code` |
| App | 微信/支付宝/Apple SDK 授权 → 拿 `accessToken` |

## 3. Token 刷新机制（核心，防竞态）

```ts
// 伪代码
let refreshPromise: Promise<string> | null = null

api.interceptors.response.use(null, async (err) => {
  if (err.status !== 401 || err.config.skipAuth) throw err
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  }
  const newToken = await refreshPromise
  err.config.headers.Authorization = `Bearer ${newToken}`
  return api.request(err.config)   // 重放原始请求
})
```

**关键点**：并发多个 401 → `refreshPromise` 去重 → 只刷新一次 → 全部重放。

## 4. Refresh Token 存储

- 必须存 `wx.setStorage`（持久），不能只放内存（小程序冷启动需恢复）
- 加密存储（`api.storage.set(rt, { encrypt: true })`，走 A6 secure storage）
- 小程序 `session_key` 有效期内的静默刷新策略

## 5. 与 Router 守卫联动（对接 Router M6）

```ts
// 路由守卫里读 auth 状态
router.beforeEach(async (to) => {
  if (to.meta.requiresAuth && !api.auth.getAccessToken()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
})
```

`api.auth.onAuthStateChange` 触发时，可配合 Router 的全局事件做跳转。

## 6. 测试要点

- [ ] 模拟 token 过期 → 自动刷新 + 原请求成功
- [ ] 并发 10 个 401 → 只发 1 次 refresh 请求
- [ ] refresh 本身 401 → 跳转登录，不再循环刷新
- [ ] 冷启动从 storage 恢复 token → 无需重新登录
