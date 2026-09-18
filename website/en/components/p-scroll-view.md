---
title: p-scroll-view
group: 布局
order: 11
---

# p-scroll-view

Scroll container

> Semantic component (Layer 0) · domain **Layout** · compiled to each target's native controls at build time — zero platform branches in business code.

| Semantic | Domain | Mini Program equivalent |
|---|---|---|
| layout.scroll | Layout | `<scroll-view>` (L1 primitive) · `<sticky-header>` (L2 compat layer) · `<sticky-section>` (L2 compat layer) |

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · dual-source compile target for both targets (compile-time mapping + event normalization) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · native control mapping → `<scroll-view>` (L1 primitive) · `<sticky-header>` (L2 compat layer) · `<sticky-section>` (L2 compat layer) |
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
| `pid` | Component instance identifier (for debugging/observability/test targeting -- the D-2 dogfooding contract) | `String` | `''` | No |
| `disabled` | Disabled state (interaction disabled + dimmed visuals; MP native disabled is passed through) | `Boolean` | `false` | No |
| `ariaLabel` | Accessibility label (text read aloud by screen readers) | `String` | `''` | No |
| `scrollX` | Allows horizontal scrolling | `Boolean` | `false` | No |
| `scrollY` | Allows vertical scrolling | `Boolean` | `true` | No |
| `scrollTop` | Vertical scroll position (px) | `[Number, String]` | `0` | No |
| `scrollLeft` | Horizontal scroll position (px) | `[Number, String]` | `0` | No |
| `upperThreshold` | — | `[Number, String]` | `50` | No |
| `lowerThreshold` | Distance in px from the bottom that triggers the scrolltolower event | `[Number, String]` | `50` | No |
| `scrollIntoView` | — | `String` | `''` | No |
| `scrollIntoViewOffset` | — | `Number` | `0` | No |
| `scrollWithAnimation` | — | `Boolean` | `false` | No |
| `enableBackToTop` | — | `Boolean` | `false` | No |
| `enablePassive` | — | `Boolean` | `false` | No |
| `refresherEnabled` | Enables the custom pull-down refresher | `Boolean` | `false` | No |
| `refresherThreshold` | — | `Number` | `45` | No |
| `refresherDefaultStyle` | — | `String` | `'black'` | No |
| `refresherBackground` | — | `String` | `'transparent'` | No |
| `refresherTriggered` | — | `Boolean` | `false` | No |
| `bounces` | — | `Boolean` | `true` | No |
| `showScrollbar` | — | `Boolean` | `false` | No |
| `fastDeceleration` | — | `Boolean` | `false` | No |
| `scrollAnchoring` | — | `Boolean` | `false` | No |
| `type` | — | `String` | `''` | No |
| `associativeContainer` | — | `String` | `''` | No |
| `reverse` | — | `Boolean` | `false` | No |
| `clip` | — | `Boolean` | `true` | No |
| `cacheExtent` | — | `Number` | `0` | No |
| `minDragDistance` | — | `Number` | `0` | No |
| `scrollIntoViewWithinExtent` | — | `Boolean` | `false` | No |
| `scrollIntoViewAlignment` | — | `String` | `''` | No |
| `padding` | — | `Array` | `[]` | No |
| `refresherTwoLevelEnabled` | — | `Boolean` | `false` | No |
| `refresherTwoLevelTriggered` | — | `Boolean` | `false` | No |
| `refresherTwoLevelThreshold` | — | `Number` | `150` | No |
| `refresherTwoLevelCloseThreshold` | — | `Number` | `80` | No |
| `refresherTwoLevelScrollEnabled` | — | `Boolean` | `false` | No |
| `refresherBallisticRefreshEnabled` | — | `Boolean` | `false` | No |
| `refresherTwoLevelPinned` | — | `Boolean` | `false` | No |
| `enableFlex` | — | `Boolean` | `false` | No |
| `enhanced` | — | `Boolean` | `false` | No |
| `pagingEnabled` | — | `Boolean` | `false` | No |
| `usingSticky` | — | `Boolean` | `false` | No |

### Prop details

#### `pid`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Component instance identifier (for debugging/observability/test targeting -- the D-2 dogfooding contract)

#### `disabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Disabled state (interaction disabled + dimmed visuals; MP native disabled is passed through)

#### `ariaLabel`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Accessibility label (text read aloud by screen readers)

#### `scrollX`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Allows horizontal scrolling

#### `scrollY`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: Allows vertical scrolling

#### `scrollTop`

- **Type**: `[Number, String]`　**Default**: `0`　**Required**: No
- **Doc**: Vertical scroll position (px)

