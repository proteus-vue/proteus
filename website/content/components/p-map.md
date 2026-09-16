---
title: p-map
group: 内容与表单
order: 1014
---

# p-map

地图

> 语义组件（Layer 0）· 域 **内容与表单** · 编译期映射到各端原生控件，业务零平台分支。

| 语义 | 域 | 小程序等价 |
|---|---|---|
| ui.map | 内容与表单 | `<map>`（L1 原语） |

## 兼容进度

| 端 | 兼容 | 说明 |
|---|---|---|
| Web SPA | ✅ | vue-dom · 双端同源码编译目标（编译期映射 + 事件归一） |
| 微信小程序 | ✅ | skyline（WebView 降级） · 原生控件映射 → `<map>`（L1 原语） |
| Headless（SSR / 测试） | ✅ | headless · IR 渲染测试档（工具端） |
| iOS 原生 | 🟡 | native-ios（UIKit） · 端原型映射——组件级接线未开始 |
| Android 原生 | 🟡 | native-android（Jetpack） · 端原型映射——组件级接线未开始 |
| 鸿蒙 | 🟡 | native-harmony（ArkUI） · 端原型映射——组件级接线未开始 |
| Flutter 混合 | 🟡 | flutter · widget 级映射——组件级未验证 |
| 快应用 | ⬜ | 快应用引擎（待定） · 端未开始 |

> 状态口径：✅ 端已落地·本组件可用；🟡 端原型映射·组件级接线未开始；⬜ 端未开始。端架构对照（引擎 / 运行时 / 持久化）见 [端与成熟度](/docs/framework/ends-matrix)。

## Props

| 属性 | 说明 | 类型 | 默认值 | 必填 |
|---|---|---|---|---|
| `latitude` | 中心纬度（★官方 latitude） | `Number` | `39.908823` | 否 |
| `longitude` | 中心经度（★官方 longitude） | `Number` | `116.39747` | 否 |
| `scale` | 缩放级别（3–20，★官方 scale） | `Number` | `16` | 否 |
| `minScale` | 最小缩放级别（★官方 min-scale） | `Number` | `3` | 否 |
| `maxScale` | 最大缩放级别（★官方 max-scale） | `Number` | `20` | 否 |
| `markers` | 标记点列表（★官方 markers） | `Array as () => MapMarkerItem[]` | `() => []` | 否 |
| `covers` | 即将移除的地图封面（★官方 covers，请改用 markers） | `Array as () => Record<string` | `() => []` | 否 |
| `polyline` | 路线（★官方 polyline） | `Array as () => Record<string` | `() => []` | 否 |
| `circles` | 圆（★官方 circles） | `Array as () => Record<string` | `() => []` | 否 |
| `controls` | 控件（★官方 controls，即将废弃，建议 cover-view） | `Array as () => Record<string` | `() => []` | 否 |
| `includePoints` | 缩放视野以包含所有给定坐标点（★官方 include-points） | `Array as () => Record<string` | `() => []` | 否 |
| `showLocation` | 是否显示带方向的当前定位点（★官方 show-location） | `Boolean` | `false` | 否 |
| `polygons` | 多边形（★官方 polygons） | `Array as () => Record<string` | `() => []` | 否 |
| `subkey` | 个性化地图 key（★官方 subkey；★不支持动态修改） | `String` | `''` | 否 |
| `layerStyle` | 个性化地图 style（★官方 layer-style，默认 1） | `Number` | `1` | 否 |
| `rotate` | 旋转角度 0–360（★官方 rotate） | `Number` | `0` | 否 |
| `skew` | 倾斜角度 0–40（★官方 skew） | `Number` | `0` | 否 |
| `showCompass` | 显示指南针（★官方 show-compass） | `Boolean` | `false` | 否 |
| `showScale` | 显示比例尺（★官方 show-scale） | `Boolean` | `false` | 否 |
| `enableOverlooking` | 开启俯视（★官方 enable-overlooking） | `Boolean` | `false` | 否 |
| `enableAutoMaxOverlooking` | 开启最大俯视角 45°→75°（★官方 enable-auto-max-overlooking） | `Boolean` | `false` | 否 |
| `enableZoom` | 是否允许缩放（★官方 enable-zoom） | `Boolean` | `true` | 否 |
| `enableScroll` | 是否允许拖动（★官方 enable-scroll） | `Boolean` | `true` | 否 |
| `enableRotate` | 是否允许旋转（★官方 enable-rotate） | `Boolean` | `false` | 否 |
| `enableSatellite` | 是否开启卫星图（★官方 enable-satellite） | `Boolean` | `false` | 否 |
| `enableTraffic` | 是否开启实时路况（★官方 enable-traffic） | `Boolean` | `false` | 否 |
| `enablePoi` | 是否展示 POI 点（★官方 enable-poi） | `Boolean` | `true` | 否 |
| `enableBuilding` | 是否展示建筑物（★官方 enable-building） | `Boolean` | `false` | 否 |
| `setting` | 地图配置项（★官方 setting） | `Object as () => Record<string` | `() => ({` | 否 |
| `height` | 高度 px（缺省 300） | `Number` | `300` | 否 |
| `placeholderText` | Web 占位文案 | `String` | `'地图（宿主接入 SDK）'` | 否 |

