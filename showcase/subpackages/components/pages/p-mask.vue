<!-- showcase/subpackages/components/pages/p-mask.vue —— p-mask 遮罩 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-mask.md ← gen-content.mjs ← packages/components/p-mask/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PMask, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- visible 受控；close-on-tap 缺省开启（点遮罩 emit close） -->\n<p-mask :visible=\"maskVisible\" :opacity=\"0.5\" @close=\"onMaskClose\" />",
})

const maskVisible = ref(false)
function showMask(): void {
  maskVisible.value = true
}
function onMaskClose(): void {
  maskVisible.value = false
}

const apiRows = ref([
  [
    "---",
    "---",
    "---"
  ],
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
    "visible",
    "是否可见（显隐由响应式数据驱动，零平台分支）",
    "Boolean"
  ],
  [
    "opacity",
    "透明度（0-1）",
    "Number"
  ],
  [
    "closeOnTap",
    "点击后是否自动关闭",
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
    "close",
    "关闭",
    "—"
  ]
])
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
  <page-shell title="p-mask 遮罩" subtitle="页面外壳 · 弹层体系基调 · 双端同源码">
    <demo-block index="01" title="显隐与点击关闭（visible + closeOnTap）" desc="★点按钮显示遮罩 → **点遮罩本体关闭**（closeOnTap 缺省 true，emit close 由父置 visible=false）；遮罩无动画，动画由弹层组件自行编排" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button size="small" @click="showMask">显示遮罩（点遮罩关闭）</p-button>
          <p-mask :visible="maskVisible" :opacity="0.45" @close="onMaskClose" />
      </template>
      <template #output>
        <p-text class="out">★遮罩是 fixed 全屏（z-index 1000）：显示期间会挡住下层交互——这正是遮罩的目的；关闭由 closeOnTap 的 close 事件驱动</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
