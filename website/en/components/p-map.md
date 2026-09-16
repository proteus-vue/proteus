---
title: p-map
group: 内容与表单
order: 1014
---

# p-map

Map container

> Semantic component (Layer 0) · domain **Content & Forms** · compiled to each target's native controls at build time — zero platform branches in business code.

| Semantic | Domain | Mini Program equivalent |
|---|---|---|
| ui.map | Content & Forms | `<map>` (L1 primitive) |

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · dual-source compile target for both targets (compile-time mapping + event normalization) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · native control mapping → `<map>` (L1 primitive) |
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
| `latitude` | Center latitude | `Number` | `39.908823` | No |
| `longitude` | Center longitude | `Number` | `116.39747` | No |
| `scale` | Zoom level (3-20) | `Number` | `16` | No |
| `minScale` | — | `Number` | `3` | No |
| `maxScale` | — | `Number` | `20` | No |
| `markers` | Marker list | `Array as () => MapMarkerItem[]` | `() => []` | No |
| `covers` | — | `Array as () => Record<string` | `() => []` | No |
| `polyline` | — | `Array as () => Record<string` | `() => []` | No |
| `circles` | — | `Array as () => Record<string` | `() => []` | No |
| `controls` | — | `Array as () => Record<string` | `() => []` | No |
| `includePoints` | — | `Array as () => Record<string` | `() => []` | No |
| `showLocation` | Show the current location dot | `Boolean` | `false` | No |
| `polygons` | — | `Array as () => Record<string` | `() => []` | No |
| `subkey` | — | `String` | `''` | No |
| `layerStyle` | — | `Number` | `1` | No |
| `rotate` | — | `Number` | `0` | No |
| `skew` | — | `Number` | `0` | No |
| `showCompass` | — | `Boolean` | `false` | No |
| `showScale` | — | `Boolean` | `false` | No |
| `enableOverlooking` | — | `Boolean` | `false` | No |
| `enableAutoMaxOverlooking` | — | `Boolean` | `false` | No |
| `enableZoom` | — | `Boolean` | `true` | No |
| `enableScroll` | — | `Boolean` | `true` | No |
| `enableRotate` | — | `Boolean` | `false` | No |
| `enableSatellite` | — | `Boolean` | `false` | No |
| `enableTraffic` | — | `Boolean` | `false` | No |
| `enablePoi` | — | `Boolean` | `true` | No |
| `enableBuilding` | — | `Boolean` | `false` | No |
| `setting` | — | `Object as () => Record<string` | `() => ({` | No |
| `height` | Height in px (default 300) | `Number` | `300` | No |
| `placeholderText` | — | `String` | `'地图（宿主接入 SDK）'` | No |

### Prop details

#### `latitude`

- **Type**: `Number`　**Default**: `39.908823`　**Required**: No
- **Doc**: Center latitude

#### `longitude`

- **Type**: `Number`　**Default**: `116.39747`　**Required**: No
- **Doc**: Center longitude

#### `scale`

- **Type**: `Number`　**Default**: `16`　**Required**: No
- **Doc**: Zoom level (3-20)

#### `minScale`

- **Type**: `Number`　**Default**: `3`　**Required**: No
- **Doc**: —

#### `maxScale`

- **Type**: `Number`　**Default**: `20`　**Required**: No
- **Doc**: —

#### `markers`

- **Type**: `Array as () => MapMarkerItem[]`　**Default**: `() => []`　**Required**: No
- **Doc**: Marker list

#### `covers`

- **Type**: `Array as () => Record<string`　**Default**: `() => []`　**Required**: No
- **Doc**: —

#### `polyline`

- **Type**: `Array as () => Record<string`　**Default**: `() => []`　**Required**: No
- **Doc**: —

#### `circles`

- **Type**: `Array as () => Record<string`　**Default**: `() => []`　**Required**: No
- **Doc**: —

#### `controls`

- **Type**: `Array as () => Record<string`　**Default**: `() => []`　**Required**: No
- **Doc**: —

#### `includePoints`

- **Type**: `Array as () => Record<string`　**Default**: `() => []`　**Required**: No
- **Doc**: —

#### `showLocation`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: Show the current location dot

#### `polygons`

- **Type**: `Array as () => Record<string`　**Default**: `() => []`　**Required**: No
- **Doc**: —

#### `subkey`

- **Type**: `String`　**Default**: `''`　**Required**: No
- **Doc**: —

#### `layerStyle`

- **Type**: `Number`　**Default**: `1`　**Required**: No
- **Doc**: —

#### `rotate`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `skew`

- **Type**: `Number`　**Default**: `0`　**Required**: No
- **Doc**: —

#### `showCompass`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `showScale`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableOverlooking`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableAutoMaxOverlooking`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableZoom`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `enableScroll`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `enableRotate`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableSatellite`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enableTraffic`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `enablePoi`

- **Type**: `Boolean`　**Default**: `true`　**Required**: No
- **Doc**: —

#### `enableBuilding`

- **Type**: `Boolean`　**Default**: `false`　**Required**: No
- **Doc**: —

#### `setting`

- **Type**: `Object as () => Record<string`　**Default**: `() => ({`　**Required**: No
- **Doc**: —

#### `height`

- **Type**: `Number`　**Default**: `300`　**Required**: No
- **Doc**: Height in px (default 300)

#### `placeholderText`

- **Type**: `String`　**Default**: `'地图（宿主接入 SDK）'`　**Required**: No
- **Doc**: —

## Events

| Event | Doc | Payload |
|---|---|---|
| `markertap` | — | — |
| `labeltap` | — | — |
| `controltap` | — | — |
| `callouttap` | — | — |
| `updated` | — | — |
| `regionchange` | — | — |
| `poitap` | — | — |
| `polylinetap` | — | — |
| `tap` | — | — |
| `error` | — | — |

### Event details

#### `markertap`

- **Doc**: —
- **Payload**: none

#### `labeltap`

- **Doc**: —
- **Payload**: none

#### `controltap`

- **Doc**: —
- **Payload**: none

#### `callouttap`

- **Doc**: —
- **Payload**: none

#### `updated`

- **Doc**: —
- **Payload**: none

#### `regionchange`

- **Doc**: —
- **Payload**: none

#### `poitap`

- **Doc**: —
- **Payload**: none

#### `polylinetap`

- **Doc**: —
- **Payload**: none

#### `tap`

- **Doc**: —
- **Payload**: none

#### `error`

- **Doc**: —
- **Payload**: none

## Slots

| Slot | Doc |
|---|---|
| default | Default slot (main content) |

## Implementation notes

- Aligned with the Mini Program <map>: map view with markers / scale / show-location
- MP uses the native <map>; the web has no standard map API → a host slot for injecting Amap / Google / Mapbox SDK (honest degradation)
- Map control (moveTo/addMarkers…) goes through the useMap() capability surface

## Usage

```vue
<p-map :latitude="…">
  <p-text>content</p-text>
</p-map>
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/components/p-map/index.vue -->