<!-- showcase/subpackages/components/pages/p-grid.vue —— p-grid 自适应网格 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-grid.md ← gen-content.mjs ← packages/components/p-grid/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PGrid, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  grid: "<!-- 只声明「每列最小宽度」，列数自动求解 -->\n<p-grid :min-col-width=\"120\" :gap=\"12\">\n  <p-text>1</p-text>\n  <p-text>2</p-text>\n</p-grid>",
})

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "minColWidth",
    "每列最小宽度（px）——列数自动求解",
    "Number"
  ],
  [
    "gap",
    "列间距（px）",
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
    "skyline（WebView 降级） · 原生控件映射 → <grid-view>（L1 原语）"
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
  <page-shell title="p-grid 自适应网格" subtitle="布局原语 · layout.grid · Web-only（MP 走语义编译）">
    <demo-block index="01" title="自适应列数（minColWidth）" desc="Web = CSS Grid repeat(auto-fill, minmax(minColWidth, 1fr))——**拖宽窗口看列数变化**；★MP 端已走语义编译（flex 档位 + px basis），本组件是 Web-only" :has-output="true" :code="codes.grid">
      <template #demo>
        <p-grid :min-col-width="110" :gap="10">
            <p-text v-for="i in 8" :key="i" class="cell">{{ i }}</p-text>
          </p-grid>
      </template>
      <template #output>
        <p-text class="out">列数 = floor(容器宽 / minColWidth)——★拖宽/缩窄模拟器视口可看到列数自适应</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.cell { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: var(--sp-3); text-align: center; }
</style>
