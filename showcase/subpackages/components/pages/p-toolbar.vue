<!-- showcase/subpackages/components/pages/p-toolbar.vue —— p-toolbar 工具栏溢出折叠 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-toolbar.md ← gen-content.mjs ← packages/components/p-toolbar/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PToolbar } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- items: [{key,label}]；容器宽度不足时溢出项收进「更多」 -->\n<p-toolbar :items=\"items\" :item-width=\"80\" more-label=\"更多\" @select=\"onSelect\" />",
})

const tbLast = ref('（暂无）')
const tbItems = ref([
  { key: 'bold', label: '加粗' },
  { key: 'italic', label: '斜体' },
  { key: 'under', label: '下划线' },
  { key: 'strike', label: '删除线' },
  { key: 'code', label: '代码' },
  { key: 'link', label: '链接' },
  { key: 'image', label: '图片' },
  { key: 'table', label: '表格' },
])
function onTbSelect(v: unknown): void {
  tbLast.value = String(v)
}

const apiRows = ref([
  [
    "items",
    "导航项（{ key, label }）",
    "Array"
  ],
  [
    "itemWidth",
    "单导航项宽度（px；溢出计算用）",
    "Number"
  ],
  [
    "moreWidth",
    "「更多」按钮宽度（px）",
    "Number"
  ],
  [
    "moreLabel",
    "「更多」文案",
    "String"
  ]
])
const eventRows = ref([
  [
    "select",
    "选中某项",
    "String(ev?.currentTarget?.dataset?.value ?? '')"
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
  <page-shell title="p-toolbar 工具栏溢出折叠" subtitle="页面外壳 · 溢出折叠 · 双端同源码">
    <demo-block index="01" title="溢出折叠（items / itemWidth / moreLabel / select）" desc="★点任意项 emit select；容器不够宽时，放不下的项自动收进「更多」并显示数量角标（点「更多」展开）——★缩窄窗口可看到折叠变化" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-toolbar :items="tbItems" :item-width="72" more-label="更多" @select="onTbSelect" />
      </template>
      <template #output>
        <p-text class="out">最后点击：{{ tbLast }}</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>
