<!-- showcase/subpackages/components/pages/p-canvas.vue —— p-canvas 画布 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-canvas.md ← gen-content.mjs ← packages/components/p-canvas/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PCanvas, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  base: "<p-canvas :width=\"240\" :height=\"140\" />",
  id: "<p-canvas canvas-id=\"main-canvas\" :width=\"240\" :height=\"140\" />",
  scroll: "<p-canvas :disable-scroll=\"true\" />",
  dpr: "<p-canvas :resolution=\"2\" :width=\"120\" :height=\"80\" />",
})

const info = ref('canvas-id 已生成；改用 canvas-id 属性可自定义句柄标识')

const apiRows = ref([
  [
    "engine",
    "渲染引擎：2d / webgl / skia（★语义等价官方 <canvas type>；skia 非原生 canvas 类型 → MP 回落 2d）",
    "String"
  ],
  [
    "canvasId",
    "画布唯一标识（★官方 canvas-id：CanvasContext 句柄；缺省按组件实例生成，保证唯一）",
    "String"
  ],
  [
    "disableScroll",
    "画布中移动且有绑定手势事件时禁止页面滚动/下拉刷新（★官方 disable-scroll）",
    "Boolean"
  ],
  [
    "width",
    "CSS 宽 px（0=自适应）",
    "Number"
  ],
  [
    "height",
    "CSS 高 px（0=自适应）",
    "Number"
  ],
  [
    "resolution",
    "分辨率倍率（>1 高清渲染；canvas 内部分辨率 = CSS × 倍率）",
    "Number"
  ]
])
const eventRows = ref([])
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
    "skyline（WebView 降级） · 原生控件映射 → <canvas>（L1 原语） · <snapshot>（L2 兼容层）"
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
  <page-shell title="p-canvas 画布" subtitle="内容基元 · 2d / webgl 上下文 + 高清倍率">
    <demo-block index="01" title="基础画布" desc="engine 缺省 2d；canvas-id 由组件自动生成保证唯一" :has-output="false" :code="codes.base">
      <template #demo>
        <p-canvas :width="240" :height="140" />
      </template>
    </demo-block>

    <demo-block index="02" title="自定义 canvas-id" desc="canvas-id 是绘制上下文的句柄标识（指定后无需再传 type）" :has-output="true" :code="codes.id">
      <template #demo>
        <p-canvas canvas-id="main-canvas" :width="240" :height="140" />
      </template>
      <template #output>
        <p-text class="out">{{ info }}</p-text>
      </template>
    </demo-block>

    <demo-block index="03" title="禁止画布内滚动" desc="disable-scroll：画布中的手势不触发页面滚动/下拉刷新" :has-output="false" :code="codes.scroll">
      <template #demo>
        <p-canvas :disable-scroll="true" :width="240" :height="140" />
      </template>
    </demo-block>

    <demo-block index="04" title="高清倍率" desc="resolution=2 → 内部分辨率翻倍（CSS 尺寸不变，渲染更清晰）" :has-output="false" :code="codes.dpr">
      <template #demo>
        <p-canvas :resolution="2" :width="120" :height="80" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
