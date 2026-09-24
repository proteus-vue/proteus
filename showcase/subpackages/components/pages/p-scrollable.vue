<!-- showcase/subpackages/components/pages/p-scrollable.vue —— p-scrollable 可滚动区域 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-scrollable.md ← gen-content.mjs ← packages/components/p-scrollable/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PScrollable, PText } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  basic: "<!-- height 固定滚动区；触底 40px 内 emit load-more -->\n<p-scrollable :height=\"160\" load-more :loading=\"loading\" @load-more=\"onLoadMore\">\n  <p-text>内容</p-text>\n</p-scrollable>",
})

const scLog = ref('（滚动看看）')
const scLoading = ref(false)
function onLoadMore(): void {
  scLog.value = '触底 → load-more 触发 · ' + Date.now().toString().slice(-4)
  scLoading.value = true
  setTimeout(() => {
    scLoading.value = false
  }, 900)
}

const apiRows = ref([
  [
    "bounce",
    "弹性滚动（iOS 橡皮筋）",
    "Boolean"
  ],
  [
    "refresh",
    "下拉刷新（语义声明——原生实现批次接入）",
    "Boolean"
  ],
  [
    "loadMore",
    "触底加载更多",
    "Boolean"
  ],
  [
    "loading",
    "加载中（footer 文案切换）",
    "Boolean"
  ],
  [
    "height",
    "可视高度 px（0=继承/自适应）",
    "Number"
  ]
])
const eventRows = ref([
  [
    "load-more",
    "加载更多（触底翻页）",
    "—"
  ],
  [
    "refresh",
    "刷新触发",
    "—"
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
    "skyline（WebView 降级） · 原生控件映射 → <movable-area>（L1 原语）"
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
  <page-shell title="p-scrollable 可滚动区域" subtitle="手势 · 滚动 + 加载更多 · 双端同源码">
    <demo-block index="01" title="触底加载更多（loadMore / load-more / loading）" desc="★滚动到底部（触底 40px 内）会 emit load-more 并回显——真滚动触发，不是点击模拟" :has-output="true" :code="codes.basic">
      <template #demo>
        <p-scrollable class="sc-box" :height="160" load-more :loading="scLoading" @load-more="onLoadMore">
            <p-text v-for="i in 14" :key="i" class="scroll-line">第 {{ i }} 行（滚到底部触发加载）</p-text>
          </p-scrollable>
      </template>
      <template #output>
        <p-text class="out">{{ scLog }}（loading 时页脚显示「加载中…」）</p-text>
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.sc-box { background: #f7f8fa; border-radius: var(--sp-radius-sm); padding: var(--sp-2); }
.scroll-line { display: block; padding: 6px 0; border-bottom: 1px solid #eceef2; }
</style>
