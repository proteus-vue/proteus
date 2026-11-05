---
title: usePermission (capability.permission)
group: 账号与支付
order: 5001
---

# usePermission

**What it does**: Check and request system permissions (camera, location, notifications).

**When to use it**: First-use permission prompts.

**End support & boundaries**: **App targets query only, they never request.** This is the most misunderstood part: `usePermission(name)` reads the **current authorization state** and **never shows a permission prompt** — the real request happens when your code actually uses the capability (opening the camera, requesting location), and the system prompts then. Prompting here would give a "just checking the state" call a user-visible side effect.

**App targets expose two states only** (`granted` / `denied`), not Web's `prompt`: distinguishing "never asked" from "permanently denied" on Android needs `getPermissionFlags()` (a SystemApi unavailable to third-party apps), and HarmonyOS `checkAccessTokenSync` also returns two states — so anything not granted is reported honestly as `denied` rather than guessed as `prompt` (guessing would make apps re-prompt after the user picked "don't ask again", with nothing happening). iOS `notDetermined` also maps to `denied` — a **deliberate loss of information** for cross-target consistency.

**Three scopes in the first batch**: `camera` / `microphone` / `geolocation` (WeChat-style names `scope.camera` / `scope.record` / `scope.userLocation` are accepted too). **An unknown name is an error**, not `denied` — disguising "the framework does not know this" as "the system refused" makes the problem undiagnosable. Notifications are not in the first batch: iOS only exposes an async API (`getNotificationSettings`) while the host invoke contract is synchronous.

**Configuration prerequisite (the easiest trap)**: with the permission missing from the Android manifest, `checkSelfPermission` still returns DENIED; on iOS, a missing `NSCameraUsageDescription` (or equivalent) in `Info.plist` makes the **real request terminate the app** rather than return denied. Both disguise "not configured" as "user refused" — so the host reply carries a `declared` flag that lets you tell the two apart (`declared:false` means fix the configuration, not send the user hunting through Settings).

> 技术标识：能力原语 C16 · `capability.permission` · 返回 `Result<PermissionStatus>` · **Hook implemented** (per-end support in the table below)

usePermission: Permission status (web Permissions API)

## Signature

```ts
usePermission(name: string): Promise<CapResult<PermissionState>>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `name` | `string` | Yes | Permission name (standard web Permissions API name) |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `PermissionState` | Success payload (structure below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `permission` | `string` | Yes | Permission name (web Permissions API name, e.g. geolocation / camera) |
| `state` | `'granted' \| 'denied' \| 'prompt'` | Yes | Authorization state (prompt = not yet asked) |

## Error codes

| code | Doc |
|---|---|
| `permission.unsupported` | Bridge does not provide getPermission (usePermission unavailable) |
| `permission.failed` | — |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.authorize |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | ✅ | native-harmony (ArkUI RenderNode) · Harmony host wired (proteus_device.h) |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `PermissionState`

| Prop/Method | Type | Doc |
|---|---|---|
| `permission` | `string` | 权限名（web Permissions API 名，如 geolocation / camera） |
| `state` | `'granted' \| 'denied' \| 'prompt'` | 授权状态（prompt = 未询问） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const res = await usePermission('geolocation')

if (res.ok) {
  console.log(res.data.permission, res.data.state)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->