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
| `getRegion` | `getRegion(): Promise<CapResult<MapRegion>>` | 获取当前地图视野（中心经纬 + 缩放级别） |
| `moveTo` | `moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>` | 平移地图中心到指定经纬。 |
| `moveToLocation` | `moveToLocation(): Promise<CapResult<void>>` | 移动到当前定位点 |
| `includePoints` | `includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<CapResult<void>>` | 缩放视野以包含所有给定点。 |
| `translateMarker` | `translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<CapResult<void>>` | 平移指定标记到目标点（带旋转/时长）。 |
| `addMarkers` | `addMarkers(markers: MapMarker[]): Promise<CapResult<void>>` | 添加标记。 |
| `removeMarkers` | `removeMarkers(ids: number[]): Promise<CapResult<void>>` | 移除标记。 |
| `addPolylines` | `addPolylines(polylines: MapPolyline[]): Promise<CapResult<void>>` | 添加折线。 |
| `removePolylines` | `removePolylines(ids: number[]): Promise<CapResult<void>>` | 移除折线。 |
| `addCircles` | `addCircles(circles: MapCircle[]): Promise<CapResult<void>>` | 添加圆。 |
| `removeCircles` | `removeCircles(ids: number[]): Promise<CapResult<void>>` | 移除圆。 |
| `getScale` | `getScale(): Promise<CapResult<number>>` | 获取当前缩放级别 |
| `openMapApp` | `openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<CapResult<void>>` | 打开第三方地图 App 导航（宿主放行才可用）。 |
| `on` | `on(event: 'regionchange' \| 'markerTap' \| 'updated', cb: (payload: unknown) => void): () => void` | 订阅地图事件。 |
| `getCenterLocation` | `getCenterLocation(): Promise<CapResult<{ latitude: number; longitude: number }>>` | 获取地图中心经纬 |
| `getRotate` | `getRotate(): Promise<CapResult<number>>` | 获取地图旋转角（度） |
| `getSkew` | `getSkew(): Promise<CapResult<number>>` | 获取地图倾斜角（度） |
| `fromScreenLocation` | `fromScreenLocation(x: number, y: number): Promise<CapResult<{ latitude: number; longitude: number }>>` | 屏幕坐标 → 经纬度。 |
| `toScreenLocation` | `toScreenLocation(latitude: number, longitude: number): Promise<CapResult<{ x: number; y: number }>>` | 经纬度 → 屏幕坐标。 |
| `setCenterOffset` | `setCenterOffset(offset: { x: number; y: number }): Promise<CapResult<void>>` | 设置地图中心偏移（把中心点从容器中心移开，露出标记）。 |
| `setBoundary` | `setBoundary(boundaries: Array<{ latitude: number; longitude: number }>): Promise<CapResult<void>>` | 限制地图可拖动范围到给定边界多边形。 |
| `moveAlong` | `moveAlong(opt: { path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }): Promise<CapResult<void>>` | 沿路径平滑移动（轨迹回放）。 |
| `addArc` | `addArc(arc: { id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }): Promise<CapResult<void>>` | 添加弧线。 |
| `eraseLines` | `eraseLines(ids: number[]): Promise<CapResult<void>>` | 删除折线（清空指定 id）。 |
| `initMarkerCluster` | `initMarkerCluster(enable: boolean): Promise<CapResult<void>>` | 开启/关闭点聚合。 |
| `setLocMarkerIcon` | `setLocMarkerIcon(iconPath: string): Promise<CapResult<void>>` | 设置定位点图标。 |
| `addCustomLayer` | `addCustomLayer(layer: Record<string, unknown>): Promise<CapResult<void>>` | 添加自定义图层（Canvas 绘制覆盖物）。 |
| `removeCustomLayer` | `removeCustomLayer(layerId: string): Promise<CapResult<void>>` | 移除自定义图层。 |
| `addVisualLayer` | `addVisualLayer(layer: Record<string, unknown>): Promise<CapResult<void>>` | 添加可视化图层（GeoJSON → 样式）。 |
| `removeVisualLayer` | `removeVisualLayer(layerId: string): Promise<CapResult<void>>` | 移除可视化图层。 |
| `executeVisualLayerCommand` | `executeVisualLayerCommand(command: Record<string, unknown>): Promise<CapResult<string>>` | 执行可视化图层指令（增删改要素）。 |
| `addGroundOverlay` | `addGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>` | 添加地面覆盖物（图片贴地）。 |
| `updateGroundOverlay` | `updateGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>` | 更新地面覆盖物。 |
| `removeGroundOverlay` | `removeGroundOverlay(overlayId: string): Promise<CapResult<void>>` | 移除地面覆盖物。 |

