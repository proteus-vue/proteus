---
title: p-share-element
group: 工程
order: 4004
---

# p-share-element

Shared element transition (between pages) — ★aligned with the official <share-element>

> Semantic component (Layer 0) · domain **Engineering** · compiled to each target's native controls at build time — zero platform branches in business code.

| Semantic | Domain | Mini Program equivalent |
|---|---|---|
| engineering.share-element | Engineering | `<share-element>` (L1 primitive) |

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · dual-source compile target for both targets (compile-time mapping + event normalization) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · native control mapping → `<share-element>` (L1 primitive) |
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
| `pid` | — | `String` | `''` | No |
| `ariaLabel` | — | `String` | `''` | No |
| `shuttleKey` | Mapping marker (unique within a page; the same name on two pages means the same flying object) — ★official key (renamed: Vue reserved attribute) | `String` | `''` | No |
| `animate` | Whether to animate (false → position alignment only) — ★official transform (renamed: collides with CSS transform) | `Boolean` | `true` | No |
| `duration` | Animation duration in ms (★official duration) | `Number` | `300` | No |
| `easingFunction` | CSS easing function, e.g. ease / cubic-bezier(...) (★official easing-function) | `String` | `'ease'` | No |
| `transitionOnGesture` | Whether to animate on gesture-back (★official transition-on-gesture) | `Boolean` | `true` | No |
| `shuttleOnPush` | The flying object for the push phase (★official shuttle-on-push) | `String` | `''` | No |
| `shuttleOnPop` | The flying object for the pop phase (★official shuttle-on-pop) | `String` | `''` | No |
| `rectTweenType` | Animation interpolation curve (rect geometry tween type) (★official rect-tween-type) | `String` | `''` | No |

### Prop details

#### `pid`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `ariaLabel`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `shuttleKey`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Mapping marker (unique within a page; the same name on two pages means the same flying object) — ★official key (renamed: Vue reserved attribute)

#### `animate`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: Whether to animate (false → position alignment only) — ★official transform (renamed: collides with CSS transform)

#### `duration`

- **Type**: `Number`　**Default**: `300`　**Required**: No
- **Doc**: Animation duration in ms (★official duration)

#### `easingFunction`

- **Type**: `String`　**Default**: `'ease'`　**Required**: No
- **Doc**: CSS easing function, e.g. ease / cubic-bezier(...) (★official easing-function)

#### `transitionOnGesture`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: Whether to animate on gesture-back (★official transition-on-gesture)

#### `shuttleOnPush`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: The flying object for the push phase (★official shuttle-on-push)

#### `shuttleOnPop`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: The flying object for the pop phase (★official shuttle-on-pop)

#### `rectTweenType`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Animation interpolation curve (rect geometry tween type) (★official rect-tween-type)

## Slots

| Slot | Doc |
|---|---|
| default | Default slot (main content) |

## Implementation notes

- Shared elements across pages: elements with the same shuttle-key fly between pages during navigation (shuttle = the flying object); the transition itself is provided by the host (WeChat/native)
- ★Naming decision (02-ir-prop-binding, "reserved-word conflicts → prefix or rename"): the official `key` is NOT a prop in Vue (it is the vnode diff reserved attribute, so the component never receives it) → renamed to `shuttleKey`; the official `transform` (boolean: whether to animate) collides with the CSS transform string attribute on <view> → renamed to `animate`
- ★Cross-end honesty: on MP (Skyline) the attribute passes through to the native <share-element>; on Web there is no host shared-element transition → it degrades to a plain container (content visible, no flight) — use p-transition for in-page animation; native ends map to system shared-element transitions
- The official worklet:onframe is a worklet callback (event semantics) — filtered by schema type and not counted as an attribute

## Usage

```vue
<p-share-element :pid="…">
  <p-text>content</p-text>
</p-share-element>
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/components/p-share-element/index.vue -->