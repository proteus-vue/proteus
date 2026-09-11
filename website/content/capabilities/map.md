---
title: useMap（capability.map）
group: 位置与地图
order: 3002
---

# useMap

useMap：地图上下文句柄（wx.createMapContext / web 宿主集成；无 → Err）

> 能力原语 C4 · `capability.map` · 返回 `MapController` · **Hook 已实现**（API 就绪，双端桥见下表）

## 签名

```ts
useMap(id: string): Promise<CapResult<MapController>>
```

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | 是 | 地图实例 ID（多地图场景区分） |

## 返回值

`Promise<CapResult<T>>`——铁律：无回调、无 try/catch 义务，`res.ok` 分支处理：

| 属性 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 成功 `true` / 失败 `false` |
| `data` | `MapController` | 成功载荷（方法结构见下） |
| `error` | `CapError` | 失败时存在：`code`（机器码）/ `message`（人读原因）/ `cause`（原始异常） |

#### `data`（`MapController`）的方法

| 方法 | 签名 | 说明 |
|---|---|---|
| `getRegion` | `getRegion(): Promise<CapResult<MapRegion>>` | — |
| `moveTo` | `moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>` | — |
| `moveToLocation` | `moveToLocation(): Promise<CapResult<void>>` | 移动到当前定位点 |
| `includePoints` | `includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<CapResult<void>>` | 缩放视野以包含所有点 |
| `translateMarker` | `translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<CapResult<void>>` | 平移（相对当前中心，单位 px 或度数） |
| `addMarkers` | `addMarkers(markers: MapMarker[]): Promise<CapResult<void>>` | 添加/移除标记 |
| `removeMarkers` | `removeMarkers(ids: number[]): Promise<CapResult<void>>` | — |
| `addPolylines` | `addPolylines(polylines: MapPolyline[]): Promise<CapResult<void>>` | 折线 / 圆 |
| `removePolylines` | `removePolylines(ids: number[]): Promise<CapResult<void>>` | — |
| `addCircles` | `addCircles(circles: MapCircle[]): Promise<CapResult<void>>` | — |
| `removeCircles` | `removeCircles(ids: number[]): Promise<CapResult<void>>` | — |
| `getScale` | `getScale(): Promise<CapResult<number>>` | 获取缩放级别 / 旋转角 |
| `openMapApp` | `openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<CapResult<void>>` | 打开地图 App（导航，宿主放行才可用） |
| `on` | `on(event: 'regionchange' \| 'markerTap' \| 'updated', cb: (payload: unknown) => void): () => void` | 订阅地图事件（regionchange/updated 等；返回取消） |
| `getCenterLocation` | `getCenterLocation(): Promise<CapResult<{ latitude: number; longitude: number }>>` | — |
| `getRotate` | `getRotate(): Promise<CapResult<number>>` | — |
| `getSkew` | `getSkew(): Promise<CapResult<number>>` | — |
| `fromScreenLocation` | `fromScreenLocation(x: number, y: number): Promise<CapResult<{ latitude: number; longitude: number }>>` | 坐标转换：屏幕 ↔ 经纬 |
| `toScreenLocation` | `toScreenLocation(latitude: number, longitude: number): Promise<CapResult<{ x: number; y: number }>>` | — |
| `setCenterOffset` | `setCenterOffset(offset: { x: number; y: number }): Promise<CapResult<void>>` | — |
| `setBoundary` | `setBoundary(boundaries: Array<{ latitude: number; longitude: number }>): Promise<CapResult<void>>` | — |
| `moveAlong` | `moveAlong(opt: { path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }): Promise<CapResult<void>>` | — |
| `addArc` | `addArc(arc: { id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }): Promise<CapResult<void>>` | — |
| `eraseLines` | `eraseLines(ids: number[]): Promise<CapResult<void>>` | — |
| `initMarkerCluster` | `initMarkerCluster(enable: boolean): Promise<CapResult<void>>` | — |
| `setLocMarkerIcon` | `setLocMarkerIcon(iconPath: string): Promise<CapResult<void>>` | — |
| `addCustomLayer` | `addCustomLayer(layer: Record<string, unknown>): Promise<CapResult<void>>` | — |
| `removeCustomLayer` | `removeCustomLayer(layerId: string): Promise<CapResult<void>>` | — |
| `addVisualLayer` | `addVisualLayer(layer: Record<string, unknown>): Promise<CapResult<void>>` | — |
| `removeVisualLayer` | `removeVisualLayer(layerId: string): Promise<CapResult<void>>` | — |
| `executeVisualLayerCommand` | `executeVisualLayerCommand(command: Record<string, unknown>): Promise<CapResult<string>>` | — |
| `addGroundOverlay` | `addGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>` | — |
| `updateGroundOverlay` | `updateGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>` | — |
| `removeGroundOverlay` | `removeGroundOverlay(overlayId: string): Promise<CapResult<void>>` | — |

## 错误码

| code | 说明 |
|---|---|
| `map.unsupported` | 桥未提供 createMap（useMap 不可用） |
| `map.failed` | wx 地图  |

> 平台不支持 → `*.unsupported` 族；业务按 code 分支处理，无需 try/catch。

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ⚠️ | vue-dom · webBridge 未提供 createMap → Err 显式降级（平台无直通 API） |
| 微信小程序 | ✅ | skyline（WebView 降级） · wx 桥 → wx.createMapContext |
| Headless（SSR / 测试） | ✅ | headless · mock 桥注入（测试 / SSR 档） |
| iOS 原生 | 🟡 | native-ios（UIKit） · 端原型映射——能力桥未接线 |
| Android 原生 | 🟡 | native-android（Jetpack） · 端原型映射——能力桥未接线 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · 端原型映射——能力桥未接线 |
| Flutter 混合 | 🟡 | flutter · 同一 JS 逻辑层——能力桥未接线 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本能力可用；⚠️ 端已落地·桥未提供→Err 显式降级；🟡 端原型映射·能力桥未接线；⬜ 端未开始。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

> 铁律：能力原语全部返回 `Result<T>`（无回调 / 无全局对象）；平台不支持 → `Err` 显式降级，业务零平台分支。

## 用法

```ts
const res = await useMap('map-1')

if (res.ok) {
  const map = res.data
  await map.moveTo(31.2304, 121.4737, 12) // 上海人民广场，缩放 12
  const region = await map.getRegion()
  if (region.ok) console.log('中心:', region.data.latitude, region.data.longitude)
} else if (res.error.code.endsWith('.unsupported')) {
  // 地图需宿主集成 → 降级路径
}
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->