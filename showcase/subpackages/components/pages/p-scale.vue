<!-- showcase/subpackages/components/pages/p-scale.vue —— p-scale 动态字号 / 密度 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-scale.md ← gen-content.mjs ← packages/components/p-scale/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PScale, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  level: "<!-- 字号级别 0 小 / 1 标准 / 2 大 / 3 特大 -->\n<p-scale :level=\"0\"><p-text>小号</p-text></p-scale>\n<p-scale :level=\"3\"><p-text>特大</p-text></p-scale>",
  density: "<!-- 密度：compact / regular / comfortable -->\n<p-scale density=\"compact\">…</p-scale>\n<p-scale density=\"comfortable\">…</p-scale>",
})

const apiRows = ref([
  [
    "level",
    "字号级别：0 小 / 1 标准 / 2 大 / 3 特大（无障碍档位）",
    "Number"
  ],
  [
    "density",
    "密度：compact（紧凑）/ regular / comfortable（宽松无障碍）",
    "String"
  ],
  [
    "baseSize",
    "基准字号（px）——子项用 em 继承即随缩放",
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
  <page-shell title="p-scale 动态字号 / 密度" subtitle="布局原语 · Fluid System S4 · 无障碍档位">
    <demo-block index="01" title="字号级别（level 0–3）" desc="容器 font-size = base × 级别倍率 × 全局字号缩放（--proteus-font-scale）；★子项用 em 继承即随缩放" :has-output="false" :code="codes.level">
      <template #demo>
        <p-scale class="scale-row" :level="0"><p-text>级别 0（小）· 子项 em 继承</p-text></p-scale>
          <p-scale class="scale-row" :level="1"><p-text>级别 1（标准·默认）</p-text></p-scale>
          <p-scale class="scale-row" :level="2"><p-text>级别 2（大）</p-text></p-scale>
          <p-scale class="scale-row" :level="3"><p-text>级别 3（特大）</p-text></p-scale>
      </template>
    </demo-block>

    <demo-block index="02" title="密度（density）" desc="compact 紧凑 / regular 常规 / comfortable 宽松（无障碍）——影响行高与 --proteus-density-gap 间距 token" :has-output="true" :code="codes.density">
      <template #demo>
        <p-scale class="scale-row" density="compact"><p-text>紧凑密度</p-text></p-scale>
          <p-scale class="scale-row" density="regular"><p-text>常规密度</p-text></p-scale>
          <p-scale class="scale-row" density="comfortable"><p-text>宽松密度（无障碍）</p-text></p-scale>
      </template>
      <template #output>
        <p-text class="out">★宿主可注入 --proteus-font-scale 做系统级字号缩放（折叠屏/平板/用户无障碍设置），组件侧零改动</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.scale-row { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }
</style>
