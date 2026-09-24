<!-- showcase/subpackages/components/pages/p-fit.vue —— p-fit 内在尺寸 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-fit.md ← gen-content.mjs ← packages/components/p-fit/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PFit, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  fit: "<!-- 宽度由内容决定，但不超过容器 maxRatio（默认 0.8 = 80%） -->\n<p-fit><p-text>短</p-text></p-fit>\n<p-fit :max-ratio=\"0.8\"><p-text>很长很长…</p-text></p-fit>",
})

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "maxRatio",
    "最大占容器比例（0-1；默认 0.8）——防动态内容撑爆容器",
    "Number"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "---",
    "---",
    "—"
  ],
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ]
])
const compatRows = ref([
  [
    "---",
    "---",
    "---"
  ],
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
  <page-shell title="p-fit 内在尺寸" subtitle="布局原语 · Fluid System B3 · 双端同源码">
    <demo-block index="01" title="内容驱动宽度 + 上限（maxRatio）" desc="宽度 fit-content（随内容），maxRatio 防止动态内容撑爆容器——★第二行的长文本被 80% 上限截断换行" :has-output="true" :code="codes.fit">
      <template #demo>
        <p-fit class="fit-box"><p-text>短内容</p-text></p-fit>
          <p-fit class="fit-box"><p-text>很长很长很长很长很长很长很长很长很长的文本内容，用来观察 80% 上限生效</p-text></p-fit>
      </template>
      <template #output>
        <p-text class="out">★Skyline 无 fit-content → width 走 auto（内容驱动天然），maxWidth 上限仍生效</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.fit-box { background: #fff7ed; border: 1px solid #fed7aa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }
</style>
