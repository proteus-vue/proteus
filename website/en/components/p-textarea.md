---
title: p-textarea
group: 内容与表单
order: 1029
---

# p-textarea

Multiline textarea

> Semantic component (Layer 0) · domain **Content & Forms** · compiled to each target's native controls at build time — zero platform branches in business code.

| Semantic | Domain | Mini Program equivalent |
|---|---|---|
| ui.textarea | Content & Forms | `<textarea>` (L1 primitive) |

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · dual-source compile target for both targets (compile-time mapping + event normalization) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · native control mapping → `<textarea>` (L1 primitive) |
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
| `pid` | Component instance id (debugging/observation/test targeting — D-2 dogfooding contract) | `String` | `''` | No |
| `disabled` | Disabled state (blocks interaction and dims the visuals; MP native disabled is passed through) | `Boolean` | `false` | No |
| `ariaLabel` | Accessibility label (the text read aloud by a screen reader) | `String` | `''` | No |
| `value` | Bound value | `String` | `''` | No |
| `maxlength` | Maximum input length (<= 0 = unlimited) | `Number` | `-1` | No |
| `placeholder` | Placeholder hint text | `String` | `''` | No |
| `placeholderStyle` | — | `String` | `''` | No |
| `placeholderClass` | — | `String` | `''` | No |
| `focus` | Auto focus | `Boolean` | `false` | No |
| `autoHeight` | — | `Boolean` | `false` | No |
| `cursorSpacing` | — | `Number` | `0` | No |
| `cursor` | — | `Number` | `-1` | No |
| `selectionStart` | — | `Number` | `-1` | No |
| `selectionEnd` | — | `Number` | `-1` | No |
| `adjustPosition` | — | `Boolean` | `true` | No |
| `holdKeyboard` | — | `Boolean` | `false` | No |
| `disableDefaultPadding` | — | `Boolean` | `false` | No |
| `confirmType` | — | `String` | `''` | No |
| `confirmHold` | — | `Boolean` | `false` | No |
| `adjustKeyboardTo` | — | `String` | `''` | No |
| `fixed` | — | `Boolean` | `false` | No |
| `showConfirmBar` | — | `Boolean` | `true` | No |

### Prop details

#### `pid`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Component instance id (debugging/observation/test targeting — D-2 dogfooding contract)

#### `disabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Disabled state (blocks interaction and dims the visuals; MP native disabled is passed through)

#### `ariaLabel`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Accessibility label (the text read aloud by a screen reader)

#### `value`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Bound value

#### `maxlength`

- **Type**: `Number`　**Default**: `-1`　**Required**: No
- **Doc**: Maximum input length (<= 0 = unlimited)

#### `placeholder`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Placeholder hint text

#### `placeholderStyle`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `placeholderClass`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `focus`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Auto focus

#### `autoHeight`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `cursorSpacing`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `cursor`

- **Type**: `Number`　**Default**: `-1`　**Required**: No
- **Doc**: —

#### `selectionStart`

- **Type**: `Number`　**Default**: `-1`　**Required**: No
- **Doc**: —

#### `selectionEnd`

- **Type**: `Number`　**Default**: `-1`　**Required**: No
- **Doc**: —

#### `adjustPosition`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `holdKeyboard`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `disableDefaultPadding`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `confirmType`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `confirmHold`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `adjustKeyboardTo`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `fixed`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `showConfirmBar`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

## Events

| Event | Doc | Payload |
|---|---|---|
| `input` | Input changes (payload { value } normalized cross-end — MP custom-component v-model only covers native input/textarea, hence the explicit event contract) | `{ value: eventValue(e) }` |
| `confirm` | Keyboard confirm (Enter/Done key) | `{ value: eventValue(e) }` |
| `focus` | Gains focus | `e` |
| `blur` | Loses focus | `e` |

### Event details

#### `input`

- **Doc**: Input changes (payload { value } normalized cross-end — MP custom-component v-model only covers native input/textarea, hence the explicit event contract)
- **Payload**: `{ value: eventValue(e) }`

#### `confirm`

- **Doc**: Keyboard confirm (Enter/Done key)
- **Payload**: `{ value: eventValue(e) }`

#### `focus`

- **Doc**: Gains focus
- **Payload**: `e`

#### `blur`

- **Doc**: Loses focus
- **Payload**: `e`

## Implementation notes

- Matrix 01 §6: value / maxlength / placeholder / focus / disabled + @input/@confirm/@focus/@blur
- Event contract: :value + @input (payload { value } normalized cross-end, replacing v-model)
- Dual-end same-source: textarea native passthrough (tag/passthrough); MP textarea natively supports bindconfirm

## Usage

```vue
<p-textarea :pid="…">
  <p-text>content</p-text>
</p-textarea>
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/components/p-textarea/index.vue -->