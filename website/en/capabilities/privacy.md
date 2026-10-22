---
title: usePrivacy (capability.privacy)
group: 账号与支付
order: 5009
---

# usePrivacy

**What it does**: Check and obtain privacy-policy consent.

**When to use it**: First-launch privacy consent dialog.

**End support & boundaries**: Privacy consent is a platform compliance flow (mini program / app store); Web has no equivalent and returns `unsupported`.

> 技术标识：能力原语 C65 · `capability.privacy` · 返回 `PrivacyAPI` · **Hook implemented** (per-end support in the table below)

usePrivacy: privacy-agreement handle — query authorization state / open the privacy contract page / require authorization / on-need-authorization (wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize/onNeedPrivacyAuthorization; web has no WeChat-privacy standard → Err)

## Signature

```ts
usePrivacy(): CapResult<PrivacyAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `PrivacyAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`getSetting`](#getsetting) | — |
| [`openContract`](#opencontract) | — |
| [`requireAuthorize`](#requireauthorize) | — |
| [`onNeedAuthorization`](#onneedauthorization) | — |

### `getSetting`

```ts
getSetting(): Promise<CapResult<PrivacySetting>>
```

**Returns**: `Promise<CapResult<PrivacySetting>>`

### `openContract`

```ts
openContract(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `requireAuthorize`

```ts
requireAuthorize(): Promise<CapResult<boolean>>
```

**Returns**: `Promise<CapResult<boolean>>` -- 用户是否同意

### `onNeedAuthorization`

```ts
onNeedAuthorization(cb: (res: { privacyContractName: string }) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `cb` | `(res: { privacyContractName: string }) => void` | Yes | 事件处理器 |

**Returns**: `() => void` -- 取消订阅函数

## Referenced types

### `PrivacySetting`

★权威标尺缺口补齐（C65）：隐私协议（wx.getPrivacySetting / openPrivacyContract /
requirePrivacyAuthorize / onNeedPrivacyAuthorization）。
《个人信息保护法》+ 微信隐私协议合规的刚需：开发者需在用户触发隐私授权时弹协议、可跳转协议页、可主动触发授权。
web 端无对等标准（Cookie 同意可由宿主自建）→ 缺省 Err 诚实降级（常驻宿主桥）。

| Prop | Type | Default | Doc |
|---|---|---|---|
| `needAuthorization` | `boolean` | — | 是否需要用户授权（用户未同意 → true） |
| `privacyContractName` | `string` | — | 隐私协议名称（如《用户隐私保护指引》） |

## Error codes

| code | Doc |
|---|---|
| `privacy.unsupported` | The privacy API is missing (web has no WeChat privacy standard — build your own cookie consent in the host) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge getPrivacy is a pure shell (every path returns unsupported, no platform integration) → always Err |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.getPrivacySetting/openPrivacyContract/requirePrivacyAuthorize |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `PrivacyAPI`

| Prop/Method | Type | Doc |
|---|---|---|
| `getSetting` | `getSetting(): Promise<CapResult<PrivacySetting>>` | 查询隐私授权状态（wx.getPrivacySetting） |
| `openContract` | `openContract(): Promise<CapResult<void>>` | 打开隐私协议页面（wx.openPrivacyContract） |
| `requireAuthorize` | `requireAuthorize(): Promise<CapResult<boolean>>` | 主动触发隐私授权弹窗（wx.requirePrivacyAuthorize）。 |
| `onNeedAuthorization` | `onNeedAuthorization(cb: (res: { privacyContractName: string }) => void): () => void` | 订阅「需要用户隐私授权」事件（wx.onNeedPrivacyAuthorization）。 用户在页面触发隐私接口但未同意时回调——业务据此弹自家协议 UI 或调用 openContract。 |

### `PrivacySetting`

★权威标尺缺口补齐（C65）：隐私协议（wx.getPrivacySetting / openPrivacyContract /
requirePrivacyAuthorize / onNeedPrivacyAuthorization）。
《个人信息保护法》+ 微信隐私协议合规的刚需：开发者需在用户触发隐私授权时弹协议、可跳转协议页、可主动触发授权。
web 端无对等标准（Cookie 同意可由宿主自建）→ 缺省 Err 诚实降级（常驻宿主桥）。

| Prop/Method | Type | Doc |
|---|---|---|
| `needAuthorization` | `boolean` | 是否需要用户授权（用户未同意 → true） |
| `privacyContractName` | `string` | 隐私协议名称（如《用户隐私保护指引》） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const privacy = usePrivacy() // synchronous handle — no await, no res.ok

if (privacy.ok) {
  const setting = await privacy.data.getSetting()
  if (setting.ok && setting.data.needAuthorization) {
    // user hit a privacy API without consent → show your own consent UI
    privacy.data.onNeedAuthorization((res) => {
      console.log('needs consent:', res.privacyContractName)
    })
    await privacy.data.openContract() // or open the WeChat privacy page
  }
} else if (privacy.error.code === 'privacy.unsupported') {
  // no WeChat privacy standard on Web → degradation path (build your own consent)
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->