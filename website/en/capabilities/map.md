---
title: useMap (capability.map)
group: 位置与地图
order: 3002
---

# useMap

useMap: map context handle (wx.createMapContext / web host integration; → Err when none is available)

> Capability primitive C4 · `capability.map` · returns `MapController` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useMap(id: string): Promise<CapResult<MapController>>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `id` | `string` | Yes | map instance ID (distinguishes instances in multi-map scenarios) |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `MapController` | Success payload (methods below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Signature | Doc |
|---|---|---|
| [`getRegion`](#getregion) | `getRegion(): Promise<CapResult<MapRegion>>` | — |
| [`moveTo`](#moveto) | `moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>` | — |
| [`moveToLocation`](#movetolocation) | `moveToLocation(): Promise<CapResult<void>>` | — |
| [`includePoints`](#includepoints) | `includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<CapResult<void>>` | — |
| [`translateMarker`](#translatemarker) | `translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<CapResult<void>>` | — |
| [`addMarkers`](#addmarkers) | `addMarkers(markers: MapMarker[]): Promise<CapResult<void>>` | — |
| [`removeMarkers`](#removemarkers) | `removeMarkers(ids: number[]): Promise<CapResult<void>>` | — |
| [`addPolylines`](#addpolylines) | `addPolylines(polylines: MapPolyline[]): Promise<CapResult<void>>` | — |
| [`removePolylines`](#removepolylines) | `removePolylines(ids: number[]): Promise<CapResult<void>>` | — |
| [`addCircles`](#addcircles) | `addCircles(circles: MapCircle[]): Promise<CapResult<void>>` | — |
| [`removeCircles`](#removecircles) | `removeCircles(ids: number[]): Promise<CapResult<void>>` | — |
| [`getScale`](#getscale) | `getScale(): Promise<CapResult<number>>` | — |
| [`openMapApp`](#openmapapp) | `openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<CapResult<void>>` | — |
| [`on`](#on) | `on(event: 'regionchange' \| 'markerTap' \| 'updated', cb: (payload: unknown) => void): () => void` | — |
| [`getCenterLocation`](#getcenterlocation) | `getCenterLocation(): Promise<CapResult<{ latitude: number; longitude: number }>>` | — |
| [`getRotate`](#getrotate) | `getRotate(): Promise<CapResult<number>>` | — |
| [`getSkew`](#getskew) | `getSkew(): Promise<CapResult<number>>` | — |
| [`fromScreenLocation`](#fromscreenlocation) | `fromScreenLocation(x: number, y: number): Promise<CapResult<{ latitude: number; longitude: number }>>` | — |
| [`toScreenLocation`](#toscreenlocation) | `toScreenLocation(latitude: number, longitude: number): Promise<CapResult<{ x: number; y: number }>>` | — |
| [`setCenterOffset`](#setcenteroffset) | `setCenterOffset(offset: { x: number; y: number }): Promise<CapResult<void>>` | — |
| [`setBoundary`](#setboundary) | `setBoundary(boundaries: Array<{ latitude: number; longitude: number }>): Promise<CapResult<void>>` | — |
| [`moveAlong`](#movealong) | `moveAlong(opt: { path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }): Promise<CapResult<void>>` | — |
| [`addArc`](#addarc) | `addArc(arc: { id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }): Promise<CapResult<void>>` | — |
| [`eraseLines`](#eraselines) | `eraseLines(ids: number[]): Promise<CapResult<void>>` | — |
| [`initMarkerCluster`](#initmarkercluster) | `initMarkerCluster(enable: boolean): Promise<CapResult<void>>` | — |
| [`setLocMarkerIcon`](#setlocmarkericon) | `setLocMarkerIcon(iconPath: string): Promise<CapResult<void>>` | — |
| [`addCustomLayer`](#addcustomlayer) | `addCustomLayer(layer: Record<string, unknown>): Promise<CapResult<void>>` | — |
| [`removeCustomLayer`](#removecustomlayer) | `removeCustomLayer(layerId: string): Promise<CapResult<void>>` | — |
| [`addVisualLayer`](#addvisuallayer) | `addVisualLayer(layer: Record<string, unknown>): Promise<CapResult<void>>` | — |
| [`removeVisualLayer`](#removevisuallayer) | `removeVisualLayer(layerId: string): Promise<CapResult<void>>` | — |
| [`executeVisualLayerCommand`](#executevisuallayercommand) | `executeVisualLayerCommand(command: Record<string, unknown>): Promise<CapResult<string>>` | — |
| [`addGroundOverlay`](#addgroundoverlay) | `addGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>` | — |
| [`updateGroundOverlay`](#updategroundoverlay) | `updateGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>` | — |
| [`removeGroundOverlay`](#removegroundoverlay) | `removeGroundOverlay(overlayId: string): Promise<CapResult<void>>` | — |

### `getRegion`

```ts
getRegion(): Promise<CapResult<MapRegion>>
```

**Returns**: `Promise<CapResult<MapRegion>>`

### `moveTo`

```ts
moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `latitude` | `number` | Yes | 纬度 |
| `longitude` | `number` | Yes | 经度 |
| `scale` | `number` | No | 缩放级别（1-20；缺省不变） |

**Returns**: `Promise<CapResult<void>>`

### `moveToLocation`

```ts
moveToLocation(): Promise<CapResult<void>>
```

**Returns**: `Promise<CapResult<void>>`

### `includePoints`

```ts
includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `points` | `Array<{ latitude: number; longitude: number }>` | Yes | 经纬点列表 |
| `padding` | `number[]` | No | 边距（[上, 右, 下, 左]，px） |

**Returns**: `Promise<CapResult<void>>`

### `translateMarker`

```ts
translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `opt` | `{ markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }` | No | markerId 标记 id、destination 目标经纬、rotate 旋转角、duration 动画时长(ms) |

**Returns**: `Promise<CapResult<void>>`

### `addMarkers`

```ts
addMarkers(markers: MapMarker[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `markers` | `MapMarker[]` | Yes | 标记列表（id 唯一） |

**Returns**: `Promise<CapResult<void>>`

### `removeMarkers`

```ts
removeMarkers(ids: number[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `ids` | `number[]` | Yes | 标记 id 列表 |

**Returns**: `Promise<CapResult<void>>`

### `addPolylines`

```ts
addPolylines(polylines: MapPolyline[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `polylines` | `MapPolyline[]` | Yes | 折线列表（点序列 + 颜色/宽度） |

**Returns**: `Promise<CapResult<void>>`

### `removePolylines`

```ts
removePolylines(ids: number[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `ids` | `number[]` | Yes | 折线 id 列表 |

**Returns**: `Promise<CapResult<void>>`

### `addCircles`

```ts
addCircles(circles: MapCircle[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `circles` | `MapCircle[]` | Yes | 圆列表（中心 + 半径 + 颜色） |

**Returns**: `Promise<CapResult<void>>`

### `removeCircles`

```ts
removeCircles(ids: number[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `ids` | `number[]` | Yes | 圆 id 列表 |

**Returns**: `Promise<CapResult<void>>`

### `getScale`

```ts
getScale(): Promise<CapResult<number>>
```

**Returns**: `Promise<CapResult<number>>`

### `openMapApp`

```ts
openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `opt` | `{ latitude: number; longitude: number; name?: string }` | No | latitude/longitude 目标、name 地点名 |

**Returns**: `Promise<CapResult<void>>`

### `on`

```ts
on(event: 'regionchange' | 'markerTap' | 'updated', cb: (payload: unknown) => void): () => void
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `event` | `'regionchange' \| 'markerTap' \| 'updated'` | Yes | 事件名（regionchange 视野变化 / markerTap 标记点击 / updated 更新完成） |
| `cb` | `(payload: unknown) => void` | Yes | 事件处理器 |

**Returns**: `() => void` -- 取消订阅函数

### `getCenterLocation`

```ts
getCenterLocation(): Promise<CapResult<{ latitude: number; longitude: number }>>
```

**Returns**: `Promise<CapResult<{ latitude: number; longitude: number }>>`

### `getRotate`

```ts
getRotate(): Promise<CapResult<number>>
```

**Returns**: `Promise<CapResult<number>>`

### `getSkew`

```ts
getSkew(): Promise<CapResult<number>>
```

**Returns**: `Promise<CapResult<number>>`

### `fromScreenLocation`

```ts
fromScreenLocation(x: number, y: number): Promise<CapResult<{ latitude: number; longitude: number }>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `x` | `number` | Yes | 屏幕 x |
| `y` | `number` | Yes | 屏幕 y |

**Returns**: `Promise<CapResult<{ latitude: number; longitude: number }>>`

### `toScreenLocation`

```ts
toScreenLocation(latitude: number, longitude: number): Promise<CapResult<{ x: number; y: number }>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `latitude` | `number` | Yes | 纬度 |
| `longitude` | `number` | Yes | 经度 |

**Returns**: `Promise<CapResult<{ x: number; y: number }>>`

### `setCenterOffset`

```ts
setCenterOffset(offset: { x: number; y: number }): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `offset` | `{ x: number; y: number }` | Yes | x/y 偏移量（px） |

**Returns**: `Promise<CapResult<void>>`

### `setBoundary`

```ts
setBoundary(boundaries: Array<{ latitude: number; longitude: number }>): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `boundaries` | `Array<{ latitude: number; longitude: number }>` | Yes | 边界多边形顶点 |

**Returns**: `Promise<CapResult<void>>`

### `moveAlong`

```ts
moveAlong(opt: { path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `opt` | `{ path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }` | No | path 路径点、duration 总时长(ms)、autoRotate 是否自动转向 |

**Returns**: `Promise<CapResult<void>>`

### `addArc`

```ts
addArc(arc: { id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `arc` | `{ id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }` | No | id / start 起点 / end 终点 / color / width |

**Returns**: `Promise<CapResult<void>>`

### `eraseLines`

```ts
eraseLines(ids: number[]): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `ids` | `number[]` | Yes | 折线 id 列表 |

**Returns**: `Promise<CapResult<void>>`

### `initMarkerCluster`

```ts
initMarkerCluster(enable: boolean): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `enable` | `boolean` | Yes | 是否启用 |

**Returns**: `Promise<CapResult<void>>`

### `setLocMarkerIcon`

```ts
setLocMarkerIcon(iconPath: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `iconPath` | `string` | Yes | 图标路径 |

**Returns**: `Promise<CapResult<void>>`

### `addCustomLayer`

```ts
addCustomLayer(layer: Record<string, unknown>): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `layer` | `Record<string, unknown>` | Yes | 图层配置（id + 绘制器） |

**Returns**: `Promise<CapResult<void>>`

### `removeCustomLayer`

```ts
removeCustomLayer(layerId: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `layerId` | `string` | Yes | 图层 id |

**Returns**: `Promise<CapResult<void>>`

### `addVisualLayer`

```ts
addVisualLayer(layer: Record<string, unknown>): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `layer` | `Record<string, unknown>` | Yes | 图层配置（id + GeoJSON + 样式） |

**Returns**: `Promise<CapResult<void>>`

### `removeVisualLayer`

```ts
removeVisualLayer(layerId: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `layerId` | `string` | Yes | 图层 id |

**Returns**: `Promise<CapResult<void>>`

### `executeVisualLayerCommand`

```ts
executeVisualLayerCommand(command: Record<string, unknown>): Promise<CapResult<string>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `command` | `Record<string, unknown>` | Yes | 指令对象（layerId + command + 参数） |

**Returns**: `Promise<CapResult<string>>`

### `addGroundOverlay`

```ts
addGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `overlay` | `Record<string, unknown>` | Yes | 覆盖物配置（id + 图片 + 边界） |

**Returns**: `Promise<CapResult<void>>`

### `updateGroundOverlay`

```ts
updateGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `overlay` | `Record<string, unknown>` | Yes | 覆盖物配置（含 id） |

**Returns**: `Promise<CapResult<void>>`

### `removeGroundOverlay`

```ts
removeGroundOverlay(overlayId: string): Promise<CapResult<void>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `overlayId` | `string` | Yes | 覆盖物 id |

**Returns**: `Promise<CapResult<void>>`

## Referenced types

### `MapRegion`

C4 地图区域（wx.createMapContext 语义）

| Prop | Type | Doc |
|---|---|---|
| `latitude` | `number` | 中心纬度 |
| `longitude` | `number` | 中心经度 |
| `scale` | `number` | 缩放级别（4-20，越大越细） |

### `MapMarker`

地图标记（wx.Marker 子集）

| Prop | Type | Doc |
|---|---|---|
| `id` | `number` | 标记唯一 id（增删改按 id） |
| `latitude` | `number` | 纬度 |
| `longitude` | `number` | 经度 |
| `title` | `string` | 标题（点按显示） |
| `iconPath` | `string` | 图标路径 |
| `width` | `number` | 图标宽（px） |
| `height` | `number` | 图标高（px） |
| `callout` | `Record<string, unknown>` | 气泡配置 |

### `MapPolyline`

折线

| Prop | Type | Doc |
|---|---|---|
| `points` | `Array<{ latitude: number; longitude: number }>` | 顶点序列 |
| `color` | `string` | 线颜色 |
| `width` | `number` | 线宽（px） |

### `MapCircle`

圆

| Prop | Type | Doc |
|---|---|---|
| `latitude` | `number` | 圆心纬度 |
| `longitude` | `number` | 圆心经度 |
| `radius` | `number` | 半径（m） |
| `color` | `string` | 描边色 |
| `fillColor` | `string` | 填充色 |

## Error codes

| code | Doc |
|---|---|
| `map.unsupported` | Bridge does not provide createMap (useMap unavailable) |
| `map.failed` | wx map region retrieval failed |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge missing createMap → explicit Err degradation (no direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.createMapContext |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit) · prototype mapping — capability bridge not wired |
| Android native | 🟡 | native-android (Jetpack) · prototype mapping — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI) · prototype mapping — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 prototype mapping — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const res = await useMap('map-1')

if (res.ok) {
  const map = res.data
  await map.moveTo(31.2304, 121.4737, 12) // Shanghai, zoom 12
  const region = await map.getRegion()
  if (region.ok) console.log('center:', region.data.latitude, region.data.longitude)
} else if (res.error.code.endsWith('.unsupported')) {
  // map requires host integration → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->