<!-- showcase/subpackages/components/pages/p-scroll.vue —— p-scroll 显式滚动容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-scroll.md ← gen-content.mjs ← packages/components/p-scroll/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PScroll, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  y: "<!-- 纵向滚动（默认）+ 分页/下拉刷新/指示器声明 -->\n<p-scroll axis=\"y\" paging refresh indicator>\n  <p-text>内容</p-text>\n</p-scroll>",
  x: "<!-- 横向滚动：axis=\"x\" -->\n<p-scroll axis=\"x\">…</p-scroll>",
})

const apiRows = ref([
  [
    "axis",
    "滚动轴：x 水平 / y 垂直 / both",
    "String"
  ],
  [
    "paging",
    "翻页吸附（能力约束——B2 仅声明）",
    "Boolean"
  ],
  [
    "refresh",
    "下拉刷新（能力约束——B2 仅声明）",
    "Boolean"
  ],
  [
    "indicator",
    "滚动指示器",
    "Boolean"
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
    "skyline（WebView 降级） · 原生控件映射 → <scroll-view>（L1 原语） · <sticky-header>（L2 兼容层） · <sticky-section>（L2 兼容层）"
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
  <page-shell title="p-scroll 显式滚动容器" subtitle="布局 · layout.scroll · 双端同源码">
    <demo-block index="01" title="纵向滚动（axis=&quot;y&quot;）" desc="★真滚动容器：内容超出即滚动；paging 声明分页、refresh 声明下拉刷新、indicator 控制滚动条——★Skyline 下 CSS overflow 无效（平台限制，见组件注释），需用 p-scroll-view" :has-output="false" :code="codes.y">
      <template #demo>
        <p-scroll class="scroll-box" axis="y" indicator>
            <p-text v-for="i in 12" :key="i" class="scroll-line">第 {{ i }} 行内容（超出容器高度即产生滚动）</p-text>
          </p-scroll>
      </template>
    </demo-block>

    <demo-block index="02" title="横向滚动（axis=&quot;x&quot;）" desc="axis=&quot;x&quot; 切换主轴——内容超宽即横向滚动" :has-output="true" :code="codes.x">
      <template #demo>
        <p-scroll class="scroll-box-x" axis="x">
            <p-text v-for="i in 8" :key="i" class="scroll-card">{{ i }}</p-text>
          </p-scroll>
      </template>
      <template #output>
        <p-text class="out">★与 p-scroll-view / p-stack snap 的分工：p-scroll 是「显式滚动容器」，滚动行为需宿主容器有确定高度</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.scroll-box { height: 120px; background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.scroll-line { display: block; padding: 6px 0; border-bottom: 1px solid #eceef2; }
.scroll-box-x { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.scroll-card { display: inline-block; min-width: 64px; background: #dbeafe; border-radius: var(--sp-radius-sm); padding: var(--sp-3); text-align: center; margin-right: var(--sp-2); }
</style>
