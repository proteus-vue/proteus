---
title: useNavigationGuard (capability.navigation-guard)
group: 应用与生命周期
order: 7012
---

# useNavigationGuard

**What it does**: Intercept navigation away from a page to confirm.

**When to use it**: Unsaved-form protection, leave confirmation.

> 技术标识：能力原语 C75 · `capability.navigation-guard` · 返回 `NavigationGuardAPI` · **Hook implemented** (per-end support in the table below)

useNavigationGuard: navigation/unload guard — enable/disable a confirm prompt before leaving (wx.enableAlertBeforeUnload/disableAlertBeforeUnload; web beforeunload event)

## Signature

```ts
useNavigationGuard(): CapResult<NavigationGuardAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `NavigationGuardAPI` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`enable`](#enable) | — |
| [`disable`](#disable) | — |

### `enable`

```ts
enable(message: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `message` | `string` | Yes | 询问文案 |

**Returns**: `Promise<CapResult<void>>`

### `disable`

```ts
disable(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

## Error codes

| code | Doc |
|---|---|
| `navigation-guard.unsupported` | The navigation-guard API is missing (web has no beforeunload event available) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.enableAlertBeforeUnload/disableAlertBeforeUnload |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `NavigationGuardAPI`

★权威标尺缺口 C75：导航卸载拦截（`useNavigationGuard()`）。
wx：`wx.enableAlertBeforeUnload` / `disableAlertBeforeUnload`（返回/关闭时弹确认）；
web：`beforeunload` 事件承接（浏览器原生行为）。

| Prop/Method | Type | Doc |
|---|---|---|
| `enable` | `enable(message: string): Promise<CapResult<void>>` | 开启卸载前确认弹窗。 |
| `disable` | `disable(): Promise<CapResult<void>>` | 关闭卸载前确认弹窗 |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const guard = useNavigationGuard() // synchronous handle — no await, no res.ok

if (guard.ok) {
  await guard.data.enable('Form has unsaved changes. Leave anyway?')
  // after a successful save: await guard.data.disable()
} else if (guard.error.code === 'navigation-guard.unsupported') {
  // platform unsupported → degradation path
}
```

## Platform notes

### Mini Program (MP)

- **wx.enableAlertBeforeUnload** — Shows a confirm dialog on back navigation (guards unsaved drafts) — base library 2.12.0+; intercepts back only, not app close

### Web

- **Browser limits on beforeunload** — Browsers only allow "are you sure you want to leave" and **cannot show custom text** (modern browsers force a generic prompt)

### App (iOS / Android / Harmony)

- **Virtual-stack pop interception (in-framework)** — ★No native API needed on App: virtual-stack pop is the framework's own command (M5) — interception happens in-framework with custom dialogs and copy · Related capabilities: [`usePageLifecycle`](/docs/capability/page-lifecycle)
- **Android hardware back key** — Hardware/gesture back dispatches through the same stack pop — consistent with UI back (the shell maps onBackPressed to a virtual-stack pop) · Planned: Effective once the shell wires onBackPressed to a stack pop

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->