#### 方法详解

##### `getRegion`

```ts
getRegion(): Promise<CapResult<MapRegion>>
```

**说明**：获取当前地图视野（中心经纬 + 缩放级别）

**返回值**：`Promise<CapResult<MapRegion>>`

##### `moveTo`

```ts
moveTo(latitude: number, longitude: number, scale?: number): Promise<CapResult<void>>
```

**说明**：平移地图中心到指定经纬。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `latitude` | `number` | 是 | 纬度 |
| `longitude` | `number` | 是 | 经度 |
| `scale` | `number` | 否 | 缩放级别（1-20；缺省不变） |

**返回值**：`Promise<CapResult<void>>`

##### `moveToLocation`

```ts
moveToLocation(): Promise<CapResult<void>>
```

**说明**：移动到当前定位点

**返回值**：`Promise<CapResult<void>>`

##### `includePoints`

```ts
includePoints(points: Array<{ latitude: number; longitude: number }>, padding?: number[]): Promise<CapResult<void>>
```

**说明**：缩放视野以包含所有给定点。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `points` | `Array<{ latitude: number; longitude: number }>` | 是 | 经纬点列表 |
| `padding` | `number[]` | 否 | 边距（[上, 右, 下, 左]，px） |

**返回值**：`Promise<CapResult<void>>`

##### `translateMarker`

```ts
translateMarker(opt: { markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }): Promise<CapResult<void>>
```

**说明**：平移指定标记到目标点（带旋转/时长）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `opt` | `{ markerId: number; destination: { latitude: number; longitude: number }; rotate?: number; duration?: number }` | 否 | markerId 标记 id、destination 目标经纬、rotate 旋转角、duration 动画时长(ms) |

**返回值**：`Promise<CapResult<void>>`

##### `addMarkers`

```ts
addMarkers(markers: MapMarker[]): Promise<CapResult<void>>
```

**说明**：添加标记。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `markers` | `MapMarker[]` | 是 | 标记列表（id 唯一） |

**返回值**：`Promise<CapResult<void>>`

##### `removeMarkers`

```ts
removeMarkers(ids: number[]): Promise<CapResult<void>>
```

**说明**：移除标记。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ids` | `number[]` | 是 | 标记 id 列表 |

**返回值**：`Promise<CapResult<void>>`

##### `addPolylines`

```ts
addPolylines(polylines: MapPolyline[]): Promise<CapResult<void>>
```

**说明**：添加折线。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `polylines` | `MapPolyline[]` | 是 | 折线列表（点序列 + 颜色/宽度） |

**返回值**：`Promise<CapResult<void>>`

##### `removePolylines`

```ts
removePolylines(ids: number[]): Promise<CapResult<void>>
```

**说明**：移除折线。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ids` | `number[]` | 是 | 折线 id 列表 |

**返回值**：`Promise<CapResult<void>>`

##### `addCircles`

```ts
addCircles(circles: MapCircle[]): Promise<CapResult<void>>
```

**说明**：添加圆。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `circles` | `MapCircle[]` | 是 | 圆列表（中心 + 半径 + 颜色） |

**返回值**：`Promise<CapResult<void>>`

##### `removeCircles`

```ts
removeCircles(ids: number[]): Promise<CapResult<void>>
```

