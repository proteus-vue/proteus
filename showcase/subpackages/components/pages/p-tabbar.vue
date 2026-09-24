<!-- showcase/subpackages/components/pages/p-tabbar.vue —— p-tabbar 底部标签栏 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-tabbar.md ← gen-content.mjs ← packages/components/p-tabbar/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PTabbar, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- tabs: [{key,label,icon?}]；active 受控 + select 事件 -->\n<p-tabbar :tabs=\"tabs\" v-model:active=\"active\" @select=\"onSelect\" />",
})

const tabActive = ref('home')
const tabLast = ref('（暂无）')
const tabTabs = ref([
  { key: 'home', label: '首页' },
  { key: 'find', label: '发现' },
  { key: 'mine', label: '我的' },
])
function onTabSelect(k: unknown): void {
  tabLast.value = String(k)
}

const apiRows = ref([
  [
    "tabs",
    "标签项数组（{key,label,badge?,icon?}）",
    "Array as () => TabItem[]"
  ],
  [
    "active",
    "当前激活项 key",
    "[String, Number]"
  ]
])
const eventRows = ref([
  [
    "update:active",
    "v-model 双向绑定：active变化时触发（同步父级绑定）",
    "key"
  ],
  [
    "select",
    "选中某项",
    "key"
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
  <page-shell title="p-tabbar 底部标签栏" subtitle="页面外壳 · shell.tabbar · 双端同源码">
    <demo-block index="01" title="受控切换（tabs / active / select）" desc="★点标签项切换激活态；select 事件回传 key（v-model:active 同步回写）" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-tabbar :tabs="tabTabs" v-model:active="tabActive" @select="onTabSelect" />
      </template>
      <template #output>
        <p-text class="out">当前：{{ tabActive }} · 最后 select：{{ tabLast }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
