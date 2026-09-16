<!-- packages/components/p-map/index.vue —— 地图（★权威标尺批 J：ui.map · 对齐小程序 <map>）
     语义：地图容器 + 标记/路线/圆/多边形/控件等图层。
     ★端对齐批次3（2026-09-16）：补齐官方 <map> 全量属性（29 项）——缩放族（min/max-scale）、
       图层族（markers/covers/polyline/circles/controls/polygons/include-points）、个性化（subkey/layer-style）、
       视角（rotate/skew）、交互族（show-compass/show-scale/enable-*）与 setting。
       ★注意：markers 等数组的**元素字段**（marker 的 id/title/callout…）属子对象 schema，非组件属性，
       在标尺侧已由生成器按区块剔除（见 gen-mp-component-attrs.mjs）。
     MP 端原生 <map> 承接全部属性；Web 端无标准地图 API（需宿主接入高德/Google/Mapbox SDK）→ 宿主槽位诚实降级。
     ★v-if 双分支：<map>（MP 原生）/ <view>宿主槽位（Web）——两端标签均编译安全。
     地图控制（moveTo/addMarkers…）走 useMap() 能力面（原生 MapContext / 宿主 SDK 集成）。 -->
<template>
  <view class="p-map" :style="wrapStyle">
    <!-- MP 原生地图组件（官方属性全量透传） -->
    <map
      v-if="isMp"
      class="p-map__el"
      :id="mapId"
      :longitude="longitude"
      :latitude="latitude"
      :scale="scale"
      :min-scale="minScale"
      :max-scale="maxScale"
      :markers="markers"
      :covers="covers"
      :polyline="polyline"
      :circles="circles"
      :controls="controls"
      :include-points="includePoints"
      :show-location="showLocation"
      :polygons="polygons"
      :subkey="subkey"
      :layer-style="layerStyle"
      :rotate="rotate"
      :skew="skew"
      :show-compass="showCompass"
      :show-scale="showScale"
      :enable-overlooking="enableOverlooking"
      :enable-auto-max-overlooking="enableAutoMaxOverlooking"
      :enable-zoom="enableZoom"
      :enable-scroll="enableScroll"
      :enable-rotate="enableRotate"
      :enable-satellite="enableSatellite"
      :enable-traffic="enableTraffic"
      :enable-poi="enablePoi"
      :enable-building="enableBuilding"
      :setting="setting"
      @markertap="onMarkerTap"
      @labeltap="onLabelTap"
      @controltap="onControlTap"
      @callouttap="onCalloutTap"
      @updated="onUpdated"
      @regionchange="onRegionChange"
      @poitap="onPoiTap"
      @polylinetap="onPolylineTap"
      @tap="onTap"
      @error="onError"
    />
    <!-- Web 宿主槽位（接入地图 SDK：高德/Google/Mapbox） -->
    <view v-else :id="mapId" class="p-map__host" :style="hostStyle">
      <slot>
        <text class="p-map__hint">{{ placeholderText }}</text>
      </slot>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import { isMpRuntime } from '../runtime/container-measure'

/** 地图标记（wx Marker 子集） */
export interface MapMarkerItem {
  id: number
  latitude: number
  longitude: number
  title?: string
  iconPath?: string
  width?: number
  height?: number
}