**说明**：移除圆。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ids` | `number[]` | 是 | 圆 id 列表 |

**返回值**：`Promise<CapResult<void>>`

##### `getScale`

```ts
getScale(): Promise<CapResult<number>>
```

**说明**：获取当前缩放级别

**返回值**：`Promise<CapResult<number>>`

##### `openMapApp`

```ts
openMapApp(opt: { latitude: number; longitude: number; name?: string }): Promise<CapResult<void>>
```

**说明**：打开第三方地图 App 导航（宿主放行才可用）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `opt` | `{ latitude: number; longitude: number; name?: string }` | 否 | latitude/longitude 目标、name 地点名 |

**返回值**：`Promise<CapResult<void>>`

##### `on`

```ts
on(event: 'regionchange' | 'markerTap' | 'updated', cb: (payload: unknown) => void): () => void
```

**说明**：订阅地图事件。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `event` | `'regionchange' \| 'markerTap' \| 'updated'` | 是 | 事件名（regionchange 视野变化 / markerTap 标记点击 / updated 更新完成） |
| `cb` | `(payload: unknown) => void` | 是 | 事件处理器 |

**返回值**：`() => void`——取消订阅函数

##### `getCenterLocation`

```ts
getCenterLocation(): Promise<CapResult<{ latitude: number; longitude: number }>>
```

**说明**：获取地图中心经纬

**返回值**：`Promise<CapResult<{ latitude: number; longitude: number }>>`

##### `getRotate`

```ts
getRotate(): Promise<CapResult<number>>
```

**说明**：获取地图旋转角（度）

**返回值**：`Promise<CapResult<number>>`

##### `getSkew`

```ts
getSkew(): Promise<CapResult<number>>
```

**说明**：获取地图倾斜角（度）

**返回值**：`Promise<CapResult<number>>`

##### `fromScreenLocation`

```ts
fromScreenLocation(x: number, y: number): Promise<CapResult<{ latitude: number; longitude: number }>>
```

**说明**：屏幕坐标 → 经纬度。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `x` | `number` | 是 | 屏幕 x |
| `y` | `number` | 是 | 屏幕 y |

**返回值**：`Promise<CapResult<{ latitude: number; longitude: number }>>`

##### `toScreenLocation`

```ts
toScreenLocation(latitude: number, longitude: number): Promise<CapResult<{ x: number; y: number }>>
```

**说明**：经纬度 → 屏幕坐标。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `latitude` | `number` | 是 | 纬度 |
| `longitude` | `number` | 是 | 经度 |

**返回值**：`Promise<CapResult<{ x: number; y: number }>>`

##### `setCenterOffset`

```ts
setCenterOffset(offset: { x: number; y: number }): Promise<CapResult<void>>
```

**说明**：设置地图中心偏移（把中心点从容器中心移开，露出标记）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `offset` | `{ x: number; y: number }` | 是 | x/y 偏移量（px） |

**返回值**：`Promise<CapResult<void>>`

##### `setBoundary`

```ts
setBoundary(boundaries: Array<{ latitude: number; longitude: number }>): Promise<CapResult<void>>
```

**说明**：限制地图可拖动范围到给定边界多边形。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `boundaries` | `Array<{ latitude: number; longitude: number }>` | 是 | 边界多边形顶点 |

**返回值**：`Promise<CapResult<void>>`

##### `moveAlong`

```ts
moveAlong(opt: { path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }): Promise<CapResult<void>>
```

**说明**：沿路径平滑移动（轨迹回放）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `opt` | `{ path: Array<{ latitude: number; longitude: number }>; duration?: number; autoRotate?: boolean }` | 否 | path 路径点、duration 总时长(ms)、autoRotate 是否自动转向 |

**返回值**：`Promise<CapResult<void>>`

##### `addArc`

```ts
addArc(arc: { id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }): Promise<CapResult<void>>
```

**说明**：添加弧线。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `arc` | `{ id: number; start: { latitude: number; longitude: number }; end: { latitude: number; longitude: number }; color?: string; width?: number }` | 否 | id / start 起点 / end 终点 / color / width |

**返回值**：`Promise<CapResult<void>>`

##### `eraseLines`

```ts
eraseLines(ids: number[]): Promise<CapResult<void>>
```

**说明**：删除折线（清空指定 id）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ids` | `number[]` | 是 | 折线 id 列表 |

**返回值**：`Promise<CapResult<void>>`

##### `initMarkerCluster`

```ts
initMarkerCluster(enable: boolean): Promise<CapResult<void>>
```

**说明**：开启/关闭点聚合。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `enable` | `boolean` | 是 | 是否启用 |

**返回值**：`Promise<CapResult<void>>`

##### `setLocMarkerIcon`