### 属性详解

#### `latitude`

- **类型**：`Number`　**默认值**：`39.908823`　**必填**：否
- **说明**：中心纬度（★官方 latitude）

#### `longitude`

- **类型**：`Number`　**默认值**：`116.39747`　**必填**：否
- **说明**：中心经度（★官方 longitude）

#### `scale`

- **类型**：`Number`　**默认值**：`16`　**必填**：否
- **说明**：缩放级别（3–20，★官方 scale）

#### `minScale`

- **类型**：`Number`　**默认值**：`3`　**必填**：否
- **说明**：最小缩放级别（★官方 min-scale）

#### `maxScale`

- **类型**：`Number`　**默认值**：`20`　**必填**：否
- **说明**：最大缩放级别（★官方 max-scale）

#### `markers`

- **类型**：`Array as () => MapMarkerItem[]`　**默认值**：`() => []`　**必填**：否
- **说明**：标记点列表（★官方 markers）

#### `covers`

- **类型**：`Array as () => Record<string`　**默认值**：`() => []`　**必填**：否
- **说明**：即将移除的地图封面（★官方 covers，请改用 markers）

#### `polyline`

- **类型**：`Array as () => Record<string`　**默认值**：`() => []`　**必填**：否
- **说明**：路线（★官方 polyline）

#### `circles`

- **类型**：`Array as () => Record<string`　**默认值**：`() => []`　**必填**：否
- **说明**：圆（★官方 circles）

#### `controls`

- **类型**：`Array as () => Record<string`　**默认值**：`() => []`　**必填**：否
- **说明**：控件（★官方 controls，即将废弃，建议 cover-view）

#### `includePoints`

- **类型**：`Array as () => Record<string`　**默认值**：`() => []`　**必填**：否
- **说明**：缩放视野以包含所有给定坐标点（★官方 include-points）

#### `showLocation`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否显示带方向的当前定位点（★官方 show-location）

#### `polygons`

- **类型**：`Array as () => Record<string`　**默认值**：`() => []`　**必填**：否
- **说明**：多边形（★官方 polygons）

#### `subkey`

- **类型**：`String`　**默认值**：`''`　**必填**：否
- **说明**：个性化地图 key（★官方 subkey；★不支持动态修改）

#### `layerStyle`

- **类型**：`Number`　**默认值**：`1`　**必填**：否
- **说明**：个性化地图 style（★官方 layer-style，默认 1）

#### `rotate`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：旋转角度 0–360（★官方 rotate）

#### `skew`

