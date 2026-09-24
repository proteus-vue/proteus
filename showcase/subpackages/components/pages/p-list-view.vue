<!-- showcase/subpackages/components/pages/p-list-view.vue —— p-list-view 虚拟长列表 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-list-view.md ← gen-content.mjs ← packages/components/p-list-view/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PListView, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- items + itemHeight + height：只渲染可视窗口（含 bufferSize 行缓冲） -->\n<p-list-view :items=\"items\" :item-height=\"44\" :height=\"220\" :buffer-size=\"2\" />",
  full: "<!-- virtual=false → 小列表可选全量渲染（省去切片与占位开销） -->\n<p-list-view :items=\"items\" :virtual=\"false\" :height=\"220\" />",
})

// ★500 条数据，但**只渲染可视窗口内那几行**（虚拟化）——渲染行数由 DOM 实测按钮/门禁验证
const lvItems = ref(Array.from({ length: 500 }, (_, i) => ({ title: '第 ' + (i + 1) + ' 行 · 固定行高 44px' })))
const lvCount = ref('点按钮实测 DOM 里真实渲染了多少行')
function countRendered(): void {
  // ★Web 端数真实 DOM 行数；MP 端无 document → 由真机断言覆盖（不假装测到）
  if (typeof document === 'undefined') {
    lvCount.value = '（MP 端请在真机断言中查看渲染行数）'
    return
  }
  // ★必须**限定在本页第一个列表内**数：页面上还有 virtual=false 的对照列表（500 行），
  //   全局 querySelectorAll('.plv-row') 会把两者相加（实测报出 507），得出误导性结论。
  const firstList = document.querySelectorAll('.p-list-view')[0]
  const n = firstList ? firstList.querySelectorAll('.plv-row').length : 0
  lvCount.value = `数据 ${lvItems.value.length} 条 · 本列表 DOM 实际渲染 ${n} 行（虚拟化只渲染可视窗口）`
}

const apiRows = ref([
  [
    "pid",
    "组件实例标识（调试/观测/测试定位用——D-2 dogfooding 契约）",
    "String"
  ],
  [
    "disabled",
    "禁用态（禁交互 + 弱化视觉；MP 原生 disabled 透传）",
    "Boolean"
  ],
  [
    "ariaLabel",
    "无障碍标签（读屏器朗读文本）",
    "String"
  ],
  [
    "items",
    "数据项数组",
    "Array"
  ],
  [
    "itemHeight",
    "单项高度（px，虚拟窗口计算基准）",
    "Number"
  ],
  [
    "height",
    "高度（px）",
    "Number"
  ],
  [
    "bufferSize",
    "可视区外缓冲行数（平滑滚动的提前量）",
    "Number"
  ],
  [
    "virtual",
    "虚拟化开关（false = 全量渲染，小列表省切片开销）",
    "Boolean"
  ],
  [
    "lazy",
    "懒挂载（首屏不渲染，首次滚动/可见才渲染）",
    "Boolean"
  ],
  [
    "padding",
    "★官方 <list-view> 属性对齐（2026-09-18）：长度 4 的数组，按 top/right/bottom/left 指定内边距",
    "Array"
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
  <page-shell title="p-list-view 虚拟长列表" subtitle="内容与表单 · 虚拟化长列表 · 双端同源码">
    <demo-block index="01" title="500 条数据 → 只渲染可视窗口（virtual 缺省开）" desc="★滚动这个 500 行的列表：DOM 里始终只有可视区那几行（+2 行缓冲），滚动时靠占位块撑高——点按钮**实测**当前 DOM 行数" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button size="small" @click="countRendered">数一数 DOM 实际渲染行数</p-button>
          <p-list-view class="lv-box" :items="lvItems" :item-height="44" :height="220" :buffer-size="2" />
      </template>
      <template #output>
        <p-text class="out">{{ lvCount }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="关掉虚拟化对照（virtual=false）" desc="virtual=false → 500 行全部进 DOM；★上下两块对比同样滚动，DOM 行数差异即虚拟化的实际效果" :has-output="false" :code="codes.full">
      <template #demo>
        <p-list-view class="lv-box" :items="lvItems" :virtual="false" :item-height="44" :height="220" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.lv-box { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); margin-top: var(--sp-2); }
</style>
