<!-- src/components/p-map/index.vue —— 地图（★权威标尺批 J：ui.map · 对齐小程序 <map>）
     语义：地图容器 + 标记。MP 端原生 <map>（latitude/longitude/markers/scale）+ onXxx 事件；
     Web 端无标准地图 API（需宿主接入高德/Google/Mapbox SDK）→ 宿主槽位（slot 注入）诚实降级。
     ★v-if 双分支：<map>（MP 原生）/ <view>宿主槽位（Web）——两端标签均编译安全。
     地图控制（moveTo/addMarkers…）走 useMap() 能力面（原生 MapContext / 宿主 SDK 集成）。 -->
<template>
  <div class="p-map" :style="wrapStyle">
    <!-- MP 原生地图组件 -->
    <map
      v-if="isMp"
      class="p-map__el"
      :id="mapId"
      :latitude="latitude"
      :longitude="longitude"
      :scale="scale"
      :markers="markers"
      :show-location="showLocation"
      :enable-zoom="enableZoom"
      :enable-scroll="enableScroll"
      @markertap="onMarkerTap"
      @regionchange="onRegionChange"
      @tap="onTap"
    />
    <!-- Web 宿主槽位（接入地图 SDK：高德/Google/Mapbox） -->
    <div v-else :id="mapId" class="p-map__host" :style="hostStyle">
      <slot>
        <span class="p-map__hint">{{ placeholderText }}</span>
      </slot>
    </div>
  </div>
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
  /** 中心纬度（对齐 latitude） */
  latitude: { type: Number, default: 39.908823 },
  /** 中心经度（对齐 longitude） */
  longitude: { type: Number, default: 116.39747 },
  /** 缩放级别（3–20，对齐 scale） */
  scale: { type: Number, default: 16 },
  /** 标记点列表（对齐 markers） */
  markers: { type: Array as () => MapMarkerItem[], default: () => [] },
  /** 是否显示带方向的当前定位点（对齐 show-location） */
  showLocation: { type: Boolean, default: false },
  /** 是否允许缩放（对齐 enable-zoom） */
  enableZoom: { type: Boolean, default: true },
  /** 是否允许拖动（对齐 enable-scroll） */
  enableScroll: { type: Boolean, default: true },
  /** 高度 px（缺省 300） */
  height: { type: Number, default: 300 },
  /** Web 占位文案 */
  placeholderText: { type: String, default: '地图（宿主接入 SDK）' },
})

const emit = defineEmits(['markertap', 'regionchange', 'tap'])

const isMp = isMpRuntime()
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

function onMarkerTap(e: unknown): void {
  emit('markertap', e)
}
function onRegionChange(e: unknown): void {
  emit('regionchange', e)
}
function onTap(e: unknown): void {
  emit('tap', e)
}

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
</style>
