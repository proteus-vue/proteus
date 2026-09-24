<!-- showcase/subpackages/components/pages/p-page.vue —— p-page 页面根容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-page.md ← gen-content.mjs ← packages/components/p-page/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PPage, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 页面根容器：statusBar 顶部避让 / pullRefresh 下拉刷新 -->\n<p-page title=\"标题\" status-bar pull-refresh>\n  <p-text>页面内容</p-text>\n</p-page>",
})

const apiRows = ref([
  [
    "title",
    "页面标题（导航栏/文档标题语义声明）",
    "String"
  ],
  [
    "statusBar",
    "沉浸式状态栏（内容延伸至状态栏区域）",
    "Boolean"
  ],
  [
    "pullRefresh",
    "下拉刷新（页面级滚动接入批次使用）",
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
    "skyline（WebView 降级） · 原生控件映射 → <page-container>（L1 原语） · <page-meta>（L2 兼容层）"
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
  <page-shell title="p-page 页面根容器" subtitle="页面外壳 · shell.page · 双端同源码">
    <demo-block index="01" title="基础容器 + statusBar 避让" desc="页面根容器（默认无样式，仅提供页面级语义与扩展点）；statusBar 开启顶部状态栏避让" :has-output="false" :code="codes.basic">
      <template #demo>
        <p-page class="page-demo" status-bar>
            <p-text>页面内容（statusBar 已开启顶部避让）</p-text>
          </p-page>
      </template>
    </demo-block>

    <demo-block index="02" title="下拉刷新开关（pullRefresh）" desc="pullRefresh 声明式开启下拉刷新（由宿主/页面装配接线；组件只声明意图，不直调平台 API）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-page class="page-demo" pull-refresh>
            <p-text>页面内容（pullRefresh 已声明）</p-text>
          </p-page>
      </template>
      <template #output>
        <p-text class="out">★页面框架件的分工：p-page 提供根语义，p-nav/p-tabbar 提供栏位，p-safe 提供安全区——三者组合即完整页面骨架</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.page-demo { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }
</style>
