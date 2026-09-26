<!-- showcase/subpackages/components/pages/p-webview.vue —— p-webview 内嵌网页 组件演示（官方形态）
     ★由 scripts/gen-component-demo-pages.mjs 生成（勿手改——改数据表后重跑）。
     ★API 三表（Props / Events / 插槽）+ 兼容进度**从官网内容 SSOT 解析**
       （website/content/components/p-webview.md ← gen-content.mjs ← packages/components/p-webview/index.vue）
       ——组件改了源码，check:content 与本页门禁都会红，页面不会「悄悄过时」。
     ★演示部分（各 demo 块的用法与状态）逐组件手写——页面的价值所在，无法机械化。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PText, PWebview } from '@proteus-vue/components'

// ★代码片段放 data（含 < > " 的属性字面量会破坏 WXML 解析）
const codes = ref({
  remote: "<p-webview src=\"https://example.com\" :height=\"240\" />",
  local: "<p-webview src=\"/about\" :height=\"240\" />",
  events: "<p-webview src=\"…\" @load=\"onLoad\" @error=\"onError\" @message=\"onMessage\" />",
})

const state = ref('等待 load / error 事件…')
function onLoad(e: unknown) { const d = e as { src?: string }; state.value = 'load：' + (d?.src ?? '(已加载)') }
function onError(e: unknown) { state.value = 'error：' + JSON.stringify(e) }

const remote = ref('https://example.com')
const local = ref('/about')

const apiRows = ref([
  [
    "src",
    "网页地址（对齐 src）",
    "String"
  ],
  [
    "height",
    "高度 px（Web 容器；缺省撑满父容器）",
    "Number"
  ],
  [
    "sandbox",
    "Web iframe 沙箱策略（缺省允许脚本/表单/同源）",
    "String"
  ],
  [
    "mpLocalHint",
    "MP 端 src 非 URL 时的占位文案（诚实边界：小程序 <web-view> 不支持包内本地 HTML）",
    "String"
  ]
])
const eventRows = ref([
  [
    "message",
    "—",
    "e"
  ],
  [
    "load",
    "加载完成",
    "e"
  ],
  [
    "error",
    "加载/执行失败",
    "e"
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
    "skyline（WebView 降级） · 原生控件映射 → <web-view>（L1 原语）"
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
  <page-shell title="p-webview 内嵌网页" subtitle="页面外壳 · 承载宿主 WebView / iframe">
    <demo-block index="01" title="远程网页" desc="Web 用 iframe 直接加载；MP 需配置业务域名（未配置时平台拒绝加载）" :has-output="true" :code="codes.remote">
      <template #demo>
        <p-webview :src="remote" :height="240" @load="onLoad" @error="onError" />
      </template>
      <template #output>
        <p-text class="out">{{ state }}</p-text>
      </template>
    </demo-block>

    <demo-block index="02" title="本地路径（诚实降级）" desc="Web 端 iframe 可加载包内页面；★MP 端平台不支持包内本地 HTML → 显示明确提示" :has-output="false" :code="codes.local">
      <template #demo>
        <p-webview :src="local" :height="240" />
      </template>
    </demo-block>

    <demo-block index="03" title="事件契约" desc="load / error / message 跨端同名（Web iframe 同语义触发）" :has-output="false" :code="codes.events">
      <template #demo>
        <p-webview :src="remote" :height="200" @load="onLoad" @error="onError" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="插槽" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
    <api-table title="双端兼容进度" :columns="['端', '说明', '状态']" :rows="compatRows" />
  </page-shell>
</template>

<style scoped>
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
