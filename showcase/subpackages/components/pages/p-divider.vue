<!-- showcase/subpackages/components/pages/p-divider.vue —— p-divider 分隔线 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-divider.md ← gen-content.mjs ← packages/components/p-divider/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PDivider, PStack, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  h: "<!-- 水平分隔线（默认） -->\n<p-divider />\n<!-- 带内缩 -->\n<p-divider :inset=\"12\" />",
  v: "<!-- 垂直分隔线：左右内缩 -->\n<p-divider orientation=\"vertical\" :inset=\"8\" />",
})

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "orientation",
    "方向：horizontal 水平 / vertical 垂直",
    "String"
  ],
  [
    "inset",
    "内缩距离 px（水平=上下外边距；垂直=左右外边距）",
    "Number"
  ],
  [
    "color",
    "线色（缺省随主题变量）",
    "String"
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
  <page-shell title="p-divider 分隔线" subtitle="布局原语 · layout.divider · 双端同源码">
    <demo-block index="01" title="水平分隔（含 inset 内缩）" desc="inset 为上下外边距——拉开与上下内容的距离" :has-output="false" :code="codes.h">
      <template #demo>
        <p-text>上方内容</p-text>
          <p-divider />
          <p-text>默认分隔（inset 0）</p-text>
          <p-divider :inset="12" />
          <p-text>下方内容（分隔线上下各留 12px）</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="垂直分隔（行内）" desc="orientation=&quot;vertical&quot; → 高度 100%、左右 inset；用于行内元素之间" :has-output="false" :code="codes.v">
      <template #demo>
        <p-stack direction="row" align="center" class="row-demo">
            <p-text>首页</p-text>
            <p-divider orientation="vertical" :inset="8" />
            <p-text>分类</p-text>
            <p-divider orientation="vertical" :inset="8" />
            <p-text>我的</p-text>
          </p-stack>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.row-demo { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
</style>
