<!-- showcase/subpackages/components/pages/p-selection.vue —— p-selection 局部文本选区 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-selection.md ← gen-content.mjs ← packages/components/p-selection/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSelection, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- 选区变化 emit selectionchange（载荷对齐小程序 event.detail） -->\n<p-selection @selectionchange=\"onSel\">\n  <p-text>可划选的文本内容…</p-text>\n</p-selection>",
})

const selDetail = ref('（用鼠标/手指划选上方文本试试）')
function onSelectionChange(d: unknown): void {
  const p = d as { isCollapsed?: boolean; selectedString?: string; firstOffset?: number; lastOffset?: number }
  selDetail.value = p?.isCollapsed
    ? '选区已折叠（未选中内容）'
    : `选中 "${p?.selectedString ?? ''}"（偏移 ${p?.firstOffset ?? 0}→${p?.lastOffset ?? 0}）`
}

const apiRows = ref([
  [
    "disableContextMenu",
    "是否隐藏客户端原生文本选区按钮（对齐 disable-context-menu）",
    "Boolean"
  ],
  [
    "selectable",
    "用户选择文本是否可选（映射 CSS user-select）",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "selectionchange",
    "—",
    "detail"
  ]
])
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
    "skyline（WebView 降级） · 原生控件映射 → <selection>（L1 原语）"
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
  <page-shell title="p-selection 局部文本选区" subtitle="内容与表单 · ui.selection · 双端同源码">
    <demo-block index="01" title="划选文本 → selectionchange 载荷" desc="★用鼠标拖拽划选下方文本：选中内容与偏移量会实时回显（载荷 isCollapsed / selectedString / firstOffset / lastOffset 对齐小程序同名事件）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-selection class="sel-box" @selectionchange="onSelectionChange">
            <p-text>这是一段可以划选的文本内容。选中其中几个字，下方会实时显示选中的字符串与起止偏移——选区语义与小程序 selectionchange 事件对齐。</p-text>
          </p-selection>
      </template>
      <template #output>
        <p-text class="out">{{ selDetail }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.sel-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-3); user-select: text; }
</style>
