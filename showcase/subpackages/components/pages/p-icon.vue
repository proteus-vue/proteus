<!-- showcase/subpackages/components/pages/p-icon.vue —— p-icon 图标 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-icon.md ← gen-content.mjs ← packages/components/p-icon/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PIcon, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  types: "<p-icon type=\"success\" /><p-icon type=\"info\" /><p-icon type=\"warn\" /><p-icon type=\"waiting\" />",
  size: "<p-icon name=\"star\" :size=\"24\" color=\"#ffc300\" />",
  spin: "<p-icon name=\"waiting\" :spin=\"true\" />",
})

const apiRows = ref([
  [
    "name",
    "图标名（内置字形表；未知 → '?'）。框架名，优先于官方 type",
    "String"
  ],
  [
    "type",
    "★官方 <icon> type（success/info/warn/waiting/cancel/download/clear…）——name 的官方别名",
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
  ],
  [
    "spin",
    "旋转动画",
    "Boolean"
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
    "skyline（WebView 降级） · 原生控件映射 → <icon>（L1 原语）"
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
  <page-shell title="p-icon 图标" subtitle="内容基元 · 内置矢量字形，零资源">
    <demo-block index="01" title="官方 type 取值" desc="对齐官方 <icon> 的 type 语义（success/info/warn/waiting…）" :has-output="false" :code="codes.types">
      <template #demo>
        <view class="row">
  <p-icon type="success" />
  <p-icon type="success_no_circle" />
  <p-icon type="info" />
  <p-icon type="warn" />
  <p-icon type="waiting" />
  <p-icon type="cancel" />
  <p-icon type="download" />
  <p-icon type="clear" />
</view>
      </template>
    </demo-block>

    <demo-block index="02" title="尺寸与颜色" desc="size 控制字号与盒尺寸；color 同 CSS color" :has-output="false" :code="codes.size">
      <template #demo>
        <view class="row">
  <p-icon name="star" :size="16" color="#ffc300" />
  <p-icon name="star" :size="24" color="#ffc300" />
  <p-icon name="heart" :size="24" color="#ef4d4d" />
  <p-icon name="search" :size="24" color="#1a7af8" />
</view>
      </template>
    </demo-block>

    <demo-block index="03" title="旋转与常用名" desc="spin 旋转（加载态）；name 走框架字形表" :has-output="false" :code="codes.spin">
      <template #demo>
        <view class="row">
  <p-icon name="back" :size="20" />
  <p-icon name="more" :size="20" />
  <p-icon name="home" :size="20" />
  <p-icon name="user" :size="20" />
  <p-icon name="waiting" :size="20" :spin="true" />
</view>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-4); flex-wrap: wrap; }
</style>
