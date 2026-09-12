---
title: p-button
group: 内容与表单
order: 1002
---

# p-button

Button

> Semantic component (Layer 0) · domain **Content & Forms** · compiled to each target's native controls at build time — zero platform branches in business code.

| Semantic | Domain | Mini Program equivalent |
|---|---|---|
| ui.button | Content & Forms | `<button>` (L1 primitive) |

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · dual-source compile target for both targets (compile-time mapping + event normalization) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · native control mapping → `<button>` (L1 primitive) |
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
| `pid` | Component instance id (debugging / observation / test targeting -- D-2 dogfooding contract) | `String` | `''` | No |
| `disabled` | Disabled state (blocks interaction + de-emphasizes visuals; passes through to the native MP disabled) | `Boolean` | `false` | No |
| `ariaLabel` | Accessibility label (text read aloud by screen readers) | `String` | `''` | No |
| `loading` | Loading state | `Boolean` | `false` | No |
| `throttle` | Click throttle interval (ms; prevents repeated triggers -- built into the runtime) | `Number` | `0` | No |
| `size` | — | `String` | `''` | No |
| `type` | — | `String` | `''` | No |
| `plain` | — | `Boolean` | `false` | No |
| `formType` | — | `String` | `''` | No |
| `openType` | — | `String` | `''` | No |
| `hoverClass` | — | `String` | `''` | No |
| `hoverStopPropagation` | — | `Boolean` | `false` | No |
| `hoverStartTime` | — | `Number` | `20` | No |
| `hoverStayTime` | — | `Number` | `70` | No |
| `lang` | — | `String` | `''` | No |
| `sessionFrom` | — | `String` | `''` | No |
| `sendMessageTitle` | — | `String` | `''` | No |
| `sendMessagePath` | — | `String` | `''` | No |
| `sendMessageImg` | — | `String` | `''` | No |
| `appParameter` | — | `String` | `''` | No |
| `showMessageCard` | — | `Boolean` | `false` | No |
| `phoneNumberNoQuotaToast` | — | `Boolean` | `true` | No |
| `needShowEntrance` | — | `Boolean` | `false` | No |
| `entrancePath` | — | `String` | `''` | No |

### Prop details

#### `pid`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Component instance id (debugging / observation / test targeting -- D-2 dogfooding contract)

#### `disabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Disabled state (blocks interaction + de-emphasizes visuals; passes through to the native MP disabled)

#### `ariaLabel`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Accessibility label (text read aloud by screen readers)

#### `loading`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Loading state

#### `throttle`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: Click throttle interval (ms; prevents repeated triggers -- built into the runtime)

#### `size`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `type`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `plain`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `formType`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `openType`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `hoverClass`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `hoverStopPropagation`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `hoverStartTime`

- **Type**: `Number`　**Default**: `20`　**Required**: No
- **Doc**: —

#### `hoverStayTime`

- **Type**: `Number`　**Default**: `70`　**Required**: No
- **Doc**: —

#### `lang`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `sessionFrom`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `sendMessageTitle`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `sendMessagePath`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `sendMessageImg`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `appParameter`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `showMessageCard`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `phoneNumberNoQuotaToast`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `needShowEntrance`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `entrancePath`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

## Events

| Event | Doc | Payload |
|---|---|---|
| `click` | Click / tap (fires after throttling) | `e, { bubbles: true, composed: true }` |
| `getuserinfo` | — | — |
| `contact` | — | — |
| `getphonenumber` | — | — |
| `getrealtimephonenumber` | — | — |
| `error` | — | — |
| `opensetting` | — | — |
| `launchapp` | — | — |
| `chooseavatar` | — | — |
| `agreeprivacyauthorization` | — | — |
| `createliveactivity` | — | — |

### Event details

#### `click`

- **Doc**: Click / tap (fires after throttling)
- **Payload**: `e, { bubbles: true, composed: true }`

#### `getuserinfo`

- **Doc**: —
- **Payload**: none

#### `contact`

- **Doc**: —
- **Payload**: none

#### `getphonenumber`

- **Doc**: —
- **Payload**: none

#### `getrealtimephonenumber`

- **Doc**: —
- **Payload**: none

#### `error`

- **Doc**: —
- **Payload**: none

#### `opensetting`

- **Doc**: —
- **Payload**: none

#### `launchapp`

- **Doc**: —
- **Payload**: none

#### `chooseavatar`

- **Doc**: —
- **Payload**: none

#### `agreeprivacyauthorization`

- **Doc**: —
- **Payload**: none

#### `createliveactivity`

- **Doc**: —
- **Payload**: none

## Slots

| Slot | Doc |
|---|---|
| default | Default slot (main content) |

## Implementation notes

- Matrix 01 §7: native mapping of disabled/loading + throttle prevents duplicate clicks (built into the runtime)
- Dual-source for both targets: native button passthrough (tag/passthrough); @click → bindtap

## Usage

```vue
<p-button :pid="…">
  <p-text>content</p-text>
</p-button>
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: src/components/p-button/index.vue -->