```ts
setLocMarkerIcon(iconPath: string): Promise<CapResult<void>>
```

**说明**：设置定位点图标。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `iconPath` | `string` | 是 | 图标路径 |

**返回值**：`Promise<CapResult<void>>`

##### `addCustomLayer`

```ts
addCustomLayer(layer: Record<string, unknown>): Promise<CapResult<void>>
```

**说明**：添加自定义图层（Canvas 绘制覆盖物）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `layer` | `Record<string, unknown>` | 是 | 图层配置（id + 绘制器） |

**返回值**：`Promise<CapResult<void>>`

##### `removeCustomLayer`

```ts
removeCustomLayer(layerId: string): Promise<CapResult<void>>
```

**说明**：移除自定义图层。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `layerId` | `string` | 是 | 图层 id |

**返回值**：`Promise<CapResult<void>>`

##### `addVisualLayer`

```ts
addVisualLayer(layer: Record<string, unknown>): Promise<CapResult<void>>
```

**说明**：添加可视化图层（GeoJSON → 样式）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `layer` | `Record<string, unknown>` | 是 | 图层配置（id + GeoJSON + 样式） |

**返回值**：`Promise<CapResult<void>>`

##### `removeVisualLayer`

```ts
removeVisualLayer(layerId: string): Promise<CapResult<void>>
```

**说明**：移除可视化图层。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `layerId` | `string` | 是 | 图层 id |

**返回值**：`Promise<CapResult<void>>`

##### `executeVisualLayerCommand`

```ts
executeVisualLayerCommand(command: Record<string, unknown>): Promise<CapResult<string>>
```

**说明**：执行可视化图层指令（增删改要素）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `command` | `Record<string, unknown>` | 是 | 指令对象（layerId + command + 参数） |

**返回值**：`Promise<CapResult<string>>`

##### `addGroundOverlay`

```ts
addGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>
```

**说明**：添加地面覆盖物（图片贴地）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `overlay` | `Record<string, unknown>` | 是 | 覆盖物配置（id + 图片 + 边界） |

**返回值**：`Promise<CapResult<void>>`

##### `updateGroundOverlay`

```ts
updateGroundOverlay(overlay: Record<string, unknown>): Promise<CapResult<void>>
```

**说明**：更新地面覆盖物。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `overlay` | `Record<string, unknown>` | 是 | 覆盖物配置（含 id） |

**返回值**：`Promise<CapResult<void>>`

##### `removeGroundOverlay`

```ts
removeGroundOverlay(overlayId: string): Promise<CapResult<void>>
```

**说明**：移除地面覆盖物。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `overlayId` | `string` | 是 | 覆盖物 id |

**返回值**：`Promise<CapResult<void>>`

#### 类型引用

**`MapRegion`** — C4 地图区域（wx.createMapContext 语义）

| 属性/方法 | 类型 | 说明 |
|---|---|---|
| `latitude` | `number` | 中心纬度 |
| `longitude` | `number` | 中心经度 |
| `scale` | `number` | 缩放级别（4-20，越大越细） |

**`MapMarker`** — 地图标记（wx.Marker 子集）

| 属性/方法 | 类型 | 说明 |
|---|---|---|
| `id` | `number` | 标记唯一 id（增删改按 id） |
| `latitude` | `number` | 纬度 |
| `longitude` | `number` | 经度 |
| `title` | `string` | 标题（点按显示） |
| `iconPath` | `string` | 图标路径 |
| `width` | `number` | 图标宽（px） |
| `height` | `number` | 图标高（px） |
| `callout` | `Record<string, unknown>` | 气泡配置 |

**`MapPolyline`** — 折线

| 属性/方法 | 类型 | 说明 |
|---|---|---|
| `points` | `Array<{ latitude: number; longitude: number }>` | 顶点序列 |
| `color` | `string` | 线颜色 |
| `width` | `number` | 线宽（px） |

**`MapCircle`** — 圆

| 属性/方法 | 类型 | 说明 |
|---|---|---|
| `latitude` | `number` | 圆心纬度 |
| `longitude` | `number` | 圆心经度 |
| `radius` | `number` | 半径（m） |
| `color` | `string` | 描边色 |
| `fillColor` | `string` | 填充色 |

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