const props = defineProps({
  /** 中心纬度（★官方 latitude） */
  latitude: { type: Number, default: 39.908823 },
  /** 中心经度（★官方 longitude） */
  longitude: { type: Number, default: 116.39747 },
  /** 缩放级别（3–20，★官方 scale） */
  scale: { type: Number, default: 16 },
  /** 最小缩放级别（★官方 min-scale） */
  minScale: { type: Number, default: 3 },
  /** 最大缩放级别（★官方 max-scale） */
  maxScale: { type: Number, default: 20 },
  /** 标记点列表（★官方 markers） */
  markers: { type: Array as () => MapMarkerItem[], default: () => [] },
  /** 即将移除的地图封面（★官方 covers，请改用 markers） */
  covers: { type: Array as () => Record<string, unknown>[], default: () => [] },
  /** 路线（★官方 polyline） */
  polyline: { type: Array as () => Record<string, unknown>[], default: () => [] },
  /** 圆（★官方 circles） */
  circles: { type: Array as () => Record<string, unknown>[], default: () => [] },
  /** 控件（★官方 controls，即将废弃，建议 cover-view） */
  controls: { type: Array as () => Record<string, unknown>[], default: () => [] },
  /** 缩放视野以包含所有给定坐标点（★官方 include-points） */
  includePoints: { type: Array as () => Record<string, unknown>[], default: () => [] },
  /** 是否显示带方向的当前定位点（★官方 show-location） */
  showLocation: { type: Boolean, default: false },
  /** 多边形（★官方 polygons） */
  polygons: { type: Array as () => Record<string, unknown>[], default: () => [] },
  /** 个性化地图 key（★官方 subkey；★不支持动态修改） */
  subkey: { type: String, default: '' },
  /** 个性化地图 style（★官方 layer-style，默认 1） */
  layerStyle: { type: Number, default: 1 },
  /** 旋转角度 0–360（★官方 rotate） */
  rotate: { type: Number, default: 0 },
  /** 倾斜角度 0–40（★官方 skew） */
  skew: { type: Number, default: 0 },
  /** 显示指南针（★官方 show-compass） */
  showCompass: { type: Boolean, default: false },
  /** 显示比例尺（★官方 show-scale） */
  showScale: { type: Boolean, default: false },
  /** 开启俯视（★官方 enable-overlooking） */
  enableOverlooking: { type: Boolean, default: false },
  /** 开启最大俯视角 45°→75°（★官方 enable-auto-max-overlooking） */
  enableAutoMaxOverlooking: { type: Boolean, default: false },
  /** 是否允许缩放（★官方 enable-zoom） */
  enableZoom: { type: Boolean, default: true },
  /** 是否允许拖动（★官方 enable-scroll） */
  enableScroll: { type: Boolean, default: true },
  /** 是否允许旋转（★官方 enable-rotate） */
  enableRotate: { type: Boolean, default: false },
  /** 是否开启卫星图（★官方 enable-satellite） */
  enableSatellite: { type: Boolean, default: false },
  /** 是否开启实时路况（★官方 enable-traffic） */
  enableTraffic: { type: Boolean, default: false },
  /** 是否展示 POI 点（★官方 enable-poi） */
  enablePoi: { type: Boolean, default: true },
  /** 是否展示建筑物（★官方 enable-building） */
  enableBuilding: { type: Boolean, default: false },
  /** 地图配置项（★官方 setting） */
  setting: { type: Object as () => Record<string, unknown>, default: () => ({}) },
  /** 高度 px（缺省 300） */
  height: { type: Number, default: 300 },
  /** Web 占位文案 */
  placeholderText: { type: String, default: '地图（宿主接入 SDK）' },
})

// ★事件名与 MP 原生 bind:<name> 对齐（跨端同名契约）
const emit = defineEmits(['markertap', 'labeltap', 'controltap', 'callouttap', 'updated', 'regionchange', 'poitap', 'polylinetap', 'tap', 'error'])

// ★真机 bug 修复（2026-09-12）：computed 使 isMp 进 data（直调会成实例属性，模板读不到 → MP 错走 Web 槽位）
const isMp = computed(() => isMpRuntime())
const mapId = 'p-map-' + Math.random().toString(36).slice(2, 8)

const wrapStyle = computed<CSSProperties>(() => ({ width: '100%', height: props.height + 'px' }))
const hostStyle = computed<CSSProperties>(() => ({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--p-fill-color, rgba(0,0,0,0.03))',
  color: 'var(--p-text-color-3, #86909c)',
  fontSize: '13px',
}))

/** ★载荷归一（跨端裸载荷约定，同 p-scroll-view）：取 e.detail ?? e */
function payload(e: unknown): unknown {
  const p = e as { detail?: unknown }
  return p && typeof p === 'object' && 'detail' in p ? p.detail : e
}
function onMarkerTap(e: unknown): void { emit('markertap', payload(e)) }
function onLabelTap(e: unknown): void { emit('labeltap', payload(e)) }
function onControlTap(e: unknown): void { emit('controltap', payload(e)) }
function onCalloutTap(e: unknown): void { emit('callouttap', payload(e)) }
function onUpdated(e: unknown): void { emit('updated', payload(e)) }
function onRegionChange(e: unknown): void { emit('regionchange', payload(e)) }
function onPoiTap(e: unknown): void { emit('poitap', payload(e)) }
function onPolylineTap(e: unknown): void { emit('polylinetap', payload(e)) }
function onTap(e: unknown): void { emit('tap', payload(e)) }
function onError(e: unknown): void { emit('error', payload(e)) }

defineExpose({ mapId: () => mapId })
</script>

<style scoped>
.p-map {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}
.p-map__el,
.p-map__host {
  width: 100%;
  height: 100%;
  display: block;
}
.p-map__hint {
  font-size: 13px;
}
</style>
