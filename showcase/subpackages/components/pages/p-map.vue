<!-- showcase/subpackages/components/pages/p-map.vue —— p-map 地图 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-map.md ← gen-content.mjs ← packages/components/p-map/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PMap, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-map :latitude=\"39.90\" :longitude=\"116.39\" :scale=\"16\" />",
  marker: "<p-map :markers=\"marker\" @markertap=\"onMarkerTap\" />",
  scale: "<p-map :min-scale=\"5\" :max-scale=\"18\" />",
  view: "<p-map :rotate=\"30\" :skew=\"20\" show-compass show-scale />",
  enable: "<p-map enable-satellite enable-traffic :enable-rotate=\"false\" />",
})

const near = ref('等待 markertap / regionchange 事件…')
function onMarkerTap(e: unknown) { near.value = 'markertap: ' + JSON.stringify(e) }
function onRegionChange(e: unknown) { const d = e as { type?: string }; near.value = 'regionchange: type=' + (d?.type ?? 'unknown') }

// ★字面量直接内联进 ref()（编译器静态求值：标识符初值 → data undefined，见 S33/S57）
const marker = ref([{ id: 1, latitude: 39.908823, longitude: 116.39747, title: '天安门' }])
const line = ref([{ points: [{ latitude: 39.908823, longitude: 116.39747 }, { latitude: 39.918823, longitude: 116.40747 }], color: '#7c5cff', width: 4 }])

const apiRows = ref([
  [
    "latitude",
    "中心纬度（★官方 latitude）",
    "Number"
  ],
  [
    "longitude",
    "中心经度（★官方 longitude）",
    "Number"
  ],
  [
    "scale",
    "缩放级别（3–20，★官方 scale）",
    "Number"
  ],
  [
    "minScale",
    "最小缩放级别（★官方 min-scale）",
    "Number"
  ],
  [
    "maxScale",
    "最大缩放级别（★官方 max-scale）",
    "Number"
  ],
  [
    "markers",
    "标记点列表（★官方 markers）",
    "Array as () => MapMarkerItem[]"
  ],
  [
    "covers",
    "即将移除的地图封面（★官方 covers，请改用 markers）",
    "Array as () => Record<string"
  ],
  [
    "polyline",
    "路线（★官方 polyline）",
    "Array as () => Record<string"
  ],
  [
    "circles",
    "圆（★官方 circles）",
    "Array as () => Record<string"
  ],
  [
    "controls",
    "控件（★官方 controls，即将废弃，建议 cover-view）",
    "Array as () => Record<string"
  ],
  [
    "includePoints",
    "缩放视野以包含所有给定坐标点（★官方 include-points）",
    "Array as () => Record<string"
  ],
  [
    "showLocation",
    "是否显示带方向的当前定位点（★官方 show-location）",
    "Boolean"
  ],
  [
    "polygons",
    "多边形（★官方 polygons）",
    "Array as () => Record<string"
  ],
  [
    "subkey",
    "个性化地图 key（★官方 subkey；★不支持动态修改）",
    "String"
  ],
  [
    "layerStyle",
    "个性化地图 style（★官方 layer-style，默认 1）",
    "Number"
  ],
  [
    "rotate",
    "旋转角度 0–360（★官方 rotate）",
    "Number"
  ],
  [
    "skew",
    "倾斜角度 0–40（★官方 skew）",
    "Number"
  ],
  [
    "showCompass",
    "显示指南针（★官方 show-compass）",
    "Boolean"
  ],
  [
    "showScale",
    "显示比例尺（★官方 show-scale）",
    "Boolean"
  ],
  [
    "enableOverlooking",
    "开启俯视（★官方 enable-overlooking）",
    "Boolean"
  ],
  [
    "enableAutoMaxOverlooking",
    "开启最大俯视角 45°→75°（★官方 enable-auto-max-overlooking）",
    "Boolean"
  ],
  [
    "enableZoom",
    "是否允许缩放（★官方 enable-zoom）",
    "Boolean"
  ],
  [
    "enableScroll",
    "是否允许拖动（★官方 enable-scroll）",
    "Boolean"
  ],
  [
    "enableRotate",
    "是否允许旋转（★官方 enable-rotate）",
    "Boolean"
  ],
  [
    "enableSatellite",
    "是否开启卫星图（★官方 enable-satellite）",
    "Boolean"
  ],
  [
    "enableTraffic",
    "是否开启实时路况（★官方 enable-traffic）",
    "Boolean"
  ],
  [
    "enablePoi",
    "是否展示 POI 点（★官方 enable-poi）",
    "Boolean"
  ],
  [
    "enableBuilding",
    "是否展示建筑物（★官方 enable-building）",
    "Boolean"
  ],
  [
    "setting",
    "地图配置项（★官方 setting）",
    "Object as () => Record<string"
  ],
  [
    "height",
    "高度 px（缺省 300）",
    "Number"
  ],
  [
    "placeholderText",
    "Web 占位文案",
    "String"
  ]
])
const eventRows = ref([
  [
    "markertap",
    "—",
    "—"
  ],
  [
    "labeltap",
    "—",
    "—"
  ],
  [
    "controltap",
    "—",
    "—"
  ],
  [
    "callouttap",
    "—",
    "—"
  ],
  [
    "updated",
    "—",
    "—"
  ],
  [
    "regionchange",
    "—",
    "—"
  ],
  [
    "poitap",
    "—",
    "—"
  ],
  [
    "polylinetap",
    "—",
    "—"
  ],
  [
    "tap",
    "—",
    "—"
  ],
  [
    "error",
    "加载/执行失败",
    "—"
  ]
])
const slotRows = ref([
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ]
])
const compatRows = ref([
  [
    "Web SPA",
    "✅",
    "vue-dom · 双端同源码编译目标（编译期映射 + 事件归一）"
  ],
  [
    "微信小程序",
    "✅",
    "skyline（WebView 降级） · 原生控件映射 → <map>（L1 原语）"
  ],
  [
    "Headless（SSR / 测试）",
    "✅",
    "headless · IR 渲染测试档（工具端）"
  ],
  [
    "iOS 原生",
    "🟡",
    "native-ios（UIKit） · 端原型映射——组件级接线未开始"
  ],
  [
    "Android 原生",
    "🟡",
    "native-android（Jetpack） · 端原型映射——组件级接线未开始"
  ],
  [
    "鸿蒙",
    "🟡",
    "native-harmony（ArkUI） · 端原型映射——组件级接线未开始"
  ],
  [
    "Flutter 混合",
    "🟡",
    "flutter · widget 级映射——组件级未验证"
  ],
  [
    "快应用",
    "⬜",
    "快应用引擎（待定） · 端未开始"
  ]
])
</script>

