<!-- showcase/subpackages/components/pages/p-keyboard-accessory.vue —— p-keyboard-accessory 键盘上方工具栏 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-keyboard-accessory.md ← gen-content.mjs ← packages/components/p-keyboard-accessory/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PKeyboardAccessory, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- visible 缺省 undefined → 自动感知键盘高度；显式传值则可手动控制 -->\n<p-keyboard-accessory :visible=\"visible\" :max-height=\"200\">\n  <p-text>工具栏内容</p-text>\n</p-keyboard-accessory>",
})

const kaVisible = ref(false)
function toggleKa(): void {
  kaVisible.value = !kaVisible.value
}

const apiRows = ref([
  [
    "visible",
    "是否可见（受控；不传则由键盘高度自动判定）",
    "Boolean"
  ],
  [
    "maxHeight",
    "工具栏最大高度 px（对齐官方 200px 上限）",
    "Number"
  ],
  [
    "background",
    "背景色（缺省白）",
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
    "skyline（WebView 降级） · 原生控件映射 → <keyboard-accessory>（L1 原语）"
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
  <page-shell title="p-keyboard-accessory 键盘上方工具栏" subtitle="页面外壳 · 键盘附属栏 · 双端同源码">
    <demo-block index="01" title="显式控制显隐（visible 受控）" desc="★visible 不传 → 组件自动感知键盘高度（真机聚焦输入框时出现）；传布尔值 → 由页面控制。演示用**显式模式**展示样式与显隐（真实键盘检测需真机聚焦输入框）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button size="small" @click="toggleKa">{{ kaVisible ? '隐藏工具栏' : '显示工具栏' }}</p-button>
          <p-keyboard-accessory class="ka-box" :visible="kaVisible" :max-height="200">
            <p-text>工具栏（键盘上方固定，maxHeight 200px）</p-text>
          </p-keyboard-accessory>
      </template>
      <template #output>
        <p-text class="out">★自动模式：内部经 visualViewport 判定「视口高度 &lt; 基准高度 × 0.6」视为键盘弹起——真机上聚焦输入框即触发，无需业务代码</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.ka-box { background: #eef2ff; border: 1px solid #d6ddff; border-radius: var(--sp-radius-sm); padding: var(--sp-2); margin-top: var(--sp-2); }
</style>
