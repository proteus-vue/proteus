# M2 - Credential Management（凭证托管 + 防重放）

> token / code / 会话凭证统一托管，业务代码只通过 `useAuth()` 读取派生状态，永不接触 raw secret。

## 1. 凭证托管 API

```ts
// 业务代码
const auth = useAuth()
auth.accessToken   // 只读 getter，内部持有
auth.isLoggedIn
auth.login(form)   // → 换取 token，托管层存储（encrypted）
auth.logout()      // → 清凭证 + 通知所有订阅者
```

内部 `CredentialStore`（对接 Pinia + SecretStorage M1）：
```ts
interface CredentialStore {
  accessToken: SecretRef      // 存 encrypted
  refreshToken: SecretRef     // 存 encrypted + 单独 scope
  expiresAt: number
}
```

**铁律**：`accessToken` 不作为普通 store 字段暴露，只通过 `auth.fetchWithAuth(input)` 注入 header。

## 2. Token 刷新竞态（防重放核心）

并发 N 个 401 请求 → 只触发 **1 次** refresh：

```ts
let refreshPromise: Promise<void> | null = null

async function ensureFreshToken() {
  if (isFresh()) return
  if (refreshPromise) return refreshPromise   // ← 复用进行中的刷新
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}
```

队列机制：刷新期间到达的请求挂起，刷新成功后用新 token 重放。

## 3. 防重放（Replay Protection）

- 请求签名：`nonce`（一次性随机数）+ `timestamp`（±5min 窗口）
- 服务端校验 nonce 唯一性（Redis SETNX）
- 关键操作（支付 / 改密）强制 `idempotency-key`

```ts
request.use(async (ctx, next) => {
  ctx.headers['X-Nonce'] = crypto.randomUUID()
  ctx.headers['X-Timestamp'] = Date.now()
  await next()
})
```

## 4. Refresh Token 轮换 + 撤销

- refresh token **一次性**：用后即换新，旧 token 立即失效
- 服务端维护 refresh token 版本号，登出时 invalidate 全部
- 检测到 refresh token 被复用 → 判定泄露，**撤销整个会话**

## 5. 存储安全（对接 M1）

- accessToken / refreshToken 走 `encrypted` 存储
- refreshToken 使用独立加密 key（拆分风险）
- 敏感凭证不进 `localStorage`（Web）而是内存 + 加密 cookie / sessionStorage

## 6. 编译期 + 运行时守卫

- 业务代码出现 `localStorage.setItem('token',` → `audit security` 报错
- 禁止 `axios.defaults.headers.common['Authorization'] = token`（绕过托管层）
- 规则：`no-raw-credential-access`

## 7. 测试

- 并发 10 个 401 → mock refresh 只调用 1 次
- refresh 失败 → 全部请求 reject + 跳转登录
- refresh token 复用 → 触发会话撤销
- 登出 → 内存 + 存储凭证全部清除

## 8. 验收

- [ ] 业务代码无 `token` 字符串字面量（grep 门禁）
- [ ] 并发刷新只发生 1 次
- [ ] refresh token 轮换 + 撤销链路完整
- [ ] 凭证仅以 `encrypted` 形式落盘