<template>
  <page-shell title="p-map 地图" subtitle="页面外壳 · 地图容器（MP 原生 / Web 宿主槽位）">
    <demo-block index="01" title="基础地图" desc="latitude / longitude / scale 定位与缩放" :has-output="false" :code="codes.base">
      <template #demo>
        <p-map :latitude="39.908823" :longitude="116.39747" :scale="16" :height="220" />
      </template>
    </demo-block>

    <demo-block index="02" title="标记点与事件" desc="markers 标注；点击标记/拖动视野经事件回显（Web 端需宿主接 SDK 才有交互）" :has-output="true" :code="codes.marker">
      <template #demo>
        <p-map :markers="marker" :height="220" @markertap="onMarkerTap" @regionchange="onRegionChange" />
      </template>
      <template #output>
        <p-text class="out">{{ near }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="缩放范围与路线" desc="min-scale / max-scale 约束缩放；polyline 绘制路线" :has-output="false" :code="codes.scale">
      <template #demo>
        <p-map :min-scale="5" :max-scale="18" :polyline="line" :height="220" />
      </template>
    </demo-block>

    <demo-block index="04" title="视角与指南针" desc="rotate / skew 视角倾斜 + 指南针与比例尺" :has-output="false" :code="codes.view">
      <template #demo>
        <p-map :rotate="30" :skew="20" show-compass show-scale :height="220" />
      </template>
    </demo-block>

    <demo-block index="05" title="图层开关" desc="卫星图 / 路况 / POI / 建筑物等图层启用族" :has-output="false" :code="codes.enable">
      <template #demo>
        <p-view class="wrap">
  <p-map enable-satellite :enable-poi="false" :height="200" />
</p-view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.wrap { display: block; }
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
