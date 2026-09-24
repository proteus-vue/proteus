<!-- showcase/subpackages/components/pages/p-label.vue —— p-label 表单标签 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-label.md ← gen-content.mjs ← packages/components/p-label/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PInput, PLabel, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  for: "<!-- for 关联控件 id：点标签聚焦/切换该控件 -->\n<p-label for=\"demo-name\">用户名</p-label>\n<p-input id=\"demo-name\" placeholder=\"点上面的标签会聚焦这里\" />",
  block: "<!-- block：整行块级标签 -->\n<p-label :block=\"true\">整行标签</p-label>",
})

const labelClicks = ref('（暂无）')
function onLabelClick(): void {
  labelClicks.value = '已点击 · ' + Date.now().toString().slice(-4)
}

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "for",
    "关联控件的 id（对齐小程序 <label for> / HTML label for）",
    "String"
  ],
  [
    "block",
    "是否整行块级",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "---",
    "---",
    "---"
  ],
  [
    "click",
    "点击/轻触（throttle 节流后触发）",
    "e"
  ]
])
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
    "skyline（WebView 降级） · 原生控件映射 → <label>（L1 原语）"
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
  <page-shell title="p-label 表单标签" subtitle="UI 原语 · ui.label · 对齐小程序 <label>">
    <demo-block index="01" title="关联控件（for + 控件 id）" desc="★点「用户名」标签 → 下方输入框获得焦点（对齐小程序 <label for> 与 HTML label for 语义）；同时标签自身 emit click" :has-output="true" :code="codes.for">
      <template #demo>
        <p-label for="demo-name" @click="onLabelClick">用户名（点我聚焦输入框）</p-label>
          <p-input id="demo-name" placeholder="点上面的标签会聚焦这里" />
      </template>
      <template #output>
        <p-text class="out">标签点击：{{ labelClicks }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="块级标签（block）" desc="block=true → 整行块级（默认 inline-flex 与控件同行）" :has-output="false" :code="codes.block">
      <template #demo>
        <p-label :block="true" class="block-label">整行标签（display: block）</p-label>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.block-label { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
</style>