- **类型**：`Number`　**默认值**：`0`　**必填**：否
- **说明**：倾斜角度 0–40（★官方 skew）

#### `showCompass`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：显示指南针（★官方 show-compass）

#### `showScale`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：显示比例尺（★官方 show-scale）

#### `enableOverlooking`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：开启俯视（★官方 enable-overlooking）

#### `enableAutoMaxOverlooking`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：开启最大俯视角 45°→75°（★官方 enable-auto-max-overlooking）

#### `enableZoom`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：是否允许缩放（★官方 enable-zoom）

#### `enableScroll`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：是否允许拖动（★官方 enable-scroll）

#### `enableRotate`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否允许旋转（★官方 enable-rotate）

#### `enableSatellite`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否开启卫星图（★官方 enable-satellite）

#### `enableTraffic`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否开启实时路况（★官方 enable-traffic）

#### `enablePoi`

- **类型**：`Boolean`　**默认值**：`true`　**必填**：否
- **说明**：是否展示 POI 点（★官方 enable-poi）

#### `enableBuilding`

- **类型**：`Boolean`　**默认值**：`false`　**必填**：否
- **说明**：是否展示建筑物（★官方 enable-building）

#### `setting`

- **类型**：`Object as () => Record<string`　**默认值**：`() => ({`　**必填**：否
- **说明**：地图配置项（★官方 setting）

#### `height`

- **类型**：`Number`　**默认值**：`300`　**必填**：否
- **说明**：高度 px（缺省 300）

#### `placeholderText`

- **类型**：`String`　**默认值**：`'地图（宿主接入 SDK）'`　**必填**：否
- **说明**：Web 占位文案

## Events

| 事件 | 说明 | 载荷 |
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
| `error` | 加载/执行失败 | — |

### 事件详解

#### `markertap`

- **说明**：—
- **载荷**：无

#### `labeltap`

- **说明**：—
- **载荷**：无

#### `controltap`

- **说明**：—
- **载荷**：无

#### `callouttap`

- **说明**：—
- **载荷**：无

#### `updated`

- **说明**：—
- **载荷**：无

#### `regionchange`

- **说明**：—
- **载荷**：无

#### `poitap`

- **说明**：—
- **载荷**：无

#### `polylinetap`

- **说明**：—
- **载荷**：无

#### `tap`

- **说明**：—
- **载荷**：无

#### `error`

- **说明**：加载/执行失败
- **载荷**：无

## 插槽

| 插槽 | 说明 |
|---|---|
| default | 默认插槽（组件主内容） |

## 实现要点

- 语义：地图容器 + 标记/路线/圆/多边形/控件等图层。
- ★端对齐批次3（2026-09-16）：补齐官方 <map> 全量属性（29 项）——缩放族（min/max-scale）、
- 图层族（markers/covers/polyline/circles/controls/polygons/include-points）、个性化（subkey/layer-style）、
- 视角（rotate/skew）、交互族（show-compass/show-scale/enable-*）与 setting。
- ★注意：markers 等数组的**元素字段**（marker 的 id/title/callout…）属子对象 schema，非组件属性，
- 在标尺侧已由生成器按区块剔除（见 gen-mp-component-attrs.mjs）。
- MP 端原生 <map> 承接全部属性；Web 端无标准地图 API（需宿主接入高德/Google/Mapbox SDK）→ 宿主槽位诚实降级。
- ★v-if 双分支：<map>（MP 原生）/ <view>宿主槽位（Web）——两端标签均编译安全。
- 地图控制（moveTo/addMarkers…）走 useMap() 能力面（原生 MapContext / 宿主 SDK 集成）。

## 用法

```vue
<p-map :latitude="39.908823" :longitude="116.39747" :scale="16">
  <p-text>内容</p-text>
</p-map>
```

<!-- generated by website/scripts/gen-content.mjs · 源码 SSOT：packages/components/p-map/index.vue -->