#### `scrollLeft`

- **Type**: `[Number, String]`　**Default**: `0`　**Required**: No
- **Doc**: Horizontal scroll position (px)

#### `upperThreshold`

- **Type**: `[Number, String]`　**Default**: `50`　**Required**: No
- **Doc**: —

#### `lowerThreshold`

- **Type**: `[Number, String]`　**Default**: `50`　**Required**: No
- **Doc**: Distance in px from the bottom that triggers the scrolltolower event

#### `scrollIntoView`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `scrollIntoViewOffset`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `scrollWithAnimation`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableBackToTop`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enablePassive`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `refresherEnabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Enables the custom pull-down refresher

#### `refresherThreshold`

- **Type**: `Number`　**Default**: `45`　**Required**: No
- **Doc**: —

#### `refresherDefaultStyle`

- **Type**: `String`　**Default**: `'black'`　**Required**: No
- **Doc**: —

#### `refresherBackground`

- **Type**: `String`　**Default**: `'transparent'`　**Required**: No
- **Doc**: —

#### `refresherTriggered`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `bounces`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `showScrollbar`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `fastDeceleration`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `scrollAnchoring`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `type`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `associativeContainer`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `reverse`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `clip`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `cacheExtent`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `minDragDistance`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `scrollIntoViewWithinExtent`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `scrollIntoViewAlignment`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `padding`

- **Type**: `Array`　**Default**: `[]`　**Required**: No
- **Doc**: —

#### `refresherTwoLevelEnabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `refresherTwoLevelTriggered`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `refresherTwoLevelThreshold`

- **Type**: `Number`　**Default**: `150`　**Required**: No
- **Doc**: —

#### `refresherTwoLevelCloseThreshold`

- **Type**: `Number`　**Default**: `80`　**Required**: No
- **Doc**: —

#### `refresherTwoLevelScrollEnabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `refresherBallisticRefreshEnabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `refresherTwoLevelPinned`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableFlex`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enhanced`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `pagingEnabled`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `usingSticky`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

## Events

| Event | Doc | Payload |
|---|---|---|
| `scroll` | Scrolling (eventScrollTop normalization: MP e.detail.scrollTop / Web e.target.scrollTop) | — |
| `scrolltoupper` | — | — |
| `scrolltolower` | Scrolled to the bottom (triggered by lowerThreshold) | — |
| `refresherpulling` | — | — |
| `refresherrefresh` | Custom pull-down refresher triggered | — |
| `refresherrestore` | — | — |
| `refresherabort` | — | — |
| `refresherwillrefresh` | — | — |
| `refresherstatuschange` | — | — |
| `dragstart` | — | — |
| `dragging` | — | — |
| `dragend` | — | — |
| `scrollstart` | — | — |
| `scrollend` | — | — |

### Event details

#### `scroll`

- **Doc**: Scrolling (eventScrollTop normalization: MP e.detail.scrollTop / Web e.target.scrollTop)
- **Payload**: none

#### `scrolltoupper`

- **Doc**: —
- **Payload**: none

#### `scrolltolower`

- **Doc**: Scrolled to the bottom (triggered by lowerThreshold)
- **Payload**: none

#### `refresherpulling`

- **Doc**: —
- **Payload**: none

#### `refresherrefresh`

- **Doc**: Custom pull-down refresher triggered
- **Payload**: none

#### `refresherrestore`

- **Doc**: —
- **Payload**: none

#### `refresherabort`

- **Doc**: —
- **Payload**: none

#### `refresherwillrefresh`

- **Doc**: —
- **Payload**: none

#### `refresherstatuschange`

- **Doc**: —
- **Payload**: none

#### `dragstart`

- **Doc**: —
- **Payload**: none

#### `dragging`

- **Doc**: —
- **Payload**: none

#### `dragend`

- **Doc**: —
- **Payload**: none

#### `scrollstart`

- **Doc**: —
- **Payload**: none

#### `scrollend`

- **Doc**: —
- **Payload**: none

## Slots

| Slot | Doc |
|---|---|
| default | Default slot (main content) |

## Implementation notes

- Matrix 01 §4: Skyline must-have (page-level scrolling, global scroll disabled); scroll-x/y, scroll-top/left, refresher, lower-threshold
- Performance constraint (very-large-count reuse scenarios): thin wrapper -- no component-layer logic introduced, events passed through, no throttling/no state

## Usage

```vue
<p-scroll-view :pid="…">
  <p-text>content</p-text>
</p-scroll-view>
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/components/p-scroll-view/index.vue -->