<!-- showcase/subpackages/components/pages/p-skeleton.vue —— p-skeleton 骨架屏 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-skeleton.md ← gen-content.mjs ← packages/components/p-skeleton/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PSkeleton, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- visible=false → 渲染真实内容（默认插槽） -->\n<p-skeleton :visible=\"loading\" avatar :lines=\"[90, 70, 80]\">\n  <p-text>真实内容</p-text>\n</p-skeleton>",
})

const skVisible = ref(true)
function toggleSkeleton(): void {
  skVisible.value = !skVisible.value
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
    "avatar",
    "是否头部头像形状（骨架屏）",
    "Boolean"
  ],
  [
    "lines",
    "行数（骨架屏占位行数）",
    "Array"
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
  <page-shell title="p-skeleton 骨架屏" subtitle="业务组件 · 骨架屏 · 双端同源码">
    <demo-block index="01" title="绑定加载态（visible 切换骨架 / 真实内容）" desc="★点按钮切换：visible=true 显示 shimmer 骨架，false 渲染默认插槽的真实内容——骨架屏的正确用法是「绑定加载态」，不是常驻" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button size="small" @click="toggleSkeleton">{{ skVisible ? '切换到真实内容' : '切换回骨架' }}</p-button>
          <p-skeleton :visible="skVisible" avatar :lines="[90, 70, 80]">
            <p-text>真实内容已就绪（骨架消失）</p-text>
          </p-skeleton>
      </template>
      <template #output>
        <p-text class="out">★lines 为数组（宽度百分比）——规避 MP `wx:for` 需数组、range 不可用</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
