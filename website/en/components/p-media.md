---
title: p-media
group: 内容与表单
order: 1015
---

# p-media

Unified media entry

> Semantic component (Layer 0) · domain **Content & Forms** · compiled to each target's native controls at build time — zero platform branches in business code.

| Semantic | Domain | Mini Program equivalent |
|---|---|---|
| ui.media | Content & Forms | `<audio>` (L1 primitive) · `<video>` (L1 primitive) · `<live-player>` (L1 primitive) · `<live-pusher>` (L1 primitive) |

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · dual-source compile target for both targets (compile-time mapping + event normalization) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · native control mapping → `<audio>` (L1 primitive) · `<video>` (L1 primitive) · `<live-player>` (L1 primitive) · `<live-pusher>` (L1 primitive) |
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
| `kind` | Media type: image / video / audio / live | `String` | `'image'` | No |
| `src` | Resource address | `String` | `''` | No |
| `duration` | — | `Number` | `0` | No |
| `controls` | Show the control bar | `Boolean` | `true` | No |
| `danmuList` | — | `Array as () => Record<string` | `() => []` | No |
| `danmuBtn` | — | `Boolean` | `false` | No |
| `enableDanmu` | — | `Boolean` | `false` | No |
| `autoplay` | Autoplay | `Boolean` | `false` | No |
| `loop` | Loop | `Boolean` | `false` | No |
| `muted` | Muted | `Boolean` | `false` | No |
| `initialTime` | — | `Number` | `0` | No |
| `pageGesture` | — | `Boolean` | `false` | No |
| `direction` | — | `Number` | `0` | No |
| `showProgress` | — | `Boolean` | `true` | No |
| `showFullscreenBtn` | — | `Boolean` | `true` | No |
| `showPlayBtn` | — | `Boolean` | `true` | No |
| `showCenterPlayBtn` | — | `Boolean` | `true` | No |
| `enableProgressGesture` | — | `Boolean` | `true` | No |
| `objectFit` | — | `String` | `'contain'` | No |
| `poster` | Poster (video/live) | `String` | `''` | No |
| `showMuteBtn` | — | `Boolean` | `false` | No |
| `title` | — | `String` | `''` | No |
| `playBtnPosition` | — | `String` | `'bottom'` | No |
| `enablePlayGesture` | — | `Boolean` | `false` | No |
| `autoPauseIfNavigate` | — | `Boolean` | `true` | No |
| `autoPauseIfOpenNative` | — | `Boolean` | `true` | No |
| `vslideGesture` | — | `Boolean` | `false` | No |
| `vslideGestureInFullscreen` | — | `Boolean` | `true` | No |
| `showBottomProgress` | — | `Boolean` | `true` | No |
| `adUnitId` | — | `String` | `''` | No |
| `posterForCrawler` | — | `String` | `''` | No |
| `showCastingButton` | — | `Boolean` | `false` | No |
| `pictureInPictureMode` | — | `[String, Array] as unknown as () => string \| string[]` | `''` | No |
| `pictureInPictureShowProgress` | — | `Boolean` | `false` | No |
| `pictureInPictureInitPosition` | — | `String` | `''` | No |
| `enableSystemPip` | — | `Boolean` | `true` | No |
| `enableAutoRotation` | — | `Boolean` | `false` | No |
| `showScreenLockButton` | — | `Boolean` | `false` | No |
| `showSnapshotButton` | — | `Boolean` | `false` | No |
| `showBackgroundPlaybackButton` | — | `Boolean` | `true` | No |
| `backgroundPoster` | — | `String` | `''` | No |
| `referrerPolicy` | — | `String` | `'no-referrer'` | No |
| `isDrm` | — | `Boolean` | `false` | No |
| `isLive` | — | `Boolean` | `false` | No |
| `provisionUrl` | — | `String` | `''` | No |
| `certificateUrl` | — | `String` | `''` | No |
| `licenseUrl` | — | `String` | `''` | No |
| `preferredPeakBitRate` | — | `Number` | `0` | No |
| `width` | Width in px (0 = auto) | `Number` | `0` | No |
| `height` | Height in px (0 = auto) | `Number` | `0` | No |

### Prop details

#### `kind`

- **Type**: `String`　**Default**: `'image'`　**Required**: No
- **Doc**: Media type: image / video / audio / live

#### `src`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Resource address

#### `duration`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `controls`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: Show the control bar

#### `danmuList`

- **Type**: `Array as () => Record<string`　**Default**: `() => []`　**Required**: No
- **Doc**: —

#### `danmuBtn`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableDanmu`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `autoplay`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Autoplay

#### `loop`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Loop

#### `muted`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Muted

#### `initialTime`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `pageGesture`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `direction`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `showProgress`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `showFullscreenBtn`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `showPlayBtn`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `showCenterPlayBtn`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `enableProgressGesture`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `objectFit`

- **Type**: `String`　**Default**: `'contain'`　**Required**: No
- **Doc**: —

#### `poster`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: Poster (video/live)

#### `showMuteBtn`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `title`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `playBtnPosition`

- **Type**: `String`　**Default**: `'bottom'`　**Required**: No
- **Doc**: —

#### `enablePlayGesture`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `autoPauseIfNavigate`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `autoPauseIfOpenNative`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `vslideGesture`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `vslideGestureInFullscreen`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `showBottomProgress`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `adUnitId`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `posterForCrawler`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `showCastingButton`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `pictureInPictureMode`

- **Type**: `[String, Array] as unknown as () => string \| string[]`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `pictureInPictureShowProgress`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `pictureInPictureInitPosition`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `enableSystemPip`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `enableAutoRotation`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `showScreenLockButton`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `showSnapshotButton`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `showBackgroundPlaybackButton`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `backgroundPoster`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `referrerPolicy`

- **Type**: `String`　**Default**: `'no-referrer'`　**Required**: No
- **Doc**: —

#### `isDrm`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `isLive`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `provisionUrl`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `certificateUrl`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `licenseUrl`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `preferredPeakBitRate`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `width`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: Width in px (0 = auto)

#### `height`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: Height in px (0 = auto)

## Events

| Event | Doc | Payload |
|---|---|---|
| `play` | — | — |
| `pause` | — | — |
| `ended` | — | — |
| `timeupdate` | — | — |
| `fullscreenchange` | — | — |
| `waiting` | — | — |
| `error` | — | — |
| `progress` | — | — |
| `loadedmetadata` | — | — |
| `controlstoggle` | — | — |

### Event details

#### `play`

- **Doc**: —
- **Payload**: none

#### `pause`

- **Doc**: —
- **Payload**: none

#### `ended`

- **Doc**: —
- **Payload**: none

#### `timeupdate`

- **Doc**: —
- **Payload**: none

#### `fullscreenchange`

- **Doc**: —
- **Payload**: none

#### `waiting`

- **Doc**: —
- **Payload**: none

#### `error`

- **Doc**: —
- **Payload**: none

#### `progress`

- **Doc**: —
- **Payload**: none

#### `loadedmetadata`

- **Doc**: —
- **Payload**: none

#### `controlstoggle`

- **Doc**: —
- **Payload**: none

## Implementation notes

- Unified entry for image/video/audio/live via kind (eliminates the separate video/audio components)
- ★B2 Web-first: kind decides the element (img/video/audio with explicit v-if - the MP compiler does not support dynamic tags)
- Same source for both ends; no platform API (controls/autoplay/loop/muted are passed through as native attributes)

## Usage

```vue
<p-media :kind="…">
  <p-text>content</p-text>
</p-media>
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/components/p-media/index.vue -->