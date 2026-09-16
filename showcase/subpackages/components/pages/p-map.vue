<!-- showcase/subpackages/components/pages/p-map.vue —— p-map 地图演示
     覆盖：中心点与缩放族（min/max-scale）/ 标记点 / 图层族（polyline / circles / polygons / include-points）/
           视角（rotate / skew）/ 交互族（enable-zoom / scroll / rotate / satellite / traffic / poi）/
           指南针比例尺 / setting。
     ★诚实边界：Web 端无标准地图 API（与 MP 原生 map 不同）——宿主需接入高德/Google/Mapbox SDK，
       本页 Web 端为**宿主槽位占位**（诚实标注，非伪装已渲染地图）；MP 端原生 <map> 承接全部属性。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PMap, PText, PView } from '@proteus-vue/components'

const near = ref('等待 markertap / regionchange 事件…')
function onMarkerTap(e: unknown) { near.value = 'markertap: ' + JSON.stringify(e) }
function onRegionChange(e: unknown) { const d = e as { type?: string }; near.value = 'regionchange: type=' + (d?.type ?? 'unknown') }

// ★字面量直接内联进 ref()（编译器静态求值：标识符初值 → data undefined，见 S33/S57）
const marker = ref([{ id: 1, latitude: 39.908823, longitude: 116.39747, title: '天安门' }])
const line = ref([{ points: [{ latitude: 39.908823, longitude: 116.39747 }, { latitude: 39.918823, longitude: 116.40747 }], color: '#7c5cff', width: 4 }])

const codes = ref({
  base: '<p-map :latitude="39.90" :longitude="116.39" :scale="16" />',
  marker: '<p-map :markers="marker" @markertap="onMarkerTap" />',
  scale: '<p-map :min-scale="5" :max-scale="18" />',
  view: '<p-map :rotate="30" :skew="20" show-compass show-scale />',
  enable: '<p-map enable-satellite enable-traffic :enable-rotate="false" />',
})

const apiRows = ref([
  ['latitude', '中心纬度（★官方 latitude，必填）', 'number'],
  ['longitude', '中心经度（★官方 longitude，必填）', 'number'],
  ['scale', '缩放级别 3–20（★官方 scale）', 'number'],
  ['minScale', '最小缩放级别（★官方 min-scale）', 'number'],
  ['maxScale', '最大缩放级别（★官方 max-scale）', 'number'],
  ['markers', '标记点列表（★官方 markers）', 'array'],
  ['covers', '即将移除的地图封面（★官方 covers，建议改 markers）', 'array'],
  ['polyline', '路线（★官方 polyline）', 'array'],
  ['circles', '圆（★官方 circles）', 'array'],
  ['controls', '控件（★官方 controls，建议改 cover-view）', 'array'],
  ['includePoints', '缩放视野包含所有给定坐标点（★官方 include-points）', 'array'],
  ['polygons', '多边形（★官方 polygons）', 'array'],
  ['showLocation', '显示带方向的当前定位点（★官方 show-location）', 'boolean'],
  ['subkey', '个性化地图 key（★官方 subkey，不支持动态修改）', 'string'],
  ['layerStyle', '个性化地图 style（★官方 layer-style）', 'number'],
  ['rotate', '旋转角度 0–360（★官方 rotate）', 'number'],
  ['skew', '倾斜角度 0–40（★官方 skew）', 'number'],
  ['showCompass', '显示指南针（★官方 show-compass）', 'boolean'],
  ['showScale', '显示比例尺（★官方 show-scale）', 'boolean'],
  ['enableOverlooking', '开启俯视（★官方 enable-overlooking）', 'boolean'],
  ['enableAutoMaxOverlooking', '最大俯视角 45°→75°（★官方 enable-auto-max-overlooking）', 'boolean'],
  ['enableZoom', '允许缩放（★官方 enable-zoom）', 'boolean'],
  ['enableScroll', '允许拖动（★官方 enable-scroll）', 'boolean'],
  ['enableRotate', '允许旋转（★官方 enable-rotate）', 'boolean'],
  ['enableSatellite', '开启卫星图（★官方 enable-satellite）', 'boolean'],
  ['enableTraffic', '开启实时路况（★官方 enable-traffic）', 'boolean'],
  ['enablePoi', '展示 POI 点（★官方 enable-poi）', 'boolean'],
  ['enableBuilding', '展示建筑物（★官方 enable-building）', 'boolean'],
  ['setting', '地图配置项（★官方 setting）', 'object'],
  ['height', '高度 px（框架扩展，默认 300）', 'number'],
  ['placeholderText', 'Web 占位文案（框架扩展，诚实标注宿主需接 SDK）', 'string'],
])
const eventRows = ref([
  ['markertap / labeltap / callouttap', '标记点 / 标签 / 气泡点击（★官方 bind:markertap / labeltap / callouttap）', '{ markerId }'],
  ['controltap', '控件点击（★官方 bind:controltap）', '{ controlId }'],
  ['updated', '地图渲染更新完成（★官方 bind:updated）', 'event'],
  ['regionchange', '视野变化（★官方 bind:regionchange）', 'event'],
  ['poitap / polylinetap', 'POI / 路线点击（★官方 bind:poitap / polylinetap）', '{ longitude, latitude }'],
  ['tap', '点击地图（★官方 bind:tap，含经纬度）', 'event'],
  ['error', '组件错误（★官方 bind:error）', 'event'],
])
const slotRows = ref([['default', 'Web 宿主槽位（接入地图 SDK 后替换占位）', '—']])
</script>

<template>
  <page-shell title="p-map 地图" subtitle="页面外壳 · 地图容器（MP 原生 / Web 宿主槽位）">
    <demo-block index="01" title="基础地图" desc="latitude / longitude / scale 定位与缩放" :code="codes.base">
      <template #demo>
        <p-map :latitude="39.908823" :longitude="116.39747" :scale="16" :height="220" />
      </template>
    </demo-block>

    <demo-block index="02" title="标记点与事件" :has-output="true"
      desc="markers 标注；点击标记/拖动视野经事件回显（Web 端需宿主接 SDK 才有交互）" :code="codes.marker">
      <template #demo>
        <p-map :markers="marker" :height="220" @markertap="onMarkerTap" @regionchange="onRegionChange" />
      </template>
      <template #output><p-text class="out">{{ near }}</p-text></template>
    </demo-block>

    <demo-block index="03" title="缩放范围与路线" desc="min-scale / max-scale 约束缩放；polyline 绘制路线" :code="codes.scale">
      <template #demo>
        <p-map :min-scale="5" :max-scale="18" :polyline="line" :height="220" />
      </template>
    </demo-block>

    <demo-block index="04" title="视角与指南针" desc="rotate / skew 视角倾斜 + 指南针与比例尺" :code="codes.view">
      <template #demo>
        <p-map :rotate="30" :skew="20" show-compass show-scale :height="220" />
      </template>
    </demo-block>

    <demo-block index="05" title="图层开关" desc="卫星图 / 路况 / POI / 建筑物等图层启用族" :code="codes.enable">
      <template #demo>
        <p-view class="wrap">
          <p-map enable-satellite :enable-poi="false" :height="200" />
        </p-view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.wrap { display: block; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
