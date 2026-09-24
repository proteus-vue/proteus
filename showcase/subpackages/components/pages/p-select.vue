<!-- showcase/subpackages/components/pages/p-select.vue —— p-select 选择器 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-select.md ← gen-content.mjs ← packages/components/p-select/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PSelect, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  single: "<!-- 单选（默认）-->\n<p-select :options=\"options\" placeholder=\"请选择\" />",
  multi: "<!-- 多选：modelValue 为数组 -->\n<p-select :options=\"options\" multiple :model-value=\"[]\" />",
})

const selValue = ref('')
const selMultiple = ref<string[]>([])
const selOptions = ref([
  { value: 'vue', label: 'Vue' },
  { value: 'react', label: 'React' },
  { value: 'svelte', label: 'Svelte' },
])
function onSelChange(v: unknown): void {
  selValue.value = String(v)
}
function onMultiChange(v: unknown): void {
  selMultiple.value = Array.isArray(v) ? (v as string[]).map(String) : []
}

const apiRows = ref([
  [
    "options",
    "选项 [{value,label}?]",
    "Array as () => Array<{ value?: string | number; label?: string }>"
  ],
  [
    "modelValue",
    "单选值 或 多选值数组",
    "[String, Number, Array]"
  ],
  [
    "multiple",
    "多选模式",
    "Boolean"
  ],
  [
    "placeholder",
    "占位文本",
    "String"
  ],
  [
    "searchable",
    "搜索（B2 占位声明——后续批次实现）",
    "Boolean"
  ],
  [
    "cascader",
    "级联（B2 占位声明——后续批次实现）",
    "Boolean"
  ]
])
const eventRows = ref([
  [
    "update:modelValue",
    "v-model 双向绑定：v-model 值变化时触发（同步父级绑定）",
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
    "skyline（WebView 降级） · 原生控件映射 → <picker>（L1 原语） · <selection>（L1 原语）"
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
  <page-shell title="p-select 选择器" subtitle="内容与表单 · ui.select · 双端同源码">
    <demo-block index="01" title="单选（options + placeholder）" desc="★点选择器展开选项；选中后回显 label，change 同步 modelValue" :has-output="true" :code="codes.single">
      <template #demo>
        <p-select :options="selOptions" placeholder="请选择一个框架" :model-value="selValue" @update:model-value="onSelChange" />
      </template>
      <template #output>
        <p-text class="out">当前值：{{ selValue || "（未选择）" }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="多选（multiple）" desc="multiple 开启后 modelValue 为数组，可多选累加" :has-output="false" :code="codes.multi">
      <template #demo>
        <p-select :options="selOptions" multiple placeholder="可多选" :model-value="selMultiple" @update:model-value="onMultiChange" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
