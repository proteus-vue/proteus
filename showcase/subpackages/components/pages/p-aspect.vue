<!-- showcase/subpackages/components/pages/p-aspect.vue —— p-aspect 纵横比容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-aspect.md ← gen-content.mjs ← packages/components/p-aspect/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PAspect, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  ratio: "<!-- 16:9（默认）与 1:1 -->\n<p-aspect :ratio=\"16 / 9\"><p-text>16 : 9</p-text></p-aspect>\n<p-aspect :ratio=\"1\"><p-text>1 : 1</p-text></p-aspect>",
  maxw: "<!-- 限制最大宽度 + 1:1 -->\n<p-aspect :ratio=\"1\" :max-width=\"120\"><p-text>1 : 1（≤120px）</p-text></p-aspect>",
})

const apiRows = ref([
  [
    "ratio",
    "宽/高比（如 16/9 = 1.777；默认 1.777）",
    "Number"
  ],
  [
    "maxWidth",
    "最大宽度（px；0 = 不限）",
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
    "skyline（WebView 降级） · Proteus 扩展组件——无小程序对应"
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
  <page-shell title="p-aspect 纵横比容器" subtitle="布局原语 · Fluid System S2 · 双端同源码">
    <demo-block index="01" title="宽高比（ratio）" desc="只声明宽/高比，高度由宽度推导；★Web 走原生 CSS aspect-ratio，Skyline 不支持时降级为 padding-top hack（内容驱动盒高）" :has-output="false" :code="codes.ratio">
      <template #demo>
        <p-aspect class="box" :ratio="16 / 9"><p-text>16 : 9</p-text></p-aspect>
          <p-aspect class="box" :ratio="1"><p-text>1 : 1</p-text></p-aspect>
      </template>
    </demo-block>

    <demo-block index="02" title="限制最大宽度（maxWidth）" desc="maxWidth 给盒宽设上限（0 = 不限）——与 ratio 组合可做定宽比例的媒体位" :has-output="true" :code="codes.maxw">
      <template #demo>
        <p-aspect class="box" :ratio="1" :max-width="120"><p-text>1 : 1（≤120px）</p-text></p-aspect>
      </template>
      <template #output>
        <p-text class="out">★降级可观察：Skyline 无 CSS aspect-ratio → padding-top hack（源码 #500 显式 content-box，否则高度恒 0）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); margin-bottom: var(--sp-2); }
.box > :deep(*) { display: flex; align-items: center; justify-content: center; }
</style>
