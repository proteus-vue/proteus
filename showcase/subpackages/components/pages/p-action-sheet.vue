<!-- showcase/subpackages/components/pages/p-action-sheet.vue —— p-action-sheet 动作面板 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-action-sheet.md ← gen-content.mjs ← packages/components/p-action-sheet/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PActionSheet, PButton, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- actions: [{label, value?, color?}]；select / cancel 事件 -->\n<p-action-sheet v-model=\"open\" :actions=\"actions\" cancel-text=\"取消\"\n  @select=\"onSelect\" @cancel=\"onCancel\" />",
})

const sheetVisible = ref(false)
const sheetLast = ref('（暂无）')
const sheetActions = ref([
  { label: '拍照' },
  { label: '从相册选择' },
  { label: '删除', color: '#e54d42' },
])
function openSheet(): void {
  sheetVisible.value = true
}
function onSheetSelect(v: unknown): void {
  sheetLast.value = '选中：' + String(v)
}
function onSheetCancel(): void {
  sheetLast.value = '取消'
}

const apiRows = ref([
  [
    "modelValue",
    "显隐（v-model）",
    "Boolean"
  ],
  [
    "actions",
    "动作项 [{label,value?,color?}]",
    "Array as () => ActionItem[]"
  ],
  [
    "cancelText",
    "取消文案",
    "String"
  ]
])
const eventRows = ref([
  [
    "update:modelValue",
    "v-model 双向绑定：v-model 值变化时触发（同步父级绑定）",
    "false"
  ],
  [
    "select",
    "选中某项",
    "v == null ? '' : v"
  ],
  [
    "cancel",
    "取消/关闭",
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
  <page-shell title="p-action-sheet 动作面板" subtitle="页面外壳 · 底部动作面板 · 双端同源码">
    <demo-block index="01" title="动作项 + 危险色 + 取消（actions / select / cancel）" desc="★点按钮弹出；点动作项 emit select 并自动关闭，点取消 emit cancel；color 给单项着色（如删除用红）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button size="small" @click="openSheet">打开动作面板</p-button>
          <p-action-sheet v-model="sheetVisible" :actions="sheetActions" cancel-text="取消"
            @select="onSheetSelect" @cancel="onSheetCancel" />
      </template>
      <template #output>
        <p-text class="out">{{ sheetLast }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
