---
title: p-router-link
group: 工程
order: 4003
---

# p-router-link

Declarative navigation

> Semantic component (Layer 0) · domain **Engineering** · compiled to each target's native controls at build time — zero platform branches in business code.

| Semantic | Domain | Mini Program equivalent |
|---|---|---|
| engineering.router-link | Engineering | `<navigator>` (L1 primitive) |

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · dual-source compile target for both targets (compile-time mapping + event normalization) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · native control mapping → `<navigator>` (L1 primitive) |
| Headless (SSR / testing) | ✅ | headless · IR render test tier (tooling target) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — component-level wiring not started |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — component-level wiring not started |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — component-level wiring not started |
| Flutter hybrid | 🟡 | flutter · widget-level mapping — component-level not yet verified |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ shipped & this component usable · 🟡 prototype mapping — component-level wiring not started · ⬜ target not started. Target architecture matrix (engine / runtime / persistence) → [Ends & maturity](/docs/framework/ends-matrix).

## Props

| Prop | Doc | Type | Default | Required |
|---|---|---|---|---|
| `to` | Navigation target (route name or path) - createRouterEngineering.push({ name: to \| path: to }) | `String` | `''` | No |
| `replace` | Replaces the current page (E12 semantics - push({...to, replace:true})) | `Boolean` | `false` | No |
| `switchTab` | Switches to a Tab page (E14 semantics - push({...to, switchTab:true})) | `Boolean` | `false` | No |
| `target` | — | `String` | `'self'` | No |
| `url` | — | `String` | `''` | No |
| `openType` | — | `String` | `'navigate'` | No |
| `delta` | — | `Number` | `1` | No |
| `appId` | — | `String` | `''` | No |
| `path` | — | `String` | `''` | No |
| `extraData` | — | `Object` | `null` | No |
| `version` | — | `String` | `'release'` | No |
| `shortLink` | — | `String` | `''` | No |
| `hoverClass` | — | `String` | `''` | No |
| `hoverStopPropagation` | — | `Boolean` | `false` | No |
| `hoverStartTime` | — | `Number` | `50` | No |
| `hoverStayTime` | — | `Number` | `400` | No |

### Prop details

#### `to`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Navigation target (route name or path) - createRouterEngineering.push({ name: to \| path: to })

#### `replace`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Replaces the current page (E12 semantics - push({...to, replace:true}))

#### `switchTab`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Switches to a Tab page (E14 semantics - push({...to, switchTab:true}))

#### `target`

- **Type**: `String`　**Default**: `'self'`　**Required**: No
- **Doc**: —

#### `url`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `openType`

- **Type**: `String`　**Default**: `'navigate'`　**Required**: No
- **Doc**: —

#### `delta`

- **Type**: `Number`　**Default**: `1`　**Required**: No
- **Doc**: —

#### `appId`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `path`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `extraData`

- **Type**: `Object`　**Default**: `null`　**Required**: No
- **Doc**: —

#### `version`

- **Type**: `String`　**Default**: `'release'`　**Required**: No
- **Doc**: —

#### `shortLink`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `hoverClass`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `hoverStopPropagation`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `hoverStartTime`

- **Type**: `Number`　**Default**: `50`　**Required**: No
- **Doc**: —

#### `hoverStayTime`

- **Type**: `Number`　**Default**: `400`　**Required**: No
- **Doc**: —

## Events

| Event | Doc | Payload |
|---|---|---|
| `navigate` | — | — |

### Event details

#### `navigate`

- **Doc**: —
- **Payload**: none

## Slots

| Slot | Doc |
|---|---|
| default | Default slot (main content) |

## Implementation notes

- to: navigation target (route name or path - createRouterEngineering.push({ name|path }) semantics, E11)
- replace: replaces the current page (E12 semantics)
- switchTab: switches to a Tab page (E14 semantics)
- Behavior: on click, emit('navigate', { to, replace, switchTab }) - the parent responds via createRouterEngineering (#320)
- Zero platform dependencies (no router import, no wx/document access - audit compliant); web role="link" accessibility
- MP: @click → bindtap; aligned with the existing p-radio defineEmits + emit pipeline

## Usage

```vue
<p-router-link :to="…">
  <p-text>content</p-text>
</p-router-link>
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/components/p-router-link/index.vue -->