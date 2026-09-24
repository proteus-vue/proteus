<!-- showcase/subpackages/components/pages/p-segment.vue —— p-segment 分段控制器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-segment.md ← gen-content.mjs ← packages/components/p-segment/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSegment, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- options + v-model:active 受控 -->\n<p-segment :options=\"options\" v-model:active=\"active\" @select=\"onSelect\" />",
})

const segActive = ref('全部')
const segLast = ref('（暂无）')
const segOptions = ref([
  { label: '全部' },
  { label: '进行中' },
  { label: '已完成' },
])
function onSegSelect(v: unknown): void {
  segLast.value = String(v)
}

const apiRows = ref([
  [
    "options",
    "分段项 [{label,value?}?]（value 缺省=label）",
    "Array as () => SegmentItem[]"
  ],
  [
    "active",
    "当前激活项 value",
    "[String, Number]"
  ]
])
const eventRows = ref([
  [
    "update:active",
    "v-model 双向绑定：active变化时触发（同步父级绑定）",
    "s"
  ],
  [
    "select",
    "选中某项",
    "s"
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
  <page-shell title="p-segment 分段控制器" subtitle="页面外壳 · shell.segment · 双端同源码">
    <demo-block index="01" title="受控分段（options + v-model:active + select）" desc="★点选项切换激活态；select 事件回传选中值（载荷两端一致：Web 为裸载荷、MP 为 e.detail）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-segment :options="segOptions" v-model:active="segActive" @select="onSegSelect" />
      </template>
      <template #output>
        <p-text class="out">当前：{{ segActive }} · 最后 select：{{ segLast }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
