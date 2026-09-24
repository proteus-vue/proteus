<!-- showcase/subpackages/components/pages/p-adaptive.vue —— p-adaptive 容器形态自适应 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-adaptive.md ← gen-content.mjs ← packages/components/p-adaptive/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PAdaptive, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- modes: 形态区间声明（sheet / dialog / popover 按宽度切换） -->\n<p-adaptive modes=\"sheet(0, 600) | dialog(600, 840)\">\n  <p-text>内容</p-text>\n</p-adaptive>",
})

const apiRows = ref([
  [
    "modes",
    "形态区间表达式：sheet(0, 600) | dialog(600, 840) | popover(840, ∞)",
    "String"
  ],
  [
    "visible",
    "形态层是否渲染（false → 不渲染）",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "update:visible",
    "v-model 双向绑定：visible变化时触发（同步父级绑定）",
    "—"
  ],
  [
    "formChange",
    "表单项变化",
    "s.form"
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
  <page-shell title="p-adaptive 容器形态自适应" subtitle="布局 · 形态区间声明 · 双端同源码">
    <demo-block index="01" title="形态区间（modes）——同 p-modal 的形态求解" desc="★按**容器宽度**求解形态区间（sheet(0,600) / dialog(600,840) / popover(840+)）；当前窄容器应命中 sheet 形态；★改 modes 可自定义区间" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-adaptive class="ad-box" modes="sheet(0, 600) | dialog(600, 840) | popover(840, 9999)">
            <p-text>当前形态由容器宽度决定（窄容器 → sheet）</p-text>
          </p-adaptive>
      </template>
      <template #output>
        <p-text class="out">★p-modal 的 pAdaptive 属性与之一脉相承：同一套「形态区间声明」语义，弹窗只是它的一个消费者</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.ad-box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); }
</style>
