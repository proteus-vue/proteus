<!-- showcase/subpackages/components/pages/p-heading.vue —— p-heading 标题 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-heading.md ← gen-content.mjs ← packages/components/p-heading/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PHeading, PStack, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  levels: "<!-- level 1-6：字号递减 -->\n<p-heading :level=\"1\">一级标题</p-heading>\n<p-heading :level=\"3\">三级标题</p-heading>",
})

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "level",
    "标题级别 1-6（字号递减）",
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
    "skyline（WebView 降级） · 原生控件映射 → <text>（L1 原语）"
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
  <page-shell title="p-heading 标题" subtitle="UI 原语 · ui.heading · 双端同源码">
    <demo-block index="01" title="六个级别（level 1-6）" desc="语义级标题（对齐 h1-h6）——★用 class 表达级别而非动态标签（MP 编译器不支持动态标签名）" :has-output="true" :code="codes.levels">
      <template #demo>
        <p-stack :gap="6">
            <p-heading :level="1">一级 24px</p-heading>
            <p-heading :level="2">二级 20px</p-heading>
            <p-heading :level="3">三级 17px</p-heading>
            <p-heading :level="4">四级 15px</p-heading>
            <p-heading :level="5">五级 13px</p-heading>
            <p-heading :level="6">六级 12px</p-heading>
          </p-stack>
      </template>
      <template #output>
        <p-text class="out">★级别越界自动收敛：level 0 → 1、level 9 → 6（源码 Math.min/max 钳制）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
