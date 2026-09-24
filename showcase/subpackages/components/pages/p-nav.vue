<!-- showcase/subpackages/components/pages/p-nav.vue —— p-nav 导航栏 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-nav.md ← gen-content.mjs ← packages/components/p-nav/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PNav, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- title + left/right 插槽；transparent 透明模式 -->\n<p-nav title=\"页面标题\">\n  <template #left><p-text>返回</p-text></template>\n  <template #right><p-text>更多</p-text></template>\n</p-nav>",
})

const apiRows = ref([
  [
    "title",
    "标题文本（插槽内容优先）",
    "String"
  ],
  [
    "transparent",
    "透明模式（随背景融合）",
    "Boolean"
  ]
])
const eventRows = ref([])
const slotRows = ref([
  [
    "left",
    "具名插槽",
    "—"
  ],
  [
    "default",
    "默认插槽（组件主内容）",
    "—"
  ],
  [
    "right",
    "具名插槽",
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
    "skyline（WebView 降级） · 原生控件映射 → <navigation-bar>（L1 原语）"
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
  <page-shell title="p-nav 导航栏" subtitle="页面外壳 · shell.nav · 双端同源码">
    <demo-block index="01" title="标题 + 左右插槽" desc="声明式导航栏：中间标题居中（插槽内容优先于 title），左右各 64px 最小操作区" :has-output="false" :code="codes.basic">
      <template #demo>
        <p-nav class="nav-demo" title="声明式导航栏">
            <template #left><p-text class="nav-side">← 返回</p-text></template>
            <template #right><p-text class="nav-side">更多 ›</p-text></template>
          </p-nav>
      </template>
    </demo-block>

    <demo-block index="02" title="透明模式（transparent）" desc="transparent 去掉背景与底边——用于与页面背景融合的场景（如沉浸式头图）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-nav class="nav-demo nav-transparent-demo" title="透明导航栏" transparent>
            <template #left><p-text class="nav-side">← 返回</p-text></template>
          </p-nav>
      </template>
      <template #output>
        <p-text class="out">★与 p-tabbar 同属 shell 族：页面框架件由组件声明，不依赖平台原生导航配置</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.nav-demo { border: 1px solid #e5e6eb; border-radius: var(--sp-radius-sm); margin-bottom: var(--sp-2); }
.nav-transparent-demo { background: linear-gradient(135deg, #eef2ff, #f7f8fa); border-style: dashed; }
.nav-side { font-size: 13px; color: #4f6bff; }
</style>
