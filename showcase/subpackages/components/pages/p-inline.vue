<!-- showcase/subpackages/components/pages/p-inline.vue —— p-inline 行内容器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-inline.md ← gen-content.mjs ← packages/components/p-inline/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PInline, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  wrap: "<!-- 不折行（默认） vs 允许折行 -->\n<p-inline :gap=\"8\"><p-text>一</p-text><p-text>二</p-text></p-inline>\n<p-inline :gap=\"8\" wrap>…</p-inline>",
  align: "<!-- 主轴/交叉轴对齐 -->\n<p-inline :gap=\"8\" justify=\"space-between\" align=\"center\">…</p-inline>",
})

const apiRows = ref([
  [
    "wrap",
    "允许折行（默认不折行）",
    "Boolean"
  ],
  [
    "gap",
    "元素间距 px",
    "Number"
  ],
  [
    "justify",
    "主轴对齐（flex-start/center/end/space-between/space-around）",
    "String"
  ],
  [
    "align",
    "交叉轴对齐（flex-start/center/end/stretch）",
    "String"
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
  <page-shell title="p-inline 行内容器" subtitle="布局原语 · layout.inline · 双端同源码">
    <demo-block index="01" title="折行开关（wrap）+ 间距（gap）" desc="行内盒语义（对齐 CSS inline-flex）；wrap 开启后内容超宽自动折行——★对比上下两块" :has-output="false" :code="codes.wrap">
      <template #demo>
        <p-inline class="row" :gap="6">
            <p-text class="chip">1</p-text><p-text class="chip">2</p-text><p-text class="chip">3</p-text>
            <p-text class="chip">4</p-text><p-text class="chip">5</p-text><p-text class="chip">6</p-text>
            <p-text class="chip">7</p-text><p-text class="chip">8</p-text><p-text class="chip">9</p-text>
          </p-inline>
          <p-inline class="row" :gap="6" wrap>
            <p-text class="chip">1</p-text><p-text class="chip">2</p-text><p-text class="chip">3</p-text>
            <p-text class="chip">4</p-text><p-text class="chip">5</p-text><p-text class="chip">6</p-text>
            <p-text class="chip">7</p-text><p-text class="chip">8</p-text><p-text class="chip">9</p-text>
          </p-inline>
      </template>
    </demo-block>

    <demo-block index="02" title="对齐（justify / align）" desc="justify 主轴对齐（space-between 把两端顶开），align 交叉轴对齐" :has-output="false" :code="codes.align">
      <template #demo>
        <p-inline class="row space" :gap="8" justify="space-between" align="center">
            <p-text class="chip">左</p-text>
            <p-text class="chip">中</p-text>
            <p-text class="chip">右</p-text>
          </p-inline>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.row { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-bottom: var(--sp-2); }
.row.space { background: #eef2ff; }
.chip { background: #dbeafe; border-radius: var(--sp-radius-sm); padding: 2px 8px; }
</style>
