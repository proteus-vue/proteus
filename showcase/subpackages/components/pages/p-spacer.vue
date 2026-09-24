<!-- showcase/subpackages/components/pages/p-spacer.vue —— p-spacer 弹性空白 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-spacer.md ← gen-content.mjs ← packages/components/p-spacer/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSpacer, PStack, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 撑开左右两侧：把中间内容推向另一侧 -->\n<p-stack direction=\"row\">\n  <p-text>左</p-text>\n  <p-spacer />\n  <p-text>右</p-text>\n</p-stack>",
  grow: "<!-- 按比例分配剩余空间（grow=2 : grow=1） -->\n<p-spacer :grow=\"2\" />\n<p-spacer :grow=\"1\" />",
})

const spacerGrow = ref(1)

const apiRows = ref([
  [
    "grow",
    "弹性增长比例（默认 1——占满剩余空间）",
    "Number"
  ],
  [
    "shrink",
    "收缩比例（默认 1）",
    "Number"
  ],
  [
    "minSize",
    "自身尺寸下限 px（保证可见/可点）",
    "Number"
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
  <page-shell title="p-spacer 弹性空白" subtitle="布局原语 · layout.spacer · 双端同源码">
    <demo-block index="01" title="撑开两侧（默认 grow=1）" desc="弹性占用剩余空间（对齐 flex:1）——把后一个元素推到容器另一端" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-stack class="row-demo" direction="row">
            <p-text class="chip">左</p-text>
            <p-spacer />
            <p-text class="chip">右（被推到末端）</p-text>
          </p-stack>
      </template>
      <template #output>
        <p-text class="out">左 / 右 分居两端——中间的 p-spacer 吃掉了全部剩余空间</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="按比例分配（grow）" desc="两个 spacer 的 grow 为 2:1 → 剩余空间按比例切分" :has-output="false" :code="codes.grow">
      <template #demo>
        <p-stack class="row-demo" direction="row">
            <p-text class="chip">A</p-text>
            <p-spacer :grow="2" />
            <p-text class="chip">B</p-text>
            <p-spacer :grow="1" />
            <p-text class="chip">C</p-text>
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
.chip { background: #eef2ff; border-radius: var(--sp-radius-sm); padding: 4px 8px; }
</style>
