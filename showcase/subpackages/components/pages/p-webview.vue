<!-- showcase/subpackages/components/pages/p-webview.vue —— p-webview 内嵌网页演示
     覆盖：src（远程 URL / 本地路径）/ height / sandbox / message & load & error 事件。
     ★双端：MP 原生 <web-view>（仅绝对 https 业务域名网页）；Web <iframe>（本地/远程均可）。
     ★诚实边界（已在组件内实现，本页展示）：小程序 <web-view> **不支持包内本地 HTML**（平台限制），
       MP 端遇本地路径显示明确提示而非空白；远程网页需在小程序后台配置业务域名。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../../../components/page-shell/index.vue'
import DemoBlock from '../../../components/demo-block/index.vue'
import ApiTable from '../../../components/api-table/index.vue'
import { PWebview, PText } from '@proteus-vue/components'

const state = ref('等待 load / error 事件…')
function onLoad(e: unknown) { const d = e as { src?: string }; state.value = 'load：' + (d?.src ?? '(已加载)') }
function onError(e: unknown) { state.value = 'error：' + JSON.stringify(e) }

const remote = ref('https://example.com')
const local = ref('/about')

const codes = ref({
  remote: '<p-webview src="https://example.com" :height="240" />',
  local: '<p-webview src="/about" :height="240" />',
  events: '<p-webview src="…" @load="onLoad" @error="onError" @message="onMessage" />',
})

const apiRows = ref([
  ['src', '网页地址（★官方 src；MP 端须为业务域名内的绝对 https 地址）', 'string'],
  ['height', '高度 px（0=撑满父容器）', 'number'],
  ['sandbox', 'Web iframe 沙箱策略（默认 allow-scripts allow-forms allow-same-origin）', 'string'],
  ['mpLocalHint', 'MP 端 src 非 URL 时的提示文案（框架扩展，诚实标注平台限制）', 'string'],
])
const eventRows = ref([
  ['load', '网页加载成功（★官方 bind:load，detail={src}）', '{ src }'],
  ['message', '网页 postMessage（★官方 bind:message）', 'event'],
  ['error', '网页加载失败（★官方 bind:error，detail={url,fullUrl}）', '{ url, fullUrl }'],
])
const slotRows = ref([['—', 'p-webview 无插槽', '—']])
</script>

<template>
  <page-shell title="p-webview 内嵌网页" subtitle="页面外壳 · 承载宿主 WebView / iframe">
    <demo-block index="01" title="远程网页" :has-output="true"
      desc="Web 用 iframe 直接加载；MP 需配置业务域名（未配置时平台拒绝加载）" :code="codes.remote">
      <template #demo>
        <p-webview :src="remote" :height="240" @load="onLoad" @error="onError" />
      </template>
      <template #output><p-text class="out">{{ state }}</p-text></template>
    </demo-block>

    <demo-block index="02" title="本地路径（诚实降级）"
      desc="Web 端 iframe 可加载包内页面；★MP 端平台不支持包内本地 HTML → 显示明确提示" :code="codes.local">
      <template #demo>
        <p-webview :src="local" :height="240" />
      </template>
    </demo-block>

    <demo-block index="03" title="事件契约" desc="load / error / message 跨端同名（Web iframe 同语义触发）" :code="codes.events">
      <template #demo>
        <p-webview :src="remote" :height="200" @load="onLoad" @error="onError" />
      </template>
    </demo-block>

    <api-table title="Props" :columns="['属性', '说明', '类型']" :rows="apiRows" />
    <api-table title="Events" :columns="['事件', '说明', '载荷']" :rows="eventRows" />
    <api-table title="Slots" :columns="['插槽', '说明', '作用域']" :rows="slotRows" />
  </page-shell>
</template>

<style scoped>
.out { display: block; font-size: 12.5px; color: #2f7a4d; }
</style>
