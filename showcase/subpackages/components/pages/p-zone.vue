<!-- showcase/subpackages/components/pages/p-zone.vue —— p-zone 容器断点分区 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-zone.md ← gen-content.mjs ← packages/components/p-zone/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PZone } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  zone: "<!-- 按**容器宽度**（非视口）渲染对应命名槽 -->\n<p-zone>\n  <template #sm><p-text>窄：单列</p-text></template>\n  <template #md><p-text>中：两列</p-text></template>\n  <template #lg><p-text>宽：三列</p-text></template>\n</p-zone>",
})

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "designWidth",
    "设计稿宽度（容器断点推导基准；缺省 375）",
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
    "sm",
    "具名插槽",
    "—"
  ],
  [
    "md",
    "具名插槽",
    "—"
  ],
  [
    "lg",
    "具名插槽",
    "—"
  ],
  [
    "xl",
    "具名插槽",
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
  <page-shell title="p-zone 容器断点分区" subtitle="布局原语 · Fluid System S1 · 容器级响应式">
    <demo-block index="01" title="容器断点 → 命名槽（sm / md / lg / xl）" desc="按**容器**宽度（不是视口）选槽渲染——四个槽各写不同内容，当前只渲染命中的那一个；★缩窄模拟器视口可观察切换（窄屏命中 sm）" :has-output="true" :code="codes.zone">
      <template #demo>
        <p-zone class="zone">
            <template #sm><p-text class="zone-slot">窄容器 → sm 槽（单列）</p-text></template>
            <template #md><p-text class="zone-slot">中容器 → md 槽</p-text></template>
            <template #lg><p-text class="zone-slot">宽容器 → lg 槽</p-text></template>
            <template #xl><p-text class="zone-slot">超宽容器 → xl 槽</p-text></template>
          </p-zone>
      </template>
      <template #output>
        <p-text class="out">★容器级（非视口级）响应式：Web 走 ResizeObserver，MP 走 SelectorQuery 运行时测量（容器断点在真机同样生效）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.zone { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); }
.zone-slot { font-weight: 600; }
</style>
