<!-- showcase/subpackages/components/pages/p-svg.vue —— p-svg 矢量图形 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-svg.md ← gen-content.mjs ← packages/components/p-svg/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSvg, PText, PView } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- path = SVG path d 数据；颜色随 currentColor -->\n<p-svg path=\"M12 2 L22 22 L2 22 Z\" :size=\"32\" color=\"#4f6bff\" />",
})

const apiRows = ref([
  [
    "path",
    "SVG path d 数据（无 fill 语义——随 currentColor）",
    "String"
  ],
  [
    "viewbox",
    "视盒 \"x y w h\"（缺省 0 0 24 24）",
    "String"
  ],
  [
    "size",
    "尺寸 px",
    "Number"
  ],
  [
    "color",
    "颜色",
    "String"
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
  <page-shell title="p-svg 矢量图形" subtitle="UI 原语 · ui.svg · Web-first（MP 走 Skia 映射）">
    <demo-block index="01" title="路径渲染 + 尺寸 / 颜色（path / size / color）" desc="★矢量优先（无位图）：path 的 fill 随 currentColor，颜色由 color 控制；size 同时设定宽高" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-view class="svg-row">
            <p-svg path="M12 2 L22 22 L2 22 Z" :size="32" color="#4f6bff" />
            <p-svg path="M12 2 A10 10 0 1 1 11.99 2 Z" :size="32" color="#07c160" />
            <p-svg path="M4 6 h16 v12 h-16 Z" :size="32" color="#e54d42" />
            <p-svg path="M12 2 L22 22 L2 22 Z" :size="48" color="#7c5cff" />
          </p-view>
      </template>
      <template #output>
        <p-text class="out">★诚实边界：p-svg 当前是 **Web-first**（内联 svg 元素）——MP 端矢量映射走 Skia（后续批次）；需要跨端矢量图形时用 p-icon 或 SVG→image 路线</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.svg-row { display: flex; gap: var(--sp-3); align-items: center; background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-3); }
</style>
