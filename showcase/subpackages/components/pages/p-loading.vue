<!-- showcase/subpackages/components/pages/p-loading.vue —— p-loading 加载中 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-loading.md ← gen-content.mjs ← packages/components/p-loading/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PButton, PLoading, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- visible 受控；不自动关闭（由页面控制） -->\n<p-loading :visible=\"loading\" text=\"加载中…\" />\n\n// 页面侧：数据就绪后收起\nloading.value = false",
})

const loadingVisible = ref(false)
/** ★由**页面**控制关闭（组件不自动关闭——这是 p-loading 的设计契约）。
 *  演示按真实用法：显示 1.5s 后由页面收起。★不要做「再点一次关闭」的演示——
 *  遮罩是 fixed 全屏（z-index 1000）会拦截点击，按钮在遮罩后面点不到。 */
function showLoading(): void {
  loadingVisible.value = true
  window.setTimeout(() => {
    loadingVisible.value = false
  }, 1500)
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
    "text",
    "显示文本",
    "String"
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
  <page-shell title="p-loading 加载中" subtitle="业务组件 · 加载态遮罩 · 双端同源码">
    <demo-block index="01" title="受控显示（visible + text）" desc="★点按钮显示 1.5s 后自动收起（模拟「加载 → 数据就绪 → 页面收起」的真实用法）；组件本身**不自动关闭**" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-button size="small" @click="showLoading">显示加载态（1.5s 后收起）</p-button>
          <p-loading :visible="loadingVisible" text="加载中…" />
      </template>
      <template #output>
        <p-text class="out">★遮罩是 fixed 全屏（阻断交互，这正是加载态的目的）；★加载环用「统一色 border 环 + 随转子元素点」——不用单边异色 border（Skyline 下会渲染成方块，四组对照实验定论）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
