---
title: useAuth (capability.auth)
group: 账号与支付
order: 5002
---

# useAuth

**What it does**: Run an authorization flow and obtain a session.

**When to use it**: Phone or third-party sign-in.

> 技术标识：能力原语 C33 · `capability.auth` · 返回 `AuthState` · **Hook implemented** (per-end support in the table below)

useAuth: authentication state composition (token custody + login/logout + subscription) — business code never reads the raw token (iron rule 2)

## Signature

```ts
useAuth(): AuthState
```

## Returns

Returns `AuthState` (synchronous handle/state object).

## Methods

| Method | Doc |
|---|---|
| [`login`](#login) | Log in via the host bridge (stores the token on success; missing bridge → explicit Err) |
| [`logout`](#logout) | Log out (clears the token) |
| [`setToken`](#settoken) | Manually set the token (third-party login / server-issued session) |
| [`subscribe`](#subscribe) | Subscribe to auth-state changes (returns an unsubscribe function) |

### `login`

```ts
login(provider?: string): Promise<CapResult<string>>
```

**Doc**: Log in via the host bridge (stores the token on success; missing bridge → explicit Err)

| Param | Type | Required | Doc |
|---|---|---|---|
| `provider` | `string` | No | — |

**Returns**: `Promise<CapResult<string>>`

### `logout`

```ts
logout(): Promise<CapResult<void>>
```

**Doc**: Log out (clears the token)

**Returns**: `Promise<CapResult<void>>`

### `setToken`

```ts
setToken(token: string | null): void
```

**Doc**: Manually set the token (third-party login / server-issued session)

| Param | Type | Required | Doc |
|---|---|---|---|
| `token` | `string \| null` | Yes | — |

**Returns**: `void`

### `subscribe`

```ts
subscribe(cb: (token: string | null) => void): () => void
```

**Doc**: Subscribe to auth-state changes (returns an unsubscribe function)

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(token: string \| null) => void` | Yes | — |

**Returns**: `() => void`

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `token` | `string \| null` | Yes | Current token (null when not logged in; reactive — bind directly in the UI) |
| `isAuthenticated` | `boolean` | Yes | Whether the user is logged in (true when the token is non-empty) |

## Error codes

| code | Doc |
|---|---|
| `login.unsupported` | wx.login is unavailable on this platform (useAuth login degraded to Err) |
| `login.failed` | wx.login failed |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge missing login → explicit Err degradation (no direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → (wx-native equivalent; exact mapping in the zh version) |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `AuthState`

C33 认证状态（组合：createAuth 凭证托管 + login 桥 + 存储桥；业务只读 AuthState 不读 raw token——铁律 2）

| Prop/Method | Type | Doc |
|---|---|---|
| `token` | `string \| null` | 当前令牌（未登录 null；响应式——UI 直接绑定） |
| `isAuthenticated` | `boolean` | 是否已登录（token 非空即真） |

| Prop/Method | Type | Doc |
|---|---|---|
| `login` | `login(provider?: string): Promise<CapResult<string>>` | 登录：调桥 login() → 成功存 token（无 login 桥 → Err<cap>.native 降级） |
| `logout` | `logout(): Promise<CapResult<void>>` | 登出：清 token |
| `setToken` | `setToken(token: string \| null): void` | 手动设置 token（第三方登录 / 服务端下发的既有会话） |
| `subscribe` | `subscribe(cb: (token: string \| null) => void): () => void` | 订阅登录态变化（响应式 UI 联动） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const auth = useAuth() // synchronous state — auth.isAuthenticated binds directly in UI

if (!auth.isAuthenticated) {
  const res = await auth.login() // provider decided by the host bridge; missing login bridge → explicit Err
  if (res.ok) console.log('logged in, token managed by the framework')
}
// auth.setToken(token) takes over the session manually; await auth.logout() logs out; auth.subscribe(cb) observes auth state
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->