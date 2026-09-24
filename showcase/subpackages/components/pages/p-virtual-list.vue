<!-- showcase/subpackages/components/pages/p-virtual-list.vue —— p-virtual-list 虚拟化长列表（语义别名） 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-virtual-list.md ← gen-content.mjs ← packages/components/p-virtual-list/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PVirtualList } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 与 p-list-view 同一实现（薄转发层，API 表面 items/itemHeight/height） -->\n<p-virtual-list :items=\"items\" :item-height=\"44\" :height=\"220\" />",
})

const vlItems = ref(Array.from({ length: 500 }, (_, i) => ({ title: '第 ' + (i + 1) + ' 行（p-virtual-list）' })))
const vlLog = ref('滚动列表看看（窗口跨行时才更新）')
function onVlScroll(): void {
  vlLog.value = '滚动事件 ' + Date.now().toString().slice(-4)
}

const apiRows = ref([
  [
    "items",
    "列表数据（渲染 item 数组）",
    "Array as () => unknown[]"
  ],
  [
    "itemHeight",
    "固定行高 px（虚拟化前提）",
    "Number"
  ],
  [
    "height",
    "可视区高度 px",
    "Number"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "—",
    "无插槽",
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
    "skyline（WebView 降级） · 原生控件映射 → <scroll-view>（L1 原语） · <list-view>（L1 原语） · <grid-view>（L1 原语）"
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
  <page-shell title="p-virtual-list 虚拟化长列表（语义别名）" subtitle="布局 · layout.virtual-list · 转发 p-list-view 单实现">
    <demo-block index="01" title="与 p-list-view 同机制（语义命名版）" desc="★G-32 语义命名为 p-virtual-list；旧标签 virtual-list 兼容保留。它与 p-list-view 是**同一实现**（转发层），不存在第二套虚拟化代码" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-virtual-list class="vl-box" :items="vlItems" :item-height="44" :height="200" :buffer-size="2" />
      </template>
      <template #output>
        <p-text class="out">★诚实说明：本页与 p-list-view 共用实现——页面价值在记录「两个标签同一个实现」这件事，避免后人误以为有两套虚拟化</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.vl-box { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); }
</style>
